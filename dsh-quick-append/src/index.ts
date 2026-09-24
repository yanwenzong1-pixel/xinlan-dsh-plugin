/**
 * @dsh-external/dsh-quick-append — host half (v0.3.1).
 *
 * v0.3.1（宿主策略单点）：
 * - **模型与思考强度由宿主决定**：默认 `deepseek-flash`（DeepSeek-V41-Flash，适配器目录
 *   contextWindow 与 vision-exp 同为 1M 档、inputModalities 含 image ⇒ 图片通道不丢）、
 *   思考强度默认 `max`。客户端不再发送 `model` / `reasoningEffort`，弹窗不再暴露控件。
 *   payload 仍接受这两个字段（向后兼容旧客户端），经归一化兜底到上述默认值。
 * - 多模态：客户端上传图片（base64）经 ctx.attachments.saveImage 准入生成 ImageAttachmentRef，
 *   与正文按序合并进同一条 user 消息（harness 多模态消息协议 ImageBlock）；
 *   全部图片准入失败 → 降级纯文本并在结果中标注「未采纳图片信息」（响应 imagesDropped=true）。
 * - 容错：输出为 JSON 信封 {"optimized","imageNote"}，解析走 extractJSON 多路兜底；
 *   瞬态失败（调用错误/超时/空输出/解析失败）重试 2 次（共 3 次尝试）；末次仍有非空正文 → 纯文本兜底；
 *   单次尝试超时 600s（1M 上下文 + 思考模式上调）；客户端断开立即中止上游流（不烧 token）。
 * - 证据日志：console.log 输出 model / reasoningEffort / contextWindow（1M 档位核查）。
 */
import type { Context } from 'cordis'
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { loadSpecContext, formatSpecContext } from './lib/spec-context.js'
import {
  DEFAULT_OPTIMIZE_MODEL,
  DEFAULT_REASONING_EFFORT,
  OPTIMIZE_PROVIDER,
  OPTIMIZE_MAX_ATTEMPTS,
  OPTIMIZE_TIMEOUT_MS,
  parseOptimizeResult,
  plainTextFallback,
  retryDecision,
  buildOptimizeSystemPrompt,
  buildOptimizeUserText,
  validateImagePayloads,
} from './lib/optimize.js'

export const name = '@dsh-external/dsh-quick-append'
// 铁律 3：访问 ctx.llm / ctx.attachments 前必须写入 inject。
export const inject = ['webServer', 'llm', 'attachments']

/** 请求体上限（含图片 base64；客户端单图已预处理 ≤4MB，64MB 覆盖多图场景）。 */
const MAX_BODY_BYTES = 64 << 20

/** 附件服务最小接口（结构兼容 ctx.attachments，避免直接依赖 dsh-attachment 类型）。 */
interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<unknown>
}

/** 模型元信息最小接口（ctx.llm.resolveModelInfo，用于 1M 上下文证据）。 */
interface LlmRuntimeLike {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  resolveModelInfo?: (provider: string, model: string) => Promise<{ context?: { contextWindow?: number } }>
}

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

function finishError(finish: { kind: string; failure?: { message?: string; code?: string } }): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure?.message ?? 'LLM call failed') as Error & { code?: string }
      error.code = finish.failure?.code
      return error
    }
    case 'max-tokens':
      return new Error('LLM output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('LLM unexpectedly requested a tool')
    default:
      return new Error('LLM call finished with an unknown reason')
  }
}

export function apply(ctx: Context): void {
  const webServer = (ctx as any).webServer
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-quick-append/api',
    handler: async (req: any, res: any) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      let payload: Record<string, unknown>
      try {
        payload = await readJsonBody(req)
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        return
      }
      const draft = typeof payload.draft === 'string' ? payload.draft : ''
      const context = typeof payload.context === 'string' ? payload.context : ''
      const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd()
      if (draft.trim() === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'draft is required' }))
        return
      }
      // 模型/思考强度：**纯宿主策略**，不从请求体读取。
      // 客户端已不再发送这两个字段（弹窗也不暴露控件）；若从 payload 读取，
      // 「客户端不再发送」这条契约就会退化成"看起来没发送但宿主仍接受覆盖"，
      // 冻结断言也随之失效 —— 故这里刻意只取常量。
      const model = DEFAULT_OPTIMIZE_MODEL
      const reasoningEffort = DEFAULT_REASONING_EFFORT

      // 图片：发送前校验（mediaType/base64 粗校验）；准入失败条目剔除；全部剔除 → 纯文本降级。
      const { images, dropped: payloadImagesDropped } = validateImagePayloads(payload.images)
      const attachments = (ctx as unknown as { attachments?: AttachmentStoreLike }).attachments
      const refs: unknown[] = []
      let admissionDropped = 0
      for (const image of images) {
        try {
          if (attachments === undefined) throw new Error('attachment service unavailable')
          const data = Buffer.from(image.data, 'base64')
          const ref = await attachments.saveImage({
            data,
            mediaType: image.mediaType,
            ...(image.name !== undefined ? { name: image.name } : {}),
          })
          refs.push(ref)
        } catch {
          admissionDropped += 1 // 准入失败 → 该图不纳入，其余照常
        }
      }
      const imagesDropped = payloadImagesDropped || (images.length > 0 && refs.length === 0)

      const specResult = await loadSpecContext(cwd)
      const specText = formatSpecContext(specResult)
      const userText = buildOptimizeUserText(draft, specText, context)
      // 多模态消息组装：正文 + 全部图片（附件顺序）合并进同一条 user 消息；1M 上下文不做截断。
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
      for (const ref of refs) content.push({ type: 'image', attachment: ref })
      const messages = [createUserMessage({
        content: content as any,
        source: { kind: 'user' },
      })]
      // 客户端断开立即中止上游流；超时按 1M+思考上调；两者取先到者。
      const aborter = new AbortController()
      res.on('close', () => aborter.abort())

      // 1M 上下文档位证据：读取模型上下文窗口元数据（仅日志，不影响路由）。
      const llm = ctx.llm as unknown as LlmRuntimeLike
      try {
        const info = await llm.resolveModelInfo?.(OPTIMIZE_PROVIDER, model)
        console.log(`[dsh-quick-append] optimize model=${model} reasoning=${reasoningEffort} contextWindow=${info?.context?.contextWindow ?? 'unknown'} images=${refs.length}`)
      } catch {
        console.log(`[dsh-quick-append] optimize model=${model} reasoning=${reasoningEffort} contextWindow=unresolved images=${refs.length}`)
      }

      let lastText = ''
      for (let attempt = 0; attempt < OPTIMIZE_MAX_ATTEMPTS; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(OPTIMIZE_TIMEOUT_MS)
        const signal = AbortSignal.any([aborter.signal, timeoutSignal])
        const options: GenerateOptions = {
          provider: OPTIMIZE_PROVIDER,
          model,
          reasoningEffort: ReasoningEffortId(reasoningEffort),
          system: buildOptimizeSystemPrompt(),
          messages,
          temperature: 0,
          maxTokens: 16384,
          signal,
        }
        let terminalError: Error | undefined
        try {
          const assembler = new BlockAssembler()
          for await (const chunk of llm.stream(options)) {
            assembler.push(chunk)
          }
          terminalError = finishError(assembler.finish)
          lastText = assembler.blocks()
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map(block => block.text)
            .join('\n')
        } catch (error) {
          terminalError = error instanceof Error ? error : new Error(String(error))
        }
        if (aborter.signal.aborted) return // 客户端断开：不再写响应，也不重试
        if (terminalError === undefined) {
          const parsedJson = parseOptimizeResult(lastText)
          const parsed = parsedJson ?? plainTextFallback(lastText)
          if (parsed !== null) {
            // 图片全部未纳入 → 在优化结果中明确标注（需求：不得静默丢弃图片信息）。
            let optimized = parsed.optimized
            if (images.length > 0 && refs.length === 0) {
              optimized += '\n\n（注：本次输入包含图片但未能纳入，已按纯文本优化，未采纳图片信息）'
            } else if (parsed.imageNote !== null && !optimized.includes('未采纳图片信息')) {
              optimized += `\n\n（图片信息说明：${parsed.imageNote}）`
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              ok: true,
              optimized,
              parsedVia: parsedJson !== null ? 'json' : 'text',
              imagesIncluded: refs.length,
              imagesDropped: imagesDropped || admissionDropped > 0,
            }))
            return
          }
          // 空输出/不可解析 → 瞬态失败，按需求重试 2 次
          console.log(`[dsh-quick-append] optimize parse failed attempt=${attempt + 1}/${OPTIMIZE_MAX_ATTEMPTS}`)
          if (retryDecision({ kind: 'transient' }, attempt)) continue
          terminalError = new Error('优化结果解析失败（重试 2 次后仍无法解析）')
        }
        if (retryDecision({ kind: 'transient' }, attempt)) {
          console.log(`[dsh-quick-append] optimize retry attempt=${attempt + 1}/${OPTIMIZE_MAX_ATTEMPTS} error=${terminalError.message}`)
          continue
        }
        if (res.writableEnded || res.destroyed) return
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: terminalError.message }))
        return
      }
      // 循环耗尽（理论不可达：attempt 2 必走 500 分支；防御性兜底）
      if (res.writableEnded || res.destroyed) return
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: '优化失败（重试耗尽）' }))
    },
  }), '@dsh-external/dsh-quick-append: optimize api')
}
