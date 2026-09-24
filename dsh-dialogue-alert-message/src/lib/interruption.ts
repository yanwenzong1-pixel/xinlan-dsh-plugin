/**
 * 强制中断报警纯函数核心（无副作用，可单测）。
 *
 * 覆盖：中断原因归一化分类（turn/end、重启恢复种子、会话失效销毁）、
 * 原因枚举注册扩展、等级映射（纯函数 + 可配置覆盖）、幂等去重、
 * 门控（总开关/全静音/等级过滤/免打扰时段）、配置钳位、alert.v1 构建、结构化日志。
 *
 * 映射策略（用户确认）：工具报错/强制取消/会话失效 → 「重要」（出口发声已放行），
 * 宿主强制重启 → 「高危」。需求示例「工具报错=普通」若照做将无声（出口仅重要/高危
 * 发声），故细化时重写为上述映射 —— 见 SPEC 变更记录。
 */
import { createHash } from 'node:crypto'

/** 中文等级（与 alert-hub alert.v1 契约一致）。 */
export type AlertLevel = '提示' | '普通' | '重要' | '高危'
export const ALERT_LEVELS: AlertLevel[] = ['提示', '普通', '重要', '高危']

/** 中断原因枚举（内置 4 类；新类型经 registerInterruptionKind 扩展，禁止散落硬编码分支）。 */
export const INTERRUPTION_KINDS = ['tool-error', 'forced-cancel', 'session-evicted', 'host-restart'] as const
export type InterruptionKind = (typeof INTERRUPTION_KINDS)[number]

/** 内置声音类型（本地降级音色）：single 单音 / double 双脉冲 / triple 三连。 */
export const SOUND_TYPES = ['single', 'double', 'triple'] as const
export type SoundType = (typeof SOUND_TYPES)[number]

/** 每种中断原因的默认规格：等级 + 音色。 */
export interface KindSpec {
  level: AlertLevel
  soundType: SoundType
}

export const DEFAULT_KIND_SPEC: Record<string, KindSpec> = {
  'tool-error': { level: '重要', soundType: 'double' },
  'forced-cancel': { level: '重要', soundType: 'double' },
  'session-evicted': { level: '重要', soundType: 'double' },
  'host-restart': { level: '高危', soundType: 'triple' },
}

/** 注册式扩展：注册新中断类型（幂等，已存在返回 false 不改写）。 */
export function registerInterruptionKind(kind: string, spec: KindSpec): boolean {
  if (!/^[a-z][a-z0-9-]*$/.test(kind)) return false
  if (Object.prototype.hasOwnProperty.call(DEFAULT_KIND_SPEC, kind)) return false
  if (!ALERT_LEVELS.includes(spec.level)) return false
  if (!SOUND_TYPES.includes(spec.soundType)) return false
  ;(DEFAULT_KIND_SPEC as Record<string, KindSpec>)[kind] = spec
  ;(INTERRUPTION_KINDS as unknown as string[]).push(kind)
  return true
}

/** 归一化后的中断事件。 */
export interface InterruptionEvent {
  kind: InterruptionKind
  sessionId: string
  turn: number
  detail: string
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0
}

/**
 * turn/end 分类（近期轮结束信号）：
 * - error → tool-error（工具/LLM 链路中止）；
 * - interrupted → host-restart（持久化后端为崩溃孤儿轮收尾——宿主强制重启信号）；
 * - aborted + 非 user 原因 → forced-cancel（父/钩子/销毁/遗留——外部强制取消）；
 * - aborted + user / completed / max-tokens / blocked / 非法 → null（不报警）。
 */
export function classifyTurnEnd(data: unknown): InterruptionEvent | null {
  if (typeof data !== 'object' || data === null) return null
  const reason = (data as Record<string, unknown>).reason
  if (typeof reason !== 'object' || reason === null) return null
  const kind = str((reason as Record<string, unknown>).kind)
  const turn = num((data as Record<string, unknown>).turn)
  if (kind === 'error') {
    const error = (reason as Record<string, unknown>).error
    const detail = typeof error === 'object' && error !== null
      ? str((error as Record<string, unknown>).message) || '对话链路中止（未知错误）'
      : '对话链路中止'
    return { kind: 'tool-error', sessionId: '', turn, detail }
  }
  if (kind === 'interrupted') {
    return { kind: 'host-restart', sessionId: '', turn, detail: '崩溃孤儿轮由持久化后端收尾（宿主强制重启）' }
  }
  if (kind === 'interrupted') {
    return { kind: 'host-restart', sessionId: '', turn, detail: '崩溃孤儿轮由持久化后端收尾（宿主强制重启）' }
  }
  if (kind === 'aborted') {
    const cause = (reason as Record<string, unknown>).reason
    const causeKind = typeof cause === 'object' && cause !== null ? str((cause as Record<string, unknown>).kind) : ''
    if (causeKind === 'user') return null
    if (causeKind === '' || causeKind === 'legacy') {
      // legacy 无原因信息：视为强制（历史粗粒度记录）
    }
    return { kind: 'forced-cancel', sessionId: '', turn, detail: `对话被外部取消（${causeKind || 'legacy'}）` }
  }
  return null
}

/** 容错取事件列表末项 type。 */
export function lastEventTypeOf(events: unknown): string | null {
  if (!Array.isArray(events) || events.length === 0) return null
  const last = events[events.length - 1]
  return typeof last === 'object' && last !== null ? str((last as Record<string, unknown>).type) || null : null
}

/**
 * 恢复种子的有效事件：剥离 live 部分（分界线 firstLiveSeq）与
 * 'session/end-seed' 边界标记（构造种子投影，非会话事件）。
 */
export function seedEventsOf(events: unknown, firstLiveSeq: number): unknown[] {
  if (!Array.isArray(events)) return []
  const bound = typeof firstLiveSeq === 'number' && Number.isInteger(firstLiveSeq) && firstLiveSeq > 0
    ? Math.min(firstLiveSeq, events.length)
    : events.length
  const slice = events.slice(0, bound)
  while (slice.length > 0 && lastEventTypeOf(slice) === 'session/end-seed') slice.pop()
  return slice
}

/** 取事件列表最后一个 turn/start/end 的 turn 号（容错）。 */
function lastTurnOf(events: unknown[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (typeof ev !== 'object' || ev === null) continue
    const type = str((ev as Record<string, unknown>).type)
    if (type === 'turn/end' || type === 'turn/start') {
      const data = (ev as Record<string, unknown>).data
      const turn = typeof data === 'object' && data !== null
        ? num((data as Record<string, unknown>).turn)
        : 0
      if (turn > 0) return turn
    }
  }
  return 0
}

/**
 * 恢复会话种子分类：种子有效尾部为「开放轮 turn/start」或「崩溃收尾 turn/end(interrupted)」
 * → host-restart（两类为同一事实的两种可观测形态：修复前开放 / 修复后标记）。
 */
export function classifySeed(session: unknown): InterruptionEvent | null {
  if (typeof session !== 'object' || session === null) return null
  const events = (session as Record<string, unknown>).events
  const seed = seedEventsOf(events, num((session as Record<string, unknown>).firstLiveSeq))
  const last = lastEventTypeOf(seed)
  if (last !== 'turn/start' && last !== 'turn/end') return null
  const lastEvent = seed[seed.length - 1]
  if (last === 'turn/end') {
    const data = (lastEvent as Record<string, unknown>).data
    const reason = typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).reason
      : undefined
    const kind = typeof reason === 'object' && reason !== null
      ? str((reason as Record<string, unknown>).kind)
      : ''
    if (kind !== 'interrupted') return null
  }
  const turn = lastTurnOf(seed)
  const detail = last === 'turn/start'
    ? '宿主进程重启，会话恢复时处于未完成轮'
    : '宿主进程重启，会话恢复时带崩溃收尾标记'
  return { kind: 'host-restart', sessionId: str((session as Record<string, unknown>).id), turn, detail }
}

/** 会话失效分类：销毁时末事件仍为开放轮 → session-evicted。 */
export function classifyDispose(session: unknown): InterruptionEvent | null {
  if (typeof session !== 'object' || session === null) return null
  const events = (session as Record<string, unknown>).events
  if (lastEventTypeOf(events) !== 'turn/start') return null
  const turn = num((Array.isArray(events) ? events[events.length - 1] : undefined)?.data?.turn)
  return { kind: 'session-evicted', sessionId: str((session as Record<string, unknown>).id), turn, detail: '会话上下文被回收/外部重置，销毁时轮次尚未完成' }
}

/** 确定性去重键：kind:sessionId:turn。 */
export function dedupeKeyOf(kind: string, sessionId: string, turn: number): string {
  return `${kind}:${sessionId || 'unknown'}:${num(turn)}`
}

/** 幂等判断（纯函数）：同键已存在 → 不报；否则插入（超限淘汰最旧）。 */
export function shouldAlert(keys: string[], key: string, cap: number): { alert: boolean; keys: string[] } {
  const normalized = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
  const max = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 1024
  if (key === '' || typeof key !== 'string') return { alert: true, keys: normalized }
  if (normalized.includes(key)) return { alert: false, keys: normalized }
  return { alert: true, keys: [...normalized, key].slice(-max) }
}

/** 门控配置（clamp 后）。 */
export interface AlarmGateConfig {
  alarmEnabled: boolean
  muteAll: boolean
  mutedLevels: AlertLevel[]
  dndWindows: string[]
  severityMapping: Record<string, AlertLevel>
  sounds: Record<string, { soundType: string; volume: number; durationMs: number }>
}

/** 免打扰窗口解析：'HH:mm-HH:mm'（本地时间；end<start 视为跨天）。非法返回 null。 */
function parseWindow(raw: string): { startMin: number; endMin: number } | null {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(raw)
  if (m === null) return null
  const startMin = Number(m[1]) * 60 + Number(m[2])
  const endMin = Number(m[3]) * 60 + Number(m[4])
  if (startMin < 0 || startMin > 1439 || endMin < 0 || endMin > 1439) return null
  if (startMin === endMin) return null
  return { startMin, endMin }
}

/**
 * 门控判定（纯函数）：总开关/全静音/等级过滤/免打扰任意命中 → 拦截并给原因；
 * 全部通过 → 放行。本地时间 = 宿主本地。
 */
export function checkGate(cfg: AlarmGateConfig, level: string, nowMs: number): { allowed: boolean; mutedBy: string | null } {
  if (cfg.alarmEnabled !== true) return { allowed: false, mutedBy: 'master' }
  if (cfg.muteAll === true) return { allowed: false, mutedBy: 'muteAll' }
  if (Array.isArray(cfg.mutedLevels) && cfg.mutedLevels.includes(level as AlertLevel)) {
    return { allowed: false, mutedBy: 'level' }
  }
  if (Array.isArray(cfg.dndWindows)) {
    const d = new Date(nowMs)
    const cur = d.getHours() * 60 + d.getMinutes()
    for (const raw of cfg.dndWindows) {
      if (typeof raw !== 'string') continue
      const w = parseWindow(raw)
      if (w === null) continue
      if (w.startMin <= w.endMin) {
        if (cur >= w.startMin && cur < w.endMin) return { allowed: false, mutedBy: 'dnd' }
      } else {
        if (cur >= w.startMin || cur < w.endMin) return { allowed: false, mutedBy: 'dnd' }
      }
    }
  }
  return { allowed: true, mutedBy: null }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 配置钳位收敛（纯函数）：非法输入回退默认；未知字段原样保留。 */
export function clampAlarmConfig(raw: unknown): AlarmGateConfig & Record<string, unknown> {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const defaultSounds: Record<string, { soundType: string; volume: number; durationMs: number }> = {
    提示: { soundType: 'single', volume: 0.12, durationMs: 400 },
    普通: { soundType: 'single', volume: 0.16, durationMs: 600 },
    重要: { soundType: 'double', volume: 0.2, durationMs: 800 },
    高危: { soundType: 'triple', volume: 0.28, durationMs: 1200 },
  }
  const sounds: Record<string, { soundType: string; volume: number; durationMs: number }> = {}
  const srcSounds = typeof r.sounds === 'object' && r.sounds !== null ? r.sounds as Record<string, unknown> : {}
  for (const level of ALERT_LEVELS) {
    const rawSpec = typeof srcSounds[level] === 'object' && srcSounds[level] !== null
      ? srcSounds[level] as Record<string, unknown>
      : {}
    sounds[level] = {
      soundType: typeof rawSpec.soundType === 'string' && SOUND_TYPES.includes(rawSpec.soundType as SoundType)
        ? rawSpec.soundType
        : defaultSounds[level].soundType,
      volume: clampNum(rawSpec.volume, 0, 1, defaultSounds[level].volume),
      durationMs: clampNum(rawSpec.durationMs, 100, 5000, defaultSounds[level].durationMs),
    }
  }
  const mutedLevels = Array.isArray(r.mutedLevels)
    ? r.mutedLevels.filter((v): v is AlertLevel => typeof v === 'string' && ALERT_LEVELS.includes(v as AlertLevel))
    : []
  const dndWindows = Array.isArray(r.dndWindows)
    ? r.dndWindows.filter((v): v is string => typeof v === 'string' && parseWindow(v) !== null)
    : []
  const severityMapping: Record<string, AlertLevel> = {}
  const srcMap = typeof r.severityMapping === 'object' && r.severityMapping !== null
    ? r.severityMapping as Record<string, unknown>
    : {}
  for (const [k, v] of Object.entries(srcMap)) {
    if (typeof v === 'string' && ALERT_LEVELS.includes(v as AlertLevel)) severityMapping[k] = v as AlertLevel
  }
  return {
    ...r,
    alarmEnabled: typeof r.alarmEnabled === 'boolean' ? r.alarmEnabled : true,
    muteAll: typeof r.muteAll === 'boolean' ? r.muteAll : false,
    mutedLevels,
    dndWindows,
    severityMapping,
    sounds,
  }
}

/** 等级映射（纯函数 + 配置覆盖）：kind → 等级；未知 kind 返回 null（不报警）。 */
export function levelOfKind(kind: string, cfg: AlarmGateConfig | undefined): AlertLevel | null {
  const spec = DEFAULT_KIND_SPEC[kind]
  if (spec === undefined) {
    const mapped = cfg?.severityMapping?.[kind]
    return mapped ?? null
  }
  const overridden = cfg?.severityMapping?.[kind]
  return overridden ?? spec.level
}

/** 声音规格（按 kind 默认 + 配置覆盖）：本地降级音色用。 */
export function soundSpecOf(kind: string, cfg: AlarmGateConfig | undefined): { soundType: string; volume: number; durationMs: number } {
  const level = levelOfKind(kind, cfg) ?? '高危'
  const spec = DEFAULT_KIND_SPEC[kind]
  const soundType = spec?.soundType ?? 'single'
  const s = cfg?.sounds?.[level]
  if (s === undefined) return { soundType, volume: 0.2, durationMs: 800 }
  return { soundType, volume: s.volume, durationMs: s.durationMs }
}

/** 构建 alert.v1 告警载荷（汇入唯一出口 alert-hub）。 */
export function buildAlertPayload(input: {
  kind: string
  level: AlertLevel
  sessionId: string
  dedupeKey: string
  turn: number
  detail: string
  ts: number
  soundType: string
}): Record<string, unknown> {
  const title = `对话强制中断：${input.kind}`
  const body = `会话 ${input.sessionId} 第 ${input.turn} 轮未完成即被强制终止。${input.detail}`
  return {
    schema_version: 'alert.v1',
    id: 'interruption-' + createHash('sha1').update(input.dedupeKey).digest('hex').slice(0, 16),
    level: input.level,
    category: '系统异常',
    title,
    body,
    sourcePlugin: '@dsh-external/dsh-dialogue-alert-message',
    createdAt: new Date(input.ts).toISOString(),
    extraPayload: {
      interruption: {
        kind: input.kind,
        sessionId: input.sessionId,
        turn: input.turn,
        dedupeKey: input.dedupeKey,
        soundType: input.soundType,
      },
    },
  }
}

/** 结构化日志行（JSON，一行一条；UTC ISO8601 时间戳）。 */
export function buildAlarmLogLine(input: {
  ts: number
  sessionId: string
  kind: string
  level: string
  alerted: boolean
  mutedBy: string | null
  detail: string
}): string {
  return JSON.stringify({
    ts: new Date(input.ts).toISOString(),
    sessionId: input.sessionId,
    kind: input.kind,
    level: input.level,
    alerted: input.alerted,
    mutedBy: input.mutedBy,
    detail: input.detail,
  })
}
