/**
 * 「点击追加」按钮解析中交互纯函数测试（TDD）。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gestureDecision,
  nextToast,
  isToastExpired,
  PARSING_TOAST,
  TOAST_DURATION_MS,
  OPTIMIZING_TOAST,
  DONE_TOAST,
  DONE_TOAST_MS,
  toastOnOptimizeStart,
  toastOnOptimizeEnd,
  isDoneToastExpired,
} from '../src/lib/interaction.ts'

// —— 状态判定：解析中拦截，非解析中零侵入 ——
test('解析中 + 左键 → 拦截且触发固定文案 toast', () => {
  const d = gestureDecision('parsing', 'click')
  assert.equal(d.intercepted, true)
  assert.equal(d.toast, PARSING_TOAST)
  assert.equal(d.openMenu, false)
})

test('解析中 + 右键 → 拦截、不打开任何菜单、同一固定文案', () => {
  const d = gestureDecision('parsing', 'contextmenu')
  assert.equal(d.intercepted, true)
  assert.equal(d.toast, PARSING_TOAST)
  assert.equal(d.openMenu, false)
})

test('常规态 + 左键 → 零拦截零提示（业务动作照常）', () => {
  const d = gestureDecision('idle', 'click')
  assert.equal(d.intercepted, false)
  assert.equal(d.toast, null)
  assert.equal(d.openMenu, false)
})

test('常规态 + 右键 → 不拦截、允许打开自定义菜单（原语义）', () => {
  const d = gestureDecision('idle', 'contextmenu')
  assert.equal(d.intercepted, false)
  assert.equal(d.toast, null)
  assert.equal(d.openMenu, true)
})

test('解析结束（idle）立即放行：拦截只在 parsing 生效', () => {
  assert.equal(gestureDecision('idle', 'click').intercepted, false)
  assert.equal(gestureDecision('idle', 'contextmenu').intercepted, false)
})

test('未知状态/可疑输入按常规态处理（零侵入、零副作用）', () => {
  for (const s of ['busy', 'loading', 'processing', '', null, undefined]) {
    const d = gestureDecision(s, 'click')
    assert.equal(d.intercepted, false, 'unknown state must not intercept: ' + String(s))
    assert.equal(d.toast, null)
    assert.equal(d.openMenu, false)
  }
  const g = gestureDecision('parsing', 'hover')
  assert.equal(g.intercepted, false, 'unknown gesture must not intercept')
})

// —— toast：自动消失 + 去重 ——
test('toast 固定文案精确匹配', () => {
  assert.equal(PARSING_TOAST, '提示词正在生成，请稍后再试！')
})

test('nextToast: 异文案替换并刷新超时', () => {
  const out = nextToast({ text: '旧提示', deadline: 100 }, '新提示', 1_000)
  assert.equal(out.text, '新提示')
  assert.equal(out.deadline, 1_000 + TOAST_DURATION_MS)
})

test('nextToast: 同文案重复点击 → 单实例复用，仅保持可见（刷新时长，不叠加）', () => {
  const first = nextToast(null, PARSING_TOAST, 1_000)
  assert.equal(first.text, PARSING_TOAST)
  assert.equal(first.deadline, 1_000 + TOAST_DURATION_MS)
  // 已展示中再次触发同一文案：文本不变、时长刷新、无第二条
  const second = nextToast(first, PARSING_TOAST, 2_000)
  assert.equal(second.text, PARSING_TOAST)
  assert.equal(second.deadline, 2_000 + TOAST_DURATION_MS)
})

test('nextToast: 过期后同文案重新触发 → 重新可见（deadline 重置）', () => {
  const expired = { text: PARSING_TOAST, deadline: 500 }
  const out = nextToast(expired, PARSING_TOAST, 1_000)
  assert.equal(out.text, PARSING_TOAST)
  assert.equal(out.deadline, 1_000 + TOAST_DURATION_MS)
})

test('isToastExpired: 边界（到期即过期，未到期不过期）', () => {
  assert.equal(isToastExpired(1_000, 1_000), true)
  assert.equal(isToastExpired(1_000, 999), false)
  assert.equal(isToastExpired(null, 1_000), true)
})

// ── 常驻任务态 toast（v0.3.0：不自动消失、单实例、终态驱动）──
test('常驻 toast 固定文案精确匹配（需求锁定）', () => {
  assert.equal(OPTIMIZING_TOAST, '正在优化提示词中…')
  assert.equal(DONE_TOAST, '优化完成')
  assert.equal(DONE_TOAST_MS, 2000)
})

test('toastOnOptimizeStart：任意前置状态 → 优化中（重复触发替换旧实例，不堆叠）', () => {
  assert.equal(toastOnOptimizeStart(null).kind, 'optimizing')
  assert.equal(toastOnOptimizeStart({ kind: 'optimizing' }).kind, 'optimizing', '已优化中再触发 → 仍是唯一实例')
  assert.equal(toastOnOptimizeStart({ kind: 'done', since: 100 }).kind, 'optimizing', '完成态再次触发 → 回到优化中（先关旧再开新）')
  assert.equal(toastOnOptimizeStart({ kind: 'idle' }).kind, 'optimizing')
})

test('toastOnOptimizeEnd：终态（成功）→ 完成态；idle 保持 idle', () => {
  const done = toastOnOptimizeEnd({ kind: 'optimizing' }, 1_000)
  assert.equal(done.kind, 'done')
  assert.equal(done.since, 1_000)
  assert.equal(toastOnOptimizeEnd(null, 1_000).kind, 'idle')
  assert.equal(toastOnOptimizeEnd({ kind: 'idle' }, 1_000).kind, 'idle')
})

test('isDoneToastExpired：仅完成态计时退出；优化中/idle 永不因计时关闭', () => {
  assert.equal(isDoneToastExpired({ kind: 'done', since: 1_000 }, 1_000 + DONE_TOAST_MS), true, '完成态 2s 到期 → 退出')
  assert.equal(isDoneToastExpired({ kind: 'done', since: 1_000 }, 1_000 + DONE_TOAST_MS - 1), false)
  assert.equal(isDoneToastExpired({ kind: 'optimizing' }, Number.MAX_SAFE_INTEGER), false, '优化中任何时刻不自动关闭')
  assert.equal(isDoneToastExpired({ kind: 'idle' }, Number.MAX_SAFE_INTEGER), false)
})
