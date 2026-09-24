/**
 * @dsh-external/dsh-dialogue-alert-message — host half.
 * 三重职责：
 *   1) session 事件监听 → 状态栏计数（原有）；
 *   2) DeepSeek 用量统计：余额/当日消耗/计数（v0.1.x，见 lib/usage-stats.ts）；
 *   3) 强制中断报警（v0.2.0+，见 lib/interruption.ts）：工具报错/强制取消/会话失效
 *      （重要级）与宿主强制重启（高危级）→ 归一化 → 幂等去重 → 本插件门控
 *      （总开关/全静音/等级过滤/免打扰：可配置+持久化+即时生效）→ 本插件自包含
 *      通知服务（/api/alarm 内部队列 → 本插件客户端 WebAudio 发声 + ack；v0.2.1 起
 *      不与其他任何插件交互）；每次判定输出结构化 JSON 日志（alarm.log，UTC ISO8601）。
 *      用户主动取消/正常结束/截断类不报警。
 */
import type { Context } from 'cordis'
import {
  appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import z from 'schemastery'
import {
  USAGE_STATS_VERSION,
  type PriceTable,
  type UsageState,
  type BalanceState,
  applyStepUsage,
  dayKeyAt,
  loadBalance,
  loadState,
  normalizeUsage,
  parseBalancePayload,
  priceEntryFor,
  recordCompletedTurn,
  sanitizeOverview,
  shouldRefresh,
} from './lib/usage-stats.js'
import {
  classifyTurnEnd,
  classifySeed,
  classifyDispose,
  dedupeKeyOf,
  shouldAlert,
  checkGate,
  clampAlarmConfig,
  levelOfKind,
  soundSpecOf,
  buildAlertPayload,
  buildAlarmLogLine,
  type InterruptionEvent,
  type AlarmGateConfig,
} from './lib/interruption.js'

export const name = '@dsh-external/dsh-dialogue-alert-message'
export const inject = ['webServer', 'sessions', 'llm']

type SessionStatus = 'idle' | 'running' | 'completed' | 'error'

interface SessionState {
  status: SessionStatus
}

interface LastEvent {
  seq: number
  type: 'completed' | 'error'
  sessionId: string
  time: number
}

interface UsageConfig {
  apiKeyEnv: string
  baseURL: string
  balanceTimeoutMs: number
  balanceMinIntervalMs: number
  balanceTimerMs: number
  tzOffsetMin: number
  offPeakFactor: number
  peakWindows: Array<[number, number]>
  peakWeekdays: number[]
  prices: Record<string, { input: number; cacheHit: number; output: number }>
  defaultPrice: { input: number; cacheHit: number; output: number }
  statsFile: string
  alarmSettingsFile: string
  alarmDedupeCap: number
}

/**
 * 缺省单价与 DeepSeek 官方价目表一致（高峰价；闲时由 offPeakFactor=0.5 折算）。
 * 校准入口：cordis.patch.yml 中本插件 config.prices（元/百万 tokens）。
 */
const DEFAULT_PRICES: UsageConfig['prices'] = {
  'deepseek-v4-flash': { input: 1.5, cacheHit: 0.05, output: 4.5 },
  'deepseek-v4-flash-vision-exp': { input: 1.5, cacheHit: 0.05, output: 4.5 },
  'deepseek-v4-pro': { input: 4.5, cacheHit: 0.15, output: 13.5 },
}
const DEFAULT_PRICE: UsageConfig['defaultPrice'] = { input: 1.5, cacheHit: 0.05, output: 4.5 }

export const Config = z.object({
  apiKeyEnv: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default('DEEPSEEK_API_KEY'),
  baseURL: z.string().default('https://api.deepseek.com'),
  balanceTimeoutMs: z.number().min(500).max(60_000).default(5_000),
  balanceMinIntervalMs: z.number().min(1_000).default(30_000),
  balanceTimerMs: z.number().min(60_000).default(300_000),
  tzOffsetMin: z.number().default(480),
  offPeakFactor: z.number().min(0.1).max(1).default(0.5),
  peakWindows: z.array(z.tuple([z.number(), z.number()])).default([[9, 12], [14, 18]]),
  peakWeekdays: z.array(z.number()).default([1, 2, 3, 4, 5]),
  prices: z.dict(z.object({
    input: z.number(),
    cacheHit: z.number(),
    output: z.number(),
  })).default(DEFAULT_PRICES),
  defaultPrice: z.object({
    input: z.number().default(DEFAULT_PRICE.input),
    cacheHit: z.number().default(DEFAULT_PRICE.cacheHit),
    output: z.number().default(DEFAULT_PRICE.output),
  }).default(DEFAULT_PRICE),
  statsFile: z.string().default(''),
  alarmSettingsFile: z.string().default(''),
  alarmDedupeCap: z.number().min(8).max(8192).default(1024),
})

export function apply(ctx: Context, config: UsageConfig): void {
  try {
    applyInner(ctx, config)
  } catch (error) {
    // 铁律 5：apply 内部兜底，禁止异常冒泡导致 dsh web 启动失败。
    ctx.logger.error('dsh-dialogue-alert-message: apply failed; plugin disabled for this load', error)
  }
}

/** 内部降级报警条目（客户端轮询 /api/alarm 播放后 ack）。 */
interface InternalAlarm {
  id: string
  sessionId: string
  kind: string
  level: string
  soundType: string
  volume: number
  durationMs: number
  ts: number
}

function applyInner(ctx: Context, config: UsageConfig): void {
  const webServer = (ctx as any).webServer
  const sessions = (ctx as any).sessions
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const statsFile = config.statsFile || join(dshHome, 'dsh-dialogue-alert-message', 'stats.json')
  const alarmSettingsFile = config.alarmSettingsFile || join(dshHome, 'dsh-dialogue-alert-message', 'alarm-settings.json')
  const alarmLogFile = join(dirname(alarmSettingsFile), 'alarm.log')

  const priceTable: PriceTable = { models: config.prices, fallback: config.defaultPrice }
  const policy = {
    tzOffsetMin: config.tzOffsetMin,
    offPeakFactor: config.offPeakFactor,
    peakWindows: config.peakWindows,
    peakWeekdays: config.peakWeekdays,
  }

  const states = new Map<string, SessionState>()
  let lastEventSeq = 0
  let lastEvent: LastEvent | null = null
  // 会话首见集合：恢复会话可能在插件 apply 前完成（session/created 未命中），
  // 首个 live turn/start 处惰性判定「恢复时开放轮」→ host-restart 报警（不依赖事件时序）。
  const seenSessions = new Map<string, boolean>()

  // ── 强制中断报警状态 ──
  const rawSettings = readJson(alarmSettingsFile) as Record<string, unknown> | null
  let alarmCfg: AlarmGateConfig = clampAlarmConfig(rawSettings)
  let alertKeys: string[] = Array.isArray(rawSettings?.recentAlertKeys)
    ? (rawSettings.recentAlertKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : []
  const internalAlarms: InternalAlarm[] = []

  const appendAlarmLog = (line: string): void => {
    try {
      mkdirSync(dirname(alarmLogFile), { recursive: true })
      appendFileSync(alarmLogFile, line + '\n', 'utf8')
    } catch { /* 日志失败不影响报警链路 */ }
  }

  let alarmSaveTimer: ReturnType<typeof setTimeout> | undefined
  const saveAlarmState = (): void => {
    try {
      const payload = JSON.stringify({
        version: 1,
        alarmEnabled: alarmCfg.alarmEnabled,
        muteAll: alarmCfg.muteAll,
        mutedLevels: alarmCfg.mutedLevels,
        dndWindows: alarmCfg.dndWindows,
        severityMapping: alarmCfg.severityMapping,
        sounds: alarmCfg.sounds,
        recentAlertKeys: alertKeys,
      })
      mkdirSync(dirname(alarmSettingsFile), { recursive: true })
      const tmp = `${alarmSettingsFile}.tmp`
      writeFileSync(tmp, payload, 'utf8')
      renameSync(tmp, alarmSettingsFile)
    } catch (error) {
      ctx.logger.warn('dsh-dialogue-alert-message: alarm settings persist failed', error)
    }
  }
  const queueAlarmSave = (): void => {
    if (alarmSaveTimer !== undefined) clearTimeout(alarmSaveTimer)
    alarmSaveTimer = setTimeout(() => {
      alarmSaveTimer = undefined
      saveAlarmState()
    }, 1000)
  }

  /**
   * 本插件自包含通知服务（v0.2.1 起）：不与其他任何插件交互——报警经本插件
   * 内部队列，由本插件客户端轮询 /api/alarm 统一发声（WebAudio 音色按等级），
   * 播放后 ack 消除；静音/等级过滤/免打扰在宿主侧门控后放行。
   */
  const pushInternal = (
    payload: Record<string, unknown>,
    sound: { soundType: string; volume: number; durationMs: number },
  ): void => {
    const extra = payload.extraPayload
    const interRaw = typeof extra === 'object' && extra !== null
      ? (extra as Record<string, unknown>).interruption
      : undefined
    const inter: Record<string, unknown> = typeof interRaw === 'object' && interRaw !== null ? interRaw as Record<string, unknown> : {}
    if (internalAlarms.length >= 32) internalAlarms.shift()
    internalAlarms.push({
      id: String(payload.id ?? ''),
      sessionId: String(inter.sessionId ?? ''),
      kind: String(inter.kind ?? ''),
      level: String(payload.level ?? ''),
      soundType: String(inter.soundType ?? sound.soundType),
      volume: sound.volume,
      durationMs: sound.durationMs,
      ts: Date.now(),
    })
  }

  /** 中断事件处理主路径：分类 → 去重（持久化）→ 门控 → 出口/降级 → 结构化日志。 */
  const handleInterruption = (evt: InterruptionEvent, sessionId: string): void => {
    const now = Date.now()
    const level = levelOfKind(evt.kind, alarmCfg)
    const key = dedupeKeyOf(evt.kind, sessionId, evt.turn)
    const dedup = shouldAlert(alertKeys, key, config.alarmDedupeCap)
    alertKeys = dedup.keys
    if (!dedup.alert) {
      appendAlarmLog(buildAlarmLogLine({ ts: now, sessionId, kind: evt.kind, level: level ?? '未知', alerted: false, mutedBy: 'dedup', detail: evt.detail }))
      queueAlarmSave()
      return
    }
    if (level === null) {
      appendAlarmLog(buildAlarmLogLine({ ts: now, sessionId, kind: evt.kind, level: '未知', alerted: false, mutedBy: 'unknown-kind', detail: evt.detail }))
      queueAlarmSave()
      return
    }
    const gate = checkGate(alarmCfg, level, now)
    const sound = soundSpecOf(evt.kind, alarmCfg)
    if (!gate.allowed) {
      appendAlarmLog(buildAlarmLogLine({ ts: now, sessionId, kind: evt.kind, level, alerted: false, mutedBy: gate.mutedBy, detail: evt.detail }))
      queueAlarmSave()
      return
    }
    const payload = buildAlertPayload({
      kind: evt.kind, level, sessionId, dedupeKey: key, turn: evt.turn, detail: evt.detail, ts: now, soundType: sound.soundType,
    })
    // 自包含通知：本插件内部队列 → 客户端发声（不依赖任何其他插件）。
    pushInternal(payload, sound)
    appendAlarmLog(buildAlarmLogLine({ ts: now, sessionId, kind: evt.kind, level, alerted: true, mutedBy: null, detail: evt.detail }))
    ctx.logger.info(`dsh-dialogue-alert-message: forced interruption alarm (${evt.kind}) session=${sessionId} turn=${evt.turn}`)
    queueAlarmSave()
  }

  const rememberEvent = (sessionId: string, type: 'completed' | 'error'): void => {
    lastEventSeq += 1
    lastEvent = { seq: lastEventSeq, type, sessionId, time: Date.now() }
  }

  // ---- 用量状态（纯函数核心 + 持久化） ----
  const todayKey = (): string => dayKeyAt(Date.now(), config.tzOffsetMin);
  let usageState: UsageState = loadState(readStats(statsFile), todayKey());
  let balanceState: BalanceState = loadBalance(readStats(statsFile));
  let lastModel: string | null = null;
  // 模型归属：llm/stream 钩子记录最近一次请求的模型（usage 事件紧随其后，时序一致）。
  (ctx as any).on('llm/stream', (options: any, next: () => unknown) => {
    if (options && typeof options.model === 'string') lastModel = options.model
    return next()
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = (): void => {
    try {
      const payload = JSON.stringify({
        version: USAGE_STATS_VERSION,
        day: usageState.day,
        dialogueCount: usageState.dialogueCount,
        todayCost: usageState.todayCost,
        recentKeys: usageState.recentKeys,
        updatedAt: usageState.updatedAt,
        balance: balanceState.balance,
        balanceAt: balanceState.balanceAt,
      })
      mkdirSync(dirname(statsFile), { recursive: true })
      const tmp = `${statsFile}.tmp`
      writeFileSync(tmp, payload, 'utf8')
      renameSync(tmp, statsFile)
    } catch (error) {
      ctx.logger.error('dsh-dialogue-alert-message: persist failed', error)
    }
  }
  const queuePersist = (): void => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      persist()
    }, 500)
  }

  // ---- 余额查询（异步、非阻塞、节流、失败降级） ----
  const resolveKey = async (): Promise<string> => {
    const credentials = (ctx as any).get?.('credentials')
    let value: string | undefined
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(config.apiKeyEnv)
        value = hit?.value
      } catch { value = undefined }
    }
    if (value === undefined) value = process.env[config.apiKeyEnv]
    if (value === undefined || value.length === 0) {
      throw new Error(`no DeepSeek API key for ref "${config.apiKeyEnv}" (credentials seam/ambient env)`)
    }
    return value
  }

  let balanceInFlight: Promise<void> | null = null
  const baseURL = (): string => process.env.DEEPSEEK_BASE_URL || config.baseURL
  const refreshBalance = (): Promise<void> => {
    if (balanceInFlight !== null) return balanceInFlight
    if (!shouldRefresh(balanceState.balanceAt, Date.now(), config.balanceMinIntervalMs)) return Promise.resolve()
    balanceInFlight = (async () => {
      try {
        const key = await resolveKey()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), config.balanceTimeoutMs)
        let response: Response
        try {
          response = await fetch(`${baseURL()}/user/balance`, {
            method: 'GET',
            headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }
        if (!response.ok) throw new Error(`balance api http ${response.status}`)
        const parsed = parseBalancePayload(await response.json())
        if (parsed === null) throw new Error('balance api payload malformed')
        balanceState = { balance: parsed, balanceAt: Date.now(), lastError: null }
        usageState = { ...usageState, updatedAt: Date.now() }
        queuePersist()
        ctx.logger.info(`dsh-dialogue-alert-message: balance refreshed: ¥${parsed}`)
      } catch (error) {
        const message = error instanceof Error ? String(error.message) : String(error)
        balanceState = { ...balanceState, lastError: message }
        // 失败静默降级：保留上次成功缓存值；只写日志，不上屏。
        ctx.logger.warn(`dsh-dialogue-alert-message: balance refresh failed: ${message}`)
      } finally {
        balanceInFlight = null
      }
    })()
    return balanceInFlight
  }

  // ---- 事件监听（session/event 全局；created/disposed 用于中断检测） ----
  ctx.on('session/event' as any, (session: any, event: any): void => {
    try {
      const id = String(session.id)
      const data = (event as any)?.data
      // 首见惰性判定（任意首个 live 事件）：恢复会话可能在插件 apply 前恢复
      // （session/created 未命中）——检查构造种子尾部：开放轮或崩溃收尾标记 → host-restart。
      if (!seenSessions.has(id)) {
        seenSessions.set(id, true)
        if (seenSessions.size > 512) {
          const firstKey = seenSessions.keys().next().value as string | undefined
          if (firstKey !== undefined) seenSessions.delete(firstKey)
        }
        const resumeEvent = classifySeed({
          id,
          events: session?.events ?? [],
          firstLiveSeq: session?.firstLiveSeq,
        })
        if (resumeEvent !== null) {
          resumeEvent.sessionId = id
          handleInterruption(resumeEvent, id)
        }
      }
      if (event.type === 'assistant/message') {
        const usage = normalizeUsage(data?.usage)
        if (usage !== null) {
          const price = priceEntryFor(priceTable, lastModel ?? 'unknown')
          usageState = applyStepUsage(usageState, usage, price, event.time, policy)
          queuePersist()
        }
        return
      }
      if (event.type === 'turn/start') {
        states.set(id, { status: 'running' })
        return
      }
      if (event.type !== 'turn/end') return
      const kind = data?.reason?.kind
      if (kind === 'completed') {
        // 完成音（原有正向通知）仅对正常完成轮触发。
        const topLevel = session?.header?.parentSession === undefined
        if (topLevel) {
          usageState = recordCompletedTurn(usageState, `${id}:${String(data?.turn ?? 0)}`, event.time)
          queuePersist()
          void refreshBalance()
        }
        states.set(id, { status: 'completed' })
        rememberEvent(id, 'completed')
        return
      }
      // 强制中断分类：error → tool-error；aborted(非 user) → forced-cancel；user 主动取消 → 静默。
      const evt = classifyTurnEnd(data)
      if (evt !== null) {
        evt.sessionId = id
        handleInterruption(evt, id)
      }
      const isAbortedByUser = kind === 'aborted' && data?.reason?.reason?.kind === 'user'
      if (isAbortedByUser) {
        // 用户主动取消：静默（不报警、不响错误音），仅更新状态计数。
        states.set(id, { status: 'idle' })
        return
      }
      // 非正常完成不再触发客户端错误音（v0.2.0：错误/中断改走唯一出口报警音；截断类静默）。
      states.set(id, { status: 'error' })
    } catch (error) {
      ctx.logger.warn('dsh-dialogue-alert-message: event handler error', error)
    }
  }, { global: true } as any);

  ctx.on('session/created' as any, (session: any): void => {
    try {
      // 宿主重启恢复：种子末事件若无终态而是开放轮 → 强制重启中断（高危，逐会话一次）。
      const resumeEvent = classifySeed({
        id: String(session?.id ?? ''),
        events: session?.events ?? [],
      })
      if (resumeEvent !== null) {
        resumeEvent.sessionId = String(session.id)
        handleInterruption(resumeEvent, String(session.id))
      }
    } catch (error) {
      ctx.logger.warn('dsh-dialogue-alert-message: session/created handler error', error)
    }
  }, { global: true } as any);

  ctx.on('session/disposed' as any, (session: any): void => {
    try {
      const id = String(session.id)
      states.delete(id)
      // 上下文/内存移除：销毁时开放轮未完成 → 会话失效（重要级）。
      const evicted = classifyDispose({
        id,
        events: session?.events ?? [],
      })
      if (evicted !== null) {
        evicted.sessionId = id
        handleInterruption(evicted, id)
      }
    } catch (error) {
      ctx.logger.warn('dsh-dialogue-alert-message: session/disposed handler error', error)
    }
  }, { global: true } as any);

  // Seed current sessions so counts start accurate.
  try {
    for (const session of sessions.list()) {
      states.set(String(session.id), { status: 'idle' })
    }
  } catch { /* sessions list unavailable early */ }

  // ---- Web API：状态（原有，不动） ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/@dsh-external/dsh-dialogue-alert-message/api/status',
    handler: (req: any, res: any) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      const counts = { running: 0, error: 0, completed: 0 }
      for (const state of states.values()) {
        if (state.status === 'running') counts.running += 1
        else if (state.status === 'error') counts.error += 1
        else if (state.status === 'completed') counts.completed += 1
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, counts, lastEvent }))
    },
  }), '@dsh-external/dsh-dialogue-alert-message: status api')

  // ---- Web API：统一用量查询（getUsageOverview） ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/@dsh-external/dsh-dialogue-alert-message/api/usage',
    handler: (req: any, res: any) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      const data = sanitizeOverview(usageState, balanceState)
      // updatedAt = 状态与余额中较新的时刻；页面加载后首次请求顺带触发余额刷新。
      data.updatedAt = Math.max(data.updatedAt, balanceState.balanceAt ?? 0)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, data }))
      // 页面加载/菜单初始化触发一次（节流）。
      void refreshBalance()
    },
  }), '@dsh-external/dsh-dialogue-alert-message: usage api')

  // ---- Web API：内部报警队列（本插件自包含发声通道；GET 拉取待播） ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/@dsh-external/dsh-dialogue-alert-message/api/alarm',
    handler: (req: any, res: any) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, items: internalAlarms.slice() }))
    },
  }), '@dsh-external/dsh-dialogue-alert-message: internal alarm api')

  // ---- Web API：报警播放确认（独立 exact 路由：修复历史上 POST /api/alarm/ack 被
  //      exact 路由 404 导致的「ack 永不成功 → 客户端每秒重播 → 无限循环」） ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/@dsh-external/dsh-dialogue-alert-message/api/alarm/ack',
    handler: async (req: any, res: any) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      let ids: string[] = []
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === 'string') : []
      } catch { ids = [] }
      for (const id of ids) {
        const idx = internalAlarms.findIndex((a) => a.id === id)
        if (idx >= 0) internalAlarms.splice(idx, 1)
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true }))
    },
  }), '@dsh-external/dsh-dialogue-alert-message: internal alarm ack api')

  // ---- Web API：报警配置（GET 读取 / POST 更新，clamp 收敛 + 即时生效 + 持久化） ----
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/@dsh-external/dsh-dialogue-alert-message/api/alarm-settings',
    handler: async (req: any, res: any) => {
      const send = (code: number, body: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(body))
      }
      if (req.method === 'GET') {
        send(200, { ok: true, data: alarmCfg })
        return
      }
      if (req.method !== 'POST') {
        send(405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        if (Buffer.concat(chunks).length > 64 * 1024) {
          send(400, { ok: false, error: 'payload too large' })
          return
        }
        const patch = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
          send(400, { ok: false, error: 'patch must be an object' })
          return
        }
        alarmCfg = clampAlarmConfig({ ...alarmCfg, ...patch })
        saveAlarmState()
        send(200, { ok: true, data: alarmCfg })
      } catch (error) {
        send(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), '@dsh-external/dsh-dialogue-alert-message: alarm settings api')

  // ---- 生命周期：低频余额刷新 + 启动即刷 + 释放时落盘 ----
  ctx.effect(() => {
    void refreshBalance() // 启动后首次
    const timer = setInterval(() => { void refreshBalance() }, config.balanceTimerMs)
    return () => {
      clearInterval(timer)
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
        persist() // 卸载前落盘，防丢最近一次计数/消耗
      }
      if (alarmSaveTimer !== undefined) {
        clearTimeout(alarmSaveTimer)
        alarmSaveTimer = undefined
        saveAlarmState()
      }
    }
  }, '@dsh-external/dsh-dialogue-alert-message: balance refresh timer')
}

/** 读取 JSON 文件（不存在/损坏返回 null）。 */
function readJson(path: string): unknown {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** 读取持久化文件（不存在返回 null；损坏由 loadState/loadBalance 回退重建）。 */
function readStats(path: string): unknown {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
