/**
 * 提示词优化链路纯逻辑（无 IO，可单测；Host/Client 共用）。
 *
 * v0.3.1 契约：
 * - 默认模型 deepseek-flash（DeepSeek-V41-Flash；适配器目录 contextWindow 与
 *   deepseek-v4-flash-vision-exp 同为默认 1M 档，且 inputModalities 含 image ⇒ 图片通道不丢）。
 * - 思考强度默认 max。**模型与思考强度是宿主策略**：客户端不再发送这两个字段，
 *   弹窗也不再暴露对应控件（避免"界面可覆盖"与"需求锁定"两套语义并存）。
 * - 输出为 JSON 信封 {"optimized": "...", "imageNote": "..."}；解析走 extractJSON 多路兜底；
 *   瞬态失败（调用错误/超时/空输出/解析失败）重试 2 次（共 3 次尝试）；末次仍失败 → 纯文本兜底。
 * - 单次尝试超时 OPTIMIZE_TIMEOUT_MS（1M 上下文 + 思考模式上调，避免长输入被超时打断）。
 */

/** 默认优化模型（需求锁定：deepseek-flash；如需换档，改此处并同步 host-optimize 门禁）。 */
export const DEFAULT_OPTIMIZE_MODEL = 'deepseek-flash'
/** 优化调用提供商路由（不变）。 */
export const OPTIMIZE_PROVIDER = 'deepseek-official'
/** 思考强度枚举（llm-deepseek 适配器实际支持的档位）。 */
export const REASONING_EFFORTS = ['off', 'low', 'high', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
/** 默认思考强度：max（需求：思考强度拉满）。 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'max'
/** 失败重试 2 次 = 共 3 次尝试。 */
export const OPTIMIZE_MAX_ATTEMPTS = 3
/** 单次尝试超时（ms）：按 1M 上下文与思考模式实际耗时上调。 */
export const OPTIMIZE_TIMEOUT_MS = 600_000

/**
 * 客户端 `/api/optimize` 请求体的字段契约（单一事实来源）。
 *
 * `model` / `reasoningEffort` 曾在此列，v0.3.1 起由宿主默认策略接管而移除；
 * 断言见 `test/optimize.test.mjs` 与 `test/client-shape.test.mjs`。
 */
export const OPTIMIZE_REQUEST_FIELDS = ['draft', 'context', 'cwd', 'images'] as const

const MODEL_PATTERN = /^[A-Za-z0-9._/-]{1,80}$/

/** 模型标识归一化：缺失/空白/非法字符/超长 → 默认模型；合法 → 去首尾空白。 */
export function normalizeModel(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_OPTIMIZE_MODEL
  const trimmed = input.trim()
  if (trimmed === '' || !MODEL_PATTERN.test(trimmed)) return DEFAULT_OPTIMIZE_MODEL
  return trimmed
}

/** 思考强度归一化：枚举内通过；其余（含大小写不符）→ 默认 max。 */
export function normalizeReasoningEffort(input: unknown): ReasoningEffort {
  return typeof input === 'string' && (REASONING_EFFORTS as readonly string[]).includes(input)
    ? input as ReasoningEffort
    : DEFAULT_REASONING_EFFORT
}

/** 平衡大括号扫描：自首个 { 起找匹配的 }，忽略字符串内花括号与转义。 */
function balancedBraces(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * extractJSON 多路兜底（纯函数）：① 整体解析；② markdown 代码围栏内（含 json 标注）；
 * ③ 首 { 到尾 } 子串；④ 平衡扫描取第一个完整对象。全部失败 → null。
 */
export function extractJSON(text: unknown): unknown {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  const candidates: string[] = [trimmed]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fenced !== null) candidates.push(fenced[1].trim())
  const first = trimmed.indexOf('{')
  const last = trimmed.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  const balanced = balancedBraces(trimmed)
  if (balanced !== null) candidates.push(balanced)
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch { /* 下一路 */ }
  }
  return null
}

/** 优化结果（解析成功）。 */
export interface ParsedOptimizeResult {
  /** 优化后的工程化提示词正文（已去首尾空白）。 */
  optimized: string
  /** 图片信息采纳情况说明（无/空 → null）。 */
  imageNote: string | null
}

/** 从 JSON 信封解析优化结果：optimized 必须为非空字符串；其余形状 → null（触发重试/兜底）。 */
export function parseOptimizeResult(text: unknown): ParsedOptimizeResult | null {
  const parsed = extractJSON(text)
  if (parsed === null || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (typeof o.optimized !== 'string' || o.optimized.trim() === '') return null
  return {
    optimized: o.optimized.trim(),
    imageNote: typeof o.imageNote === 'string' && o.imageNote.trim() !== '' ? o.imageNote.trim() : null,
  }
}

/** 纯文本兜底：非空文本直接作为优化结果（末次解析失败时的最后一路）。 */
export function plainTextFallback(text: unknown): ParsedOptimizeResult | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  return { optimized: trimmed, imageNote: null }
}

/** 重试失败分类：transient=可重试；client-aborted=客户端取消（永不重试）；none=无失败。 */
export type RetryFailure = { kind: 'transient' } | { kind: 'client-aborted' } | null

/** 失败重试判定：仅瞬态失败且未耗尽 2 次重试（attempt 0/1 → 重试，attempt 2 → 终止）。 */
export function retryDecision(failure: RetryFailure, attempt: number): boolean {
  if (failure === null || failure.kind !== 'transient') return false
  if (!Number.isInteger(attempt) || attempt < 0) return false
  return attempt < OPTIMIZE_MAX_ATTEMPTS - 1
}

/** 优化 System 约束：图片语义规则 + JSON 输出契约 + 确定性规则（temperature 0 由调用方保证）。 */
export function buildOptimizeSystemPrompt(): string {
  return `你是一个需求提示词工程标准化助手。
目标：将用户的模糊、口语化需求，转写为大模型能够理解的工程标准化话术。
规则：
- 不要向用户提问，不要输出问题列表。
- 必须基于提供的「规范上下文」「最近对话上下文」理解用户真实意图。
- 若本条消息包含图片：必须先读取图片视觉信息——包括但不限于图片中的文字（截图/长图/文档/弹窗）与图表/数据/曲线/K线/界面内容——将图片承载的信息视为用户真实意图的一部分参与提示词重构与补全；当图片内容无法识别或与文本无关时，必须在优化后的提示词中明确标注「未采纳图片信息」及原因，不得编造图片内容。
- 输出必须是合法 JSON 对象（禁止 markdown 代码块，直接输出 JSON）：{"optimized": "优化后的工程化提示词正文（不要解释）", "imageNote": "图片信息采纳情况说明；本条消息无图片时填空字符串"}。
- 如果信息不足，用通用工程术语补全可执行描述，不要脑补具体业务数据。`
}

/** 优化 user 文本：正文 + 规范上下文 + 最近对话上下文完整承载（不做截断）。 */
export function buildOptimizeUserText(draft: string, specText: string, context: string): string {
  return `用户需求：
${draft}

规范上下文：
${specText}

最近3轮对话上下文：
${context || '（无）'}

请按系统要求输出。`
}

/** 客户端上传的图片 payload（base64）。 */
export interface OptimizeImagePayload {
  mediaType: string
  data: string
  name?: string
}

const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** base64 非空粗校验（严格解码交给 host attachments 准入）。 */
function isNonEmptyBase64(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && /^[A-Za-z0-9+/=\s]+$/.test(v.trim())
}

/**
 * 图片 payload 校验：仅保留 mediaType 合法且 data 非空的条目；
 * 存在被剔除条目 → dropped=true（供降级提示）；未提供 images/非数组 → 空列表 + dropped=false。
 */
export function validateImagePayloads(raw: unknown): { images: OptimizeImagePayload[]; dropped: boolean } {
  if (!Array.isArray(raw)) return { images: [], dropped: false }
  const images: OptimizeImagePayload[] = []
  let dropped = false
  for (const item of raw) {
    if (item === null || typeof item !== 'object') { dropped = true; continue }
    const o = item as Record<string, unknown>
    if (typeof o.mediaType !== 'string' || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(o.mediaType)) { dropped = true; continue }
    if (!isNonEmptyBase64(o.data)) { dropped = true; continue }
    images.push({
      mediaType: o.mediaType,
      data: o.data.trim(),
      ...(typeof o.name === 'string' && o.name !== '' ? { name: o.name } : {}),
    })
  }
  return { images, dropped }
}
