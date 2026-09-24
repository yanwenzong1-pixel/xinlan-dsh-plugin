/**
 * @dsh-external/dsh-ptc-task —— PTC 子代理工位。
 *
 * 形态：主 agent 保持原生工具面；把「步骤事先能说清、中途不需要看结果再决定」的多步任务
 * 交给一个**工具以 PTC(code) 模式呈现**的子代理：它写一段 TypeScript 程序经 `run_code`
 * 组合多步操作，中间输出留在程序里，只有结论回到上下文。
 *
 * 为什么需要它：PTC 是 per-scope 的呈现方式（`ctx.tools.presentAs(mode)`，最近作用域生效），
 * 进程级开关（`DSH_TOOLS_MODE`）会把主 agent 也切过去。本插件用 `setup(agentCtx)` 只在
 * **子代理作用域**声明 code 模式，主会话原生不动。
 *
 * 两条实测踩过的坑，代码里都做了兜底：
 * 1. 子代理的 prompt 会把 `{{model}}`/`{{cwd}}` 严格插值到 `agent.options` 上
 *    （packages/core/agent-loop/src/index.ts: `ctx.systemPrompt.variable('model', c => c.agent?.options.model)`）。
 *    所以**必须**把调用方的 provider/model 继承给子代理（官方 resolveChildAgentOptions 语义）；
 *    空 options 会让子代理第一步就 turn/end error，且请求从未发出（0 token、0 工具调用）——
 *    看起来像"跑完了没产物"，实际是"根本没开始"。解析不到路由时本工具直接报错，不派发。
 * 2. 子代理可能"看起来空闲"却什么都没做，所以返回前读它自己的 `turn/end` 原因；
 *    `turnEnd` 以 `error:` 开头即判定 `ok: false`。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'

export const name = '@dsh-external/dsh-ptc-task'

/** `agents`（创建子代理）、`tools`（作用域内呈现方式）、`timer`（墙钟上限）都是硬依赖。 */
export const inject = ['tools', 'agents', 'timer']

export interface Config {
  /** 子代理挂载的 agent preset：它决定子代理的工具面与人格。默认 `ptc-code`。 */
  preset: string
  /** 调用方未显式传 `budgetMs` 时的墙钟上限（毫秒）。 */
  defaultBudgetMs: number
  /**
   * 子代理作用域内**拒绝**的全局工具名（默认 `['ptc_task']` = 禁止递归派发）。
   * 只对全局工具有效；预设行注册的 scoped 工具（subagent/workflow/ralph 等）不归它管。
   * 名字必须是真实存在的全局工具，否则 `restrict()` 会拒绝——拒绝原因会写进 `setupNote`。
   */
  denyTools: string[]
  /**
   * **递归护栏装不上时是否拒绝派发**（默认 `true` = fail-closed）。
   *
   * 【为什么必须默认拒绝（2026-09-17 死循环缺陷）】旧实现把 `restrict()` 的异常写成一行
   * `setupNote` 后**照常派发**：护栏没装上时子代理仍可再调 `ptc_task`，于是每层再派 N 个、
   * 指数级重复执行同一件事。护栏是**终止性前提**而不是"nice to have"，缺了它宁可不起子代理。
   * 显式把 `denyTools` 配成空数组 = 主动声明"不要护栏"⇒ 本项不生效（保持兼容）。
   */
  requireRecursionGuard: boolean
  /**
   * 同一任务**连续失败**达到该次数后熔断（默认 3；`0` = 关闭）。
   *
   * 【为什么需要】失败返回值里的提示本身就在邀请调用方"重派"，而插件侧没有任何计数上限
   * ⇒ create→fail→create 可以无限循环。熔断把这条回路截断，并明确告诉调用方"别再自动重派"。
   */
  maxConsecutiveFailures: number
  /** 熔断窗口（毫秒，默认 600000 = 10 分钟）：超过窗口的旧失败不计入连续失败。 */
  circuitWindowMs: number
}

export const Config = z.object({
  preset: z.string().default('ptc-code'),
  defaultBudgetMs: z.number().default(1200000),
  denyTools: z.array(z.string()).default(['ptc_task']),
  requireRecursionGuard: z.boolean().default(true),
  maxConsecutiveFailures: z.number().default(3),
  circuitWindowMs: z.number().default(600000),
})

/** 由调用方路由解析出的子代理选项（字段与官方 `AgentOptions` 对齐）。 */
interface RouteOptions {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
  subagentDepth?: number
}

/** 本工具真正需要的那一小片 Agent 面（不依赖 dsh-agent 的类型声明）。 */
interface AgentLike {
  options?: RouteOptions
  session?: SessionLike
  followup(message: unknown): void
  whenIdle(): Promise<unknown>
}

interface SessionLike {
  header?: {
    id?: string
    cwd?: string
    /**
     * 子代理标记与会话深度（`packages/core/session/src/types.ts#SessionHeader` 的**顶层**字段）。
     * 框架把 `delegationDepth` 定义为 "recursion budget"（重启/续跑后仍保留）——
     * 本插件用它做**结构性**的递归兜底：调用方已是子代理 ⇒ 一律拒绝派发。
     */
    origin?: 'subagent'
    delegationDepth?: number
  }
  requestHeader?: () => { config?: RouteOptions } | undefined
  snapshotEvents?: () => Array<{ type: string; data?: { reason?: { kind?: string; error?: unknown } } }>
}

interface AgentHandleLike {
  agent?: AgentLike
  dispose?: () => unknown
}

interface AgentsServiceLike {
  create(options: Record<string, unknown>): Promise<AgentHandleLike>
}

interface ToolsServiceLike {
  presentAs(mode: 'native' | 'code' | 'both'): unknown
  /** 作用域内的全局工具过滤（`ToolRestriction`）：拒绝的名字必须是**已存在的全局工具**。 */
  restrict?(filter: { deny: string[] }): unknown
}

interface AgentCtxLike {
  get(name: string): unknown
}

/** 工具结果必须是 JSON 值（注册表的 `JsonValue` 约束），这里只出现可序列化叶子。 */
type ToolResult = Record<string, string | number | boolean | null>

/** 工具入参（与 schema 同形）。 */
interface PtcTaskArgs {
  prompt?: string
  resultPath?: string
  cwd?: string
  budgetMs?: number
  model?: string
  reasoningEffort?: string
}

const DESCRIPTION =
  '把一个步骤已经确定、无需探索的多步任务交给 PTC 作用域的子代理执行：'
  + '子代理的工具以 PTC 模式呈现（它写一段 TypeScript 程序经 run_code 组合多步操作，中间输出留在程序里），主会话保持原生。'
  + '子代理空闲后本工具返回其 sessionId 与 resultPath，主 agent 直接读产物即可。'
  + '适用：批量/确定流程（逐项跑脚本、扫描、对账、聚合汇总）。'
  + '不适用：需要边看结果再判断的探索型任务。'
  + '要求：prompt 自包含并写明判据，且要求子代理把最终结果写入 resultPath。'

/**
 * 把调用方的路由继承给子代理。
 * 语义照抄官方 `resolveChildAgentOptions`：先取创建期 options，再让最近一次请求头覆盖路由字段；
 * 显式覆写优先；换了模型又没点名档位时清掉父级档位（让新模型用自己的默认）。
 * @param parent - 调用方 agent（`exec.agent`）。
 * @param modelArg - 调用方显式指定的模型。
 * @param effortArg - 调用方显式指定的推理档位。
 * @returns 传给 `agents.create` 的 `agentOptions`，或 undefined 表示无法解析路由。
 */
function inheritRoute(parent: AgentLike, modelArg: string, effortArg: string): RouteOptions | undefined {
  const inherited: RouteOptions = {}
  const base = parent.options ?? {}
  if (base.provider !== undefined) inherited.provider = base.provider
  if (base.model !== undefined) inherited.model = base.model
  if (base.reasoningEffort !== undefined) inherited.reasoningEffort = base.reasoningEffort
  if (base.maxTokens !== undefined) inherited.maxTokens = base.maxTokens
  try {
    const config = parent.session?.requestHeader?.()?.config
    if (config !== undefined) {
      if (config.provider !== undefined) inherited.provider = config.provider
      if (config.model !== undefined) inherited.model = config.model
      if (config.reasoningEffort !== undefined) inherited.reasoningEffort = config.reasoningEffort
    }
  } catch {
    // 请求头不可读时保留创建期 options 的结果。
  }
  if (modelArg !== '') inherited.model = modelArg
  if (effortArg !== '') inherited.reasoningEffort = effortArg
  else if (modelArg !== '' && modelArg !== (base.model ?? '')) delete inherited.reasoningEffort
  inherited.subagentDepth = 1
  return inherited.model === undefined || inherited.model === '' ? undefined : inherited
}

/** 读子代理最后一次 `turn/end` 的原因：成功返回档位名，失败返回 `error: <message>`。 */
function lastTurnEnd(agent: AgentLike): string {
  try {
    const events = agent.session?.snapshotEvents?.() ?? []
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event?.type !== 'turn/end') continue
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        const message = reason.error instanceof Error
          ? reason.error.message
          : typeof reason.error === 'object' && reason.error !== null && 'message' in reason.error
            ? String((reason.error as { message: unknown }).message)
            : String(reason.error)
        return `error: ${message}`
      }
      return reason?.kind ?? 'unknown'
    }
  } catch {
    return 'unreadable'
  }
  return 'unknown'
}

/**
 * 读调用方会话的**委派深度**（`SessionHeader.delegationDepth`，顶层字段）。
 *
 * 【为什么用深度而不是"工具是否可见"做递归兜底】把 `ptc_task` 从子代理的工具面上藏掉
 * （`restrict`）只是**降低概率**：护栏可能装不上（本文件已改成 fail-closed），
 * 而预设注册的 scoped 派发工具（subagent 等）本来就不受 `restrict` 管辖。
 * `delegationDepth` 是框架自己定义的 **recursion budget**（重启/续跑后仍保留），
 * 直接用它判定"调用方本身已是子代理"⇒ 与本插件的护栏是否生效无关，递归必然终止。
 * @param parent - 调用方 agent。
 * @returns 归一后的深度（非法/缺失 = 0 = 顶层会话）。
 */
function delegationDepthOf(parent: AgentLike): number {
  const header = parent.session?.header
  const raw = header?.delegationDepth
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw
  // 只写了 origin 没写深度的实现（老版本/手工构造）按 1 算：宁可少派一次，也不要递归爆炸。
  return header?.origin === 'subagent' ? 1 : 0
}

/** 任务幂等键：同一件事（同一 preset/提示词/产出路径/工作目录/模型）必须落在同一把键上。 */
function taskKeyOf(input: {
  preset: string
  prompt: string
  resultPath: string
  cwd: string
  model: string
  effort: string
}): string {
  return [input.preset, input.resultPath.trim(), input.prompt.trim(), input.cwd.trim(), input.model, input.effort].join('\u0000')
}

/**
 * 注册 `ptc_task`。
 * @param ctx - 挂载作用域上下文（本插件装在宿主侧，工具对所有会话可见）。
 * @param config - 子代理 preset 与默认预算。
 */
export function apply(ctx: Context, config: Config): void {
  const defaults = config ?? {
    preset: 'ptc-code', defaultBudgetMs: 1_200_000, denyTools: ['ptc_task'],
    requireRecursionGuard: true, maxConsecutiveFailures: 3, circuitWindowMs: 600_000,
  }
  const preset = typeof defaults.preset === 'string' && defaults.preset !== '' ? defaults.preset : 'ptc-code'
  const defaultBudgetMs = typeof defaults.defaultBudgetMs === 'number' && defaults.defaultBudgetMs >= 60_000
    ? defaults.defaultBudgetMs
    : 1_200_000
  // 子代理默认拒掉本工具自己：实测它能递归派发 ptc_task（工具面 = 整个宿主工具面）。
  const denyTools = Array.isArray(defaults.denyTools)
    ? defaults.denyTools.filter((toolName): toolName is string => typeof toolName === 'string' && toolName !== '')
    : ['ptc_task']
  const requireRecursionGuard = defaults.requireRecursionGuard !== false
  const maxConsecutiveFailures = typeof defaults.maxConsecutiveFailures === 'number' && Number.isFinite(defaults.maxConsecutiveFailures)
    ? Math.max(0, Math.floor(defaults.maxConsecutiveFailures))
    : 3
  const circuitWindowMs = typeof defaults.circuitWindowMs === 'number' && Number.isFinite(defaults.circuitWindowMs) && defaults.circuitWindowMs > 0
    ? Math.floor(defaults.circuitWindowMs)
    : 600_000

  /**
   * ── 本插件实例的三张表（进程内、per-mount；不落盘）──────────────────────────────
   *
   * 【为什么必须有（2026-09-17 "任务被重复/无限次执行"）】
   *  · `inFlight`：**幂等键**。旧实现每次调用都 `randomUUID()` 新建子代理，重复投递
   *    （模型重复发同一调用 / 传输重试 / 用户重复点击）会把同一件事**并发跑 N 遍**。
   *  · `attempts`：同一任务的第几次尝试（如实回报，便于对账"到底跑了几遍"）。
   *  · `failures`：连续失败计数 + 时间戳 ⇒ **熔断**，截断 create→fail→create 的无限回路。
   */
  const inFlight = new Map<string, Promise<ToolResult>>()
  const attempts = new Map<string, number>()
  const failures = new Map<string, { count: number; at: number }>()

  /**
   * 观测出口：**双通道** —— 宿主 logger（供面板/统一采集）+ stdout（供文件级取证）。
   *
   * 【为什么两条都要（2026-09-17 实测）】本部署**有** `ctx.logger`，但它的落点不在
   * dsh-web.log / dsh-web.err.log / dsh-watchdog.log / 看板 ops.log 任何一个里 ⇒ 只写 logger 时
   * "任务生命周期可追踪"在**文件层面无法验证**；而 dsh-web.log 里确实有另一个插件
   * （`xllh-analysis-model-list`）的 stdout 行（`[aml] …`）⇒ stdout 才是这条链路上可验证的通道。
   * 任一通道失败都不得影响派发（铁律 5）。
   */
  const log = (level: 'info' | 'warn', message: string): void => {
    try {
      const logger = (ctx as unknown as { logger?: { info?: (m: string) => void; warn?: (m: string) => void } }).logger
      const sink = level === 'warn' ? logger?.warn : logger?.info
      if (typeof sink === 'function') sink.call(logger, message)
    } catch { /* logger 缺失/异常 ⇒ 仍有 stdout 通道 */ }
    /**
     * ⚠ 这里**必须用 `process.stdout.write`**（2026-09-18 实测）：本部署里 `console.log`
     * 的输出**不会**进 `dsh-web.log`（宿主/插件环境对 console 做了包装），而 `process.stdout.write`
     * 进得去 —— 同一文件里有另一个插件（`xllh-analysis-model-list` 的 `logPush`）用**同一 API**
     * 写下的 `[aml] …` 行。取证通道只能用被证明有效的那一条。
     */
    try {
      const stdout = (globalThis as { process?: { stdout?: { write?: (s: string) => unknown } } }).process?.stdout
      const write = stdout?.write
      if (typeof write === 'function') {
        write.call(stdout, `[ptc-task] ${message}\n`)
        return
      }
    } catch { /* 无 stdout：继续尝试 console */ }
    try { console.log(`[ptc-task] ${message}`) } catch { /* 无 stdout 的环境：忽略 */ }
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'ptc_task',
    description: DESCRIPTION,
    parameters: {
      prompt: { type: 'string', required: true, description: '自包含的完整任务说明（含产出什么、写到哪个路径、判据是什么）' },
      resultPath: { type: 'string', required: true, description: '子代理必须把最终结果写入的路径（工作区绝对路径）' },
      cwd: { type: 'string', description: '工作目录（缺省 = 调用方会话工作区）' },
      budgetMs: { type: 'number', description: '墙钟上限（毫秒，缺省 1200000 = 20 分钟）' },
      model: { type: 'string', description: '模型覆写（缺省继承调用方的 provider/model）' },
      reasoningEffort: { type: 'string', description: '推理档位覆写：low | high | max（缺省继承调用方）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: PtcTaskArgs, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args: PtcTaskArgs, exec: { agent?: unknown }): Promise<ToolResult> {
      const prompt = typeof args.prompt === 'string' ? args.prompt : ''
      const resultPath = typeof args.resultPath === 'string' ? args.resultPath : ''
      if (prompt === '' || resultPath === '') {
        return { ok: false, reason: 'bad-args', hint: 'prompt 与 resultPath 必填' }
      }
      const parent = exec.agent as AgentLike | undefined
      if (parent === undefined) {
        return { ok: false, reason: 'no-caller-agent', hint: '本工具只能由 agent 会话调用（拿不到调用方就继承不了路由）' }
      }
      /**
       * **递归兜底（fail-closed，先于一切副作用）**：调用方本身已是子代理 ⇒ 拒绝派发。
       *
       * 这是"同一任务被无限次执行"的**结构性终止条件**：无论护栏是否装得上、无论子代理
       * 通过哪条路径再次调到本工具，深度 ≥ 1 一律拒绝 —— 链长因此恒 ≤ 1。
       */
      const parentDepth = delegationDepthOf(parent)
      if (parentDepth >= 1) {
        log('warn', `ptc_task 拒绝派发：调用方已是子代理（delegationDepth=${parentDepth}）`)
        return {
          ok: false,
          reason: 'nested-dispatch-refused',
          parentDepth,
          hint: '本工具只允许顶层会话派发（子代理再派会指数级重复执行同一件事）：请在顶层会话发起，或直接用现有子代理的产物',
        }
      }

      const agents = (ctx as unknown as { get(name: string): unknown }).get('agents') as AgentsServiceLike | undefined
      if (agents === undefined || typeof agents.create !== 'function') {
        return { ok: false, reason: 'no-agents', hint: '本宿主未装配 agents 服务（子代理不可用）' }
      }

      const budgetMs = typeof args.budgetMs === 'number' && Number.isFinite(args.budgetMs) && args.budgetMs >= 60_000
        ? Math.floor(args.budgetMs)
        : defaultBudgetMs
      let cwd = typeof args.cwd === 'string' ? args.cwd : ''
      if (cwd === '') cwd = parent.session?.header?.cwd ?? ''

      const inherited = inheritRoute(parent, typeof args.model === 'string' ? args.model : '', typeof args.reasoningEffort === 'string' ? args.reasoningEffort : '')
      if (inherited === undefined) {
        return { ok: false, reason: 'no-route', hint: '无法从调用方会话解析 model；请用 model 参数显式指定' }
      }
      const route = `${inherited.provider ?? '?'}/${inherited.model ?? '?'}`
        + (inherited.reasoningEffort === undefined ? '' : ` @${inherited.reasoningEffort}`)
      const taskKey = taskKeyOf({
        preset,
        prompt,
        resultPath,
        cwd,
        model: inherited.model ?? '',
        effort: inherited.reasoningEffort ?? '',
      })

      /**
       * **幂等**：同一任务已在途中 ⇒ 合并等待，**不再起第二个子代理**（重复投递的墙）。
       * 合并方向是"等同一个上游结果"，而不是"直接返回已存在"——调用方仍能拿到真实终局。
       */
      const joined = inFlight.get(taskKey)
      if (joined !== undefined) {
        log('info', `ptc_task 合并重复投递：task=${taskKey.slice(0, 12)}…（同一任务已在途中，不再重复执行）`)
        try {
          const same = await joined
          return { ...same, deduped: true }
        } catch {
          // 上游异常（不该发生：内部全兜底）⇒ 退化为自己重跑，绝不静默失败
        }
      }

      /** **熔断**：同一任务连续失败达上限 ⇒ 拒绝，并明确告诉调用方别再自动重派。 */
      const past = failures.get(taskKey)
      const nowMs = Date.now()
      const consecutive = past !== undefined && nowMs - past.at <= circuitWindowMs ? past.count : 0
      if (maxConsecutiveFailures > 0 && consecutive >= maxConsecutiveFailures) {
        log('warn', `ptc_task 熔断：task=${taskKey.slice(0, 12)}… 连续失败 ${consecutive} 次（窗口 ${circuitWindowMs}ms）`)
        return {
          ok: false,
          reason: 'circuit-open',
          attempts: consecutive,
          parentDepth,
          hint: `同一任务已连续失败 ${consecutive} 次：请先按上一次的 turnEnd 修掉根因，不要再自动重派（熔断窗口过后可重试）`,
        }
      }

      const attempt = (attempts.get(taskKey) ?? 0) + 1
      attempts.set(taskKey, attempt)
      if (attempts.size > 1024) attempts.clear()
      const startedMs = Date.now()
      const run = async (): Promise<ToolResult> => {
        const sessionId = randomUUID()
        const disposers: Array<() => unknown> = []
        let setupNote = ''
        /** 递归护栏是否**确实**装上了（fail-closed 判据，见下）。 */
        let guardDenied = denyTools.length === 0
        const releaseAll = (): void => {
          while (disposers.length > 0) {
            const dispose = disposers.pop()
            try { dispose?.() } catch { /* 卸载即净：单个 disposer 失败不阻断其余 */ }
          }
        }

        log('info', `ptc_task 派发：preset=${preset} session=${sessionId} route=${route} attempt=${attempt} cwd=${cwd === '' ? '(default)' : cwd} result=${resultPath}`)

        let handle: AgentHandleLike
        try {
          // 官方 childSessionMeta（subagent/src/child-agent.ts:138-156）会把 parentSession 与 isSeeded 一并写入；
          // 不写这两项，客户端就认不出这是子代理会话：斜杠命令本应对其直接返回空表，
          // 却会去请求命令表、在冷会话上撞 gateway/lookup-not-found；侧栏也会把它当普通会话列出。
          const parentSessionId = parent.session?.header?.id ?? ''
          handle = await agents.create({
            sessionId,
            parentAgent: parent,
            meta: {
              ...(cwd === '' ? {} : { cwd }),
              origin: 'subagent',
              delegationDepth: 1,
              agentPreset: preset,
              // 官方 childSessionMeta 会同时写 parentSession/isSeeded（subagent/src/child-agent.ts:138-156）。
              // 不写的话：客户端认不出这是子代理会话 —— 斜杠命令本应对其返回空表，
              // 却会去请求命令表并因冷会话报 gateway/lookup-not-found；侧栏也会把它当普通会话列出。
              ...(parentSessionId === '' ? {} : { parentSession: parentSessionId }),
              isSeeded: false,
            },
            agentOptions: inherited,
            setup: (agentCtx: AgentCtxLike) => {
              try {
                const tools = agentCtx.get('tools') as ToolsServiceLike | undefined
                if (tools === undefined || typeof tools.presentAs !== 'function') {
                  setupNote = 'no-tools-service'
                  return
                }
                const dispose = tools.presentAs('code')
                if (typeof dispose === 'function') disposers.push(dispose as () => unknown)
                setupNote = 'presentAs(code) ok'
                // 工具面裁剪：子代理的**全局**工具面就是整个宿主工具面（2026-09-16 实测：
                // 它甚至能递归调 ptc_task 自己）。restrict() 只作用于全局工具（预设行注册的
                // scoped 工具不归它管，那属于预设的选择），因此这里拒绝的是自己这条递归路径。
                //
                // ⚠ **逐个名字应用**（2026-09-17）：`restrict` 的过滤器是**原子**的 —— 名单里只要有一个
                // 未知/非全局名字，宿主会**整条抛错**，于是连 `ptc_task` 也没被拦住（护栏静默失效）。
                // 逐名调用后，坏名字只影响它自己，关键的那条仍然生效。
                const restrictFn = typeof tools.restrict === 'function' ? tools.restrict.bind(tools) : null
                if (denyTools.length > 0 && restrictFn === null) {
                  setupNote += '; restrict-unavailable'
                } else if (restrictFn !== null) {
                  const denied: string[] = []
                  const refused: string[] = []
                  for (const name of denyTools) {
                    try {
                      const disposeTrim = restrictFn({ deny: [name] })
                      if (typeof disposeTrim === 'function') disposers.push(disposeTrim as () => unknown)
                      denied.push(name)
                    } catch (error) {
                      refused.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
                    }
                  }
                  if (denied.length > 0) setupNote += `; deny=${denied.join(',')}`
                  // 本插件自身的递归路径（工具名 = ptc_task）必须被成功拒绝，否则护栏不算装上
                  guardDenied = denied.includes('ptc_task') || !denyTools.includes('ptc_task')
                  if (refused.length > 0) setupNote += `; guard-refused=${refused.join('|')}`
                }
              } catch (error) {
                setupNote = `presentAs failed: ${error instanceof Error ? error.message : String(error)}`
              }
            },
          })
        } catch (error) {
          releaseAll()
          return { ok: false, reason: 'create-failed', message: error instanceof Error ? error.message : String(error), setupNote, sessionId, route, attempts: attempt }
        }

        const agent = handle.agent
        if (agent === undefined || typeof agent.followup !== 'function') {
          releaseAll()
          try { await handle.dispose?.() } catch { /* 同上 */ }
          return { ok: false, reason: 'bad-handle', setupNote, sessionId, route, attempts: attempt }
        }

        /**
         * **护栏装不上 ⇒ fail-closed：拒绝派发**（2026-09-17 死循环缺陷的核心修复）。
         * 旧实现只把失败写进 `setupNote` 就照常执行 ⇒ 子代理保留 `ptc_task` ⇒ 每层再派 N 个。
         * 现在释放并返回 `guard-unavailable`；确需放宽时由部署显式配 `requireRecursionGuard: false`。
         */
        if (requireRecursionGuard && !guardDenied) {
          log('warn', `ptc_task 拒绝派发：递归护栏未装上（${setupNote}）`)
          releaseAll()
          try { await handle.dispose?.() } catch { /* 同上 */ }
          return {
            ok: false,
            reason: 'guard-unavailable',
            sessionId,
            route,
            setupNote,
            attempts: attempt,
            hint: '递归护栏（deny ptc_task）未能安装：拒绝执行以免子代理无限自我派发。请检查 tools.restrict 的报错原文（见 setupNote），或显式配置 requireRecursionGuard=false 承担风险',
          }
        }

        let timedOut = false
        let cancelTimer: (() => unknown) | undefined
        try {
          agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })
          const idle = typeof agent.whenIdle === 'function' ? Promise.resolve(agent.whenIdle()) : Promise.resolve('no-whenIdle')
          const guard = new Promise<'timeout'>((resolve) => {
            try {
              const timer = (ctx as unknown as { timeout(fn: () => void, ms: number): () => unknown })
              cancelTimer = timer.timeout(() => { timedOut = true; resolve('timeout') }, budgetMs)
            } catch {
              resolve('timeout')
            }
          })
          await Promise.race([idle, guard])
          const turnEnd = timedOut ? 'timeout' : lastTurnEnd(agent)
          const failed = /^error:/.test(turnEnd)
          return {
            ok: !timedOut && !failed,
            sessionId,
            cwd,
            route,
            resultPath,
            spent: timedOut ? 'timeout' : 'idle',
            timedOut,
            turnEnd,
            setupNote,
            attempts: attempt,
            parentDepth,
            hint: timedOut
              ? '子代理超时未收尾（已释放）：先读 resultPath 判断产物是否完整'
              : failed
                ? '子代理首轮就报错、没有干活：按 turnEnd 修 cause 后重派'
                : '子代理已空闲：读 resultPath 取结果',
          }
        } catch (error) {
          return { ok: false, reason: 'followup-failed', message: error instanceof Error ? error.message : String(error), setupNote, sessionId, route, attempts: attempt }
        } finally {
          try { cancelTimer?.() } catch { /* 同上 */ }
          releaseAll()
          try { await handle.dispose?.() } catch { /* 同上 */ }
        }
      }

      inFlight.set(taskKey, run())
      try {
        const result = await (inFlight.get(taskKey) as Promise<ToolResult>)
        const ok = result.ok === true
        if (ok) failures.delete(taskKey)
        else failures.set(taskKey, { count: consecutive + 1, at: Date.now() })
        log(ok ? 'info' : 'warn', `ptc_task 终局：session=${String(result.sessionId ?? '')} ok=${String(ok)} turnEnd=${String(result.turnEnd ?? result.reason ?? '')} 耗时=${Date.now() - startedMs}ms attempt=${attempt} result=${resultPath}`)
        return { ...result, deduped: false, durationMs: Date.now() - startedMs }
      } finally {
        inFlight.delete(taskKey)
      }
    },
  })), '@dsh-external/dsh-ptc-task: ptc_task tool')
}
