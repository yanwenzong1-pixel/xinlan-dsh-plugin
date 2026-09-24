/** 中文等级（与 alert-hub alert.v1 契约一致）。 */
export type AlertLevel = '提示' | '普通' | '重要' | '高危';
export declare const ALERT_LEVELS: AlertLevel[];
/** 中断原因枚举（内置 4 类；新类型经 registerInterruptionKind 扩展，禁止散落硬编码分支）。 */
export declare const INTERRUPTION_KINDS: readonly ["tool-error", "forced-cancel", "session-evicted", "host-restart"];
export type InterruptionKind = (typeof INTERRUPTION_KINDS)[number];
/** 内置声音类型（本地降级音色）：single 单音 / double 双脉冲 / triple 三连。 */
export declare const SOUND_TYPES: readonly ["single", "double", "triple"];
export type SoundType = (typeof SOUND_TYPES)[number];
/** 每种中断原因的默认规格：等级 + 音色。 */
export interface KindSpec {
    level: AlertLevel;
    soundType: SoundType;
}
export declare const DEFAULT_KIND_SPEC: Record<string, KindSpec>;
/** 注册式扩展：注册新中断类型（幂等，已存在返回 false 不改写）。 */
export declare function registerInterruptionKind(kind: string, spec: KindSpec): boolean;
/** 归一化后的中断事件。 */
export interface InterruptionEvent {
    kind: InterruptionKind;
    sessionId: string;
    turn: number;
    detail: string;
}
/**
 * turn/end 分类（近期轮结束信号）：
 * - error → tool-error（工具/LLM 链路中止）；
 * - interrupted → host-restart（持久化后端为崩溃孤儿轮收尾——宿主强制重启信号）；
 * - aborted + 非 user 原因 → forced-cancel（父/钩子/销毁/遗留——外部强制取消）；
 * - aborted + user / completed / max-tokens / blocked / 非法 → null（不报警）。
 */
export declare function classifyTurnEnd(data: unknown): InterruptionEvent | null;
/** 容错取事件列表末项 type。 */
export declare function lastEventTypeOf(events: unknown): string | null;
/**
 * 恢复种子的有效事件：剥离 live 部分（分界线 firstLiveSeq）与
 * 'session/end-seed' 边界标记（构造种子投影，非会话事件）。
 */
export declare function seedEventsOf(events: unknown, firstLiveSeq: number): unknown[];
/**
 * 恢复会话种子分类：种子有效尾部为「开放轮 turn/start」或「崩溃收尾 turn/end(interrupted)」
 * → host-restart（两类为同一事实的两种可观测形态：修复前开放 / 修复后标记）。
 */
export declare function classifySeed(session: unknown): InterruptionEvent | null;
/** 会话失效分类：销毁时末事件仍为开放轮 → session-evicted。 */
export declare function classifyDispose(session: unknown): InterruptionEvent | null;
/** 确定性去重键：kind:sessionId:turn。 */
export declare function dedupeKeyOf(kind: string, sessionId: string, turn: number): string;
/** 幂等判断（纯函数）：同键已存在 → 不报；否则插入（超限淘汰最旧）。 */
export declare function shouldAlert(keys: string[], key: string, cap: number): {
    alert: boolean;
    keys: string[];
};
/** 门控配置（clamp 后）。 */
export interface AlarmGateConfig {
    alarmEnabled: boolean;
    muteAll: boolean;
    mutedLevels: AlertLevel[];
    dndWindows: string[];
    severityMapping: Record<string, AlertLevel>;
    sounds: Record<string, {
        soundType: string;
        volume: number;
        durationMs: number;
    }>;
}
/**
 * 门控判定（纯函数）：总开关/全静音/等级过滤/免打扰任意命中 → 拦截并给原因；
 * 全部通过 → 放行。本地时间 = 宿主本地。
 */
export declare function checkGate(cfg: AlarmGateConfig, level: string, nowMs: number): {
    allowed: boolean;
    mutedBy: string | null;
};
/** 配置钳位收敛（纯函数）：非法输入回退默认；未知字段原样保留。 */
export declare function clampAlarmConfig(raw: unknown): AlarmGateConfig & Record<string, unknown>;
/** 等级映射（纯函数 + 配置覆盖）：kind → 等级；未知 kind 返回 null（不报警）。 */
export declare function levelOfKind(kind: string, cfg: AlarmGateConfig | undefined): AlertLevel | null;
/** 声音规格（按 kind 默认 + 配置覆盖）：本地降级音色用。 */
export declare function soundSpecOf(kind: string, cfg: AlarmGateConfig | undefined): {
    soundType: string;
    volume: number;
    durationMs: number;
};
/** 构建 alert.v1 告警载荷（汇入唯一出口 alert-hub）。 */
export declare function buildAlertPayload(input: {
    kind: string;
    level: AlertLevel;
    sessionId: string;
    dedupeKey: string;
    turn: number;
    detail: string;
    ts: number;
    soundType: string;
}): Record<string, unknown>;
/** 结构化日志行（JSON，一行一条；UTC ISO8601 时间戳）。 */
export declare function buildAlarmLogLine(input: {
    ts: number;
    sessionId: string;
    kind: string;
    level: string;
    alerted: boolean;
    mutedBy: string | null;
    detail: string;
}): string;
