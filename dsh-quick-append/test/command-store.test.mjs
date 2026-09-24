/**
 * 「预存命令」叶子纯函数门禁（TDD 先红后绿）。
 *
 * 为什么单独成层：`tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**，
 * 「键怎么拼、脏数据怎么收敛、越界怎么翻转、删除怎么二次确认、未保存怎么判脏」若留在客户端，
 * 等于没有任何一道门能拦住它们。全部下沉到零依赖叶子后，`npm run typecheck` 与 `node --test` 都能覆盖。
 *
 * 覆盖要求（需求 附加约束）：边界 + 异常输入必须逐条覆盖，禁止伪测试
 * —— 每条断言都必须能因为「实现写错」而变红（含"恒真"反例的自检，见 C24）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMAND_STORE_KEY,
  COMMAND_STORE_VERSION,
  COMMAND_TITLE_MAX,
  COMMAND_CONTENT_MAX,
  COMMAND_LAYER,
  COMMAND_MENU_GAP_PX,
  COMMAND_VIEWPORT_EDGE_PX,
  DELETE_CONFIRM_MS,
  COMMAND_EMPTY_TOAST,
  COMMAND_SAVED_TEXT,
  COMMAND_DELETED_TEXT,
  emptyCommandStore,
  parseCommandStore,
  serializeCommandStore,
  commandsOf,
  commandOf,
  createCommandId,
  withCommandAdded,
  withCommandUpdated,
  withCommandRemoved,
  validateCommandDraft,
  commandDraftOf,
  commandDraftDirty,
  insertionText,
  commandDamagedText,
  commandWriteFailedText,
  dropUpLineFor,
  centerPlacementOf,
  nextDeleteConfirm,
  isDeleteConfirmActive,
} from '../src/lib/command-store.ts'

const draft = (title, content) => ({ title, content })
const seeded = () => withCommandAdded(withCommandAdded(emptyCommandStore(), draft('甲', '正文甲'), 'c1'), draft('乙', '正文乙'), 'c2')

// ── C1..C4 键名 / 版本 / 层级 / 上限 ─────────────────────────────────
test('C1 存储键带插件命名空间前缀，且与既有追加文案键互不相同', () => {
  assert.equal(COMMAND_STORE_KEY, 'dsh-quick-append.commands')
  assert.ok(COMMAND_STORE_KEY.startsWith('dsh-quick-append.'), '必须带插件前缀（沿用项目 ns.key 命名），避免与宿主/其它插件撞键')
  assert.notEqual(COMMAND_STORE_KEY, 'dsh-quick-append.presets')
  assert.notEqual(COMMAND_STORE_KEY, 'dsh-quick-append.text')
})

test('C2 结构带版本字段，当前为 1；空 store 是空数组', () => {
  assert.equal(COMMAND_STORE_VERSION, 1)
  assert.equal(emptyCommandStore().version, 1)
  assert.deepEqual(commandsOf(emptyCommandStore()), [])
})

test('C3 浮层层级：菜单/遮罩同级、弹窗更高，且都高于既有弹层 100', () => {
  assert.equal(COMMAND_LAYER.menu, 110)
  assert.equal(COMMAND_LAYER.mask, 110)
  assert.equal(COMMAND_LAYER.dialog, 111)
  assert.ok(COMMAND_LAYER.menu > 100, '必须高于既有 .dsh-qa-popover 的 100（需求 3.6）')
  assert.ok(COMMAND_LAYER.dialog > COMMAND_LAYER.mask, '面板必须在遮罩之上')
})

test('C4 上限与间距常量是需求锁定值', () => {
  assert.equal(COMMAND_TITLE_MAX, 50)
  assert.equal(COMMAND_CONTENT_MAX, 2000)
  assert.equal(COMMAND_MENU_GAP_PX, 5)
  assert.equal(COMMAND_VIEWPORT_EDGE_PX, 5)
  assert.ok(DELETE_CONFIRM_MS > 0)
})

// ── C5..C9 契约文案（用户可见，改一个字就是改需求）──────────────────
test('C5 空态引导 toast 逐字等于需求原文，且指向右键录入', () => {
  assert.equal(COMMAND_EMPTY_TOAST, '暂无预存命令，右键『预存命令』可录入指令')
  assert.ok(COMMAND_EMPTY_TOAST.includes('右键'), '空态必须引导到右键录入路径（需求 3.4）')
})

test('C6 保存/删除成功提示非空且互不相同（可区分是哪种操作成功）', () => {
  assert.ok(COMMAND_SAVED_TEXT.trim() !== '')
  assert.ok(COMMAND_DELETED_TEXT.trim() !== '')
  assert.notEqual(COMMAND_SAVED_TEXT, COMMAND_DELETED_TEXT)
})

test('C7 写盘失败文案非空、写明降级形态（禁止静默失败）', () => {
  const text = commandWriteFailedText(new Error('QuotaExceededError'))
  assert.ok(text.includes('预存命令') && text.includes('QuotaExceededError'))
  assert.ok(text.includes('刷新后会丢失'), '必须讲清降级形态，否则用户以为数据没丢')
  const noReason = commandWriteFailedText(undefined)
  assert.ok(noReason.includes('本地存储不可用'), '无原因时必须有兜底文案（不得为空）')
  assert.notEqual(commandWriteFailedText(''), '')
})

test('C8 数据损坏文案区分"整包读取失败"与"丢弃了 N 条"，且都非空', () => {
  const dropped = commandDamagedText(3)
  assert.ok(dropped.includes('3'), '必须报出丢弃条数，便于用户自查')
  const broken = commandDamagedText(0)
  assert.ok(broken.includes('读取失败'), '整包不可解析时必须说清是读取失败')
  assert.notEqual(dropped, broken, '两种损坏必须给出不同文案（否则用户不知道自己的指令是不是被丢过）')
})

// ── C9..C14 解析：宽容 + 脏数据收敛，绝不抛 ──────────────────────────
test('C9 键不存在（null/空串）不算损坏：降级为空列表且不弹损坏提示', () => {
  for (const raw of [null, undefined, '', '   ']) {
    const r = parseCommandStore(raw)
    assert.deepEqual(commandsOf(r.store), [])
    assert.equal(r.damaged, false, `raw=${JSON.stringify(raw)} 属"从未存过"，不该被判成损坏`)
    assert.equal(r.dropped, 0)
  }
})

test('C10 非 JSON / 非对象 / commands 非数组 → 判损坏、降级为空、不抛', () => {
  for (const raw of ['{', 'not json', '[]', '42', '"x"', '{"commands":"x"}', '{"commands":null}']) {
    const r = parseCommandStore(raw)
    assert.deepEqual(commandsOf(r.store), [], `raw=${raw} 必须降级为空列表`)
    assert.equal(r.damaged, true, `raw=${raw} 必须判损坏（需求 6.1：损坏时降级为空并给 toast）`)
  }
})

test('C11 逐条容错：缺字段/空串/非字符串的条目被丢弃并计数，合法条目保留', () => {
  const raw = JSON.stringify({
    version: 1,
    commands: [
      { id: 'a', title: '好条目', content: '正文' },
      { id: 'b', title: '   ', content: '正文' },
      { id: 'c', title: '标题', content: '' },
      { id: 'd', content: '正文' },
      { title: '缺 id', content: '正文' },
      { id: 'e', title: 42, content: '正文' },
      { id: 'f', title: '标题', content: null },
      'not-an-object',
      null,
    ],
  })
  const r = parseCommandStore(raw)
  assert.deepEqual(commandsOf(r.store).map((c) => c.id), ['a'], '只有完全合法的条目能留下')
  assert.equal(r.dropped, 8, '被丢弃的条目必须逐条计数（8 条非法）')
  assert.equal(r.damaged, true)
})

test('C12 重复 id 只保留第一条，重复项计入丢弃（防止 React key 撞车与误删整批）', () => {
  const raw = JSON.stringify({ commands: [
    { id: 'dup', title: '第一条', content: '正文1' },
    { id: 'dup', title: '第二条', content: '正文2' },
  ] })
  const r = parseCommandStore(raw)
  assert.equal(commandsOf(r.store).length, 1)
  assert.equal(commandOf(r.store, 'dup').title, '第一条')
  assert.equal(r.dropped, 1)
  assert.equal(r.damaged, true)
})

test('C13 前向兼容：多余字段被忽略，缺 version 也能读', () => {
  const r = parseCommandStore(JSON.stringify({ commands: [{ id: 'a', title: 'T', content: 'C', color: 'red', order: 9 }] }))
  assert.deepEqual(commandsOf(r.store), [{ id: 'a', title: 'T', content: 'C' }], '只保留两个业务字段（内部 id 属于结构字段），不得夹带未知字段')
  assert.equal(r.store.version, COMMAND_STORE_VERSION)
  assert.equal(r.damaged, false)
})

test('C14 序列化 → 解析往返一致（含中文、换行、超长正文的边界）', () => {
  const long = '行\n'.repeat(COMMAND_CONTENT_MAX) + '尾'
  const store = withCommandAdded(emptyCommandStore(), draft('中文标题 50 字边界', long), 'x1')
  const back = parseCommandStore(serializeCommandStore(store))
  assert.deepEqual(commandsOf(back.store), commandsOf(store), '往返必须逐字一致（换行不得被吞）')
  assert.equal(back.damaged, false)
  assert.match(serializeCommandStore(store), /"version":1/)
})

// ── C15..C18 增删改：不可变 + 未知 id 不抛 ───────────────────────────
test('C15 新增追加到末尾、只加一条、原 store 不被修改（不可变）', () => {
  const base = emptyCommandStore()
  const next = withCommandAdded(base, draft('甲', '正文甲'), 'c1')
  assert.equal(commandsOf(base).length, 0, '原对象必须保持不动')
  assert.equal(commandsOf(next).length, 1)
  const third = withCommandAdded(seeded(), draft('丙', '正文丙'), 'c3')
  assert.deepEqual(commandsOf(third).map((c) => c.id), ['c1', 'c2', 'c3'], '新命令追加到末尾（顺序稳定可预期）')
})

test('C16 修改只改目标条目、其余不动；未知 id 原样返回同一个对象（不抛）', () => {
  const base = seeded()
  const next = withCommandUpdated(base, 'c1', draft('甲改', '正文甲改'))
  assert.equal(commandOf(next, 'c1').title, '甲改')
  assert.deepEqual(commandOf(next, 'c2'), commandOf(base, 'c2'), '非目标条目必须一字不动')
  assert.equal(commandsOf(next).length, 2, '修改不得改变条数或顺序')
  assert.equal(withCommandUpdated(base, 'nope', draft('x', 'y')), base, '未知 id 必须返回原对象（幂等，不抛不插）')
})

test('C17 删除只删目标；未知 id 原样返回同一个对象；删空后仍是合法空 store', () => {
  const base = seeded()
  assert.deepEqual(commandsOf(withCommandRemoved(base, 'c1')).map((c) => c.id), ['c2'])
  assert.equal(withCommandRemoved(base, 'nope'), base)
  const one = withCommandRemoved(base, 'c2')
  assert.deepEqual(commandsOf(withCommandRemoved(one, 'c1')), [])
  assert.equal(withCommandRemoved(one, 'c1').version, COMMAND_STORE_VERSION)
})

test('C18 commandOf 对未知 id / 脏输入返回 null（不抛）', () => {
  assert.equal(commandOf(seeded(), 'nope'), null)
  assert.equal(commandOf(seeded(), ''), null)
  assert.equal(commandOf(undefined, 'c1'), null)
  assert.equal(commandOf({ commands: null }, 'c1'), null)
})

// ── C19..C21 id 生成：唯一，随机源退化也唯一 ─────────────────────────
test('C19 生成 id 不在已有集合里；已有集合为空也能生成', () => {
  const id = createCommandId([], () => 0.5)
  assert.ok(typeof id === 'string' && id !== '')
  assert.ok(!['c1', 'c2'].includes(createCommandId(['c1', 'c2'], () => 0.25)))
})

test('C20 随机源恒定（最坏情况）时仍然唯一：不得返回已在集合里的 id', () => {
  const first = createCommandId([], () => 0)
  const second = createCommandId([first], () => 0)
  assert.notEqual(first, second, '随机源退化时必须靠兜底序号保证唯一，否则会覆盖/串条')
  const third = createCommandId([first, second], () => 0)
  assert.ok(![first, second].includes(third))
})

test('C21 随机源返回非法值（NaN/负数/超界）不抛且仍唯一', () => {
  for (const value of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
    const id = createCommandId([], () => value)
    assert.ok(typeof id === 'string' && id.length > 0, `random=${String(value)} 必须仍产出可用 id`)
  }
  const dup = createCommandId([createCommandId([], () => Number.NaN)], () => Number.NaN)
  assert.ok(dup.length > 0)
})

// ── C22..C26 校验：必填 + trim + 上限 ────────────────────────────────
test('C22 标题/正文 trim 后为空一律拒绝，且指明出错字段与文案', () => {
  const t = validateCommandDraft(draft('   ', '正文'))
  assert.equal(t.ok, false)
  assert.equal(t.field, 'title')
  assert.ok(t.message.length > 0)
  const c = validateCommandDraft(draft('标题', '\n\t '))
  assert.equal(c.ok, false)
  assert.equal(c.field, 'content')
  assert.ok(c.message.length > 0)
})

test('C23 合法输入通过，且返回值是 trim 后的值（存进去的就是展示与插入的同一份）', () => {
  const r = validateCommandDraft(draft('  标题  ', '  正文\n二行  '))
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { title: '标题', content: '正文\n二行' }, '必须 trim；否则菜单标题会带空白、插入正文会多空行')
})

test('C24 上限是"闭区间"边界：恰好 50/2000 通过，51/2001 拒绝（防 off-by-one 伪门禁）', () => {
  const title50 = '标'.repeat(COMMAND_TITLE_MAX)
  const title51 = '标'.repeat(COMMAND_TITLE_MAX + 1)
  const body2000 = '文'.repeat(COMMAND_CONTENT_MAX)
  const body2001 = '文'.repeat(COMMAND_CONTENT_MAX + 1)
  assert.equal(validateCommandDraft(draft(title50, body2000)).ok, true, '恰好等于上限必须通过')
  const t = validateCommandDraft(draft(title51, body2000))
  assert.equal(t.ok, false)
  assert.equal(t.field, 'title')
  assert.ok(t.message.includes(String(COMMAND_TITLE_MAX)), '提示必须写明上限数值，否则用户不知道该删到多少')
  const c = validateCommandDraft(draft(title50, body2001))
  assert.equal(c.ok, false)
  assert.equal(c.field, 'content')
  assert.ok(c.message.includes(String(COMMAND_CONTENT_MAX)))
})

test('C25 非对象/缺字段/非字符串输入不抛，一律按"必填缺失"拒绝', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { title: 'a' }, { content: 'b' }, { title: null, content: null }, { title: 1, content: 2 }]) {
    const r = validateCommandDraft(bad)
    assert.equal(r.ok, false, `input=${JSON.stringify(bad)} 必须被拒绝而不是抛异常`)
    assert.ok(r.message.length > 0)
  }
})

test('C26 校验先标题后正文：两者都非法时先报标题（错误提示稳定可预期）', () => {
  const r = validateCommandDraft(draft('', ''))
  assert.equal(r.field, 'title')
})

// ── C27..C29 草稿：回填与"脏"判定 ────────────────────────────────────
test('C27 commandDraftOf 对 null / 脏输入给空草稿（新增态）', () => {
  assert.deepEqual(commandDraftOf(null), { title: '', content: '' })
  assert.deepEqual(commandDraftOf(undefined), { title: '', content: '' })
  assert.deepEqual(commandDraftOf({ id: 'a', title: 'T', content: 'C' }), { title: 'T', content: 'C' })
})

test('C28 脏判定：新增态空草稿=不脏；填了任意一个字段=脏；编辑态原值=不脏', () => {
  const base = { id: 'a', title: 'T', content: 'C' }
  assert.equal(commandDraftDirty(null, draft('', '')), false, '新增态什么都没填就关窗不该拦人')
  assert.equal(commandDraftDirty(null, draft('   ', '')), false, '只有空白也不算脏（保存本来就会被拒）')
  assert.equal(commandDraftDirty(null, draft('T', '')), true)
  assert.equal(commandDraftDirty(null, draft('', 'C')), true)
  assert.equal(commandDraftDirty(base, draft('T', 'C')), false)
  assert.equal(commandDraftDirty(base, draft('T', 'C ')), true, '编辑态改了一个字符也算脏（默认提示确认放弃）')
  assert.equal(commandDraftDirty(base, draft('T', '')), true, '清空正文也是未保存变更')
})

test('C29 脏判定对脏输入不抛；base 非法视为新增态', () => {
  assert.equal(commandDraftDirty('nope', null), false)
  assert.equal(commandDraftDirty(undefined, undefined), false)
  assert.equal(commandDraftDirty({ title: 'T', content: 'C' }, draft('T', 'C')), false)
})

// ── C30..C32 插入：正文进输入区，绝不毁掉用户已写内容 ────────────────
test('C30 空草稿 → 只插正文（不留前导空行）', () => {
  assert.equal(insertionText('', '正文'), '正文')
  assert.equal(insertionText('   ', '正文'), '   \n\n正文', '空白草稿不做特殊处理：原样保留用户输入，再空两行接正文')
})

test('C31 非空草稿 → 原草稿 + 两个空行 + 正文（与「点击追加」同一拼接口径）', () => {
  assert.equal(insertionText('我的需求', '正文'), '我的需求\n\n正文')
})

test('C32 正文为空/非字符串时原样返回草稿（不得凭空造换行或把草稿清空）', () => {
  assert.equal(insertionText('我的需求', ''), '我的需求')
  assert.equal(insertionText('我的需求', null), '我的需求')
  assert.equal(insertionText('我的需求', undefined), '我的需求')
  assert.equal(insertionText(null, '正文'), '正文')
  assert.equal(insertionText(null, null), '')
})

// ── C33..C38 定位：向上拉起 + 越界翻转 + 限位 + 非法输入兜底 ─────────
const rect = (left, top, width = 26, height = 26) => ({ left, top, width, height })
const viewport = (width, height) => ({ width, height })

test('C33 默认向上拉起：面板下边缘距按钮上边缘恒为 gap（右缘对齐按钮）', () => {
  const line = dropUpLineFor({ rect: rect(400, 600), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900) })
  assert.equal(line.flip, false)
  assert.equal(line.top, null, '向上拉起必须用 bottom 锚定（视觉间距与面板真实高度无关）')
  assert.equal(line.bottom, 900 - 600 + COMMAND_MENU_GAP_PX, 'bottom = 视口高 - 按钮上边 + gap')
  assert.equal(line.left, 400 + 26 - 320, '右缘与按钮右缘对齐（沿用既有弹层 right:0 的口径）')
})

test('C34 上方空间不足 → 翻转到下方（top = 按钮下边 + gap），不再是拉起的 bottom 锚定', () => {
  const line = dropUpLineFor({ rect: rect(400, 100), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900) })
  assert.equal(line.flip, true)
  assert.equal(line.bottom, null)
  assert.equal(line.top, 100 + 26 + COMMAND_MENU_GAP_PX)
})

test('C35 视口边界限位：右缘越界左移、左缘越界贴边（绝不出屏）', () => {
  const right = dropUpLineFor({ rect: rect(1590, 600), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900) })
  assert.equal(right.left, 1600 - COMMAND_VIEWPORT_EDGE_PX - 320, '右侧越界必须左移限位')
  const left = dropUpLineFor({ rect: rect(0, 600), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900) })
  assert.equal(left.left, COMMAND_VIEWPORT_EDGE_PX, '左侧越界必须贴边（不得变负数）')
})

test('C36 窄视口/超高面板：面板比视口还宽时也停在安全边距（不得出现负坐标）', () => {
  const line = dropUpLineFor({ rect: rect(10, 40), panelWidth: 900, panelHeight: 2000, viewport: viewport(400, 300) })
  assert.ok(line.left >= COMMAND_VIEWPORT_EDGE_PX)
  assert.ok(line.flip === true)
  assert.ok(line.top >= COMMAND_VIEWPORT_EDGE_PX && line.top <= 300)
})

test('C37 非法几何（NaN/0/负/缺字段）一律回退到安全位，绝不落到屏幕左上角', () => {
  const bad = [
    {},
    { rect: rect(Number.NaN, 100), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900) },
    { rect: rect(400, 100), panelWidth: 0, panelHeight: 240, viewport: viewport(1600, 900) },
    { rect: rect(400, 100), panelWidth: 320, panelHeight: -5, viewport: viewport(1600, 900) },
    { rect: rect(400, 100), panelWidth: 320, panelHeight: 240, viewport: viewport(0, 0) },
    { rect: rect(400, 100), panelWidth: 320, panelHeight: 240 },
    null,
    undefined,
  ]
  for (const input of bad) {
    const line = dropUpLineFor(input)
    assert.equal(line.left, COMMAND_VIEWPORT_EDGE_PX, `非法输入必须贴安全边距：${JSON.stringify(input)}`)
    assert.equal(line.bottom, COMMAND_VIEWPORT_EDGE_PX)
    assert.equal(line.top, null)
    assert.equal(line.flip, false)
  }
})

test('C38 自定义 gap/edge 生效；负数/非法 gap 回落默认（不得把面板压进按钮里）', () => {
  const custom = dropUpLineFor({ rect: rect(400, 600), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900), gap: 12, edge: 20 })
  assert.equal(custom.bottom, 900 - 600 + 12)
  const negative = dropUpLineFor({ rect: rect(400, 600), panelWidth: 320, panelHeight: 240, viewport: viewport(1600, 900), gap: -3, edge: Number.NaN })
  assert.equal(negative.bottom, 900 - 600 + COMMAND_MENU_GAP_PX)
})

test('C39 弹窗居中定位：正常视口居中、越界限位、非法输入贴安全边距', () => {
  const centered = centerPlacementOf({ panelWidth: 380, panelHeight: 400, viewport: viewport(1600, 900) })
  assert.equal(centered.left, Math.round((1600 - 380) / 2))
  assert.equal(centered.top, Math.round((900 - 400) / 2))
  const big = centerPlacementOf({ panelWidth: 2000, panelHeight: 2000, viewport: viewport(1600, 900) })
  assert.equal(big.left, COMMAND_VIEWPORT_EDGE_PX)
  assert.equal(big.top, COMMAND_VIEWPORT_EDGE_PX)
  const bad = centerPlacementOf(null)
  assert.deepEqual(bad, { left: COMMAND_VIEWPORT_EDGE_PX, top: COMMAND_VIEWPORT_EDGE_PX })
  for (const input of [{ panelWidth: Number.NaN, panelHeight: 10, viewport: viewport(100, 100) }, { panelWidth: 10, panelHeight: 10, viewport: viewport(0, 100) }]) {
    assert.deepEqual(centerPlacementOf(input), { left: COMMAND_VIEWPORT_EDGE_PX, top: COMMAND_VIEWPORT_EDGE_PX })
  }
})

// ── C40..C43 删除二次确认状态机 ──────────────────────────────────────
test('C40 第一次点击只进入待确认（不删），并带上截止时间', () => {
  const r = nextDeleteConfirm(null, 'c1', 1000)
  assert.equal(r.confirmed, false, '第一次点击绝不允许直接删')
  assert.deepEqual(r.state, { id: 'c1', deadline: 1000 + DELETE_CONFIRM_MS })
})

test('C41 确认窗口内再点同一个 id → 确认删除（state 清空）', () => {
  const first = nextDeleteConfirm(null, 'c1', 1000)
  const second = nextDeleteConfirm(first.state, 'c1', 1500)
  assert.equal(second.confirmed, true)
  assert.equal(second.state, null)
})

test('C42 待确认超时后失效：再点同一个 id 只重新进入待确认（不会"隔很久误删"）', () => {
  const first = nextDeleteConfirm(null, 'c1', 1000)
  const late = nextDeleteConfirm(first.state, 'c1', 1000 + DELETE_CONFIRM_MS)
  assert.equal(late.confirmed, false, '到点即失效（闭区间外必须重新确认）')
  assert.deepEqual(late.state, { id: 'c1', deadline: 1000 + DELETE_CONFIRM_MS * 2 })
})

test('C43 待确认期间点另一条：目标切换、不误删前一条；isDeleteConfirmActive 与状态机同口径', () => {
  const first = nextDeleteConfirm(null, 'c1', 1000)
  const other = nextDeleteConfirm(first.state, 'c2', 1200)
  assert.equal(other.confirmed, false, '换了目标就不是"确认"，不得删掉 c1')
  assert.equal(other.state.id, 'c2')
  assert.equal(isDeleteConfirmActive(other.state, 'c2', 1300), true)
  assert.equal(isDeleteConfirmActive(other.state, 'c1', 1300), false)
  assert.equal(isDeleteConfirmActive(null, 'c2', 1300), false)
  assert.equal(isDeleteConfirmActive(other.state, 'c2', 1200 + DELETE_CONFIRM_MS), false, '到点即失效')
  assert.equal(nextDeleteConfirm(null, 'c1', Number.NaN).state.deadline, DELETE_CONFIRM_MS, 'now 非法时按 0 起算，deadline 必须仍是有限值')
})
