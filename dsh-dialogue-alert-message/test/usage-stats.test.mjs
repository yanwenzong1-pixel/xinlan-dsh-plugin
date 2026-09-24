/**
 * 纯函数测试：DeepSeek 用量统计核心逻辑（计价/幂等/跨日/持久化回退/格式化/余额解析）。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  costOfUsage,
  peekFactorAt,
  dayKeyAt,
  loadState,
  loadBalance,
  applyStepUsage,
  recordCompletedTurn,
  sanitizeOverview,
  fmtMoney2,
  fmtCount,
  parseBalancePayload,
  shouldRefresh,
  priceEntryFor,
} from '../src/lib/usage-stats.ts'

const PRICE = { input: 1.5, cacheHit: 0.05, output: 4.5 } // 元/1M tokens（v4-flash 高峰价）
const TABLE = { models: { 'deepseek-v4-flash': PRICE }, fallback: PRICE }
const POLICY = {
  tzOffsetMin: 480,
  offPeakFactor: 0.5,
  peakWindows: [[9, 12], [14, 18]],
  peakWeekdays: [1, 2, 3, 4, 5],
}

// —— 计价 ——
test('costOfUsage: 未命中输入+命中输入+输出 分别计价', () => {
  const cost = costOfUsage(
    { inputTokens: 1_000_000, cacheReadTokens: 2_000_000, outputTokens: 1_000_000 },
    PRICE,
    1,
  )
  assert.equal(cost, 1.5 + 0.1 + 4.5) // 1.5 + 2×0.05 + 4.5
})

test('costOfUsage: cacheWrite 并入未命中输入（账单口径）', () => {
  const cost = costOfUsage(
    { inputTokens: 100, cacheWriteTokens: 50, outputTokens: 0 },
    PRICE,
    1,
  )
  assert.equal(cost, (150 / 1_000_000) * 1.5)
})

test('costOfUsage: 因子为半价（空闲时段）', () => {
  const cost = costOfUsage({ inputTokens: 1_000_000 }, PRICE, 0.5)
  assert.equal(cost, 0.75)
})

test('costOfUsage: 缺字段按 0；非法/负数/NaN 按 0；零 token 成本 0', () => {
  assert.equal(costOfUsage({}, PRICE, 1), 0)
  assert.equal(costOfUsage({ inputTokens: -5, outputTokens: NaN }, PRICE, 1), 0)
  assert.equal(costOfUsage({ inputTokens: '1e6' }, PRICE, 1), 0) // 非数字字符串拒绝
  assert.equal(costOfUsage({ inputTokens: 0, outputTokens: 0 }, PRICE, 1), 0)
})

// —— 高峰/空闲因子 ——
test('peekFactorAt: 工作日 9:00-12:00 / 14:00-18:00 高峰全价，其余半价', () => {
  const at = (dayOfWeek, hh, mm) => {
    // 构造一个 UTC 时间，然后换算到 +08:00 得到该星期几/时刻
    const ref = new Date('2026-09-21T00:00:00Z') // 周一
    const shift = dayOfWeek - 1
    const base = ref.getTime() + shift * 86_400_000
    return new Date(base - 8 * 3_600_000 + hh * 3_600_000 + mm * 60_000).getTime()
  }
  assert.equal(peekFactorAt(at(1, 9, 0), POLICY), 1)       // 周一 09:00 边界含
  assert.equal(peekFactorAt(at(1, 11, 59), POLICY), 1)     // 高峰内
  assert.equal(peekFactorAt(at(1, 12, 0), POLICY), 0.5)    // 12:00 边界不含
  assert.equal(peekFactorAt(at(1, 13, 0), POLICY), 0.5)    // 午间空闲
  assert.equal(peekFactorAt(at(1, 14, 0), POLICY), 1)      // 下午高峰开始
  assert.equal(peekFactorAt(at(1, 18, 0), POLICY), 0.5)    // 18:00 结束
  assert.equal(peekFactorAt(at(1, 22, 0), POLICY), 0.5)    // 晚间空闲
})

test('peekFactorAt: 周末与自定义窗口', () => {
  const at = (dayOfWeek, hh, mm) => {
    const ref = new Date('2026-09-21T00:00:00Z')
    const shift = dayOfWeek - 1
    const base = ref.getTime() + shift * 86_400_000
    return new Date(base - 8 * 3_600_000 + hh * 3_600_000 + mm * 60_000).getTime()
  }
  assert.equal(peekFactorAt(at(6, 10, 0), POLICY), 0.5) // 周六高峰时段也空闲
  assert.equal(peekFactorAt(at(7, 10, 0), POLICY), 0.5) // 周日
  assert.equal(peekFactorAt(at(2, 10, 0), { ...POLICY, offPeakFactor: 1 }), 1) // 关闭闲时折扣 → 全价
  assert.equal(peekFactorAt(at(1, 10, 0), { ...POLICY, peakWindows: [[0, 24]] }), 1) // 全窗口高峰
})

// —— 跨日 ——
test('dayKeyAt: +08:00 时区日切（UTC 前天 23:00 = 本地次日）', () => {
  const utc2300 = Date.UTC(2026, 8, 21, 23, 0) // 2026-09-21 23:00 UTC
  assert.equal(dayKeyAt(utc2300, 480), '2026-09-22')
  assert.equal(dayKeyAt(utc2300, 0), '2026-09-21')
  assert.equal(dayKeyAt(Date.UTC(2026, 0, 1, 0, 0), 480), '2026-01-01')
})

// —— 持久化回退 ——
test('loadState: 损坏/非对象/字段缺失/类型错误全部回退默认，不抛错', () => {
  for (const bad of [null, undefined, 'garbage', 42, [], { version: 999 }]) {
    const s = loadState(bad, '2026-09-02')
    assert.equal(s.dialogueCount, 0)
    assert.equal(s.todayCost, 0)
    assert.equal(s.day, '2026-09-02')
    assert.equal(s.updatedAt, 0)
    assert.deepEqual(s.recentKeys, [])
  }
  const mixed = loadState(
    { dialogueCount: '9', todayCost: 'abc', day: 123, recentKeys: [1, 'a', 'a'], updatedAt: NaN },
    '2026-09-02',
  )
  assert.equal(mixed.dialogueCount, 0)
  assert.equal(mixed.todayCost, 0)
  assert.equal(mixed.day, '2026-09-02')
  assert.deepEqual(mixed.recentKeys, ['a'])
})

test('loadState: 正常值保留；recentKeys 去重截断；负数钳位', () => {
  const keys = Array.from({ length: 1200 }, (_, i) => 'k' + i)
  const s = loadState(
    { dialogueCount: 5, todayCost: 3.3, day: '2026-09-02', recentKeys: keys, updatedAt: 100 },
    '2026-09-02',
  )
  assert.equal(s.dialogueCount, 5)
  assert.equal(s.recentKeys.length, 1024)
  assert.equal(s.recentKeys[0], 'k176')
  assert.equal(s.day, '2026-09-02')
  assert.equal(s.todayCost, 3.3)
  const neg = loadState({ dialogueCount: -1, todayCost: -0.1 }, '2026-09-02')
  assert.equal(neg.dialogueCount, 0)
  assert.equal(neg.todayCost, 0)
})

test('loadState: 持久化 day 与当前日不符 → 当日消耗清零（计数保留）', () => {
  const s = loadState(
    { dialogueCount: 7, todayCost: 12.34, day: '2026-09-01', recentKeys: ['x:1'], updatedAt: 5 },
    '2026-09-02',
  )
  assert.equal(s.dialogueCount, 7)
  assert.equal(s.todayCost, 0)
  assert.equal(s.day, '2026-09-02')
  assert.deepEqual(s.recentKeys, ['x:1'])
})

// —— 当日累计 ——
test('applyStepUsage: 累加成本并更新 updatedAt；因子按事件时刻', () => {
  const s0 = loadState({ dialogueCount: 1, todayCost: 1, day: '2026-09-02', updatedAt: 9 }, '2026-09-02')
  const ts = Date.UTC(2026, 8, 2, 2, 0) // 2026-09-02 10:00 +08 周二 → 高峰全价 ×1
  const s1 = applyStepUsage(s0, { inputTokens: 1_000_000 }, PRICE, ts, POLICY)
  assert.equal(s1.todayCost, 2.5) // 1 + 1.5×1
  assert.equal(s1.updatedAt, ts)
  assert.equal(s1.dialogueCount, 1)
})

test('applyStepUsage: 成本为 0（无 usage）不污染状态，仍刷新 updatedAt', () => {
  const s0 = loadState({ dialogueCount: 1, todayCost: 1, day: '2026-09-02', updatedAt: 9 }, '2026-09-02')
  const s1 = applyStepUsage(s0, {}, PRICE, Date.UTC(2026, 8, 2, 2, 0), POLICY)
  assert.equal(s1.todayCost, 1)
  assert.equal(s1.updatedAt, Date.UTC(2026, 8, 2, 2, 0))
})

test('applyStepUsage: 跨日调用自动清零再累加', () => {
  const s0 = loadState({ dialogueCount: 2, todayCost: 5, day: '2026-09-01', updatedAt: 1 }, '2026-09-02')
  const s1 = applyStepUsage(s0, { inputTokens: 1_000_000 }, PRICE, Date.UTC(2026, 8, 2, 2, 0), POLICY)
  // 2026-09-02 02:00 UTC = 10:00 +08 周二 → 高峰全价 ×1 → 1.5
  assert.equal(s1.day, '2026-09-02')
  assert.equal(s1.todayCost, 1.5)
  assert.equal(s1.dialogueCount, 2)
})

// —— 幂等计次 ——
test('recordCompletedTurn: 首次 +1，重复回调 no-op', () => {
  const s0 = loadState({ dialogueCount: 3, todayCost: 0.5, day: '2026-09-02', updatedAt: 1 }, '2026-09-02')
  const s1 = recordCompletedTurn(s0, 'session-1:2', 100)
  assert.equal(s1.dialogueCount, 4)
  assert.equal(s1.updatedAt, 100)
  const s2 = recordCompletedTurn(s1, 'session-1:2', 200)
  assert.equal(s2.dialogueCount, 4)
  assert.equal(s2.updatedAt, 100) // 幂等时不刷新 updatedAt
  const s3 = recordCompletedTurn(s2, 'session-1:3', 300)
  assert.equal(s3.dialogueCount, 5)
})

test('recordCompletedTurn: 已计列表超过上限时淘汰最旧键，不影响新计', () => {
  let s0 = loadState({ day: '2026-09-02' }, '2026-09-02')
  for (let i = 0; i < 1024; i++) s0 = recordCompletedTurn(s0, 's:' + i, i)
  assert.equal(s0.dialogueCount, 1024)
  assert.equal(s0.recentKeys.length, 1024)
  const s1 = recordCompletedTurn(s0, 's:new', 9999)
  assert.equal(s1.dialogueCount, 1025)
  assert.equal(s1.recentKeys.length, 1024)
  assert.equal(s1.recentKeys.includes('s:0'), false)
  const s2 = recordCompletedTurn(s1, 's:1', 10000)
  assert.equal(s2.dialogueCount, 1025) // 已被淘汰的旧键再次回调 → 仍幂等？不——淘汰后视为新键
})

// —— 统一接口与格式化 ——
test('loadBalance: 损坏/缺字段回退 null；合法保留；balanceAt 为 0 时余额视为未知', () => {
  assert.deepEqual(loadBalance(null), { balance: null, balanceAt: null, lastError: null })
  assert.deepEqual(loadBalance('garbage'), { balance: null, balanceAt: null, lastError: null })
  const ok = loadBalance({ balance: 88.5, balanceAt: 123 })
  assert.deepEqual(ok, { balance: 88.5, balanceAt: 123, lastError: null })
  const noAt = loadBalance({ balance: 88.5, balanceAt: 0 })
  assert.deepEqual(noAt, { balance: null, balanceAt: null, lastError: null })
  const bad = loadBalance({ balance: 'x', balanceAt: 9 })
  assert.deepEqual(bad, { balance: null, balanceAt: 9, lastError: null })
})

test('sanitizeOverview: 无 NaN/Infinity 泄漏；balance 未知为 null', () => {
  const o = sanitizeOverview(
    { dialogueCount: 2, todayCost: NaN, recentKeys: [], updatedAt: 1 },
    { balance: Infinity, balanceAt: 1, lastError: null },
  )
  assert.deepEqual(o, { dialogueCount: 2, todayCost: 0, balance: null, updatedAt: 1 })
  const o2 = sanitizeOverview(
    { dialogueCount: 0, todayCost: 0, recentKeys: [], updatedAt: 0 },
    { balance: 100.5, balanceAt: 0, lastError: null },
  )
  assert.deepEqual(o2, { dialogueCount: 0, todayCost: 0, balance: 100.5, updatedAt: 0 })
})

test('fmtMoney2 / fmtCount: 缺失 与 合法值', () => {
  assert.equal(fmtMoney2(null), '--')
  assert.equal(fmtMoney2(undefined), '--')
  assert.equal(fmtMoney2(NaN), '--')
  assert.equal(fmtMoney2(Infinity), '--')
  assert.equal(fmtMoney2(-0.001), '0.00')
  assert.equal(fmtMoney2(0), '0.00')
  assert.equal(fmtMoney2(4.5), '4.50')
  assert.equal(fmtMoney2(12.345), '12.35')
  assert.equal(fmtCount(null), '--')
  assert.equal(fmtCount(NaN), '--')
  assert.equal(fmtCount(12), '12')
})

// —— 余额 ——
test('parseBalancePayload: 选 CNY；缺 CNY 取首个；非法/不可用返回 null', () => {
  const ok = parseBalancePayload({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '1.00' },
      { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
    ],
  })
  assert.equal(ok, 110)
  const first = parseBalancePayload({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '2.5' }] })
  assert.equal(first, 2.5)
  assert.equal(parseBalancePayload({ is_available: false, balance_infos: [] }), null)
  assert.equal(parseBalancePayload({ is_available: true, balance_infos: [] }), null)
  assert.equal(parseBalancePayload({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '-1' }] }), null)
  assert.equal(parseBalancePayload('not json'), null)
  assert.equal(parseBalancePayload(null), null)
})

// —— 节流 ——
test('shouldRefresh: 初始/过期触发，间隔内不触发', () => {
  assert.equal(shouldRefresh(null, 1000, 30_000), true)
  assert.equal(shouldRefresh(0, 1000, 30_000), false)
  assert.equal(shouldRefresh(10_000, 20_000, 30_000), false)
  assert.equal(shouldRefresh(10_000, 41_000, 30_000), true)
})

// —— 缺模型兜底 ——
test('priceEntryFor: 未知模型回退 fallback', () => {
  assert.equal(priceEntryFor(TABLE, 'deepseek-v4-flash'), PRICE)
  assert.equal(priceEntryFor(TABLE, 'no-such-model'), PRICE)
})
