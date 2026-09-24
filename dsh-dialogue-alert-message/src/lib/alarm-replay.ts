/**
 * 报警播放重放保护纯函数（无副作用，可单测）。
 * 语义：同一报警（id）最多连续播放 MAX_ALARM_REPLAYS 次；
 * 超过后仅静默（ack 尽力清除队列，客户端不再发声）。
 */
export const MAX_ALARM_REPLAYS = 3

/** 播放判定 + 下一个计数（纯函数）。count 为已播放次数。 */
export function replayDecision(count: number, max = MAX_ALARM_REPLAYS): { play: boolean; next: number } {
  const safeMax = Number.isFinite(max) && max >= 0 ? Math.floor(max) : MAX_ALARM_REPLAYS
  if (!Number.isFinite(count)) {
    if (count > 0) return { play: false, next: safeMax + 1 } // 正无穷（已播不可数）→ 视为超限
    return { play: true, next: 1 } // NaN/负无穷/负值 → 按 0
  }
  const safe = count >= 0 ? Math.floor(count) : 0
  const next = safe + 1
  return { play: next <= safeMax, next }
}

/** 计数表上限（防 Map 无限增长：超过后整体清空重建）。 */
export const REPLAY_MAP_CAP = 256
