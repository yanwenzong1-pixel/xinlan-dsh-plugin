/**
 * 强制中断报警纯函数测试（TDD）：归一化/分类/注册扩展/幂等/门控/配置钳位/日志/alert.v1 构建。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INTERRUPTION_KINDS,
  DEFAULT_KIND_SPEC,
  registerInterruptionKind,
  classifyTurnEnd,
  classifySeed,
  classifyDispose,
  lastEventTypeOf,
  dedupeKeyOf,
  shouldAlert,
  checkGate,
  clampAlarmConfig,
  levelOfKind,
  soundSpecOf,
  buildAlertPayload,
  buildAlarmLogLine,
} from '../src/lib/interruption.ts'

// ── 归一化分类：turn/end ──
test('turn/end error → tool-error（强制中断，非用户主动）', () => {
  const ev = classifyTurnEnd({ reason: { kind: 'error', error: { message: 'tool boom', code: 'TOOL_FAIL' } }, turn: 3 })
  assert.equal(ev?.kind, 'tool-error')
  assert.equal(ev?.turn, 3)
  assert.ok(ev?.detail.includes('tool boom'))
})

test('turn/end aborted + user → 用户主动取消（不报警）', () => {
  assert.equal(classifyTurnEnd({ reason: { kind: 'aborted', reason: { kind: 'user' } }, turn: 2 }), null)
})

test('turn/end aborted + parent/hook/disposed/legacy → 强制取消', () => {
  for (const r of [{ kind: 'parent' }, { kind: 'hook', reason: 'x' }, { kind: 'disposed' }, { kind: 'legacy' }]) {
    const ev = classifyTurnEnd({ reason: { kind: 'aborted', reason: r }, turn: 1 })
    assert.equal(ev?.kind, 'forced-cancel', JSON.stringify(r))
  }
})

test('turn/end completed / max-tokens / blocked → 不报警', () => {
  assert.equal(classifyTurnEnd({ reason: { kind: 'completed' }, turn: 1 }), null)
  assert.equal(classifyTurnEnd({ reason: { kind: 'max-tokens' }, turn: 1 }), null)
  assert.equal(classifyTurnEnd({ reason: { kind: 'blocked' }, turn: 1 }), null)
})

test('turn/end 非法/缺字段（null/字符串/畸形容器）→ null，不抛错', () => {
  for (const bad of [null, undefined, 'garbage', 42, {}, { reason: null }, { reason: { kind: 99 } }, { turn: 'x' }]) {
    assert.equal(classifyTurnEnd(bad), null, JSON.stringify(bad))
  }
})

// ── 归一化分类：重启恢复（seed 开放轮） / 会话失效（dispose 开放轮） ──
test('classifySeed: 种子最后事件为 turn/start（开放轮）→ host-restart', () => {
  const ev = classifySeed({ id: 's-1', events: [{ type: 'user/message' }, { type: 'turn/start', data: { turn: 5 } }] })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 5)
})

test('classifySeed: 正常结束的种子（最后 turn/end）/ 空 / 新会话 → null', () => {
  assert.equal(classifySeed({ id: 's-2', events: [{ type: 'turn/start' }, { type: 'turn/end', data: { turn: 1 } }] }), null)
  assert.equal(classifySeed({ id: 's-3', events: [{ type: 'user/message', data: {} }] }), null)
  assert.equal(classifySeed({ id: 's-4', events: [] }), null)
  assert.equal(classifySeed(null), null)
  assert.equal(classifySeed({ id: 's-5' }), null)
})

test('classifySeed: 崩溃收尾标记（种子尾 turn/end interrupted）→ host-restart（平台重启信号）', () => {
  const ev = classifySeed({
    id: 's-crash',
    events: [
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
    ],
  })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 7)
})

test('classifySeed: 剥离 firstLiveSeq 边界与 end-seed 标记后仍正确分类', () => {
  // 正常完成种子 + end-seed：不报警
  assert.equal(classifySeed({
    id: 's-9',
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/end-seed', data: {} },
    ],
  }), null)
  // 崩溃收尾种子 + end-seed + 后续 live 事件（firstLiveSeq 切开）→ 仍报警
  const ev = classifySeed({
    id: 's-10',
    firstLiveSeq: 3, // 种子 = 3 个事件；第 4 个是 live（构造后发布）
    events: [
      { type: 'turn/start', data: { turn: 3 } },
      { type: 'turn/end', data: { turn: 3, reason: { kind: 'interrupted' } } },
      { type: 'session/end-seed', data: {} },
      { type: 'user/message', data: { kind: 'user' } },
    ],
  })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 3)
})

test('turn/end interrupted（live 形态）→ host-restart', () => {
  const ev = classifyTurnEnd({ reason: { kind: 'interrupted' }, turn: 9 })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 9)
})

test('classifySeed: 崩溃收尾标记（种子尾 turn/end interrupted）→ host-restart（平台重启信号）', () => {
  const ev = classifySeed({
    id: 's-crash',
    events: [
      { type: 'turn/start', data: { turn: 7 } },
      { type: 'turn/end', data: { turn: 7, reason: { kind: 'interrupted' } } },
    ],
  })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 7)
})

test('classifySeed: 剥离 firstLiveSeq 边界与 end-seed 标记后仍正确分类', () => {
  // 正常完成种子 + end-seed：不报警
  assert.equal(classifySeed({
    id: 's-9',
    events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'session/end-seed', data: {} },
    ],
  }), null)
  // 崩溃收尾种子 + end-seed + 后续 live 事件（firstLiveSeq 切开）→ 仍报警
  const ev = classifySeed({
    id: 's-10',
    firstLiveSeq: 4,
    events: [
      { type: 'turn/start', data: { turn: 3 } },
      { type: 'turn/end', data: { turn: 3, reason: { kind: 'interrupted' } } },
      { type: 'session/end-seed', data: {} },
      { type: 'user/message', data: { kind: 'user' } },
    ],
  })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 3)
})

test('turn/end interrupted（live 形态）→ host-restart', () => {
  const ev = classifyTurnEnd({ reason: { kind: 'interrupted' }, turn: 9 })
  assert.equal(ev?.kind, 'host-restart')
  assert.equal(ev?.turn, 9)
})

test('classifyDispose: 会话销毁时最后事件为开放轮 → session-evicted', () => {
  const ev = classifyDispose({ id: 's-6', events: [{ type: 'turn/start', data: { turn: 2, step: 1 } }] })
  assert.equal(ev?.kind, 'session-evicted')
})

test('classifyDispose: 最后事件为终态/空/非法 → null', () => {
  assert.equal(classifyDispose({ id: 's-7', events: [{ type: 'turn/end', data: { turn: 1 } }] }), null)
  assert.equal(classifyDispose({ id: 's-8', events: [] }), null)
  assert.equal(classifyDispose({ id: 's-9' }), null)
})

test('lastEventTypeOf: 容错取末事件类型', () => {
  assert.equal(lastEventTypeOf([]), null)
  assert.equal(lastEventTypeOf([{ type: 'a' }]), 'a')
  assert.equal(lastEventTypeOf(undefined), null)
})

// ── 幂等去重 ──
test('dedupeKeyOf: 确定性键（kind:sessionId:turn）', () => {
  assert.equal(dedupeKeyOf('tool-error', 's-1', 3), 'tool-error:s-1:3')
  assert.equal(dedupeKeyOf('tool-error', 's-1', 3), 'tool-error:s-1:3')
  assert.equal(dedupeKeyOf('host-restart', 's-1', 9), 'host-restart:s-1:9')
})

test('shouldAlert: 首次 true；同键重复 false；新键（恢复后再中断）true；超限淘汰后同键可再报', () => {
  let keys = []
  let r1 = shouldAlert(keys, 'tool-error:s-1:3', 2)
  assert.equal(r1.alert, true)
  keys = r1.keys
  const r2 = shouldAlert(keys, 'tool-error:s-1:3', 2)
  assert.equal(r2.alert, false)
  const r3 = shouldAlert(r2.keys, 'tool-error:s-1:4', 2)
  assert.equal(r3.alert, true)
  // 容量 2：第三条挤出最旧键 → 旧键再次触发视为新中断（窗口边界，防集合无限增长）
  const r3b = shouldAlert(r3.keys, 'tool-error:s-1:5', 2)
  assert.equal(r3b.alert, true)
  const r4 = shouldAlert(r3b.keys, 'tool-error:s-1:3', 2)
  assert.equal(r4.alert, true)
  assert.ok(r4.keys.length <= 2)
})

test('shouldAlert: 非法 key/容量钳位不抛错', () => {
  assert.equal(shouldAlert(['a'], '', 0).alert, true)
  assert.equal(shouldAlert('nope', 'k:1', 1).alert, true)
})

// ── 等级映射（纯函数）与注册扩展 ──
test('levelOfKind: 默认真实映射（工具报错→重要，evict→重要，restart→高危）+ 可覆盖 + 未知拒绝', () => {
  assert.equal(levelOfKind('tool-error', undefined), '重要')
  assert.equal(levelOfKind('forced-cancel', undefined), '重要')
  assert.equal(levelOfKind('session-evicted', undefined), '重要')
  assert.equal(levelOfKind('host-restart', undefined), '高危')
  const cfg = { severityMapping: { 'tool-error': '高危' } }
  assert.equal(levelOfKind('tool-error', cfg), '高危')
  assert.equal(levelOfKind('unknown-kind', undefined), null)
})

test('registerInterruptionKind: 扩展新中断类型并参与映射', () => {
  const made = registerInterruptionKind('db-evicted', { level: '普通', soundType: 'single' })
  assert.equal(made, true)
  assert.equal(levelOfKind('db-evicted', undefined), '普通')
  assert.equal(DEFAULT_KIND_SPEC['db-evicted'].soundType, 'single')
  assert.ok(INTERRUPTION_KINDS.includes('db-evicted'))
  assert.equal(registerInterruptionKind('db-evicted', { level: '高危', soundType: 'triple' }), false) // 幂等：已存在
})

// ── 门控：总开关/全静音/等级过滤/免打扰 ──
const BASE = { alarmEnabled: true, muteAll: false, mutedLevels: [], dndWindows: [] }
test('checkGate: 默认放行；总开关/全静音/等级过滤分别拦截并给出原因', () => {
  assert.deepEqual(checkGate({ ...BASE }, '重要', 1000), { allowed: true, mutedBy: null })
  assert.deepEqual(checkGate({ ...BASE, alarmEnabled: false }, '重要', 1000), { allowed: false, mutedBy: 'master' })
  assert.deepEqual(checkGate({ ...BASE, muteAll: true }, '重要', 1000), { allowed: false, mutedBy: 'muteAll' })
  assert.deepEqual(checkGate({ ...BASE, mutedLevels: ['重要'] }, '重要', 1000), { allowed: false, mutedBy: 'level' })
  assert.deepEqual(checkGate({ ...BASE, mutedLevels: ['重要'] }, '高危', 1000), { allowed: true, mutedBy: null })
})

test('checkGate: 免打扰时段（HH:mm，含跨天）', () => {
  // 2026-09-03 本地 10:30 → 在 08:00-12:00 内
  const now = new Date(2026, 8, 3, 10, 30).getTime()
  assert.deepEqual(checkGate({ ...BASE, dndWindows: ['08:00-12:00'] }, '重要', now), { allowed: false, mutedBy: 'dnd' })
  assert.deepEqual(checkGate({ ...BASE, dndWindows: ['12:00-14:00'] }, '重要', now), { allowed: true, mutedBy: null })
  // 跨天窗口 22:00-06:00：23:00 命中；10:00 不命中
  const late = new Date(2026, 8, 3, 23, 0).getTime()
  const morning = new Date(2026, 8, 3, 10, 0).getTime()
  assert.equal(checkGate({ ...BASE, dndWindows: ['22:00-06:00'] }, '重要', late).allowed, false)
  assert.equal(checkGate({ ...BASE, dndWindows: ['22:00-06:00'] }, '重要', morning).allowed, true)
  // 非法窗口忽略
  assert.equal(checkGate({ ...BASE, dndWindows: ['bad'] }, '重要', now).allowed, true)
})

// ── 配置 clamp ──
test('clampAlarmConfig: 音量/时长/等级/窗口收敛，坏输入回退默认，未知字段保留', () => {
  const cfg = clampAlarmConfig({
    alarmEnabled: 'yes',
    muteAll: 'x',
    mutedLevels: ['高危', '不存在', 42],
    dndWindows: ['08:00-12:00', 'bad', 7],
    sounds: { '重要': { volume: 9, durationMs: 99999 } },
  })
  assert.equal(cfg.alarmEnabled, true)
  assert.equal(cfg.muteAll, false)
  assert.deepEqual(cfg.mutedLevels, ['高危'])
  assert.deepEqual(cfg.dndWindows, ['08:00-12:00'])
  assert.equal(cfg.sounds['重要'].volume, 1)
  assert.equal(cfg.sounds['重要'].durationMs, 5000)
  const bad = clampAlarmConfig({ sounds: null, dndWindows: null, alarmEnabled: null })
  assert.equal(bad.alarmEnabled, true)
  assert.deepEqual(bad.dndWindows, [])
  assert.ok(bad.sounds['高危'].volume >= 0 && bad.sounds['高危'].volume <= 1)
})

test('soundSpecOf: 按 kind 取声音规格（类型/音量/时长）', () => {
  const spec = soundSpecOf('host-restart', undefined)
  assert.equal(spec.soundType, 'triple')
  assert.ok(spec.volume > 0 && spec.volume <= 1)
  assert.ok(spec.durationMs >= 100 && spec.durationMs <= 5000)
  assert.equal(soundSpecOf('unknown-kind', undefined).soundType, 'single')
})

// ── alert.v1 构建与结构化日志 ──
test('buildAlertPayload: 合法 alert.v1 + extraPayload 携带中断元数据', () => {
  const payload = buildAlertPayload({
    kind: 'host-restart',
    level: '高危',
    sessionId: 's-1',
    dedupeKey: 'host-restart:s-1:9',
    turn: 9,
    detail: '进程重启，恢复了一个开放轮',
    ts: Date.UTC(2026, 8, 3, 1, 0, 0),
    soundType: 'triple',
  })
  assert.equal(payload.schema_version, 'alert.v1')
  assert.equal(payload.level, '高危')
  assert.equal(payload.category, '系统异常')
  assert.equal(payload.sourcePlugin, '@dsh-external/dsh-dialogue-alert-message')
  assert.equal(payload.createdAt, '2026-09-03T01:00:00.000Z')
  assert.ok(payload.id.length > 0)
  assert.ok(payload.title.length > 0 && payload.body.length > 0)
  assert.equal(payload.extraPayload.interruption.kind, 'host-restart')
  assert.equal(payload.extraPayload.interruption.dedupeKey, 'host-restart:s-1:9')
  assert.equal(payload.extraPayload.interruption.soundType, 'triple')
})

test('buildAlarmLogLine: UTC ISO8601 + 全部字段完整（成功与静音过滤两态）', () => {
  const line = buildAlarmLogLine({
    ts: Date.UTC(2026, 8, 3, 1, 0, 0),
    sessionId: 's-1',
    kind: 'tool-error',
    level: '重要',
    alerted: true,
    mutedBy: null,
    detail: 'x',
  })
  const parsed = JSON.parse(line)
  assert.equal(parsed.ts, '2026-09-03T01:00:00.000Z')
  assert.equal(parsed.sessionId, 's-1')
  assert.equal(parsed.kind, 'tool-error')
  assert.equal(parsed.level, '重要')
  assert.equal(parsed.alerted, true)
  assert.equal(parsed.mutedBy, null)
  const filtered = JSON.parse(buildAlarmLogLine({
    ts: Date.UTC(2026, 8, 3, 1, 0, 0),
    sessionId: 's-2',
    kind: 'session-evicted',
    level: '重要',
    alerted: false,
    mutedBy: 'dnd',
    detail: 'x',
  }))
  assert.equal(filtered.alerted, false)
  assert.equal(filtered.mutedBy, 'dnd')
})
