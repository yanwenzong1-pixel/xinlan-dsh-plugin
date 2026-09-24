/**
 * dsh-dialogue-alert-message — DeepSeek 用量统计纯函数核心。
 * 全部逻辑无副作用：计价、高峰/空闲因子、跨日、幂等计次、持久化回退、格式化、余额解析、节流。
 * 单测见 test/usage-stats.test.mjs（node --test test/）。
 */
/** 单次模型调用的 token 用量（跨适配器口径：缓存命中/未命中已拆分）。 */
export interface UsageCounts {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
/** 单价（元/百万 tokens）。cacheHit 为缓存命中（读取）价；input 为未命中输入价（写入缓存按未命中计）。 */
export interface PriceEntry {
    input: number;
    cacheHit: number;
    output: number;
}
/** 模型 → 单价映射 + 兜底档。缺省与 DeepSeek 官方价目表一致（校准入口见 README）。 */
export interface PriceTable {
    models: Record<string, PriceEntry>;
    fallback: PriceEntry;
}
/** 高峰时段策略：北京时区（无夏令时）按官方定义——工作日 9:00-12:00、14:00-18:00 高峰全价，其余 ×offPeakFactor。 */
export interface PeakPolicy {
    tzOffsetMin: number;
    offPeakFactor: number;
    peakWindows: Array<[number, number]>;
    peakWeekdays: number[];
}
/** 持久化状态（stats.json）。 */
export interface UsageState {
    dialogueCount: number;
    todayCost: number;
    day: string;
    recentKeys: string[];
    updatedAt: number;
}
/** 余额缓存（内存 + 持久化）。 */
export interface BalanceState {
    balance: number | null;
    balanceAt: number | null;
    lastError: string | null;
}
/** 统一查询接口返回：见 getUsageOverview。 */
export interface Overview {
    dialogueCount: number;
    todayCost: number;
    balance: number | null;
    updatedAt: number;
}
/** recentKeys 最大容量：超限淘汰最旧（防重放窗口，见风险清单）。 */
export declare const RECENT_KEYS_CAP = 1024;
/** 容错提取 usage 字段：任何非法条目按 0，返回 null 表示整包无用（无任何合法字段）。 */
export declare function normalizeUsage(raw: unknown): UsageCounts | null;
/** 未知模型回退兜底价。 */
export declare function priceEntryFor(table: PriceTable, model: string): PriceEntry;
/**
 * 一次 usage 的成本（元）。
 * 账单口径：输入 = 未命中(cacheWrite 并入) × input + 命中 × cacheHit + 输出 × output，再乘时刻因子。
 */
export declare function costOfUsage(usage: UsageCounts, price: PriceEntry, factor: number): number;
/** 时刻因子：高峰窗口内 1，否则 offPeakFactor。 */
export declare function peekFactorAt(tsMs: number, policy: PeakPolicy): number;
/** 指定时区（固定分钟偏移，无 DST——北京时区即 UTC+8）下的自然日键。 */
export declare function dayKeyAt(tsMs: number, tzOffsetMin: number): string;
/** 持久化读取回退：损坏/缺字段/类型错误 → 默认值并自动重建（当天消耗清零按 day 判定）。 */
export declare function loadState(raw: unknown, todayKey: string): UsageState;
/** 余额持久化回退：损坏/缺字段 → 未知（null），不抛错。 */
export declare function loadBalance(raw: unknown): BalanceState;
/** 一步 usage 到位：跨日先清零，再累加成本。返回新状态（纯函数）。 */
export declare function applyStepUsage(state: UsageState, usage: UsageCounts, price: PriceEntry, tsMs: number, policy: PeakPolicy): UsageState;
/** 对话完成计次：同一轮（sessionId:turn）重复回调幂等；超限淘汰最旧键。 */
export declare function recordCompletedTurn(state: UsageState, key: string, tsMs?: number): UsageState;
/** 统一接口数据：清洗非有限数（杜绝 undefined/NaN/Infinity 上屏）。 */
export declare function sanitizeOverview(state: UsageState, balance: BalanceState | null): Overview;
/** 金额/次数展示：缺失一律 '--'，禁用 undefined/NaN/null 泄漏；金额两位小数。 */
export declare function fmtMoney2(v: number | null | undefined): string;
export declare function fmtCount(v: number | null | undefined): string;
/** 官方 /user/balance 响应解析：优先 CNY，缺则首个；不可用/负数/非法 → null。 */
export declare function parseBalancePayload(raw: unknown, preferCurrency?: string): number | null;
/** 余额刷新节流：初始必刷，间隔内不刷。 */
export declare function shouldRefresh(lastFetchAt: number | null, now: number, minIntervalMs: number): boolean;
/** 持久化文件版本号（host 写入 stats.json）。 */
export declare const USAGE_STATS_VERSION = 1;
