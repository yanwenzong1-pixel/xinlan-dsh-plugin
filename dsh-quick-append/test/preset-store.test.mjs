/**
 * 「追加文案」按工作区隔离 + 本地持久化 —— 叶子纯函数门禁（TDD 先红后绿）。
 *
 * 为什么单独成层：读写逻辑一旦写在 src/client/index.ts 里就**不被 tsc 检查**
 * （tsconfig.json 显式 exclude: ["src/client"]），只能靠打包器发现语法错误；
 * 而浏览器里的串写/丢数据是打包器看不见的。因此全部判定下沉到零依赖叶子，
 * 用 node --test 逐条钉住（边界 + 异常输入，注入假计时器，不碰真 localStorage）。
 *
 * 运行：node --test（裸跑，不要传目录/文件名）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESET_STORE_KEY,
  PRESET_STORE_VERSION,
  LEGACY_PRESET_KEY,
  NO_WORKSPACE_KEY,
  DEFAULT_APPEND_TEXT,
  emptyPresetStore,
  parsePresetStore,
  serializePresetStore,
  presetOf,
  withPreset,
  workspaceKeyOf,
  migrateLegacyPreset,
  createCoalescingWriter,
  presetWriteFailedText,
  PRESET_SAVED_TEXT,
} from '../src/lib/preset-store.ts'

/** 注入式假计时器：不依赖真实 setTimeout，逐条断言"延迟未到不写、到了才写"。 */
function fakeTimers() {
  let seq = 0
  const timers = new Map()
  return {
    schedule: (fn, ms) => { seq += 1; timers.set(seq, { fn, ms }); return seq },
    cancel: (id) => { timers.delete(id) },
    runAll: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn() } },
    armed: () => timers.size,
    delays: () => [...timers.values()].map((t) => t.ms),
  }
}

// ── A. 键名与命名空间 ────────────────────────────────────────────────
test('A1 存储键带插件命名空间前缀，且与新结构键、旧键三者互不相同', () => {
  assert.equal(PRESET_STORE_KEY, 'dsh-quick-append.presets')
  assert.equal(LEGACY_PRESET_KEY, 'dsh-quick-append.text')
  assert.ok(PRESET_STORE_KEY.startsWith('dsh-quick-append.'), '必须带插件前缀，避免与宿主/其它插件撞键')
  assert.notEqual(PRESET_STORE_KEY, LEGACY_PRESET_KEY)
})

test('A2 旧键字面量必须保持原样（改了就读不到老用户的旧值，迁移静默失效）', () => {
  assert.equal(LEGACY_PRESET_KEY, 'dsh-quick-append.text')
})

test('A3 结构带版本字段，当前为 1', () => {
  assert.equal(PRESET_STORE_VERSION, 1)
  assert.equal(emptyPresetStore().version, 1)
  assert.deepEqual(emptyPresetStore().workspaces, {})
})

test('A4 默认文案 = 用户 2026-09-23 指定的新版（弹窗「填入默认文案」按钮的数据源）', () => {
  assert.equal(typeof DEFAULT_APPEND_TEXT, 'string')
  assert.ok(DEFAULT_APPEND_TEXT.length > 100, '默认文案不应被截短')
  assert.ok(DEFAULT_APPEND_TEXT.includes('最高优先级规则'))
  assert.ok(DEFAULT_APPEND_TEXT.includes('输出顺序'))
  // 新版三处特征：
  assert.ok(DEFAULT_APPEND_TEXT.includes('使需求更加精准'), '第 1 条应为新版措辞（「…扩展使需求更加精准」）')
  assert.ok(DEFAULT_APPEND_TEXT.includes('结合项目实际现状'), '第 1 条应含「结合项目实际现状」')
  assert.ok(DEFAULT_APPEND_TEXT.includes('使用Ponytail 的 full模式开发'), '附加约束首条应新增 Ponytail full 模式')
  assert.ok(DEFAULT_APPEND_TEXT.includes('严格遵守根目录配置文件：*.md'), '附加约束应改为通用「根目录配置文件：*.md」')
  // 旧措辞与旧引用必须消失（防两份文案并存 / 漏改）：
  for (const stale of ['实现更加精准', '扩展后要对合理性', 'plugin-design-spec-template.md', 'PLUGIN-LOADER-SPEC.md', 'CANVAS-INTERACTION-SPEC.md']) {
    assert.ok(!DEFAULT_APPEND_TEXT.includes(stale), `旧默认文案的残留仍在：${stale}`)
  }
  // 行尾不留空白（用户文本里的行尾空格是复制痕迹，按约定剥掉；内容一字未改）
  assert.ok(!/[ \t]+\n/.test(DEFAULT_APPEND_TEXT), '默认文案行尾不应有空白')
})

// ── B. parsePresetStore：一切脏输入都收敛，绝不抛 ────────────────────
test('B1 null/undefined/空串/非 JSON/JSON 标量 → 空 store（不抛）', () => {
  for (const raw of [null, undefined, '', '   ', 'not json', '{', '[]', '123', '"x"', 'true', 'null']) {
    const store = parsePresetStore(raw)
    assert.deepEqual(store, { version: PRESET_STORE_VERSION, workspaces: {} }, `raw=${String(raw)}`)
  }
})

test('B2 workspaces 非对象 / 条目非对象 / appendText 非字符串 → 丢弃该条目', () => {
  assert.deepEqual(parsePresetStore('{"version":1,"workspaces":[]}').workspaces, {})
  assert.deepEqual(parsePresetStore('{"version":1,"workspaces":"x"}').workspaces, {})
  const store = parsePresetStore(JSON.stringify({
    version: 1,
    workspaces: {
      ok: { appendText: 'A' },
      num: { appendText: 1 },
      nil: { appendText: null },
      obj: { appendText: {} },
      noField: {},
      notObj: 'plain',
    },
  }))
  assert.deepEqual(Object.keys(store.workspaces), ['ok'])
  assert.equal(presetOf(store, 'ok'), 'A')
})

test('B3 条目 key 为空串/非字符串语义 → 丢弃；条目 appendText 为空串 → 保留（"显式保存为空"是合法状态）', () => {
  const store = parsePresetStore(JSON.stringify({
    version: 1,
    workspaces: { '': { appendText: 'x' }, w1: { appendText: '' } },
  }))
  assert.deepEqual(Object.keys(store.workspaces), ['w1'])
  assert.equal(presetOf(store, 'w1'), '')
})

test('B4 version 非数字 → 归一化为当前版本；version 来自未来（更大）→ 仍读取 workspaces（前向兼容）', () => {
  assert.equal(parsePresetStore('{"version":"x","workspaces":{"a":{"appendText":"A"}}}').version, PRESET_STORE_VERSION)
  const future = parsePresetStore('{"version":99,"workspaces":{"a":{"appendText":"A"}}}')
  assert.equal(future.version, PRESET_STORE_VERSION)
  assert.equal(presetOf(future, 'a'), 'A', '未来版本也要能读出已知字段，不能整包丢弃')
})

test('B5 往返一致：emoji / 换行 / 引号 / 反斜杠 / 制表符 / 零宽字符 / 纯空白', () => {
  const samples = [
    '🚀 你好\n世界',
    'quote " double \' single',
    'back\\slash and \\n literal',
    'tab\there',
    'zero\u200bwidth',
    '   ',
    '\n\n\n',
    '',
  ]
  for (const s of samples) {
    const round = parsePresetStore(serializePresetStore(withPreset(emptyPresetStore(), 'w', s)))
    assert.equal(presetOf(round, 'w'), s, `样本未逐字还原：${JSON.stringify(s)}`)
  }
})

test('B6 超长文本不截断（15000 字符逐字往返）', () => {
  const long = 'A'.repeat(7000) + '\n' + '中'.repeat(7000) + '🚀'.repeat(1000)
  const round = parsePresetStore(serializePresetStore(withPreset(emptyPresetStore(), 'w', long)))
  assert.equal(presetOf(round, 'w'), long)
  assert.equal(presetOf(round, 'w').length, long.length)
})

// ── C. presetOf / withPreset：惰性初始化 + 不可变 ────────────────────
test('C1 不存在的工作区 → 空串（惰性初始化，不写盘也不报错）', () => {
  const store = emptyPresetStore()
  assert.equal(presetOf(store, 'never'), '')
  assert.equal(presetOf(store, NO_WORKSPACE_KEY), '')
  assert.deepEqual(store.workspaces, {}, '读取不得产生写入')
})

test('C2 withPreset 不可变：原 store 不被改动，且返回新对象', () => {
  const before = emptyPresetStore()
  const after = withPreset(before, 'w1', 'X')
  assert.deepEqual(before.workspaces, {})
  assert.notEqual(after, before)
  assert.equal(presetOf(after, 'w1'), 'X')
})

test('C3 工作区之间互不覆盖、互不继承（写入 A 不影响 B）', () => {
  let store = emptyPresetStore()
  store = withPreset(store, 'wA', '文案A')
  store = withPreset(store, 'wB', '文案B')
  assert.equal(presetOf(store, 'wA'), '文案A')
  assert.equal(presetOf(store, 'wB'), '文案B')
  store = withPreset(store, 'wA', '文案A2')
  assert.equal(presetOf(store, 'wA'), '文案A2')
  assert.equal(presetOf(store, 'wB'), '文案B')
})

// ── D. workspaceKeyOf：按 ID 绑定，不用展示名 ───────────────────────
test('D1 命中当前会话所属工作区 → 返回其 workspaceId', () => {
  const items = [
    { workspaceId: 'w-1', title: '项目甲', sessionIds: ['s-9'] },
    { workspaceId: 'w-2', title: '项目乙', sessionIds: ['s-1', 's-2'] },
  ]
  assert.equal(workspaceKeyOf({ sessionId: 's-2', items }), 'w-2')
})

test('D2 两个工作区**同名**（展示名相同、ID 不同）→ 各归各的键（用展示名当键就会串写）', () => {
  const items = [
    { workspaceId: 'w-1', title: '同名项目', sessionIds: ['s-1'] },
    { workspaceId: 'w-2', title: '同名项目', sessionIds: ['s-2'] },
  ]
  const k1 = workspaceKeyOf({ sessionId: 's-1', items })
  const k2 = workspaceKeyOf({ sessionId: 's-2', items })
  assert.equal(k1, 'w-1')
  assert.equal(k2, 'w-2')
  assert.notEqual(k1, k2)
  const store = withPreset(withPreset(emptyPresetStore(), k1, '甲文案'), k2, '乙文案')
  assert.equal(presetOf(store, k1), '甲文案')
  assert.equal(presetOf(store, k2), '乙文案')
})

test('D3 工作区重命名（title 变、ID 不变）→ 键不变，配置随 ID 保留', () => {
  const before = [{ workspaceId: 'w-1', title: '旧名', sessionIds: ['s-1'] }]
  const after = [{ workspaceId: 'w-1', title: '新名', sessionIds: ['s-1'] }]
  assert.equal(workspaceKeyOf({ sessionId: 's-1', items: before }), 'w-1')
  assert.equal(workspaceKeyOf({ sessionId: 's-1', items: after }), 'w-1')
})

test('D4 会话不归属任何工作区 / sessionId 缺失 → 专用占位键（不是空串，避免与"非法输入"混淆）', () => {
  const items = [{ workspaceId: 'w-1', title: 'x', sessionIds: ['s-1'] }]
  for (const sessionId of [undefined, null, '', 's-unknown']) {
    assert.equal(workspaceKeyOf({ sessionId, items }), NO_WORKSPACE_KEY, `sessionId=${String(sessionId)}`)
  }
  assert.notEqual(NO_WORKSPACE_KEY, '')
})

test('D5 脏输入不抛：items 非数组 / 条目缺字段 / sessionIds 非数组 / workspaceId 非字符串', () => {
  const cases = [
    { sessionId: 's-1', items: undefined },
    { sessionId: 's-1', items: null },
    { sessionId: 's-1', items: 'nope' },
    { sessionId: 's-1', items: [null, 1, 'x'] },
    { sessionId: 's-1', items: [{ workspaceId: 1, sessionIds: ['s-1'] }] },
    { sessionId: 's-1', items: [{ workspaceId: '', sessionIds: ['s-1'] }] },
    { sessionId: 's-1', items: [{ workspaceId: 'w-1', sessionIds: 's-1' }] },
    { sessionId: 's-1', items: [{ workspaceId: 'w-1' }] },
  ]
  for (const c of cases) {
    assert.equal(workspaceKeyOf(c), NO_WORKSPACE_KEY, JSON.stringify(c))
  }
})

test('D6 多个工作区都含该会话（异常数据）→ 取第一个命中，结果稳定', () => {
  const items = [
    { workspaceId: 'w-1', sessionIds: ['s-1'] },
    { workspaceId: 'w-2', sessionIds: ['s-1'] },
  ]
  assert.equal(workspaceKeyOf({ sessionId: 's-1', items }), 'w-1')
  assert.equal(workspaceKeyOf({ sessionId: 's-1', items: [...items].reverse() }), 'w-2')
})

// ── E. 旧配置迁移 ────────────────────────────────────────────────────
test('E1 有旧值 + 当前工作区无条目 → 迁移到当前工作区，并要求删除旧键', () => {
  const r = migrateLegacyPreset(emptyPresetStore(), '老文案', 'w-1')
  assert.equal(presetOf(r.store, 'w-1'), '老文案')
  assert.equal(r.migrated, true)
  assert.equal(r.dropLegacy, true, '旧键必须删掉，否则将来每个新工作区都会被它污染')
})

test('E2 有旧值 + 当前工作区**已有**条目 → 不覆盖（尊重现有配置），但旧键仍要删', () => {
  const existing = withPreset(emptyPresetStore(), 'w-1', '新文案')
  const r = migrateLegacyPreset(existing, '老文案', 'w-1')
  assert.equal(presetOf(r.store, 'w-1'), '新文案')
  assert.equal(r.migrated, false)
  assert.equal(r.dropLegacy, true)
})

test('E3 无旧值（null/undefined，或读取旧键抛错）→ 什么都不做，旧键也不删（下次启动可重试）', () => {
  for (const raw of [null, undefined]) {
    const r = migrateLegacyPreset(emptyPresetStore(), raw, 'w-1')
    assert.equal(presetOf(r.store, 'w-1'), '')
    assert.equal(r.migrated, false)
    assert.equal(r.dropLegacy, false, 'storage 不可用时不该清键，否则永久丢老配置')
  }
})

test('E4 旧值是空串（用户曾显式清空）→ 不产生空条目，但旧键照删', () => {
  const r = migrateLegacyPreset(emptyPresetStore(), '', 'w-1')
  assert.deepEqual(r.store.workspaces, {}, '空串不写入无意义条目')
  assert.equal(r.migrated, false)
  assert.equal(r.dropLegacy, true)
})

test('E5 迁移只作用于「当前」工作区：迁移后另一个工作区仍是空（验收 3 的核心）', () => {
  const r = migrateLegacyPreset(emptyPresetStore(), '老文案', 'w-current')
  assert.equal(presetOf(r.store, 'w-current'), '老文案')
  assert.equal(presetOf(r.store, 'w-brand-new'), '', '新建工作区不得继承任何其它工作区的文案')
  assert.equal(presetOf(r.store, NO_WORKSPACE_KEY), '')
})

test('E6 旧值是超长/含特殊字符 → 逐字迁移（不截断、不转义错误）', () => {
  const legacy = '前\n🚀 "引号" \\反斜杠\t' + 'x'.repeat(5000)
  const r = migrateLegacyPreset(emptyPresetStore(), legacy, 'w-1')
  assert.equal(presetOf(r.store, 'w-1'), legacy)
})

// ── F. 合并写入器（防抖 + 失败可观测 + 分区独立）────────────────────
test('F1 窗口内对同一工作区多次提交 → 只落一次盘，用最后一次的值', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({ delayMs: 250, write: (r) => writes.push(r), ...t })
  w.submit('w1', 'v1')
  w.submit('w1', 'v2')
  w.submit('w1', 'v3')
  assert.equal(writes.length, 0, '延迟未到不得落盘')
  t.runAll()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0], { key: 'w1', text: 'v3' })
})

test('F2 不同工作区各自独立合并，互不覆盖（切换工作区不串写）', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({ delayMs: 250, write: (r) => writes.push(r), ...t })
  w.submit('wA', 'A文案')
  w.submit('wB', 'B文案')
  t.runAll()
  assert.equal(writes.length, 2)
  const byKey = Object.fromEntries(writes.map((r) => [r.key, r.text]))
  assert.deepEqual(byKey, { wA: 'A文案', wB: 'B文案' })
})

test('F3 flush() 立即落盘（不等延迟），且清空待写队列与计时器', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({ delayMs: 250, write: (r) => writes.push(r), ...t })
  w.submit('w1', 'X')
  assert.equal(t.armed(), 1)
  w.flush()
  assert.deepEqual(writes, [{ key: 'w1', text: 'X' }])
  assert.equal(t.armed(), 0, 'flush 后必须撤掉计时器，不能留下二次写入')
  assert.deepEqual(w.pending(), [])
  t.runAll()
  assert.equal(writes.length, 1, '计时器已撤销，不得再写一次')
})

test('F4 空队列 flush 不写、不抛', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({ delayMs: 250, write: (r) => writes.push(r), ...t })
  assert.doesNotThrow(() => w.flush())
  assert.equal(writes.length, 0)
})

test('F5 写入抛错（配额超限/隐私模式）→ 不冒泡，错误回调收到 key 与原因（禁止静默失败）', () => {
  const t = fakeTimers()
  const errors = []
  const w = createCoalescingWriter({
    delayMs: 250,
    write: () => { throw new Error('QuotaExceededError') },
    onError: (req, error) => errors.push({ key: req.key, message: String(error?.message ?? error) }),
    ...t,
  })
  w.submit('w1', 'X')
  assert.doesNotThrow(() => t.runAll(), '写盘失败不得让调用方崩（客户端会整页挂）')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].key, 'w1')
  assert.match(errors[0].message, /QuotaExceededError/)
})

test('F6 某个工作区写入失败不影响另一个工作区的写入', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({
    delayMs: 250,
    write: (r) => { if (r.key === 'bad') throw new Error('boom'); writes.push(r) },
    onError: () => {},
    ...t,
  })
  w.submit('bad', 'X')
  w.submit('good', 'Y')
  assert.doesNotThrow(() => t.runAll())
  assert.deepEqual(writes, [{ key: 'good', text: 'Y' }])
})

test('F7 失败后同键再次提交仍会尝试写入（不进入死状态）', () => {
  const t = fakeTimers()
  let attempts = 0
  const w = createCoalescingWriter({
    delayMs: 250,
    write: () => { attempts += 1; if (attempts === 1) throw new Error('first fails') },
    onError: () => {},
    ...t,
  })
  w.submit('w1', 'X')
  t.runAll()
  w.submit('w1', 'X')
  t.runAll()
  assert.equal(attempts, 2)
})

test('F8 成功回调带 request；pending() 反映未落盘的键', () => {
  const t = fakeTimers()
  const applied = []
  const w = createCoalescingWriter({ delayMs: 250, write: () => {}, onApplied: (r) => applied.push(r), ...t })
  w.submit('w1', 'X')
  assert.deepEqual(w.pending(), ['w1'])
  t.runAll()
  assert.deepEqual(applied, [{ key: 'w1', text: 'X' }])
  assert.deepEqual(w.pending(), [])
})

test('F9 delayMs=0（立即窗口）也能工作：submit 后一次事件循环内落盘', () => {
  const t = fakeTimers()
  const writes = []
  const w = createCoalescingWriter({ delayMs: 0, write: (r) => writes.push(r), ...t })
  w.submit('w1', 'X')
  t.runAll()
  assert.deepEqual(writes, [{ key: 'w1', text: 'X' }])
})

// ── G. 用户可见反馈文案 ─────────────────────────────────────────────
test('G1 成功文案非空且固定', () => {
  assert.equal(PRESET_SAVED_TEXT, '已保存')
})

test('G2 失败文案必须含原因与"本页仍可用"的降级说明（不得是空串）', () => {
  const withDetail = presetWriteFailedText('QuotaExceededError')
  assert.match(withDetail, /QuotaExceededError/)
  assert.ok(withDetail.includes('追加文案'))
  // 需求：存储不可用时"保持内存态可用 + 明确提示" ⇒ 提示里必须讲清"本页还能用、刷新会丢"。
  assert.ok(withDetail.includes('当前页面内'), '失败文案必须说明本页仍可用（否则用户以为编辑已彻底丢失）')
  assert.ok(withDetail.includes('刷新'), '失败文案必须说明刷新后不保留')
  for (const empty of ['', '   ', null, undefined]) {
    const t = presetWriteFailedText(empty)
    assert.ok(t.length > 0, '失败文案不得为空（禁止静默失败）')
    assert.ok(t.includes('追加文案'))
    assert.ok(t.includes('当前页面内'), `原因缺失时也要给降级说明：${t}`)
  }
  // Error 实例与其它类型都不许抛
  assert.ok(presetWriteFailedText(new Error('boom')).includes('boom'))
  assert.ok(presetWriteFailedText(42).includes('追加文案'))
})
