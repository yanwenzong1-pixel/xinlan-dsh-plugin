/**
 * 「预存命令」弹窗/菜单 **UI 精致化门禁**（TDD 先红后绿）。
 *
 * 存在理由：样式是"没有编译器"的领域 —— 写错一个 padding 不会被任何门禁拦住，
 * 而"精致/不精致"恰恰全在这些数值上。本文件把**项目根规范的控件配方**逐条钉进源码：
 *   · plugin-design-spec-template.md §10.7.2 设计令牌表 / §10.7.3 玻璃卡面配方与遮罩 / §10.7.4 组件视觉约定
 *   · JSON-CSS-SPEC.md 的 ct-button / ct-button-primary / ct-input / ct-menu-item /
 *     ct-empty-state / ct-scrollbar-hidden / sp-window-skeleton / sp-content-padding
 * 判据一律落在**源码里的 CSS 文本**（不是"看起来差不多"），任何一条被改回旧值即红。
 *
 * 注释会引用旧值（说明改了什么），所以负面断言一律先剥注释再扫。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/** 取某条 CSS 规则的规则体（`选择器 {` 到第一个 `}`）。 */
function rule(selector) {
  const at = raw.indexOf(selector + ' {')
  assert.ok(at > 0, `未找到样式规则：${selector}`)
  const end = raw.indexOf('}', at)
  assert.ok(end > at, `规则未闭合：${selector}`)
  return raw.slice(at + selector.length + 2, end)
}

/** 规则体里是否含某条声明（容忍换行与多空格）。 */
function has(selector, decl) {
  const body = rule(selector).replace(/\s+/g, ' ')
  assert.ok(body.includes(decl.replace(/\s+/g, ' ')), `「${selector}」缺少规范配方：${decl}\n实际：${body.trim()}`)
}

const DIALOG = '.dsh-qa-dialog'
const MASK = '.dsh-qa-mask'
const MENU = '.dsh-qa-menu'
const ITEM = '.dsh-qa-menu-item'

/** 全角空格与换行归一，用于整段比对。 */
const flat = (s) => s.replace(/\s+/g, ' ').trim()

// ── U1..U3 遮罩：规范值是"深底 0.72 + blur 6"，不是随手一个浅黑 ──────────────
test('U1 弹窗遮罩用规范配方（rgba(9,12,17,0.72) + blur(6px) 双写），且旧浅值已清除', () => {
  has(MASK, 'background: rgba(9,12,17,0.72)')
  has(MASK, 'backdrop-filter: blur(6px)')
  has(MASK, '-webkit-backdrop-filter: blur(6px)')
  assert.ok(!code.includes('rgba(5,8,12,0.32)'), '旧遮罩值仍在 —— 规范 §10.7.3 要求 rgba(9,12,17,0.72) + blur(6px)')
  assert.ok(!code.includes('blur(2px)'), '旧的 2px 模糊仍在 —— 遮罩模糊应为 6px')
})

test('U2 遮罩层不吞内容点击、且不改层级（z 值必须仍在登记表内）', () => {
  has(MASK, 'position: fixed')
  has(MASK, 'inset: 0')
  assert.ok(!/pointer-events/.test(rule(MASK)), '遮罩必须可接收点击（点空白关闭），不得加 pointer-events: none')
})

test('U3 遮罩只是"底"，不得加边框/圆角/阴影把自己画成卡片', () => {
  const body = rule(MASK)
  for (const decl of ['border:', 'border-radius:', 'box-shadow:']) {
    assert.ok(!body.includes(decl), `遮罩里出现 ${decl} —— 遮罩与卡面是两个角色（§10.7.3）`)
  }
})

// ── U4..U6 控件配方：按钮 / 主按钮 / 输入框 ────────────────────────────────
test('U4 普通按钮 = ct-button 配方（0.08 冷灰底 + 0.15s 过渡 + hover 提亮边 + 键盘焦点环）', () => {
  has('.dsh-qa-btn', 'background: rgba(120,140,170,0.08)')
  has('.dsh-qa-btn', 'transition: border-color .15s, background .15s, color .15s')
  has('.dsh-qa-btn:hover', 'border-color: var(--al-borderHi, rgba(140,164,200,0.36))')
  has('.dsh-qa-btn:active', 'background: rgba(120,140,170,0.18)')
  has('.dsh-qa-btn:focus-visible', 'outline: 2px solid var(--al-info, #64B5F6)')
  has('.dsh-qa-btn:disabled', 'cursor: not-allowed')
  assert.ok(!/transform|scale\(/.test(rule('.dsh-qa-btn:hover')), 'hover 不许位移/弹跳（§10.7.2 令牌表：只变透明度）')
})

test('U5 主按钮 = ct-button-primary 配方（accent 底 + 黑字 #0A0E13），黑底白字旧配方已下线', () => {
  const body = flat(rule('.dsh-qa-btn-primary'))
  assert.ok(body.includes('background: var(--al-accent, #88DD44)'), `主按钮底必须是 accent（§12 ct-button-primary）：${body}`)
  assert.ok(body.includes('color: #0A0E13'), '主按钮字必须是语义黑 #0A0E13（规范唯一允许的黑字例外）')
  assert.ok(body.includes('border: none'), '主按钮不带边框')
  assert.ok(body.includes('font-weight: 600'), '主按钮必须 600 字重（与普通按钮区分权重）')
  assert.ok(!body.includes('background: var(--al-bgDeep'), '主按钮仍是黑底白字旧配方 —— 那是「全部」筛选按钮的语义，不是主 CTA')
})

test('U6 输入框 = ct-input 配方（7px 10px / 13px / .15s 过渡 / 聚焦 info 边 + 2px 光环 0.25）', () => {
  has('.dsh-qa-input', 'padding: 7px 10px')
  has('.dsh-qa-input', 'font-size: 13px')
  has('.dsh-qa-input', 'transition: border-color .15s, box-shadow .15s')
  for (const selector of ['.dsh-qa-textarea:focus,', '.dsh-qa-input:focus']) {
    assert.ok(raw.includes(selector), `缺少共用聚焦规则 ${selector}（两个输入框必须同一个聚焦态，否则"精致"立刻破功）`)
  }
  const focus = raw.slice(raw.indexOf('.dsh-qa-textarea:focus,'), raw.indexOf('}', raw.indexOf('.dsh-qa-textarea:focus,')))
  assert.ok(flat(focus).includes('border-color: var(--al-info, #64B5F6)'), '聚焦边必须是 info 令牌')
  assert.ok(flat(focus).includes('box-shadow: 0 0 0 2px rgba(100,181,246,0.25)'), '聚焦光环必须是 2px / 0.25（规范 ct-input 精确值）')
  assert.ok(!code.includes('rgba(100,181,246,0.22)'), '旧光环 0.22 仍在 —— 规范值是 0.25')
  // 弹窗里的正文框：不给缩放把手（模态里那个右下角小三角是"没打磨过"的典型特征），
  // 且默认高度再高一档，让"两行正文"一眼看得全。
  has('.dsh-qa-form .dsh-qa-textarea', 'resize: none')
  has('.dsh-qa-form .dsh-qa-textarea', 'min-height: 96px')
  // 反例：既有「点击追加」弹层的输入框保持原样（本轮只美化预存命令弹窗，不动它的既有手感）。
  has('.dsh-qa-textarea', 'resize: vertical')
})

// ── U7..U9 菜单与列表：菜单项配方 / 选中态语义 / 空态 ───────────────────────
test('U7 菜单项 = ct-menu-item 配方（7px 12px / 圆角 7 / 600 字重 / violet 0.14 hover + text 字）', () => {
  has(ITEM, 'padding: 7px 12px')
  has(ITEM, 'border-radius: 7px')
  has(ITEM, 'font-weight: 600')
  has(ITEM, 'color: var(--al-text2, #9AA3B2)')
  has(ITEM, 'transition: background .15s, color .15s')
  const hoverBlock = raw.slice(raw.indexOf(`${ITEM}:hover,`), raw.indexOf('}', raw.indexOf(`${ITEM}:hover,`)))
  const hover = flat(hoverBlock)
  assert.ok(hover.includes('background: rgba(147,136,255,0.14)'), `菜单 hover 必须是淡紫 0.14（§10.7.2 tk-violet）：${hover}`)
  assert.ok(hover.includes('color: var(--al-text, #E6E9EF)'), 'hover 时必须提亮文字到 text')
  // 负面判据必须**只扫菜单项的 hover 块**：冷灰 0.14 是 ct-button 的 hover 配方（按钮该用），
  // 先前写成"全源码不得出现该值"是过宽的判据 —— 会把合规的按钮规则一起判红。
  assert.ok(!hover.includes('rgba(120,140,170,0.14)'), '菜单 hover 仍是冷灰 —— 菜单 hover 语义是"选中"，用 violet 而非灰')
})

test('U8 选中/激活语义统一：菜单高亮项与"正在编辑"的列表行都用 violet，不用灰', () => {
  assert.ok(raw.includes('background: rgba(147,136,255,0.14)'), '菜单高亮项缺 violet 选中底')
  const selectedRow = raw.slice(raw.indexOf('.dsh-qa-cmd-row.on'), raw.indexOf('}', raw.indexOf('.dsh-qa-cmd-row.on')))
  assert.ok(flat(selectedRow).includes('rgba(147,136,255,0.14)'), '正在编辑的列表行必须用同一套 violet 选中语义（灰底与 hover 无法区分）')
})

test('U9 空态 = ct-empty-state 配方（弱化文字 + 居中 + 无边框），不用提示条冒充列表项', () => {
  has('.dsh-qa-empty', 'text-align: center')
  has('.dsh-qa-empty', 'color: var(--al-text3, #606B7C)')
  assert.ok(!/border:/.test(rule('.dsh-qa-empty')), '空态不该有边框（那是错误态/卡片的配方）')
  assert.match(raw, /className: 'dsh-qa-empty'/, '空态样式必须真的被渲染使用')
})

// ── U10..U12 骨架与节奏：分割线 / 滚动区 / 最大高度 ────────────────────────
test('U10 弹窗骨架 = sp-window-skeleton：头部与主体有 1px 分割线、底部操作行与内容分离', () => {
  has('.dsh-qa-head', 'display: flex')
  has('.dsh-qa-head', 'border-bottom: 1px solid var(--al-border, rgba(120,140,170,0.18))')
  has('.dsh-qa-head', 'padding-bottom: 10px')
  has(`${DIALOG} .dsh-qa-footer`, 'border-top: 1px solid var(--al-border, rgba(120,140,170,0.18))')
  has(`${DIALOG} .dsh-qa-footer`, 'padding-top: 10px')
  assert.match(raw, /className: 'dsh-qa-head'/, '头部行必须真的被渲染（否则分割线无处安放）')
  assert.match(raw, /className: 'dsh-qa-head-title'/, '头部必须有标题元素（骨架要求"标题左、信息右"）')
  assert.match(raw, /className: 'dsh-qa-head-count'/, '头部必须有计数元素（数字用 tabular-nums）')
  has('.dsh-qa-head-count', 'font-variant-numeric: tabular-nums')
})

test('U11 三处滚动区都按 ct-scrollbar-hidden：隐藏滚动条 + overscroll-behavior: contain', () => {
  for (const selector of ['.dsh-qa-menu-list', '.dsh-qa-cmd-list', DIALOG]) {
    has(selector, 'overflow-y: auto')
    has(selector, 'scrollbar-width: none')
    has(selector, 'overscroll-behavior: contain')
  }
  for (const selector of ['.dsh-qa-menu-list::-webkit-scrollbar', '.dsh-qa-cmd-list::-webkit-scrollbar', `${DIALOG}::-webkit-scrollbar`]) {
    has(selector, 'display: none')
  }
})

test('U12 弹窗最大高度按规范用 86vh 表达（不再写死 460px），且定位估算仍来自叶子常量', () => {
  assert.match(raw, /min\(86vh, /, '弹窗高度上限必须用 86vh 表达（sf-modal-panel：max-height 86vh）')
  assert.match(raw, /String\(COMMAND_DIALOG_HEIGHT\)/, '86vh 里的像素上限必须来自叶子常量，不得再抄一份字面量')
  assert.ok(!code.includes('maxHeight: COMMAND_DIALOG_HEIGHT'), '旧的固定 maxHeight 仍在 —— 小屏会溢出视口')
})

// ── U13..U14 令牌纪律与动效纪律（防"美化"变成随手写色值）────────────────────
test('U13 令牌纪律：新增弹窗样式的颜色只允许来自 var(--al-*) 或规范里列明的配方', () => {
  const start = raw.indexOf(`${MASK} {`)
  assert.ok(start > 0, '未找到遮罩样式起点')
  const block = raw.slice(start)
  // 去掉 var() 的字面量兜底后再扫：兜底是回退，不是"新色值"。
  const noFallback = block.replace(/var\(--al-[a-z0-9-]+,\s*[^)]*\)/gi, 'var(--al-x)')
  const allowed = new Set([
    'rgba(9,12,17,0.72)', // 规范遮罩
    'rgba(120,140,170,0.08)', // ct-button 底
    'rgba(120,140,170,0.10)', // 列表行 hover
    'rgba(120,140,170,0.14)', // 按钮 active / 行选中底
    'rgba(120,140,170,0.18)', // ct-button active
    'rgba(147,136,255,0.14)', // tk-violet：hover / 选中
    'rgba(147,136,255,0.36)', // 选中描边（violet 边）
    'rgba(100,181,246,0.25)', // ct-input 聚焦光环
    'rgba(242,80,86,0.10)', // 危险确认底
    'rgba(242,80,86,0.14)', // ct-error-state 底
    'rgba(242,80,86,0.30)', // ct-error-state 边
    'rgba(242,80,86,0.32)', // 危险按钮边
    '#0A0E13', // 主按钮黑字（规范唯一语义黑字）
  ])
  // 提取时归一掉色值里的空格：CSS 里惯用 `rgba(242, 80, 86, 0.14)`，而白名单按紧凑写法定，
  // 不归一会把合规值判成"未列明"（判据过严 = 假红）。
  const found = [...noFallback.matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0].replace(/\s+/g, ''))
  const unknown = found.filter((token) => !allowed.has(token))
  assert.deepEqual(unknown, [], `新增弹窗样式里出现规范未列明的色值（应改用 --al-* 令牌或规范配方）：${JSON.stringify([...new Set(unknown)])}`)
})

test('U14 动效纪律：新样式不含位移/缩放/关键帧动画，过渡时长一律 .15s', () => {
  const start = raw.indexOf(`${MASK} {`)
  const block = raw.slice(start)
  for (const token of ['transform:', 'scale(', '@keyframes']) {
    assert.ok(!block.includes(token), `弹窗/菜单样式里出现 ${token} —— 规范要求 hover 只变色、不位移不弹跳`)
  }
  const durations = [...block.matchAll(/transition:[^;]*?(\d*\.?\d+)s/g)].map((m) => m[1])
  assert.ok(durations.length > 0, '至少要有过渡声明（否则交互是"硬切"，观感粗糙）')
  for (const value of durations) {
    assert.equal(value, '.15', `过渡时长必须是 .15s（规范全站统一），实际 ${value}s`)
  }
})

// ── U15 回归锁：上一轮的门禁点不得为了"美化"被改掉 ────────────────────────
test('U15 美化不得动结构契约：类名 / 5px 间距 / 层级 / 截断 / 内部滚动 全部保留', () => {
  for (const selector of ['.dsh-qa-tools', MASK, MENU, DIALOG, '.dsh-qa-menu-list', ITEM, '.dsh-qa-cmd-list', '.dsh-qa-cmd-row', '.dsh-qa-form', '.dsh-qa-err', '.dsh-qa-confirm']) {
    assert.ok(raw.includes(selector + ' {'), `样式类被改名/删除了：${selector}（连带会让产物层与真机门禁失效）`)
  }
  has('.dsh-qa-tools', 'gap: 5px')
  has(ITEM, 'text-overflow: ellipsis')
  has(ITEM, 'white-space: nowrap')
  has('.dsh-qa-menu-list', 'max-height: 240px')
  assert.ok(raw.includes('z-index: 110') && raw.includes('z-index: 111'), '浮层层级被改动 —— 必须与叶子 COMMAND_LAYER 登记一致')
})
