/**
 * 「预存命令」的**存储 + 校验 + 定位 + 二次确认**叶子 —— 零依赖、无 DOM、无 IO。
 *
 * 为什么单独成层（与 preset-store.ts 同一理由）：
 *  1) `tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**；
 *     "键怎么拼、脏数据怎么收敛、面板越界怎么翻转、删除怎么二次确认、草稿怎么判脏"
 *     若留在客户端，等于没有任何一道门能拦住它们。下沉到这里后，`npm run typecheck`
 *     与 `node --test` 都能覆盖（test/command-store.test.mjs）。
 *  2) 结构只有一处定义：键名、版本、上限、层级、间距、契约文案，客户端只许引用常量。
 *
 * 设计口径（对应需求逐条）：
 *  · 数据模型只有两个业务字段：`title`（菜单展示）+ `content`（插入正文）；
 *    `id` 与数组顺序属于**内部结构字段**，不对用户暴露（需求 4.3）。
 *  · 持久化沿用项目既有 localStorage 方案（键 `<插件命名空间>.<短名>`），
 *    存**当前浏览器画像**一份 —— 客户端拿不到宿主身份，浏览器画像即"用户维度"的
 *    最小可用边界（需求 6.1 的"按用户维度隔离"；不削弱任何鉴权，铁律 46）。
 *  · 读取宽容、写入严格：解析永不抛（脏数据收敛成空/丢条目并计数），校验只在保存时拦。
 *  · 定位是纯函数：向上拉起、上不足翻转下方、视口四向限位、非法几何回退安全位
 *    （范式沿用本仓既有 menu-anchor.ts 的 dockMenuLineFor，见文件末尾说明）。
 *  · 对外 API（需求 6.3）：本文件导出的纯函数即插件的程序化接口 ——
 *    commands = commandsOf / onSelect = insertionText / onSave = validateCommandDraft + withCommand*
 *    / onDelete = withCommandRemoved。插槽组件自身 props 未变（向后兼容）。
 */

/** 存储键：沿用 `dsh-quick-append.*` 命名空间（与追加文案的 presets/text 三键互不覆盖）。 */
export const COMMAND_STORE_KEY = 'dsh-quick-append.commands'
export const COMMAND_STORE_VERSION = 1

/** 业务字段上限（需求 4.4：项目无统一约束时默认标题 ≤50、正文 ≤2000）。 */
export const COMMAND_TITLE_MAX = 50
export const COMMAND_CONTENT_MAX = 2000

/** 删除二次确认的有效窗口（毫秒）：窗口内再点同一个「确认删除」才真的删。 */
export const DELETE_CONFIRM_MS = 4000

/** 面板与锚点的视觉间距（需求 2.1 的 5px 同源；也是上拉面板与按钮的间距）。 */
export const COMMAND_MENU_GAP_PX = 5

/** 视口安全边距：限位后任何面板边缘都不会贴死屏幕边。 */
export const COMMAND_VIEWPORT_EDGE_PX = 5

/**
 * 浮层层级寄存器（唯一来源）。CSS 模板里必须是同样的数字，门禁会比对两者
 * （test/client-shape.test.mjs 的 z-index 冻结断言直接读这里的值）。
 *  100 = 既有「点击追加」弹层（v0.4.x 登记为 ALIGN-10）
 *  110 = 预存命令面板与遮罩（需求 3.6：高于输入区与既有菜单）
 *  111 = 编辑弹窗面板（必须在自己的遮罩之上，否则点不动）
 */
export const COMMAND_LAYER = { menu: 110, mask: 110, dialog: 111 } as const

/** 面板尺寸（单一来源：定位计算与内联样式共用，避免 CSS 与 JS 两处漂移）。 */
export const COMMAND_MENU_WIDTH = 320
/** 菜单高度**估算**：上拉用 bottom 锚定，视觉间距与真实高度无关；该值只用于判断"上方是否够放"。 */
export const COMMAND_MENU_HEIGHT = 260
export const COMMAND_DIALOG_WIDTH = 380
export const COMMAND_DIALOG_HEIGHT = 460

// ── 契约文案（用户可见，改一个字就是改需求）─────────────────────────────
/** 空态引导（需求 3.4 原文）：不展示空菜单，改为 toast 引导到右键录入路径。 */
export const COMMAND_EMPTY_TOAST = '暂无预存命令，右键『预存命令』可录入指令'
export const COMMAND_SAVED_TEXT = '预存命令已保存'
export const COMMAND_DELETED_TEXT = '预存命令已删除'

export interface StoredCommand {
  readonly id: string
  readonly title: string
  readonly content: string
}

export interface CommandStore {
  readonly version: number
  readonly commands: readonly StoredCommand[]
}

export interface CommandDraft {
  readonly title: string
  readonly content: string
}

export interface CommandParseResult {
  readonly store: CommandStore
  /** 是否发生过损坏（非空输入读不出结构，或丢弃过条目）。用于决定要不要给用户提示。 */
  readonly damaged: boolean
  /** 被丢弃的条目数（非法/重复）。 */
  readonly dropped: number
}

export type CommandValidation =
  | { readonly ok: true; readonly value: CommandDraft }
  | { readonly ok: false; readonly field: 'title' | 'content'; readonly message: string }

export interface DropUpLineInput {
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly panelWidth: number
  readonly panelHeight: number
  readonly viewport: { readonly width: number; readonly height: number }
  readonly gap?: number
  readonly edge?: number
}

/** 向上拉起的结果：`bottom` 与 `top` 恒有一个为 null（调用方必须把另一个显式置 auto）。 */
export interface DropUpLine {
  readonly left: number
  /** 上拉模式：`bottom = 视口高 - 锚点顶边 + gap`（视觉间距与面板真实高度无关）。 */
  readonly bottom: number | null
  /** 下方翻转模式：`top = 锚点底边 + gap`。 */
  readonly top: number | null
  readonly flip: boolean
}

export interface DeleteConfirmState {
  readonly id: string
  readonly deadline: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numOf(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

export function emptyCommandStore(): CommandStore {
  return { version: COMMAND_STORE_VERSION, commands: [] }
}

/**
 * 宽容解析：任何脏输入都收敛成"能读多少读多少"，**绝不抛**。
 *  · 从未存过（null/undefined/空白串）→ 空列表，`damaged=false`（不是损坏，别吓用户）。
 *  · 非空但读不出结构 → 空列表，`damaged=true`。
 *  · 逐条：id/title/content 三者都必须是 trim 后非空的字符串；重复 id 只留第一条。
 */
export function parseCommandStore(raw: unknown): CommandParseResult {
  if (typeof raw !== 'string' || raw.trim() === '') return { store: emptyCommandStore(), damaged: false, dropped: 0 }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { store: emptyCommandStore(), damaged: true, dropped: 0 }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.commands)) return { store: emptyCommandStore(), damaged: true, dropped: 0 }
  const commands: StoredCommand[] = []
  const seen = new Set<string>()
  let dropped = 0
  for (const entry of parsed.commands) {
    if (!isRecord(entry)) { dropped += 1; continue }
    const id = textOf(entry.id)
    const title = textOf(entry.title)
    const content = textOf(entry.content)
    if (id === '' || title.trim() === '' || content.trim() === '') { dropped += 1; continue }
    if (seen.has(id)) { dropped += 1; continue }
    seen.add(id)
    // 只保留两个业务字段（外加内部 id）：未知字段一律不落库，避免脏数据随写回扩散。
    commands.push({ id, title, content })
  }
  return { store: { version: COMMAND_STORE_VERSION, commands }, damaged: dropped > 0, dropped }
}

export function serializeCommandStore(store: CommandStore): string {
  return JSON.stringify({ version: COMMAND_STORE_VERSION, commands: commandsOf(store) })
}

/** 列表（不可变视图）：结构异常时降级为空数组（调用方在渲染路径上，绝不能抛）。 */
export function commandsOf(store: unknown): readonly StoredCommand[] {
  const list = (store as CommandStore | null | undefined)?.commands
  return Array.isArray(list) ? list : []
}

export function commandOf(store: unknown, id: unknown): StoredCommand | null {
  if (typeof id !== 'string' || id === '') return null
  for (const command of commandsOf(store)) if (command.id === id) return command
  return null
}

/**
 * 生成不与既有集合冲突的内部 id。
 * 随机源退化（恒定值/NaN/负数/超界）时靠兜底序号保证唯一 —— 撞 id 会导致
 * 菜单项 key 冲突与"删一条删掉两条"。
 */
export function createCommandId(existing: readonly string[], random: () => number = Math.random): string {
  const taken = new Set(existing)
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const value = numOf(random())
    const seed = Number.isFinite(value) ? Math.floor(Math.abs(value) * 0x100000000) : Number.NaN
    const id = Number.isFinite(seed) ? 'cmd-' + seed.toString(36) : 'cmd-a' + String(attempt)
    if (!taken.has(id)) return id
  }
  let n = 1
  while (taken.has('cmd-n' + String(n))) n += 1
  return 'cmd-n' + String(n)
}

/** 新增（追加到末尾，顺序稳定）：返回新 store，原对象不动。 */
export function withCommandAdded(store: CommandStore, draft: CommandDraft, id: string): CommandStore {
  return {
    version: COMMAND_STORE_VERSION,
    commands: [...commandsOf(store), { id, title: draft.title, content: draft.content }],
  }
}

/** 修改：只换目标条目，顺序与其余条目不动；未知 id 原样返回同一个对象（幂等，不抛）。 */
export function withCommandUpdated(store: CommandStore, id: string, draft: CommandDraft): CommandStore {
  const list = commandsOf(store)
  if (!list.some((command) => command.id === id)) return store
  return {
    version: COMMAND_STORE_VERSION,
    commands: list.map((command) => (command.id === id ? { id, title: draft.title, content: draft.content } : command)),
  }
}

/** 删除：未知 id 原样返回同一个对象（幂等，不抛）。 */
export function withCommandRemoved(store: CommandStore, id: string): CommandStore {
  const list = commandsOf(store)
  const next = list.filter((command) => command.id !== id)
  if (next.length === list.length) return store
  return { version: COMMAND_STORE_VERSION, commands: next }
}

/** 编辑态草稿：null（新增）或脏输入 → 空草稿。 */
export function commandDraftOf(command: StoredCommand | null | undefined): CommandDraft {
  if (command === null || command === undefined) return { title: '', content: '' }
  return { title: textOf(command.title), content: textOf(command.content) }
}

/**
 * 是否有未保存变更（决定关闭弹窗要不要先问）。
 *  · 新增态：两个字段都只有空白 → 不脏（什么都没填就关窗不该拦人）。
 *  · 编辑态：与回填值逐字符比较（多一个空格也算脏）。
 */
export function commandDraftDirty(base: StoredCommand | null | undefined, draft: CommandDraft | null | undefined): boolean {
  const current = { title: textOf(draft?.title), content: textOf(draft?.content) }
  if (base === null || base === undefined) return current.title.trim() !== '' || current.content.trim() !== ''
  const origin = commandDraftOf(base)
  return current.title !== origin.title || current.content !== origin.content
}

/**
 * 校验（保存时唯一入口）：trim 后必填 + 上限（闭区间：恰好等于上限通过）。
 * 先标题后正文：两者都非法时提示稳定只报标题。
 */
export function validateCommandDraft(input: unknown): CommandValidation {
  const record = isRecord(input) ? input : {}
  const title = textOf(record.title).trim()
  const content = textOf(record.content).trim()
  if (title === '') return { ok: false, field: 'title', message: '标题不能为空' }
  if (title.length > COMMAND_TITLE_MAX) {
    return { ok: false, field: 'title', message: '标题不能超过 ' + String(COMMAND_TITLE_MAX) + ' 字（当前 ' + String(title.length) + ' 字）' }
  }
  if (content === '') return { ok: false, field: 'content', message: '正文不能为空' }
  if (content.length > COMMAND_CONTENT_MAX) {
    return { ok: false, field: 'content', message: '正文不能超过 ' + String(COMMAND_CONTENT_MAX) + ' 字（当前 ' + String(content.length) + ' 字）' }
  }
  return { ok: true, value: { title, content } }
}

/**
 * 插入拼接：空草稿 → 只插正文（不留前导空行）；非空 → 原草稿 + 两个换行 + 正文。
 * 与「点击追加」同一口径（`draft + '\n\n' + 文案`），且**永不丢用户已写内容**。
 * 正文为空/非字符串 → 原样返回草稿（调用方据此跳过写入）。
 */
export function insertionText(draft: unknown, content: unknown): string {
  const base = textOf(draft)
  const body = textOf(content)
  if (body === '') return base
  if (base === '') return body
  return base + '\n\n' + body
}

/** 数据损坏的可见文案：区分"整包读不出"与"丢了 N 条"（后者用户才知道自己的指令少过）。 */
export function commandDamagedText(dropped: unknown): string {
  const n = typeof dropped === 'number' && Number.isFinite(dropped) && dropped > 0 ? Math.floor(dropped) : 0
  if (n === 0) return '预存命令数据读取失败：已按空列表处理（原有内容无法恢复）'
  return '预存命令数据有损坏：已忽略 ' + String(n) + ' 条无法识别的记录'
}

/**
 * 写盘失败的可见文案。两条硬要求（与 presetWriteFailedText 同口径）：
 *  ① 不得为空（空提示 = 静默失败）；② 必须讲清降级形态（本页仍可用、刷新后会丢）。
 */
export function commandWriteFailedText(reason: unknown): string {
  const raw = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : ''
  const detail = raw.trim()
  const fallback = '本地存储不可用'
  const hint = '（当前页面内仍可继续使用，刷新后会丢失）'
  return detail === '' ? '预存命令保存失败：' + fallback + hint : '预存命令保存失败：' + detail + hint
}

/**
 * 向上拉起定位（纯函数）。范式沿用本仓既有 `menu-anchor.ts` 的 `dockMenuLineFor`：
 *  · 默认在锚点正上方 `gap` 处（用 bottom 锚定 ⇒ 视觉间距与面板真实高度无关）；
 *  · 上方不足 `edge` → 翻转到锚点下方（改用 top 锚定）；
 *  · 水平右缘与锚点右缘对齐（沿用既有弹层 `right: 0` 的口径），四向限位；
 *  · 非法几何/缺字段 → 回退"视口右下角安全位"，**绝不到屏幕左上角**。
 */
export function dropUpLineFor(input: unknown): DropUpLine {
  const i = (input ?? {}) as DropUpLineInput
  const gapRaw = numOf(i.gap)
  const edgeRaw = numOf(i.edge)
  const gap = Number.isFinite(gapRaw) && gapRaw >= 0 ? gapRaw : COMMAND_MENU_GAP_PX
  const edge = Number.isFinite(edgeRaw) && edgeRaw >= 0 ? edgeRaw : COMMAND_VIEWPORT_EDGE_PX
  const left = numOf(i.rect?.left)
  const top = numOf(i.rect?.top)
  const width = numOf(i.rect?.width)
  const height = numOf(i.rect?.height)
  const panelWidth = numOf(i.panelWidth)
  const panelHeight = numOf(i.panelHeight)
  const viewWidth = numOf(i.viewport?.width)
  const viewHeight = numOf(i.viewport?.height)
  const invalid = [left, top, width, height, panelWidth, panelHeight, viewWidth, viewHeight].some((n) => !Number.isFinite(n))
    || width <= 0 || height <= 0 || panelWidth <= 0 || panelHeight <= 0 || viewWidth <= 0 || viewHeight <= 0
  // 非法几何 → "视口底缘偏左"安全位（edge 边距，绝不到屏幕左上角）：不做半程计算，
  // 避免把 NaN/负数带进样式（CSS 收到 NaN 会整条失效，面板会跳到 (0,0)）。
  if (invalid) return { left: edge, bottom: edge, top: null, flip: false }
  const raw_left = left + width - panelWidth
  const clampedLeft = Math.min(Math.max(raw_left, edge), Math.max(edge, viewWidth - edge - panelWidth))
  if (top - gap - panelHeight >= edge) {
    return { left: Math.round(clampedLeft), bottom: Math.round(viewHeight - top + gap), top: null, flip: false }
  }
  const flipTop = Math.min(Math.max(top + height + gap, edge), Math.max(edge, viewHeight - edge - panelHeight))
  return { left: Math.round(clampedLeft), bottom: null, top: Math.round(flipTop), flip: true }
}

/** 编辑弹窗定位（居中 + 限位；非法输入贴安全边距）。遮罩为模态，居中比锚定更稳。 */
export function centerPlacementOf(input: unknown): { readonly left: number; readonly top: number } {
  const i = (input ?? {}) as { panelWidth?: unknown; panelHeight?: unknown; viewport?: { width?: unknown; height?: unknown }; edge?: unknown }
  const edgeRaw = numOf(i.edge)
  const edge = Number.isFinite(edgeRaw) && edgeRaw >= 0 ? edgeRaw : COMMAND_VIEWPORT_EDGE_PX
  const panelWidth = numOf(i.panelWidth)
  const panelHeight = numOf(i.panelHeight)
  const viewWidth = numOf(i.viewport?.width)
  const viewHeight = numOf(i.viewport?.height)
  const invalid = [panelWidth, panelHeight, viewWidth, viewHeight].some((n) => !Number.isFinite(n))
    || panelWidth <= 0 || panelHeight <= 0 || viewWidth <= 0 || viewHeight <= 0
  if (invalid) return { left: edge, top: edge }
  const left = Math.min(Math.max((viewWidth - panelWidth) / 2, edge), Math.max(edge, viewWidth - edge - panelWidth))
  const top = Math.min(Math.max((viewHeight - panelHeight) / 2, edge), Math.max(edge, viewHeight - edge - panelHeight))
  return { left: Math.round(left), top: Math.round(top) }
}

/**
 * 删除二次确认状态机（纯函数）：
 *  · 第一次点某条 → 进入待确认（带截止时间），**不删**；
 *  · 窗口内再点同一个 id → `confirmed=true`（调用方才执行删除）；
 *  · 到点即失效 → 再点只重新进入待确认（防"隔很久误删"）；
 *  · 期间点另一条 → 目标切换，不动前一条。
 */
export function nextDeleteConfirm(prev: DeleteConfirmState | null, id: string, now: number): { readonly state: DeleteConfirmState | null; readonly confirmed: boolean } {
  const at = Number.isFinite(now) ? now : 0
  if (prev !== null && prev.id === id && at < prev.deadline) return { state: null, confirmed: true }
  return { state: { id, deadline: at + DELETE_CONFIRM_MS }, confirmed: false }
}

/** 与状态机同口径的"是否正在等这条的二次确认"（渲染按钮文案用，不可能与行为不一致）。 */
export function isDeleteConfirmActive(state: DeleteConfirmState | null, id: string, now: number): boolean {
  if (state === null || state.id !== id) return false
  const at = Number.isFinite(now) ? now : 0
  return at < state.deadline
}
