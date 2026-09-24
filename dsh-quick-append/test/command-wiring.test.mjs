/**
 * 「预存命令」按钮 / 上拉菜单 / 编辑弹窗 —— **客户端接线门禁**（TDD 先红后绿）。
 *
 * 为什么需要这一层：`tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**，
 * 叶子单测全绿也证明不了"客户端真的用了叶子、真的把面板挂到 body、真的收回了全局监听"。
 * 本文件断言源码里的**接线**（谁读谁写、面板挂在哪、监听有没有收回、互斥有没有做）。
 *
 * 注释会引用被删掉的旧标识符（说明改了什么），所以负面断言一律**先剥注释**再扫。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
/** 剥掉块注释与整行行注释后的代码（负面断言与"字面量计数"用）。 */
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/**
 * 取某个函数定义起到**显式结束标记**之间的源码片段。
 * 结束标记必须给：靠 `\n}` 收尾会一路吃到组件末尾（组件内的 `}` 都带缩进），
 * 断言就会在整段代码里"恒真"——那是伪门禁。
 */
function bodyFrom(startMarker, stopMarker) {
  assert.ok(typeof stopMarker === 'string' && stopMarker !== '', `bodyFrom 必须给结束标记：${startMarker}`)
  const at = raw.indexOf(startMarker)
  assert.ok(at > 0, `未找到源码片段：${startMarker}`)
  const end = raw.indexOf(stopMarker, at)
  assert.ok(end > at, `未找到片段结束标记：${stopMarker}`)
  return raw.slice(at, end)
}

// ── K1..K3 按钮：位置、间距、仅图标、与「点击追加」视觉同源 ──────────────
test('K1 按钮名称/aria-label/title 三处同名，且仅图标（无文字子节点）', () => {
  assert.match(raw, /const COMMAND_LABEL = '预存命令'/, '必须有唯一的按钮标识常量')
  assert.match(code, /title: COMMAND_LABEL/, 'title 必须取自该常量')
  assert.match(code, /'aria-label': COMMAND_LABEL/, 'aria-label 必须取自该常量（图标按钮的可访问名唯一来源）')
  const literals = (code.match(/'预存命令'/g) ?? []).length
  assert.equal(literals, 1, `代码里 '预存命令' 字面量应只有常量定义一处（实际 ${literals}）—— 多出来的那处多半是被渲染成了文字子节点，违反"仅展示图标"`)
  assert.match(code, /WRENCH_PATH/, '必须使用扳手图标路径常量')
  assert.match(code, /d: WRENCH_PATH/, '扳手图标必须真的渲染（常量定义处不算）')
})

test('K2 新按钮在「点击追加」左侧、二者水平间距 5px（flex gap，不用绝对定位）', () => {
  assert.match(raw, /\.dsh-qa-tools \{[^}]*gap: 5px/, '间距必须由同一容器的 flex gap 实现（需求 2.1/2.3）')
  assert.match(code, /className: 'dsh-qa-tools'/, '两个按钮必须在同一容器内')
  const toolsAt = code.indexOf("className: 'dsh-qa-tools'")
  const cmdAt = code.indexOf('commandButtonProps,')
  const appendAt = code.indexOf('appendButtonProps,')
  assert.ok(toolsAt > 0 && cmdAt > 0 && appendAt > 0, '未找到按钮容器或两个按钮的使用点')
  assert.ok(cmdAt > toolsAt, '预存命令按钮必须在容器内')
  assert.ok(appendAt > cmdAt, '预存命令按钮必须排在「点击追加」之前（左侧）')
})

test('K3 两个按钮共用同一份尺寸/圆角/边框/颜色与同一份 svg 属性（"完全一致"靠结构保证）', () => {
  assert.match(raw, /const ICON_BUTTON_STYLE = \{/, '必须抽出唯一的按钮样式常量')
  assert.match(raw, /const ICON_SVG_PROPS = \{/, '必须抽出唯一的图标 svg 属性常量（尺寸与线宽风格一致，需求 2.2）')
  const styleUses = (code.match(/style: ICON_BUTTON_STYLE/g) ?? []).length
  assert.equal(styleUses, 2, `两个按钮都必须引用同一份样式常量（实际引用 ${styleUses} 处）—— 各写一份内联样式就没法保证一致`)
  const svgUses = (code.match(/ICON_SVG_PROPS/g) ?? []).length
  assert.equal(svgUses, 3, `图标属性常量应为 1 处定义 + 2 处使用（实际 ${svgUses}）`)
  // 样式常量本体必须含需求点名的各项（防"抽了个空壳常量，实际样式写在别处"）
  const style = bodyFrom('const ICON_BUTTON_STYLE = {', '\n}')
  for (const token of ['width: 26', 'height: 26', 'borderRadius: 8', 'padding: 0', 'var(--al-border', 'var(--al-text']) {
    assert.ok(style.includes(token), `按钮样式常量缺少 ${token}（与「点击追加」不再一致）`)
  }
})

// ── K4..K5 浮层：portal 到 body + 向上拉起定位 ───────────────────────────
test('K4 面板走叶子的定位纯函数：向上拉起用 bottom 锚定，翻转时用 top（二选一，另一个显式 auto）', () => {
  assert.match(raw, /dropUpLineFor\(/, '必须调用叶子定位函数（越界翻转/限位不在客户端手写）')
  assert.match(raw, /centerPlacementOf\(/, '编辑弹窗必须调用叶子居中定位函数')
  assert.match(raw, /function layerStyleOf\(/, '必须只有一个定位样式出口（避免两处各写一套）')
  const style = bodyFrom('function layerStyleOf(', '\n}')
  assert.ok(style.includes("top: line.top === null ? 'auto' : line.top"), 'top 必须显式 auto，否则会与 bottom 同时生效把面板撑变形')
  assert.ok(style.includes("bottom: line.bottom === null ? 'auto' : line.bottom"), 'bottom 必须显式 auto')
  assert.ok(style.includes("right: 'auto'"), '必须清掉既有 .dsh-qa-popover 的 right:0，否则 fixed 定位会与 left 打架')
})

test('K5 面板 portal 挂到 body（避免被父容器 overflow/backdrop-filter 裁剪），卸载时收回宿主节点', () => {
  assert.match(code, /import \{ createPortal \} from 'react-dom'/, '必须用 react-dom 的 createPortal（平台模块表已提供 react-dom，见 packages/client/web/src/seed.ts）')
  assert.match(code, /createPortal\(/, '必须真的 portal')
  assert.match(code, /document\.body\.appendChild\(/, '必须把宿主节点挂到 body')
  assert.match(code, /host\.remove\(\)/, '卸载时必须移除宿主节点（防热重载叠加浮层）')
  assert.match(raw, /ref=\{menuLayerRef\}|ref: menuLayerRef/, '菜单要有可被"点外部关闭"识别的引用')
})

// ── K6..K8 左键：空态、选中插入、关闭时机 ───────────────────────────────
test('K6 空数据不渲染空菜单：走引导 toast 并直接返回', () => {
  const body = bodyFrom('const openCommandMenu = useCallback(', '\n  const resetCommandDraft = useCallback(')
  assert.match(body, /readCommands\(\)/, '菜单数据必须来自叶子读取')
  assert.match(body, /COMMAND_EMPTY_TOAST/, '空态必须弹引导 toast（需求 3.4）')
  assert.match(body, /return/, '空态必须提前返回（不得打开空面板）')
  assert.ok(!/setMenuOpen\(true\)[\s\S]*?COMMAND_EMPTY_TOAST/.test(body), '顺序反了：不能先开面板再提示')
})

test('K7 选中即插入正文：拼接走叶子、写回走既有 setDraft、聚焦并把光标落到插入文本末尾', () => {
  assert.match(raw, /insertionText\(/, '插入拼接必须走叶子（与「点击追加」同一口径，防两处漂移）')
  assert.match(raw, /inputActions\.setDraft\(/, '必须复用既有输入区写入通道（不自己碰 DOM 输入框的值）')
  assert.match(raw, /\[data-composer-input\]/, '必须以官方输入面钩子定位输入区（0.1.5 起 composer 是 contenteditable）')
  assert.match(raw, /setSelectionRange/, '旧输入面（textarea）必须用 setSelectionRange 落光标')
  assert.match(raw, /range\.collapse\(false\)|collapse\(false\)/, '新输入面（contenteditable）必须把选区块折叠到末尾')
  assert.match(raw, /\.focus\(\)/, '插入后输入区必须重新聚焦（需求 3.3：用户可直接发送）')
  assert.match(raw, /caretTimerRef/, '光标落位必须可取消（组件卸载时收回计时器，不留孤儿任务）')
})

test('K8 关闭时机齐全且监听可回收：再点/Esc/点外部/滚动/resize', () => {
  for (const token of [
    "addEventListener('mousedown'", "removeEventListener('mousedown'",
    "addEventListener('scroll'", "removeEventListener('scroll'",
    "addEventListener('resize'", "removeEventListener('resize'",
    "addEventListener('keydown'", "removeEventListener('keydown'",
  ]) {
    assert.ok(raw.includes(token), `缺少全局监听/回收：${token}（需求 3.5/7.4）`)
  }
  assert.match(raw, /'Escape'/, 'Esc 必须可关闭')
  assert.match(raw, /,\s*true\)/, 'scroll 监听必须用捕获（否则 composer 内部滚动收不到）')
  const body = bodyFrom('const closeCommandMenu = useCallback(', '\n  const openCommandMenu = useCallback(')
  assert.match(body, /setMenuOpen\(false\)/, '关闭必须落状态')
})

// ── K9..K10 互斥与右键 ──────────────────────────────────────────────────
test('K9 同一时刻只允许一个浮层：三条打开路径互相排斥', () => {
  const menu = bodyFrom('const openCommandMenu = useCallback(', '\n  const resetCommandDraft = useCallback(')
  assert.match(menu, /setEditing\(false\)/, '打开左键菜单必须关掉「点击追加」的右键弹窗')
  const dialog = bodyFrom('const openCommandDialog = useCallback(', '\n  const beginEditCommand = useCallback(')
  assert.match(dialog, /setMenuOpen\(false\)/, '打开编辑弹窗必须关掉左键菜单')
  assert.match(dialog, /setEditing\(false\)/, '打开编辑弹窗必须关掉「点击追加」的右键弹窗')
  const editor = bodyFrom('const openEditor = useCallback(', '\n  const save = useCallback(')
  assert.match(editor, /setMenuOpen\(false\)/, '打开「点击追加」弹窗必须关掉预存命令菜单')
  assert.match(editor, /setCommandDialogOpen\(false\)/, '打开「点击追加」弹窗必须关掉预存命令编辑弹窗')
})

test('K10 右键阻止原生菜单并打开编辑弹窗；Shift+F10 / 菜单键同样可达（需求 4.1/7.3）', () => {
  const btn = raw.slice(raw.indexOf('const commandButtonProps'), raw.indexOf('const appendButtonProps'))
  assert.ok(btn.length > 0, '必须抽出 commandButtonProps（两个按钮的 props 分块，便于逐条断言）')
  assert.match(btn, /onContextMenu:/, '必须有右键处理')
  assert.match(btn, /event\.preventDefault\(\)/, '必须阻止浏览器原生右键菜单')
  assert.match(btn, /openCommandDialog\(\)/, '右键必须打开编辑弹窗')
  assert.match(btn, /onKeyDown:/, '必须有键盘入口')
  assert.ok(btn.includes("'F10'") && btn.includes("'ContextMenu'"), 'Shift+F10 与菜单键必须能打开编辑弹窗')
})

// ── K11..K14 编辑弹窗：校验、删除二次确认、未保存确认、持久化 ────────────
test('K11 保存前必须过叶子校验，校验不过只提示不写入', () => {
  const body = bodyFrom('const saveCommandDraft = useCallback(', '\n  const requestDeleteCommand = useCallback(')
  const validateAt = body.indexOf('validateCommandDraft(')
  const addAt = body.indexOf('withCommandAdded(')
  const updateAt = body.indexOf('withCommandUpdated(')
  assert.ok(validateAt > 0, '保存必须先校验')
  assert.ok(addAt > validateAt && updateAt > validateAt, '写入必须在校验之后（否则非法数据会落盘）')
  assert.match(body, /setCommandError\(decision\.message\)/, '校验失败必须把叶子文案显示出来')
  assert.match(body, /return/, '校验失败必须提前返回（不写入）')
  assert.match(raw, /className: 'dsh-qa-err' \}, commandError\)/, '错误文案必须真的渲染到界面（只 set 不渲染 = 静默失败）')
})

test('K12 删除必须二次确认（第一次只进入待确认，第二次才删）', () => {
  const body = bodyFrom('const requestDeleteCommand = useCallback(', '\n  const selectCommand = useCallback(')
  assert.match(body, /nextDeleteConfirm\(/, '删除必须走叶子状态机')
  assert.match(body, /if \(!decision\.confirmed\)/, '未确认时必须提前返回（不得直接删）')
  assert.match(body, /withCommandRemoved\(/, '确认后才执行删除')
  assert.match(raw, /确认删除/, '按钮必须显示"确认删除"（可视的二次确认）')
  assert.match(raw, /isDeleteConfirmActive\(/, '渲染必须按同一状态机判定（否则按钮文案与实际行为不一致）')
})

test('K13 关闭弹窗对未保存变更必须先问：脏判定走叶子，提供放弃/继续编辑', () => {
  assert.match(raw, /commandDraftDirty\(/, '脏判定必须走叶子（纯函数，可单测）')
  const body = bodyFrom('const requestCloseDialog = useCallback(', '\n  /** 取消编辑同样不得静默丢改动。 */')
  assert.match(body, /if \(dirty\)/, '脏时必须拦截关闭')
  assert.match(body, /setDiscardConfirm\(true\)/, '脏时必须进入确认放弃态')
  assert.match(raw, /放弃/, '必须提供"放弃"入口')
  assert.match(raw, /继续编辑/, '必须提供"继续编辑"入口（只给"放弃"等于逼用户丢改动）')
  assert.match(body, /setDiscardConfirm\(false\)/, '未脏时关闭必须复位确认态')
})

test('K14 持久化：落盘函数不许吞异常；先内存后落盘；另一个标签页改了要失效缓存', () => {
  const body = bodyFrom('function commitCommandStore', '\n}')
  assert.match(body, /localStorage\.setItem\(/, '落盘函数必须真的写 localStorage')
  assert.ok(!/catch/.test(body), '落盘函数里不得有任何 catch —— 失败必须抛给调用方转成可见提示（禁止静默失败）')
  assert.match(raw, /commandWriteFailedText\(/, '失败必须用叶子文案提示用户')
  const save = bodyFrom('const saveCommandDraft = useCallback(', '\n  const requestDeleteCommand = useCallback(')
  const memAt = save.indexOf('cachedCommandStore =')
  const diskAt = save.indexOf('commitCommandStore(')
  assert.ok(memAt > 0 && diskAt > 0, '保存路径必须既有内存更新也有落盘')
  assert.ok(memAt < diskAt, '顺序反了：必须先更新内存态再落盘，否则配额超限时这一笔编辑在本页也丢了')
  assert.match(raw, /COMMAND_STORE_KEY/, '必须监听/读写叶子的键常量，不得自拼键名')
  assert.ok(!code.includes("'dsh-quick-append.commands'"), '代码里出现裸键名 —— 必须走叶子常量，避免两处漂移')
  assert.match(raw, /cachedCommandStore = null/, '另一个标签页改了配置必须失效内存缓存')
})

// ── K15..K18 互斥/层级/键盘/回归 ────────────────────────────────────────
test('K15 解析中同样拦截新按钮（与「点击追加」同一判定与固定文案，不绕过既有互斥）', () => {
  const body = bodyFrom('const commandGestureAllowed = useCallback(', '\n  const closeCommandMenu = useCallback(')
  assert.match(body, /gestureDecision\(/, '必须复用既有判定纯函数（不得自己手写状态判断）')
  assert.match(body, /decision\.toast/, '必须用同一固定文案提示')
  const props = raw.slice(raw.indexOf('const commandButtonProps'), raw.indexOf('const appendButtonProps'))
  const guardCalls = (props.match(/commandGestureAllowed\(\)/g) ?? []).length
  assert.ok(guardCalls >= 2, `左键与右键都必须过守卫（实际 ${guardCalls} 处）`)
})

test('K16 新层级只出现在 CSS 模板里，且遮罩/菜单/弹窗三层都登记（需求 3.6/5.2）', () => {
  for (const cls of ['.dsh-qa-mask', '.dsh-qa-menu', '.dsh-qa-dialog']) {
    assert.ok(raw.includes(cls + ' {'), `缺少样式类 ${cls}`)
  }
  assert.match(raw, /\.dsh-qa-mask \{[^}]*position: fixed/, '遮罩必须 fixed 覆盖视口')
  assert.match(raw, /\.dsh-qa-dialog \{[^}]*position: fixed/, '弹窗必须 fixed（在 portal 里定位）')
  assert.match(raw, /\.dsh-qa-menu-list \{[^}]*overflow-y: auto/, '列表超长必须内部滚动（需求 3.2）')
  assert.match(raw, /\.dsh-qa-menu-item \{[^}]*text-overflow: ellipsis/, '标题过长必须省略号截断（需求 3.2）')
  assert.match(raw, /\.dsh-qa-menu-item \{[^}]*white-space: nowrap/, '截断必须配合 nowrap 才生效')
})

test('K17 键盘可达：菜单语义 + 上下键导航 + Enter 选择', () => {
  for (const token of ["role: 'menu'", "'aria-haspopup': 'menu'", "'aria-expanded'", "'ArrowDown'", "'ArrowUp'", "role: 'menuitem'"]) {
    assert.ok(raw.includes(token), `缺少键盘可达要素：${token}（需求 7.3）`)
  }
  assert.match(raw, /setMenuActive/, '必须有高亮项状态（否则上下键无从导航）')
  assert.match(raw, /title: command\.title/, '菜单项必须带完整 title 提示（截断后仍可看全）')
})

test('K18 「点击追加」既有行为逐条未变（回归锁）', () => {
  assert.match(raw, /title: '点击追加 \/ 右键设置'/, '既有按钮 title 不得改动')
  assert.match(raw, /请右键设置追加文案/, '既有空文案提示不得改动')
  assert.match(raw, /\\n\\n\$\{preset\}/, '既有拼接格式（两个换行）不得改动')
  assert.match(raw, /preset,/, '请求体仍必须发送 preset（宿主契约）')
  assert.match(raw, /name: 'conversation\.input\.right'/, '插槽注册位置不得改动')
  assert.match(raw, /isComposerInputPoint/, '快捷键输入面判定不得改动')
  assert.ok(!code.includes('STORAGE_KEY'), '旧单键常量不得复活')
})
