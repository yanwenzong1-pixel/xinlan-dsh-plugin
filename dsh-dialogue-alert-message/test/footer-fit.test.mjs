/**
 * 纯函数测试：侧栏底部动作行的空间判定（决定状态栏显示全文还是降级成紧凑图标）。
 * 背景：`sidebar.footer.action` 是**一行 flex**，DSH 内置 Cordis 行的根节点 `flex:0 0 auto;
 * width:100%` 会占满整行 ⇒ 本插件原先被压成 `width:0`，文案只剩残条（真机实测 2026-10-13）。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPACT_ICON_WIDTH_PX,
  FOOTER_FIT_MARGIN_PX,
  availableForText,
  shouldCompact,
} from '../src/lib/footer-fit.ts'

// 真机实测值（1440×900，宽态侧栏 256px）：可用空间 0 / 文案自然宽 169 + 内边距 20 = 189
const REQUIRED = 189

test('shouldCompact: 有空间（无 Cordis 同行）→ 显示全文', () => {
  assert.equal(shouldCompact({ free: 256, required: REQUIRED, wasCompact: false }), false)
  // 刚好放下：不算挤
  assert.equal(shouldCompact({ free: REQUIRED, required: REQUIRED, wasCompact: false }), false)
})

test('shouldCompact: 被 Cordis 行占满（free=0）→ 降级为紧凑图标', () => {
  assert.equal(shouldCompact({ free: 0, required: REQUIRED, wasCompact: false }), true)
  assert.equal(shouldCompact({ free: 120, required: REQUIRED, wasCompact: false }), true)
})

test('shouldCompact: 迟滞 —— 已在紧凑态时，需要多出 margin 才恢复全文（防抖动）', () => {
  assert.equal(shouldCompact({ free: REQUIRED + 1, required: REQUIRED, wasCompact: true }), true)
  assert.equal(shouldCompact({ free: REQUIRED + FOOTER_FIT_MARGIN_PX - 1, required: REQUIRED, wasCompact: true }), true)
  assert.equal(shouldCompact({ free: REQUIRED + FOOTER_FIT_MARGIN_PX, required: REQUIRED, wasCompact: true }), false)
})

test('shouldCompact: 非法输入一律保守降级（宁缺勿滥，不显示残条）', () => {
  for (const bad of [NaN, -1, Infinity]) {
    assert.equal(shouldCompact({ free: bad, required: REQUIRED, wasCompact: false }), true, 'free=' + bad)
  }
  assert.equal(shouldCompact({ free: 256, required: NaN, wasCompact: false }), true)
  assert.equal(shouldCompact({ free: 256, required: -5, wasCompact: false }), true)
})

test('常量：紧凑图标宽度必须落在真机实测的右侧空隙内（12px）', () => {
  // 真机：footerActions 右边界 268、侧栏右边界 280 ⇒ 完全可见的最大宽度就是 12px
  assert.equal(COMPACT_ICON_WIDTH_PX, 12)
  assert.ok(FOOTER_FIT_MARGIN_PX > 0, '迟滞余量必须为正')
})

// —— 可用宽度：始终先扣掉自己紧凑图标的占位（防自我循环挤压同行） ——
test('availableForText: 扣掉自己的 12px 占位', () => {
  assert.equal(availableForText(256, 0), 256 - COMPACT_ICON_WIDTH_PX)
  assert.equal(availableForText(256, 256), -COMPACT_ICON_WIDTH_PX) // 同行占满 → 负数
  assert.equal(availableForText(256, 87), 256 - 87 - COMPACT_ICON_WIDTH_PX)
  assert.ok(Number.isNaN(availableForText(NaN, 0)))
})

test('availableForText + shouldCompact: 自我循环被消除（不被自己挤小的同行"喂"出展开态）', () => {
  // 真机 ③ 现象：恢复 Cordis 行后它只剩 87px，若直接按当前布局算 free=169 会一直维持展开，
  // 等于反过来挤 DSH 自带 UI。扣除自身占位后可用 157 < required 169 ⇒ 收敛回紧凑图标。
  const free = availableForText(256, 87)
  assert.equal(shouldCompact({ free, required: 169, wasCompact: false }), true)
  // 同行完全不在时（Cordis 被禁用）→ 可用 244 ≥ 169 ⇒ 正常显示全文
  assert.equal(shouldCompact({ free: availableForText(256, 0), required: 169, wasCompact: false }), false)
})
