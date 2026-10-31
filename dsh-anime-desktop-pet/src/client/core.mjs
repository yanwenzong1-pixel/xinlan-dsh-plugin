/**
 * Overlay core: animation library, selection rules, stable random binding,
 * session-row anchor parsing, right-click hit testing and persistence codecs.
 * Pure functions only — the DOM wiring lives in overlay.mjs.
 */

/** Host route prefix for additional packaged animation GIFs. */
export const ANIMATED_BASE_PATH = '/@dsh-external/dsh-anime-desktop-pet/assets/animated/'

/** Default animation: shown while context use is within the threshold. */
export const WORKING_ANIMATION = {
  id: 'blue-fat-fish-working',
  name: '蓝色大肥鱼正在工作',
  /** Human-facing character name (used by preview labels); falls back to `name`. */
  characterName: '蓝色大肥鱼',
  file: 'blue-fat-fish-working.gif',
  enabled: true,
  /** Optional per-character three-view reference image (served from assets/three-view/). */
  threeView: 'three-view/blue-fat-fish-working.png',
}

/** Context-pressure variant: selectable in settings, auto-selected above the threshold. */
export const TIRED_ANIMATION = {
  id: 'blue-fat-fish-tired',
  name: '蓝色大肥鱼很累',
  characterName: '蓝色大肥鱼',
  file: 'blue-fat-fish-tired.gif',
  base: ANIMATED_BASE_PATH,
  enabled: true,
}

/** Selectable library: the user may activate either one or both. */
export const ANIMATIONS = [WORKING_ANIMATION, TIRED_ANIMATION]

/** Strictly above this percent (and when both are active) uses the tired animation. */
export const CONTEXT_TIRED_THRESHOLD = 45

/** Bounded context-use percent from the public `contextPressure` projection. */
export function contextUsagePercent(pressure) {
  if (pressure === null || typeof pressure !== 'object') return null
  const used = Number.isFinite(pressure.projectedTokens) ? pressure.projectedTokens : pressure.pressureTokens
  const window = pressure.contextWindow
  if (!Number.isFinite(used) || !Number.isFinite(window) || window <= 0 || used < 0) return null
  return Math.min(100, Math.round(used / window * 100))
}

/** Whether a context percent selects the tired variant (strictly > 45%). */
export function shouldUseTiredAnimation(percent) {
  return Number.isFinite(percent) && percent > CONTEXT_TIRED_THRESHOLD
}

/**
 * Resolve the context pair selection:
 * - both active: > threshold -> tired, otherwise working;
 * - only tired active: tired regardless of context;
 * - only working active: working regardless of context;
 * - neither active: null (caller falls back to legacy random binding for other libraries).
 */
export function selectContextAnimation(selectedIds, percent) {
  const ids = Array.isArray(selectedIds) ? selectedIds : []
  const hasWorking = ids.includes(WORKING_ANIMATION.id)
  const hasTired = ids.includes(TIRED_ANIMATION.id)
  if (hasTired && (!hasWorking || shouldUseTiredAnimation(percent))) return TIRED_ANIMATION.id
  if (hasWorking) return WORKING_ANIMATION.id
  return null
}

/** Fixed desktop character: independent of running sessions, draggable, position persisted. */
export const FIXED_PET = {
  id: 'blue-fat-fish-eating',
  name: '蓝色大肥鱼',
  file: 'blue-fat-fish-eating.gif',
}

/** Fixed character defaults: size and the viewport margin used for placement/clamping. */
export const FIXED_DEFAULTS = { sizePx: 220, marginPx: 24 }

/** Desktop live banner (independent transparent overlay layer). */
export const BANNER_BASE_PATH = '/@dsh-external/dsh-anime-desktop-pet/assets/banner/'
export const BANNER_FILE = 'blue-fat-fish-live-banner.gif'
export const BANNER_ASPECT = 2172 / 724
export const BANNER_DEFAULTS = {
  widthPx: 720,
  minWidthPx: 240,
  maxWidthPx: 1920,
  marginPx: 24,
}
export const BANNER_POSITION_KEY = 'dsh-anime-desktop-pet/banner-position'
export const BANNER_VISIBLE_KEY = 'dsh-anime-desktop-pet/banner-visible'
// v2 key: absent means hidden. The old key defaulted to visible and would keep
// screenshots noisy after upgrade, so it is intentionally ignored.
export const OVERLAY_VISIBLE_KEY = 'dsh-anime-desktop-pet/overlay-visible-v2'

export function bannerUrl(base = BANNER_BASE_PATH) {
  return `${base}${BANNER_FILE}?v=${ASSET_VERSION}`
}

export function clampBannerWidth(width) {
  const value = Number.isFinite(width) ? width : BANNER_DEFAULTS.widthPx
  return Math.round(Math.min(Math.max(value, BANNER_DEFAULTS.minWidthPx), BANNER_DEFAULTS.maxWidthPx))
}

export function bannerSize(width) {
  const clamped = clampBannerWidth(width)
  return { width: clamped, height: Math.round(clamped / BANNER_ASPECT) }
}

export function defaultBannerPosition(viewport, width = BANNER_DEFAULTS.widthPx, margin = BANNER_DEFAULTS.marginPx) {
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null
  const size = bannerSize(width)
  const gap = Number.isFinite(margin) ? Math.max(0, margin) : BANNER_DEFAULTS.marginPx
  return {
    x: Math.round((viewport.width - size.width) / 2),
    y: Math.max(gap, Math.round(viewport.height - size.height - gap)),
  }
}

export function clampBannerPosition(position, viewport, width = position?.width ?? BANNER_DEFAULTS.widthPx, margin = BANNER_DEFAULTS.marginPx) {
  if (!position || !viewport) return null
  if (![position.x, position.y].every(Number.isFinite)) return null
  if (![viewport.width, viewport.height].every(Number.isFinite)) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const size = bannerSize(width)
  const gap = Number.isFinite(margin) ? Math.max(0, margin) : BANNER_DEFAULTS.marginPx
  return {
    x: Math.round(Math.min(Math.max(position.x, gap), Math.max(gap, viewport.width - size.width - gap))),
    y: Math.round(Math.min(Math.max(position.y, gap), Math.max(gap, viewport.height - size.height - gap))),
  }
}

export function parseBannerState(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (![value.x, value.y, value.width].every(Number.isFinite)) return null
  return { x: value.x, y: value.y, width: clampBannerWidth(value.width) }
}

export function serializeBannerState(state) {
  return JSON.stringify({ x: Math.round(state.x), y: Math.round(state.y), width: clampBannerWidth(state.width) })
}

/** Visibility defaults to true; only an explicit persisted "false" hides it. */
export function parseBannerVisible(raw) {
  return raw !== 'false' && raw !== '0'
}

/** Global overlay visibility from Ctrl+Shift+F12; absent or invalid means hidden. */
export function parseOverlayVisible(raw) {
  return raw === 'true' || raw === '1'
}

/** localStorage key for the fixed character's last dragged position. */
export const FIXED_POSITION_KEY = 'dsh-anime-desktop-pet/fixed-position'

/** Resolve the fixed character's packaged GIF URL. */
export function fixedPetUrl(base = ANIMATED_BASE_PATH) {
  return `${base}${FIXED_PET.file}?v=${ASSET_VERSION}`
}

/** Bottom-right default position for the fixed character. */
export function defaultFixedPosition(viewport, size = FIXED_DEFAULTS.sizePx, margin = FIXED_DEFAULTS.marginPx) {
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null
  const gap = Number.isFinite(margin) ? Math.max(0, margin) : FIXED_DEFAULTS.marginPx
  const box = Number.isFinite(size) ? Math.max(1, size) : FIXED_DEFAULTS.sizePx
  return { x: Math.round(viewport.width - box - gap), y: Math.round(viewport.height - box - gap) }
}

/** Keep a dragged fixed-character position fully inside the viewport (margin preserved). */
export function clampFixedPosition(position, viewport, size = FIXED_DEFAULTS.sizePx, margin = FIXED_DEFAULTS.marginPx) {
  if (!position || !viewport) return null
  if (![position.x, position.y].every(Number.isFinite)) return null
  if (![viewport.width, viewport.height].every(Number.isFinite)) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null
  const box = Number.isFinite(size) ? Math.max(1, size) : FIXED_DEFAULTS.sizePx
  const gap = Number.isFinite(margin) ? Math.max(0, margin) : FIXED_DEFAULTS.marginPx
  const maxX = Math.max(gap, viewport.width - box - gap)
  const maxY = Math.max(gap, viewport.height - box - gap)
  return {
    x: Math.round(Math.min(Math.max(position.x, gap), maxX)),
    y: Math.round(Math.min(Math.max(position.y, gap), maxY)),
  }
}

/** Parse a persisted fixed-character position; malformed values return null. */
export function parseFixedPosition(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: value.x, y: value.y }
}

/** Serialize the fixed-character position for localStorage. */
export function serializeFixedPosition(position) {
  return JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })
}

/** Hover enlargement defaults: one place for the magnification contract. */
export const HOVER_DEFAULTS = {
  /** Standard = measured row height × this old hover-scale token. */
  scale: 2.5,
  /** Safety gap between arbitrated animations (old hover edge-margin token). */
  marginPx: 8,
}

/**
 * Sidebar visibility arbitration tokens (single source, no scattered magic numbers):
 * the standard rendered size is the old hover-enlarged size (row height × scale),
 * and the safety gap reuses the existing spacing token.
 */
export const ANIMATION_ARBITRATION_GAP = HOVER_DEFAULTS.marginPx

/** Rounded-corner radius for sidebar animations (user-requested 15px card radius). */
export const SIDEBAR_ANIMATION_RADIUS_PX = 15

/** Standard (only) sidebar animation size: measured row height enlarged by the old hover token. */
export function standardAnimationSize(basePx, scale = HOVER_DEFAULTS.scale) {
  if (!Number.isFinite(basePx) || basePx <= 0) return 0
  const factor = Number.isFinite(scale) && scale > 0 ? scale : HOVER_DEFAULTS.scale
  return Math.round(basePx * factor)
}

function normalizeBox(box) {
  if (box === null || typeof box !== 'object') return null
  const left = Number.isFinite(box.left) ? box.left : box.x
  const top = Number.isFinite(box.top) ? box.top : box.y
  let width = Number.isFinite(box.width) ? box.width : null
  let height = Number.isFinite(box.height) ? box.height : null
  if ((width === null || width <= 0) && Number.isFinite(box.right) && Number.isFinite(left)) width = box.right - left
  if ((height === null || height <= 0) && Number.isFinite(box.bottom) && Number.isFinite(top)) height = box.bottom - top
  if (![left, top, width, height].every(Number.isFinite)) return null
  if (width <= 0 || height <= 0) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

/** Shared rectangle intersection predicate used by arbitration and the view layer. */
export function rectsOverlap(a, b, gap = 0) {
  const padding = Number.isFinite(gap) && gap > 0 ? gap : 0
  return a.left < b.right + padding
    && b.left < a.right + padding
    && a.top < b.bottom + padding
    && b.top < a.bottom + padding
}

const KIND_PRIORITY = { workspace: 0, conversation: 1 }

/**
 * Deterministic sidebar animation arbitration (pure; no DOM/state reads).
 *
 * Input: { candidates:[{ id, kind:'conversation'|'workspace', running, anchorRect }],
 *          size, gap, benchmarkRect? }
 * Candidate geometry: STANDARD-sized square, horizontally just right of its row and
 * vertically centered on that row. A candidate is shown only when it does not
 * overlap the fixed benchmark rect or any already placed candidate (+gap).
 * Workspace candidates win over conversation candidates; within a kind DOM order wins.
 * Returns { visibleIds, placements } in original (display) order.
 */
export function computeAnimationPlacements(input = {}) {
  const empty = { visibleIds: [], placements: [] }
  if (input === null || typeof input !== 'object') return empty
  const size = Number.isFinite(input.size) && input.size > 0 ? input.size : 0
  if (size === 0) return empty
  const gap = Number.isFinite(input.gap) && input.gap > 0 ? input.gap : 0
  const candidates = Array.isArray(input.candidates) ? input.candidates : []
  const benchmark = normalizeBox(input.benchmarkRect)
  const seen = new Set()
  const indexed = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (candidate === null || typeof candidate !== 'object') continue
    if (typeof candidate.id !== 'string' || candidate.id === '' || seen.has(candidate.id)) continue
    if (candidate.running !== true) continue
    const kind = candidate.kind === 'workspace' ? 'workspace' : candidate.kind === 'conversation' ? 'conversation' : null
    if (kind === null) continue
    const anchor = normalizeBox(candidate.anchorRect)
    if (anchor === null) continue
    const left = anchor.right + gap
    const top = anchor.top + (anchor.height - size) / 2
    const rect = { left, top, width: size, height: size, right: left + size, bottom: top + size }
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) continue
    seen.add(candidate.id)
    indexed.push({ index, candidate, kind, rect })
  }
  indexed.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.index - b.index)
  const decided = new Array(candidates.length).fill(null)
  const placedWorkspaces = []
  const workspaceQueue = indexed.filter((entry) => entry.kind === 'workspace')
  const conversationQueue = indexed.filter((entry) => entry.kind === 'conversation')
  // Same-kind priority is "upper first"; DOM display order is already top->bottom.
  workspaceQueue.sort((a, b) => a.rect.top - b.rect.top || a.index - b.index)
  conversationQueue.sort((a, b) => a.rect.top - b.rect.top || a.index - b.index)
  for (const entry of workspaceQueue) {
    if (benchmark !== null && rectsOverlap(entry.rect, benchmark, gap)) continue
    const previous = placedWorkspaces[placedWorkspaces.length - 1]
    if (previous !== undefined && rectsOverlap(entry.rect, previous.rect, gap)) continue
    placedWorkspaces.push(entry)
    decided[entry.index] = { id: entry.candidate.id, kind: entry.kind, rect: entry.rect }
  }
  // Conversations are swept against a sorted benchmark+workspace interval list and
  // the nearest placed conversation; each pointer only moves forward => O(n).
  const staticIntervals = [...placedWorkspaces.map((entry) => entry.rect), ...(benchmark === null ? [] : [benchmark])]
    .sort((a, b) => a.top - b.top)
  let cursor = 0
  let previousConversation = null
  for (const entry of conversationQueue) {
    if (previousConversation !== null && rectsOverlap(entry.rect, previousConversation.rect, gap)) continue
    while (cursor < staticIntervals.length && staticIntervals[cursor].bottom + gap <= entry.rect.top) cursor += 1
    let blocked = false
    for (let index = cursor; index < staticIntervals.length && staticIntervals[index].top < entry.rect.bottom + gap; index += 1) {
      if (rectsOverlap(entry.rect, staticIntervals[index], gap)) {
        blocked = true
        break
      }
    }
    if (blocked) continue
    previousConversation = entry
    decided[entry.index] = { id: entry.candidate.id, kind: entry.kind, rect: entry.rect }
  }
  const placements = decided.filter((placement) => placement !== null)
  return { visibleIds: placements.map((placement) => placement.id), placements }
}

/** Host route serving the packaged animation assets (see src/index.ts). */
export const GIF_BASE_PATH = '/@dsh-external/dsh-anime-desktop-pet/assets/'

/** Bump when the GIF bytes change so browsers bypass the immutable asset cache. */
export const ASSET_VERSION = '3'

/** localStorage key for the checked animation ids. */
export const STORAGE_KEY = 'dsh-anime-desktop-pet/selection'

const SESSION_ROW_PREFIX = 'session:'

/** Resolve one animation's packaged URL; `animation.base` selects a non-default route. */
export function animationUrl(animation, base = animation?.base ?? GIF_BASE_PATH) {
  return `${base}${animation.file}?v=${ASSET_VERSION}`
}

/** Whether one character declares a three-view reference image. */
export function hasThreeView(animation) {
  return Boolean(animation) && typeof animation.threeView === 'string' && animation.threeView !== ''
}

/** Human-facing character label for preview UI; never returns a non-string. */
export function characterLabel(animation) {
  if (!animation) return ''
  if (typeof animation.characterName === 'string' && animation.characterName !== '') return animation.characterName
  return typeof animation.name === 'string' ? animation.name : ''
}

/** Resolve one character's three-view URL, or null when the character has none. */
export function threeViewUrl(animation, base = GIF_BASE_PATH) {
  return hasThreeView(animation) ? `${base}${animation.threeView}` : null
}

/** Animations eligible for display (missing `enabled` means enabled). */
function enabledAnimations(library) {
  return (Array.isArray(library) ? library : []).filter(
    (animation) => animation && typeof animation.id === 'string' && animation.enabled !== false,
  )
}

/** Row key (`data-row-key`) of one conversation row, or null for group rows. */
export function parseSessionRowKey(key) {
  if (typeof key !== 'string' || !key.startsWith(SESSION_ROW_PREFIX)) return null
  const sessionId = key.slice(SESSION_ROW_PREFIX.length)
  return sessionId === '' ? null : sessionId
}

/** Keep only checked ids that still exist, are enabled and unique; never empty. */
export function normalizeSelection(selectedIds, library) {
  const enabled = enabledAnimations(library)
  const selected = []
  if (Array.isArray(selectedIds)) {
    for (const id of selectedIds) {
      if (typeof id === 'string' && !selected.includes(id) && enabled.some((animation) => animation.id === id)) {
        selected.push(id)
      }
    }
  }
  if (selected.length > 0) return selected
  return enabled.length > 0 ? [enabled[0].id] : []
}

/**
 * Toggle one checkbox. `blocked` carries the reason the UI must surface:
 * `single` (library has one animation), `last` (refuse to uncheck the last one),
 * `unknown` (id no longer in the library).
 */
export function selectionAfterToggle(selectedIds, id, library) {
  const enabled = enabledAnimations(library)
  const current = normalizeSelection(selectedIds, library)
  const target = enabled.find((animation) => animation.id === id)
  if (target === undefined) return { selected: current, blocked: true, reason: 'unknown' }
  if (!current.includes(id)) return { selected: [...current, id], blocked: false }
  if (enabled.length <= 1) return { selected: current, blocked: true, reason: 'single' }
  const next = current.filter((animationId) => animationId !== id)
  if (next.length === 0) return { selected: current, blocked: true, reason: 'last' }
  return { selected: next, blocked: false }
}

/**
 * Pick the animation for one running session, keeping an existing valid binding
 * stable across scroll/re-render. Returns null when nothing can be shown.
 */
export function bindAnimation(bindings, sessionId, selectedIds, random = Math.random) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const selected = Array.isArray(selectedIds) ? selectedIds : []
  const existing = bindings.get(sessionId)
  if (existing !== undefined && selected.includes(existing)) return existing
  if (selected.length === 0) {
    bindings.delete(sessionId)
    return null
  }
  const sample = Number(random())
  const clamped = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0
  const picked = selected[Math.floor(clamped * selected.length)]
  bindings.set(sessionId, picked)
  return picked
}

/** Parse a persisted selection; malformed values return null (caller falls back). */
export function parseSelection(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  return value.filter((entry) => typeof entry === 'string')
}

/** Serialize a selection, deduped, for localStorage. */
export function serializeSelection(selectedIds) {
  const unique = []
  for (const id of Array.isArray(selectedIds) ? selectedIds : []) {
    if (typeof id === 'string' && !unique.includes(id)) unique.push(id)
  }
  return JSON.stringify(unique)
}
