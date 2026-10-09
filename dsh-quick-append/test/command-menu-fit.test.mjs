/**
 * 「预存命令」上拉菜单 **装得下 / 够得着** 门禁（TDD 先红后绿）。
 *
 * 存在理由（2026-10-04 真机事故）：7 条命令时菜单只显示 6 条，第 7 条看不到。
 * 真机实测（scripts 探针，1280x900）：
 *   · 面板 max-height 260，但内容需要 324 → 头部 31 + 列表 236 就把预算吃光；
 *   · 列表底边比面板底边低 20（20 条时低 24）→ 最后一行画在**卡片外**，被宿主下方元素盖住；
 *   · 底部提示行（foot 39）整体被挤出卡片 → footVisible:false；
 *   · 7 条时列表 scrollHeight == clientHeight —— 条目被 flex 压扁塞进去，**连滚动这条退路都没有**。
 * 既有真机门禁 F21 只断言"能滚 + 高度受限"，从没断言过"最后一条在卡片内可见"，所以一直是假绿。
 *
 * 本文件把修复后的**不变量**钉死：
 *   ① 预算单一来源：面板 height 上限由叶子常量决定，列表不再自己写死 max-height；
 *   ② 卡片必须装下 head/list/foot（flex 列 + overflow:hidden），越界只能靠列表滚动；
 *   ③ 条目不许被压扁（flex:none）⇒ 内容超高时一定是"滚动"而不是"挤进去"；
 *   ④ 视口矮时按边距夹紧，面板不得高过视口；
 *   ⑤ 列表溢出时给出可见提示（滚动条按规范是隐藏的）。
 * 注释会引用旧值，故负面断言先剥注释再扫。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as store from '../src/lib/command-store.ts'

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
  assert.ok(body.includes(decl.replace(/\s+/g, ' ')), `「${selector}」缺少声明：${decl}\n实际：${body.trim()}`)
}

/** 规则体的"无注释"版本：注释会引用旧值（例如"旧值 240"），负面断言必须先剥注释再扫。 */
function ruleCode(selector) {
  return rule(selector).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const MENU = '.dsh-qa-menu'
const LIST = '.dsh-qa-menu-list'
const ITEM = '.dsh-qa-menu-item'

// ── M1 叶子必须导出"预算"这一组唯一来源 ─────────────────────────────────────
test('M1 叶子导出菜单预算 API（行高 / 固定开销 / 自然高度 / 视口夹紧 / 溢出提示）', () => {
  for (const name of ['COMMAND_MENU_ROW_PX', 'COMMAND_MENU_CHROME_PX', 'commandMenuPanelHeightFor', 'menuPanelMaxHeightOf', 'COMMAND_MENU_OVERFLOW_HINT']) {
    assert.ok(name in store, `叶子未导出 ${name} —— 菜单尺寸必须只有一个来源（禁止 CSS 里再抄一份）`)
  }
})

// ── M2 7 条（用户现场的条数）必须装得下，不需要滚动 ─────────────────────────
test('M2 预算至少装得下 7 条：面板自然高度 ≤ COMMAND_MENU_HEIGHT', () => {
  assert.ok(typeof store.commandMenuPanelHeightFor === 'function', '缺少 commandMenuPanelHeightFor')
  const need = store.commandMenuPanelHeightFor(7)
  assert.ok(need <= store.COMMAND_MENU_HEIGHT,
    `7 条需要 ${String(need)}px，预算只有 ${String(store.COMMAND_MENU_HEIGHT)}px —— 用户现场就是这样丢掉第 7 条的`)
})

// ── M3 自然高度的边界与异常输入 ─────────────────────────────────────────────
test('M3 自然高度：空列表=固定开销、n 行=开销+34n−2（首行前无间距）、异常输入按 0 条收敛', () => {
  const chrome = store.COMMAND_MENU_CHROME_PX
  const row = store.COMMAND_MENU_ROW_PX
  assert.equal(store.commandMenuPanelHeightFor(0), chrome)
  assert.equal(store.commandMenuPanelHeightFor(1), chrome + row - 2, '单条 = 条目自身高度（32），没有行间距')
  assert.equal(store.commandMenuPanelHeightFor(2), chrome + row * 2 - 2)
  assert.equal(store.commandMenuPanelHeightFor(7), chrome + row * 7 - 2, '7 条 = 330（真机实测口径）')
  for (const bad of [undefined, null, NaN, -3, 1.5, '7', {}, []]) {
    const got = store.commandMenuPanelHeightFor(bad)
    assert.ok(Number.isFinite(got) && got >= chrome && got <= store.COMMAND_MENU_HEIGHT,
      `异常输入 ${JSON.stringify(bad)} 得到 ${String(got)} —— 必须收敛到 [开销, 预算] 内的有限值`)
  }
})

// ── M4 视口夹紧：矮视口下不许高过视口 ───────────────────────────────────────
test('M4 面板高度上限 = min(预算, 视口 - 2×安全边距)；异常视口回落预算', () => {
  const ceiling = store.COMMAND_MENU_HEIGHT
  const edge = store.COMMAND_VIEWPORT_EDGE_PX
  assert.equal(store.menuPanelMaxHeightOf(2000), ceiling, '视口够高时应给满预算')
  assert.equal(store.menuPanelMaxHeightOf(300), 300 - edge * 2, '矮视口必须按边距夹紧')
  for (const bad of [undefined, null, NaN, -1, '900', {}, 0]) {
    const got = store.menuPanelMaxHeightOf(bad)
    assert.ok(Number.isFinite(got) && got > 0 && got <= ceiling,
      `异常视口 ${JSON.stringify(bad)} 得到 ${String(got)} —— 必须回落到 (0, 预算] 内的有限值`)
  }
})

// ── M5 卡片自己装下内容：flex 列 + 溢出裁掉（不许再把子元素画到卡片外）─────
test('M5 菜单面板 = flex 列容器 + overflow:hidden（内容越界只能滚，不能画到卡片外）', () => {
  has(MENU, 'display: flex')
  has(MENU, 'flex-direction: column')
  has(MENU, 'overflow: hidden')
})

// ── M6 列表是唯一滚动区，且不再自己写死高度上限 ─────────────────────────────
test('M6 列表为唯一滚动区：flex:1 1 auto + min-height:0 + overflow-y:auto，且旧 max-height:240px 已下线', () => {
  has(LIST, 'flex: 1 1 auto')
  has(LIST, 'min-height: 0')
  has(LIST, 'overflow-y: auto')
  assert.ok(!ruleCode(LIST).includes('max-height'),
    '列表仍在写死 max-height —— 预算必须由面板（COMMAND_MENU_HEIGHT / menuPanelMaxHeightOf）唯一决定')
  assert.ok(!code.includes('max-height: 240px'), '旧的 240px 上限仍在源码里')
})

// ── M7 条目不许被压扁：超高时要能滚，而不是"挤进去" ─────────────────────────
test('M7 菜单项 flex:none —— 内容超高时是滚动，不是把每条压扁', () => {
  has(ITEM, 'flex: none')
})

// ── M8 渲染层必须用夹紧后的上限，而不是裸常量 ───────────────────────────────
test('M8 面板 maxHeight 走 menuPanelMaxHeightOf(视口高)，不再直接传 COMMAND_MENU_HEIGHT', () => {
  assert.ok(code.includes('menuPanelMaxHeightOf('), '渲染层没有用 menuPanelMaxHeightOf —— 矮视口会高过屏幕')
  const styleCall = /layerStyleOf\(\s*menuLine\s*,\s*COMMAND_MENU_WIDTH\s*,\s*([^)]*)/.exec(code)
  assert.ok(styleCall !== null, '未找到 layerStyleOf(menuLine, …) 调用')
  assert.ok(!/^\s*COMMAND_MENU_HEIGHT\s*$/.test(styleCall[1]),
    '面板高度仍直接传裸常量 COMMAND_MENU_HEIGHT —— 必须换成菜单预算函数的结果')
})

// ── M9 溢出提示：滚动条按规范隐藏，必须另有可见提示 ─────────────────────────
test('M9 列表溢出时渲染可见提示（文案取自叶子常量）', () => {
  assert.ok(typeof store.COMMAND_MENU_OVERFLOW_HINT === 'string' && store.COMMAND_MENU_OVERFLOW_HINT.length > 0,
    '缺少溢出提示文案常量')
  assert.ok(code.includes('COMMAND_MENU_OVERFLOW_HINT'), '渲染层没有引用溢出提示文案 —— 20 条时用户看不出还能滚')
})

// ══ D 组：编辑弹窗（同一个缺陷类，2026-10-04 第二轮）══════════════════════════
//
// 真机实测（scripts 探针，1000 宽 × 视口高扫描）：
//   · 列表滚动临界 N₁ = **4 条**（3 条 133px 不滚；4 条 178px > 150px 上限 → 列表开始滚动）；
//   · 列表封顶后弹窗内容固定 457px，而弹窗自身 max-height = min(86vh, 460px)：
//     视口高 ≤ 530 → **弹窗整体开始滚动**（vs 修复后应为列表/内容区滚动）；
//     视口高 ≤ 500 → **底部操作行被推出弹窗可视区**（footInside:false）；
//     视口高 ≤ 460 → **底部按钮点不到**（elementFromPoint 命中不到它）。
//   根因与菜单同源：卡片不是 flex 列、不裁边，滚动落在**错误的容器**（整窗）上，
//   而底部操作行位于滚动流内 ⇒ 被推走。
const DIALOG = '.dsh-qa-dialog'
const BODY = '.dsh-qa-body'
const DLIST = '.dsh-qa-cmd-list'
const DROW = '.dsh-qa-cmd-row'
const DFOOT = '.dsh-qa-dialog .dsh-qa-footer'

test('D1 弹窗卡片 = flex 列 + overflow:hidden（内容不许画到弹窗盒子外）', () => {
  has(DIALOG, 'display: flex')
  has(DIALOG, 'flex-direction: column')
  has(DIALOG, 'overflow: hidden')
  assert.ok(!ruleCode(DIALOG).includes('overflow-y: auto'),
    '弹窗自身仍是滚动容器 —— 滚动必须落到列表/内容区，否则底部操作行会被推出可视区')
})

test('D2 内容区是安全阀滚动区：flex:1 1 auto + min-height:0 + 隐藏滚动条 + overscroll 不外溢', () => {
  has(BODY, 'flex: 1 1 auto')
  has(BODY, 'min-height: 0')
  has(BODY, 'overflow-y: auto')
  has(BODY, 'scrollbar-width: none')
  has(BODY, 'overscroll-behavior: contain')
  has(`${BODY}::-webkit-scrollbar`, 'display: none')
})

test('D3 列表是首选滚动区：flex:1 1 auto + 至少留一行高度；旧 max-height:150px 已下线', () => {
  has(DLIST, 'flex: 1 1 auto')
  has(DLIST, 'min-height: 44px')
  has(DLIST, 'overflow-y: auto')
  assert.ok(!ruleCode(DLIST).includes('max-height'),
    '列表仍在写死 max-height —— 高度必须由弹窗预算减去头部/表单/底部操作行后决定')
  assert.ok(!code.includes('max-height: 150px'), '旧的 150px 上限仍在源码里')
})

test('D4 列表行 flex:none —— 条数多时是滚动，不是把每行压扁', () => {
  has(DROW, 'flex: none')
})

test('D5 头部/表单/底部操作行都不参与收缩（否则底部按钮会先被挤走）', () => {
  has('.dsh-qa-head', 'flex: none')
  has('.dsh-qa-form', 'flex: none')
  has(DFOOT, 'flex: none')
})
