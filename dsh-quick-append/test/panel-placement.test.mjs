/**
 * 纯函数测试：「快捷追加文案」面板的放置计算。
 * 背景（2026-10-19 真机实测，DSH 0.2.1-rc.2）：面板原实现是 composer 内的
 * `position: absolute; right: 0; bottom: 32px; z-index: 100` —— 被困在 composer 的层叠上下文里，
 * 会被边栏/应用浮层盖住；窄窗（900×700）实测面板 left=-91，直接跑到屏幕左侧外面。
 * 修法：portal 到 body + `position: fixed`，位置由本叶子算出（右对齐触发区 + 视口内夹取）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PANEL_MARGIN,
  PANEL_OFFSET_ABOVE_TRIGGER,
  PANEL_WIDTH,
  panelPlacementOf,
} from '../src/lib/panel-placement.ts'

const anchor = (right, bottom, w = 1440, h = 900) => ({ right, bottom, viewportWidth: w, viewportHeight: h })

test('常规：右对齐触发区，底边贴在触发区上方（与旧 absolute 版同一视觉关系）', () => {
  // 真机复现值：1100×760 下触发区 right=541 / bottom=477 ⇒ 旧实现面板 left=221、bottom 边 y=445
  const p = panelPlacementOf(anchor(541, 477, 1100, 760))
  assert.equal(p.width, PANEL_WIDTH)
  assert.equal(p.left, 541 - PANEL_WIDTH)
  assert.equal(p.bottom, 760 - (477 - PANEL_OFFSET_ABOVE_TRIGGER))
  // 换算成底边 y：必须等于旧实现的 445
  assert.equal(760 - p.bottom, 477 - PANEL_OFFSET_ABOVE_TRIGGER)
})

test('窄窗：不再被推到屏幕外（真机 900×700 实测旧 left=-91）', () => {
  const p = panelPlacementOf(anchor(229, 415, 900, 700))
  assert.ok(p.left >= PANEL_MARGIN, '左边界必须留在视口内，实际 ' + p.left)
  assert.ok(p.left + p.width <= 900 - PANEL_MARGIN, '右边界不得越界')
})

test('视口比面板还窄：宽度收缩到可用宽度，仍左右各留 margin', () => {
  const p = panelPlacementOf(anchor(200, 500, 300, 600))
  assert.ok(p.width <= 300 - 2 * PANEL_MARGIN, '窄视口下宽度必须收缩，实际 ' + p.width)
  assert.ok(p.left >= PANEL_MARGIN && p.left + p.width <= 300 - PANEL_MARGIN)
  assert.ok(p.width >= 160, '宽度下限兜底，避免算出负宽度')
})

test('触发区贴右边缘 / 贴视口底部：都不越界', () => {
  const right = panelPlacementOf(anchor(1440, 780, 1440, 900))
  assert.equal(right.left, 1440 - PANEL_WIDTH - PANEL_MARGIN)
  assert.ok(right.bottom >= PANEL_MARGIN)
  const low = panelPlacementOf(anchor(700, 900, 1200, 900))
  assert.ok(low.bottom >= PANEL_MARGIN)
  assert.ok(low.bottom <= 900 - PANEL_MARGIN, 'bottom 偏移不得大到把面板推出顶部')
})

test('非法输入（NaN / 负尺寸）不产生 NaN 样式，退回安全值', () => {
  const p = panelPlacementOf(anchor(NaN, NaN, NaN, NaN))
  assert.ok(Number.isFinite(p.left) && Number.isFinite(p.bottom) && Number.isFinite(p.width))
  assert.equal(p.left, PANEL_MARGIN)
  assert.equal(p.top, null)
})
