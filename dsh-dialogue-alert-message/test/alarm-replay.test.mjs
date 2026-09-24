/**
 * 报警重放保护纯函数测试（TDD）：最多连续播放 3 次。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { replayDecision, MAX_ALARM_REPLAYS } from '../src/lib/alarm-replay.ts'

test('replayDecision: 0/1/2 次播放，第 3 次后静默', () => {
  assert.deepEqual(replayDecision(0), { play: true, next: 1 })
  assert.deepEqual(replayDecision(1), { play: true, next: 2 })
  assert.deepEqual(replayDecision(2), { play: true, next: 3 })
  assert.deepEqual(replayDecision(3), { play: false, next: 4 })
  assert.deepEqual(replayDecision(4), { play: false, next: 5 })
})

test('replayDecision: 边界与非法输入不抛错、容量钳位', () => {
  assert.equal(replayDecision(-1).play, true) // 负数按 0
  assert.equal(replayDecision(NaN).play, true)
  assert.equal(replayDecision(Infinity).play, false)
  assert.equal(replayDecision(0, 0).play, false) // max=0 → 永不播放
  assert.equal(replayDecision(0, 1.9).play, true) // max 取整
  assert.equal(MAX_ALARM_REPLAYS, 3)
})
