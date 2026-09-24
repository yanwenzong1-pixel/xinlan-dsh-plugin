/**
 * 报警播放重放保护纯函数（无副作用，可单测）。
 * 语义：同一报警（id）最多连续播放 MAX_ALARM_REPLAYS 次；
 * 超过后仅静默（ack 尽力清除队列，客户端不再发声）。
 */
export declare const MAX_ALARM_REPLAYS = 3;
/** 播放判定 + 下一个计数（纯函数）。count 为已播放次数。 */
export declare function replayDecision(count: number, max?: number): {
    play: boolean;
    next: number;
};
/** 计数表上限（防 Map 无限增长：超过后整体清空重建）。 */
export declare const REPLAY_MAP_CAP = 256;
