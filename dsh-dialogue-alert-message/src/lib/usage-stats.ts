/**
 * dsh-dialogue-alert-message — DeepSeek 用量统计纯函数核心。
 * 全部逻辑无副作用：计价、高峰/空闲因子、跨日、幂等计次、持久化回退、格式化、余额解析、节流。
 * 单测见 test/usage-stats.test.mjs（node --test test/）。
 */

/** 单次模型调用的 token 用量（跨适配器口径：缓存命中/未命中已拆分）。 */
export interface UsageCounts {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 单价（元/百万 tokens）。cacheHit 为缓存命中（读取）价；input 为未命中输入价（写入缓存按未命中计）。 */
export interface PriceEntry {
  input: number
  cacheHit: number
  output: number
}

/** 模型 → 单价映射 + 兜底档。缺省与 DeepSeek 官方价目表一致（校准入口见 README）。 */
export interface PriceTable {
  models: Record<string, PriceEntry>
  fallback: PriceEntry
}

/** 高峰时段策略：北京时区（无夏令时）按官方定义——工作日 9:00-12:00、14:00-18:00 高峰全价，其余 ×offPeakFactor。 */
export interface PeakPolicy {
  tzOffsetMin: number
  offPeakFactor: number
  peakWindows: Array<[number, number]>
  peakWeekdays: number[] // 1=周一 … 7=周日
}

/** 持久化状态（stats.json）。 */
export interface UsageState {
  dialogueCount: number
  todayCost: number
  day: string
  recentKeys: string[]
  updatedAt: number
}

/** 余额缓存（内存 + 持久化）。 */
export interface BalanceState {
  balance: number | null
  balanceAt: number | null
  lastError: string | null
}

/** 统一查询接口返回：见 getUsageOverview。 */
export interface Overview {
  dialogueCount: number
  todayCost: number
  balance: number | null
  updatedAt: number
}

/** recentKeys 最大容量：超限淘汰最旧（防重放窗口，见风险清单）。 */
export const RECENT_KEYS_CAP = 1024

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

function intOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0
}

/** 容错提取 usage 字段：任何非法条目按 0，返回 null 表示整包无用（无任何合法字段）。 */
export function normalizeUsage(raw: unknown): UsageCounts | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const out: UsageCounts = {}
  let any = false
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[key] = v
      any = true
    }
  }
  return any ? out : null
}

/** 未知模型回退兜底价。 */
export function priceEntryFor(table: PriceTable, model: string): PriceEntry {
  return table.models[model] ?? table.fallback
}

function nz(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * 一次 usage 的成本（元）。
 * 账单口径：输入 = 未命中(cacheWrite 并入) × input + 命中 × cacheHit + 输出 × output，再乘时刻因子。
 */
export function costOfUsage(usage: UsageCounts, price: PriceEntry, factor: number): number {
  const missIn = nz(usage.inputTokens) + nz(usage.cacheWriteTokens)
  const hitIn = nz(usage.cacheReadTokens)
  const out = nz(usage.outputTokens)
  const miss = nz(price.input)
  const hit = nz(price.cacheHit)
  const outP = nz(price.output)
  const off = nz(factor)
  const cost = (missIn * miss + hitIn * hit + out * outP) * off / 1_000_000
  return Number.isFinite(cost) ? cost : 0
}

/** 时刻因子：高峰窗口内 1，否则 offPeakFactor。 */
export function peekFactorAt(tsMs: number, policy: PeakPolicy): number {
  const zoned = new Date(tsMs + policy.tzOffsetMin * 60_000)
  const weekday = zoned.getUTCDay() === 0 ? 7 : zoned.getUTCDay() // 周日 0 → 7
  const minutes = zoned.getUTCHours() * 60 + zoned.getUTCMinutes()
  if (policy.peakWeekdays.includes(weekday)) {
    for (const [startHour, endHour] of policy.peakWindows) {
      if (minutes >= startHour * 60 && minutes < endHour * 60) return 1
    }
  }
  return policy.offPeakFactor
}

/** 指定时区（固定分钟偏移，无 DST——北京时区即 UTC+8）下的自然日键。 */
export function dayKeyAt(tsMs: number, tzOffsetMin: number): string {
  const zoned = new Date(tsMs + tzOffsetMin * 60_000)
  const y = zoned.getUTCFullYear()
  const m = String(zoned.getUTCMonth() + 1).padStart(2, '0')
  const d = String(zoned.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 持久化读取回退：损坏/缺字段/类型错误 → 默认值并自动重建（当天消耗清零按 day 判定）。 */
export function loadState(raw: unknown, todayKey: string): UsageState {  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { dialogueCount: 0, todayCost: 0, day: todayKey, recentKeys: [], updatedAt: 0 }
  }
  const r = raw as Record<string, unknown>
  const keys = Array.isArray(r.recentKeys)
    ? Array.from(new Set(r.recentKeys.filter((k): k is string => typeof k === 'string'))).slice(-RECENT_KEYS_CAP)
    : []
  const day = typeof r.day === 'string' && r.day.length === 10 ? r.day : todayKey
  const dialogueCount = intOrZero(r.dialogueCount)
  const updatedAt = intOrZero(r.updatedAt)
  // 跨日：消耗清零、计数保留；键集合不随日重置（防重放窗口跨日有效）。
  const todayCost = day === todayKey ? numOrZero(r.todayCost) : 0
  return { dialogueCount, todayCost, day: day === todayKey ? day : todayKey, recentKeys: keys, updatedAt }
}

/** 余额持久化回退：损坏/缺字段 → 未知（null），不抛错。 */
export function loadBalance(raw: unknown): BalanceState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { balance: null, balanceAt: null, lastError: null }
  }
  const r = raw as Record<string, unknown>
  const at = intOrZero(r.balanceAt)
  const bal = numOrZero(r.balance)
  return {
    balance: at > 0 ? (r.balance !== undefined && typeof r.balance === 'number' && Number.isFinite(r.balance) && r.balance >= 0 ? bal : null) : null,
    balanceAt: at > 0 ? at : null,
    lastError: null,
  }
}

/** 一步 usage 到位：跨日先清零，再累加成本。返回新状态（纯函数）。 */
export function applyStepUsage(
  state: UsageState,
  usage: UsageCounts,
  price: PriceEntry,
  tsMs: number,
  policy: PeakPolicy,
): UsageState {
  const today = dayKeyAt(tsMs, policy.tzOffsetMin)
  const cost = costOfUsage(usage, price, peekFactorAt(tsMs, policy))
  const base = state.day === today ? state.todayCost : 0
  return { ...state, day: today, todayCost: base + cost, updatedAt: tsMs }
}

/** 对话完成计次：同一轮（sessionId:turn）重复回调幂等；超限淘汰最旧键。 */
export function recordCompletedTurn(state: UsageState, key: string, tsMs = Date.now()): UsageState {
  if (state.recentKeys.includes(key)) return state
  const recentKeys = [...state.recentKeys, key].slice(-RECENT_KEYS_CAP)
  return { ...state, dialogueCount: state.dialogueCount + 1, recentKeys, updatedAt: tsMs }
}

/** 统一接口数据：清洗非有限数（杜绝 undefined/NaN/Infinity 上屏）。 */
export function sanitizeOverview(
  state: UsageState,
  balance: BalanceState | null,
): Overview {
  const bal = balance === null ? null : balance.balance
  return {
    dialogueCount: intOrZero(state.dialogueCount),
    todayCost: numOrZero(state.todayCost),
    balance: bal !== null && Number.isFinite(bal) && bal >= 0 ? bal : null,
    updatedAt: intOrZero(state.updatedAt),
  }
}

/** 金额/次数展示：缺失一律 '--'，禁用 undefined/NaN/null 泄漏；金额两位小数。 */
export function fmtMoney2(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '--'
  const text = v.toFixed(2)
  return text === '-0.00' ? '0.00' : text
}

export function fmtCount(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '--'
  return String(Math.trunc(v))
}

/** 官方 /user/balance 响应解析：优先 CNY，缺则首个；不可用/负数/非法 → null。 */
export function parseBalancePayload(raw: unknown, preferCurrency = 'CNY'): number | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return null }
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const body = parsed as Record<string, unknown>
  if (body.is_available === false) return null
  const infos = body.balance_infos
  if (!Array.isArray(infos) || infos.length === 0) return null
  const pick = infos.find(i =>
    typeof i === 'object' && i !== null && (i as Record<string, unknown>).currency === preferCurrency,
  ) ?? infos[0]
  if (typeof pick !== 'object' || pick === null) return null
  const total = (pick as Record<string, unknown>).total_balance
  if (typeof total !== 'string' && typeof total !== 'number') return null
  const value = Number(total)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** 余额刷新节流：初始必刷，间隔内不刷。 */
export function shouldRefresh(lastFetchAt: number | null, now: number, minIntervalMs: number): boolean {
  if (lastFetchAt === null) return true
  return now - lastFetchAt >= minIntervalMs
}

/** 持久化文件版本号（host 写入 stats.json）。 */
export const USAGE_STATS_VERSION = 1
