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
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-dialogue-alert-message";
export declare const inject: string[];
interface UsageConfig {
    apiKeyEnv: string;
    baseURL: string;
    balanceTimeoutMs: number;
    balanceMinIntervalMs: number;
    balanceTimerMs: number;
    tzOffsetMin: number;
    offPeakFactor: number;
    peakWindows: Array<[number, number]>;
    peakWeekdays: number[];
    prices: Record<string, {
        input: number;
        cacheHit: number;
        output: number;
    }>;
    defaultPrice: {
        input: number;
        cacheHit: number;
        output: number;
    };
    statsFile: string;
    alarmSettingsFile: string;
    alarmDedupeCap: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    apiKeyEnv: z<string, string>;
    baseURL: z<string, string>;
    balanceTimeoutMs: z<number, number>;
    balanceMinIntervalMs: z<number, number>;
    balanceTimerMs: z<number, number>;
    tzOffsetMin: z<number, number>;
    offPeakFactor: z<number, number>;
    peakWindows: z<[(number | undefined)?, (number | undefined)?, ...any[]][], [(number | undefined)?, (number | undefined)?, ...any[]][]>;
    peakWeekdays: z<number[], number[]>;
    prices: z<import("@deepseek-ai/cosmokit").Dict<{
        input?: number | null | undefined;
        cacheHit?: number | null | undefined;
        output?: number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>, string>>;
    defaultPrice: z<Schemastery.ObjectS<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>, Schemastery.ObjectT<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>>;
    statsFile: z<string, string>;
    alarmSettingsFile: z<string, string>;
    alarmDedupeCap: z<number, number>;
}>, Schemastery.ObjectT<{
    apiKeyEnv: z<string, string>;
    baseURL: z<string, string>;
    balanceTimeoutMs: z<number, number>;
    balanceMinIntervalMs: z<number, number>;
    balanceTimerMs: z<number, number>;
    tzOffsetMin: z<number, number>;
    offPeakFactor: z<number, number>;
    peakWindows: z<[(number | undefined)?, (number | undefined)?, ...any[]][], [(number | undefined)?, (number | undefined)?, ...any[]][]>;
    peakWeekdays: z<number[], number[]>;
    prices: z<import("@deepseek-ai/cosmokit").Dict<{
        input?: number | null | undefined;
        cacheHit?: number | null | undefined;
        output?: number | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>, string>>;
    defaultPrice: z<Schemastery.ObjectS<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>, Schemastery.ObjectT<{
        input: z<number, number>;
        cacheHit: z<number, number>;
        output: z<number, number>;
    }>>;
    statsFile: z<string, string>;
    alarmSettingsFile: z<string, string>;
    alarmDedupeCap: z<number, number>;
}>>;
export declare function apply(ctx: Context, config: UsageConfig): void;
export {};
