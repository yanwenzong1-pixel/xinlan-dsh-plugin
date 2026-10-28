/**
 * 覆盖层纯逻辑单测（不碰 DOM）：选择归一化、勾选规则、随机绑定稳定性、
 * 右键命中、行锚点解析、持久化反序列化。边界/异常输入优先。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANIMATIONS,
  ANIMATED_BASE_PATH,
  ANIMATION_ARBITRATION_GAP,
  ASSET_VERSION,
  BANNER_BASE_PATH,
  BANNER_ASPECT,
  BANNER_DEFAULTS,
  BANNER_POSITION_KEY,
  BANNER_VISIBLE_KEY,
  OVERLAY_VISIBLE_KEY,
  CONTEXT_TIRED_THRESHOLD,
  SIDEBAR_ANIMATION_RADIUS_PX,
  FIXED_DEFAULTS,
  FIXED_PET,
  FIXED_POSITION_KEY,
  GIF_BASE_PATH,
  HOVER_DEFAULTS,
  TIRED_ANIMATION,
  WORKING_ANIMATION,
  animationUrl,
  bannerSize,
  bannerUrl,
  bindAnimation,
  characterLabel,
  clampBannerPosition,
  clampBannerWidth,
  clampFixedPosition,
  computeAnimationPlacements,
  contextUsagePercent,
  defaultBannerPosition,
  defaultFixedPosition,
  fixedPetUrl,
  hasThreeView,
  normalizeSelection,
  parseBannerState,
  parseBannerVisible,
  parseOverlayVisible,
  parseFixedPosition,
  parseSelection,
  parseSessionRowKey,
  selectionAfterToggle,
  selectContextAnimation,
  serializeBannerState,
  serializeFixedPosition,
  serializeSelection,
  shouldUseTiredAnimation,
  standardAnimationSize,
  threeViewUrl,
} from '../src/client/core.mjs'

const LIB = [
  { id: 'blue-fat-fish-working', name: '蓝色大肥鱼正在工作', file: 'blue-fat-fish-working.gif', enabled: true },
  { id: 'other-a', name: '动画 A', file: 'a.gif', enabled: true },
  { id: 'other-b', name: '动画 B', file: 'b.gif', enabled: true },
  { id: 'disabled', name: '停用动画', file: 'off.gif', enabled: false },
]
const SINGLE = [LIB[0]]

test('内置动画库：首个动画 id/名称/资源路径符合预期', () => {
  assert.ok(Array.isArray(ANIMATIONS) && ANIMATIONS.length >= 1)
  assert.equal(ANIMATIONS[0].id, 'blue-fat-fish-working')
  assert.equal(ANIMATIONS[0].name, '蓝色大肥鱼正在工作')
  assert.equal(ANIMATIONS[0].file, 'blue-fat-fish-working.gif')
  assert.match(animationUrl(ANIMATIONS[0]), /blue-fat-fish-working\.gif\?v=\d+$/, 'asset URL must carry a cache-busting version')
})

test('parseSessionRowKey：只认 session: 前缀并解出 id', () => {
  assert.equal(parseSessionRowKey('session:abc-1'), 'abc-1')
  assert.equal(parseSessionRowKey('workspace:test'), null)
  assert.equal(parseSessionRowKey('session:'), null)
  assert.equal(parseSessionRowKey(''), null)
  assert.equal(parseSessionRowKey(null), null)
  assert.equal(parseSessionRowKey(undefined), null)
  assert.equal(parseSessionRowKey(42), null)
})

test('normalizeSelection：空/无效/重复/停用全部回退到首个可用动画', () => {
  assert.deepEqual(normalizeSelection(null, LIB), ['blue-fat-fish-working'])
  assert.deepEqual(normalizeSelection([], LIB), ['blue-fat-fish-working'])
  assert.deepEqual(normalizeSelection(['nope', 42, null], LIB), ['blue-fat-fish-working'])
  assert.deepEqual(normalizeSelection(['other-b', 'other-a', 'other-b'], LIB), ['other-b', 'other-a'])
  assert.deepEqual(normalizeSelection(['disabled'], LIB), ['blue-fat-fish-working'])
  assert.deepEqual(normalizeSelection(['other-a'], LIB), ['other-a'])
})

test('selectionAfterToggle：单动画锁定，多动画禁止取消最后一个', () => {
  assert.deepEqual(
    selectionAfterToggle(['blue-fat-fish-working'], 'blue-fat-fish-working', SINGLE),
    { selected: ['blue-fat-fish-working'], blocked: true, reason: 'single' },
  )
  assert.deepEqual(
    selectionAfterToggle(['other-a'], 'other-a', LIB),
    { selected: ['other-a'], blocked: true, reason: 'last' },
  )
  assert.deepEqual(selectionAfterToggle(['other-a'], 'blue-fat-fish-working', LIB), {
    selected: ['other-a', 'blue-fat-fish-working'], blocked: false,
  })
  assert.deepEqual(selectionAfterToggle(['other-a', 'other-b'], 'other-a', LIB), {
    selected: ['other-b'], blocked: false,
  })
  // 未知 id 不改动也不崩
  assert.deepEqual(selectionAfterToggle(['other-a'], 'nope', LIB), {
    selected: ['other-a'], blocked: true, reason: 'unknown',
  })
})

test('bindAnimation：本回合稳定，未勾选才重绑，随机可注入且越界安全', () => {
  const bindings = new Map()
  assert.equal(bindAnimation(bindings, 's1', ['other-a', 'other-b'], () => 0), 'other-a')
  bindings.set('s1', 'other-a')
  // 再次布局/滚动：保持原绑定，不重掷随机
  let calls = 0
  assert.equal(bindAnimation(bindings, 's1', ['other-a', 'other-b'], () => { calls += 1; return 0.99 }), 'other-a')
  assert.equal(calls, 0)
  // 勾选集合删掉了原动画 → 必须重绑到仍可用的动画
  assert.equal(bindAnimation(bindings, 's1', ['other-b'], () => 0), 'other-b')
  // 新会话按随机选取；random 返回 1（理论越界）时钳到最后一项
  assert.equal(bindAnimation(bindings, 's2', ['other-a', 'other-b'], () => 1), 'other-b')
  assert.equal(bindAnimation(bindings, 's3', ['other-a', 'other-b'], () => 0.999), 'other-b')
})

test('bindAnimation：空选择/未知会话不产生非法绑定', () => {
  const bindings = new Map()
  assert.equal(bindAnimation(bindings, 's1', [], () => 0), null)
  assert.equal(bindAnimation(bindings, '', ['other-a'], () => 0), null)
})

test('三视图资源映射：角色注册表声明 path，缺失/非法返回 null', () => {
  assert.match(ANIMATIONS[0].threeView, /^three-view\/[a-z0-9-]+\.png$/)
  assert.equal(hasThreeView(ANIMATIONS[0]), true)
  assert.equal(threeViewUrl(ANIMATIONS[0]), `${GIF_BASE_PATH}${ANIMATIONS[0].threeView}`)
  assert.equal(threeViewUrl({ id: 'x' }), null)
  assert.equal(threeViewUrl({ id: 'x', threeView: null }), null)
  assert.equal(threeViewUrl({ id: 'x', threeView: '' }), null)
  assert.equal(threeViewUrl(null), null)
  assert.equal(hasThreeView(null), false)
  assert.equal(hasThreeView({ threeView: 42 }), false)
  // 预览标签用角色名，缺省回退动画名；非法输入返回空串而不是崩
  assert.equal(characterLabel(ANIMATIONS[0]), '蓝色大肥鱼')
  assert.equal(characterLabel({ name: '动画 X' }), '动画 X')
  assert.equal(characterLabel(null), '')
  assert.equal(characterLabel({ name: 42 }), '')
})

test('固定形象配置与位置持久化：URL/默认位置/clamp/解析', () => {
  assert.equal(FIXED_PET.id, 'blue-fat-fish-eating')
  assert.equal(FIXED_PET.name, '蓝色大肥鱼')
  assert.match(FIXED_PET.file, /\.gif$/)
  assert.equal(fixedPetUrl(), `${ANIMATED_BASE_PATH}${FIXED_PET.file}?v=${ASSET_VERSION}`)
  assert.equal(FIXED_POSITION_KEY, 'dsh-anime-desktop-pet/fixed-position')
  assert.deepEqual(defaultFixedPosition({ width: 1024, height: 768 }), {
    x: 1024 - FIXED_DEFAULTS.sizePx - FIXED_DEFAULTS.marginPx,
    y: 768 - FIXED_DEFAULTS.sizePx - FIXED_DEFAULTS.marginPx,
  })
  assert.deepEqual(defaultFixedPosition({ width: 1024, height: 768 }, 200, 10), { x: 814, y: 558 })
  assert.deepEqual(clampFixedPosition({ x: -5, y: -5 }, { width: 1024, height: 768 }), { x: 24, y: 24 })
  assert.deepEqual(clampFixedPosition({ x: 2000, y: 2000 }, { width: 1024, height: 768 }), { x: 780, y: 524 })
  assert.deepEqual(clampFixedPosition({ x: 100, y: 200 }, { width: 1024, height: 768 }), { x: 100, y: 200 })
  // 视口比形象还小：不出现负数坐标，保持左上边距（会溢出屏幕，属极端窗口）
  assert.deepEqual(clampFixedPosition({ x: 0, y: 0 }, { width: 100, height: 100 }, 160, 24), { x: 24, y: 24 })
  assert.equal(clampFixedPosition(null, { width: 1024, height: 768 }), null)
  assert.equal(clampFixedPosition({ x: 1, y: 2 }, { width: 0, height: 0 }), null)
  assert.equal(clampFixedPosition({ x: Number.NaN, y: 1 }, { width: 1024, height: 768 }), null)
  assert.deepEqual(parseFixedPosition(serializeFixedPosition({ x: 10, y: 20 })), { x: 10, y: 20 })
  assert.equal(parseFixedPosition('not-json'), null)
  assert.equal(parseFixedPosition('{"x":1}'), null)
  assert.equal(parseFixedPosition('{"x":"1","y":2}'), null)
  assert.equal(parseFixedPosition('[1,2]'), null)
  assert.equal(parseFixedPosition(null), null)
})

test('桌面横幅：URL/等比尺寸/默认位置/clamp/持久化/可见性默认', () => {
  assert.equal(BANNER_BASE_PATH, '/@dsh-external/dsh-anime-desktop-pet/assets/banner/')
  assert.equal(BANNER_POSITION_KEY, 'dsh-anime-desktop-pet/banner-position')
  assert.equal(BANNER_VISIBLE_KEY, 'dsh-anime-desktop-pet/banner-visible')
  assert.match(bannerUrl(), /\/assets\/banner\/blue-fat-fish-live-banner\.gif\?v=\d+$/)
  assert.ok(Math.abs(BANNER_ASPECT - 3) < 0.01, 'source is a wide 2172x724 banner')
  assert.deepEqual(bannerSize(720), { width: 720, height: 240 })
  assert.deepEqual(bannerSize(10), { width: BANNER_DEFAULTS.minWidthPx, height: Math.round(BANNER_DEFAULTS.minWidthPx / BANNER_ASPECT) })
  assert.equal(clampBannerWidth(Number.NaN), BANNER_DEFAULTS.widthPx)
  assert.equal(clampBannerWidth(1), BANNER_DEFAULTS.minWidthPx)
  assert.equal(clampBannerWidth(99999), BANNER_DEFAULTS.maxWidthPx)
  assert.deepEqual(defaultBannerPosition({ width: 1024, height: 768 }), { x: 152, y: 504 })
  assert.deepEqual(clampBannerPosition({ x: -100, y: 900 }, { width: 1024, height: 768 }, 720), { x: 24, y: 504 })
  assert.deepEqual(parseBannerState(serializeBannerState({ x: 10.4, y: 20.6, width: 800.2 })), { x: 10, y: 21, width: 800 })
  assert.equal(parseBannerState('not-json'), null)
  assert.equal(parseBannerState('[1,2,3]'), null)
  assert.equal(parseBannerState('{"x":1,"y":2}'), null)
  assert.equal(parseBannerVisible(null), true, 'banner is shown by default')
  assert.equal(parseBannerVisible('true'), true)
  assert.equal(parseBannerVisible('false'), false)
  assert.equal(parseBannerVisible('0'), false)
  assert.equal(OVERLAY_VISIBLE_KEY, 'dsh-anime-desktop-pet/overlay-visible')
  assert.equal(parseOverlayVisible(null), true)
  assert.equal(parseOverlayVisible('true'), true)
  assert.equal(parseOverlayVisible('false'), false)
  assert.equal(parseOverlayVisible('0'), false)
})

test('上下文用量：严格 >45% 选「很累」，<=45% 选工作；两个动画均可勾选', () => {
  assert.equal(CONTEXT_TIRED_THRESHOLD, 45)
  assert.deepEqual(ANIMATIONS.map((animation) => animation.id), ['blue-fat-fish-working', 'blue-fat-fish-tired'])
  assert.equal(TIRED_ANIMATION.id, 'blue-fat-fish-tired')
  assert.equal(TIRED_ANIMATION.name, '蓝色大肥鱼很累')
  assert.equal(animationUrl(TIRED_ANIMATION), `${ANIMATED_BASE_PATH}${TIRED_ANIMATION.file}?v=${ASSET_VERSION}`)
  assert.ok(animationUrl(TIRED_ANIMATION).startsWith(ANIMATED_BASE_PATH))
  assert.ok(animationUrl(ANIMATIONS[0]).startsWith(GIF_BASE_PATH))
  // 空选择默认工作图；用户可存两个或只存某一个。
  assert.deepEqual(normalizeSelection([], ANIMATIONS), [WORKING_ANIMATION.id])
  assert.deepEqual(normalizeSelection([TIRED_ANIMATION.id], ANIMATIONS), [TIRED_ANIMATION.id])
  assert.deepEqual(normalizeSelection([TIRED_ANIMATION.id, WORKING_ANIMATION.id], ANIMATIONS), [TIRED_ANIMATION.id, WORKING_ANIMATION.id])
  assert.deepEqual(
    { 45: contextUsagePercent({ projectedTokens: 45, contextWindow: 100 }), 46: contextUsagePercent({ projectedTokens: 46, contextWindow: 100 }) },
    { 45: 45, 46: 46 },
  )
  // 与 DSH 上下文占用展示一致：优先 projectedTokens，回退 pressureTokens。
  assert.equal(contextUsagePercent({ pressureTokens: 30, contextWindow: 100 }), 30)
  assert.equal(contextUsagePercent({ projectedTokens: 30, pressureTokens: 90, contextWindow: 100 }), 30)
  assert.equal(contextUsagePercent({ projectedTokens: 1, contextWindow: 1_000 }), 0)
  assert.equal(contextUsagePercent({ projectedTokens: 130, contextWindow: 100 }), 100)
  assert.equal(contextUsagePercent(null), null)
  assert.equal(contextUsagePercent({}), null)
  assert.equal(contextUsagePercent({ projectedTokens: 1 }), null)
  assert.equal(contextUsagePercent({ projectedTokens: 1, contextWindow: 0 }), null)
  assert.equal(shouldUseTiredAnimation(46), true)
  assert.equal(shouldUseTiredAnimation(45), false)
  assert.equal(shouldUseTiredAnimation(99), true)
  assert.equal(shouldUseTiredAnimation(null), false)
  assert.equal(shouldUseTiredAnimation(Number.NaN), false)
  // 两个都激活时按上下文阈值切换；只激活一个时始终使用该动画。
  const both = [WORKING_ANIMATION.id, TIRED_ANIMATION.id]
  assert.equal(selectContextAnimation(both, 46), TIRED_ANIMATION.id)
  assert.equal(selectContextAnimation(both, 45), WORKING_ANIMATION.id)
  assert.equal(selectContextAnimation(both, null), WORKING_ANIMATION.id)
  assert.equal(selectContextAnimation([TIRED_ANIMATION.id], 10), TIRED_ANIMATION.id)
  assert.equal(selectContextAnimation([TIRED_ANIMATION.id], null), TIRED_ANIMATION.id)
  assert.equal(selectContextAnimation([WORKING_ANIMATION.id], 99), WORKING_ANIMATION.id)
  assert.equal(selectContextAnimation([], 99), null)
  assert.equal(selectContextAnimation(null, 99), null)
})

test('parseSelection/serializeSelection：坏数据回退，正常往返', () => {
  assert.equal(parseSelection(null), null)
  assert.equal(parseSelection('not json'), null)
  assert.equal(parseSelection('{"a":1}'), null)
  assert.deepEqual(parseSelection('["a",1,null,"b"]'), ['a', 'b'])
  assert.deepEqual(parseSelection(serializeSelection(['a', 'b'])), ['a', 'b'])
  assert.equal(serializeSelection(['a', 'a', 'b']), '["a","b"]')
})

/* ------------------------------------------------------------------ *
 * 几何仲裁（R2/R3/R4）：7 个对话的侧边栏验收用例。
 * STANDARD_ANIMATION_SIZE 取既有 hover 放大令牌：行高 × HOVER_DEFAULTS.scale。
 * ------------------------------------------------------------------ */
const ARB_ROW_H = 32
const ARB_SIZE = standardAnimationSize(ARB_ROW_H)
const ARB_TOP = 100

function arbCandidate(id, rowIndex, overrides = {}) {
  return {
    id,
    kind: 'conversation',
    running: true,
    anchorRect: { left: 12, top: ARB_TOP + rowIndex * ARB_ROW_H, width: 256, height: ARB_ROW_H },
    ...overrides,
  }
}

function arbVisible(candidates, extra = {}) {
  return computeAnimationPlacements({
    candidates,
    size: ARB_SIZE,
    gap: ANIMATION_ARBITRATION_GAP,
    ...extra,
  }).visibleIds
}

test('STANDARD_ANIMATION_SIZE / gap：沿用 hover 放大态令牌，默认间距大于 0', () => {
  assert.equal(ARB_SIZE, Math.round(ARB_ROW_H * HOVER_DEFAULTS.scale))
  assert.ok(ANIMATION_ARBITRATION_GAP > 0)
  assert.equal(SIDEBAR_ANIMATION_RADIUS_PX, 15, 'sidebar animations use the requested 15px radius')
  assert.equal(standardAnimationSize(0), 0)
  assert.equal(standardAnimationSize(null), standardAnimationSize(0))
  assert.equal(standardAnimationSize(-5), 0)
  assert.equal(standardAnimationSize(32, 1), 32)
})

test('R2.5 验收：仅 #1 运行 / #1#3 / #1#3#4 的贪心可见集合', () => {
  const rows = Array.from({ length: 7 }, (_, index) => arbCandidate(`c${index + 1}`, index))
  assert.deepEqual(arbVisible([rows[0]]), ['c1'])
  // #1 与 #3 中心相距 2 行，STANDARD 尺寸 > 间距 → #3 被 #1 遮挡。
  assert.deepEqual(arbVisible([rows[0], rows[2]]), ['c1'])
  // #4 与 #1 之间隔着一个完整行，垂直间隙大于 gap → #4 可展示。
  assert.deepEqual(arbVisible([rows[0], rows[2], rows[3]]), ['c1', 'c4'])
})

test('R2.5 推导用例：#1 结束后 #3 接替展示、#4 被 #3 遮挡；#3 结束后 #4 恢复', () => {
  const rows = Array.from({ length: 7 }, (_, index) => arbCandidate(`c${index + 1}`, index))
  assert.deepEqual(arbVisible([rows[2], rows[3]]), ['c3'])
  assert.deepEqual(arbVisible([rows[3]]), ['c4'])
  // 状态 + 顺序同时变化：可见集合必须等于对当前顺序重新执行算法的结果。
  const orderA = [rows[0], rows[2], rows[3]]
  const orderB = [rows[3], rows[2], rows[0]]
  assert.deepEqual(arbVisible(orderA), ['c1', 'c4'])
  assert.deepEqual(arbVisible(orderB), ['c4', 'c1'])
  assert.deepEqual(arbVisible(orderB), arbVisible(orderB))
})

test('R2：幂等、非法候选、未运行候选与异常 gap/size 不产生假阳性', () => {
  const rows = Array.from({ length: 7 }, (_, index) => arbCandidate(`c${index + 1}`, index))
  const input = { candidates: [rows[0], rows[2], rows[3]], size: ARB_SIZE, gap: ANIMATION_ARBITRATION_GAP }
  assert.deepEqual(computeAnimationPlacements(input), computeAnimationPlacements(input))
  // 未运行 => 不渲染且不占用位置。
  assert.deepEqual(arbVisible([rows[0], { ...rows[2], running: false }, rows[3]]), ['c1', 'c4'])
  // 非法矩形 / 缺 id / 重复 id 被安全忽略；坏输入返回空集合而不是抛错。
  assert.deepEqual(arbVisible([{ id: 'bad', kind: 'conversation', running: true, anchorRect: null }]), [])
  assert.deepEqual(arbVisible([arbCandidate('', 0)]), [])
  assert.deepEqual(arbVisible([arbCandidate('c1', 0), arbCandidate('c1', 0)]), ['c1'])
  assert.deepEqual(computeAnimationPlacements({ candidates: null }).visibleIds, [])
  assert.deepEqual(computeAnimationPlacements(null).visibleIds, [])
  assert.deepEqual(computeAnimationPlacements({ candidates: rows, size: 0 }).visibleIds, [])
  // gap 非法回退为 0 且不抛错；gap=0 时 #1/#3 仍因重叠而隐藏。
  assert.deepEqual(arbVisible([rows[0], rows[2]], { gap: Number.NaN }), ['c1'])
})

test('R4：固定基准矩形占用空间，优先于会话级；基准自身绝不参与渲染', () => {
  const rows = Array.from({ length: 7 }, (_, index) => arbCandidate(`c${index + 1}`, index))
  // 基准只压住 #1 动画的顶部 → #1 隐藏；远处的 #5 不受影响。
  const covered = computeAnimationPlacements({
    candidates: [rows[0], rows[4]],
    size: ARB_SIZE,
    gap: ANIMATION_ARBITRATION_GAP,
    benchmarkRect: { left: 270, top: 76, width: 40, height: 16 },
  })
  assert.deepEqual(covered.visibleIds, ['c5'])
  assert.equal(covered.placements.length, 1)
  // 基准远离列表时不改变仲裁。
  const farBenchmark = { left: 0, top: 0, width: 20, height: 20 }
  assert.deepEqual(arbVisible([rows[0], rows[4]], { benchmarkRect: farBenchmark }), ['c1', 'c5'])
  // 非法基准矩形按“无固定基准”处理，不抛错。
  assert.deepEqual(arbVisible([rows[0]], { benchmarkRect: { left: Number.NaN } }), ['c1'])
})

test('R3：折叠工作区最多一个工作区级动画，且工作区优先级高于会话级', () => {
  const workspace = {
    id: 'workspace:ws-1', kind: 'workspace', running: true,
    anchorRect: { left: 12, top: ARB_TOP - 40, width: 256, height: 34 },
  }
  const conversation = arbCandidate('c1', 0)
  // 工作区候选先放置，会话级即使在上方也被遮挡。
  const result = computeAnimationPlacements({
    candidates: [conversation, workspace],
    size: ARB_SIZE,
    gap: ANIMATION_ARBITRATION_GAP,
  })
  assert.deepEqual(result.visibleIds, ['workspace:ws-1'])
  assert.equal(result.placements.length, 1)
  // 同一工作区多个运行会话由视图层合并为一个 workspace 候选（纯函数不重复放置）。
  assert.deepEqual(arbVisible([workspace]), ['workspace:ws-1'])
})

test('R2/R4：resize（行高/间距变化）后重新计算，结果无残留', () => {
  const rows = Array.from({ length: 7 }, (_, index) => arbCandidate(`c${index + 1}`, index))
  const tall = { ...rows[0], anchorRect: { ...rows[0].anchorRect, height: 48 } }
  const smallSize = standardAnimationSize(16)
  assert.deepEqual(arbVisible([rows[0], rows[2]], { size: smallSize, gap: 4 }), ['c1', 'c3'])
  assert.deepEqual(arbVisible([tall, rows[1]], { size: standardAnimationSize(48) }), ['c1'])
})
