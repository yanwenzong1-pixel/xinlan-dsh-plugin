/**
 * Independent overlay for dsh-anime-desktop-pet.
 *
 * Renders one small GIF beside every RUNNING conversation row, without touching
 * DSH layout or sidebar source: a singleton fixed host in document.body, open
 * Shadow DOM, pointer-events:none for left-click pass-through, and a document
 * capture-phase contextmenu listener that only claims right-clicks inside a
 * visible animation bounding box.
 */
import {
  ANIMATIONS,
  ANIMATION_ARBITRATION_GAP,
  BANNER_DEFAULTS,
  BANNER_POSITION_KEY,
  BANNER_VISIBLE_KEY,
  FIXED_DEFAULTS,
  FIXED_PET,
  FIXED_POSITION_KEY,
  HOVER_DEFAULTS,
  OVERLAY_VISIBLE_KEY,
  SIDEBAR_ANIMATION_RADIUS_PX,
  STORAGE_KEY,
  TIRED_ANIMATION,
  animationUrl,
  bannerSize,
  bannerUrl,
  bindAnimation,
  characterLabel,
  clampBannerPosition,
  clampBannerWidth,
  clampFixedPosition,
  computeAnimationPlacements,
  defaultBannerPosition,
  defaultFixedPosition,
  fixedPetUrl,
  hasThreeView,
  normalizeSelection,
  parseBannerState,
  parseBannerVisible,
  parseFixedPosition,
  parseOverlayVisible,
  parseSelection,
  parseSessionRowKey,
  rectsOverlap,
  selectContextAnimation,
  selectionAfterToggle,
  serializeBannerState,
  serializeFixedPosition,
  serializeSelection,
  standardAnimationSize,
  threeViewUrl,
} from './core.mjs'

/** User-facing block messages shown inside the settings panel. */
export const SETTINGS_MESSAGES = {
  single: '动画库只有一个动画，无法取消勾选',
  last: '至少保留一个动画，不能取消最后一个',
  unknown: '该动画已不在动画库中',
}

/** User-facing copy for the three-view preview (kept in one place for future i18n). */
export const PREVIEW_MESSAGES = {
  actionLabel: (name) => `查看${name}三视图`,
  titleSuffix: '三视图',
  missing: '三视图暂未提供',
  close: '关闭三视图',
  copy: '复制图片',
  copySuccess: '图片已复制到剪贴板',
  copyFailed: '复制失败，请检查剪贴板权限后重试',
}

const DEFAULTS = { sizePx: 64, gapPx: 6, edgePx: 4, zIndex: 2147483045 }

const STYLE = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .pet { position: fixed; pointer-events: none; z-index: 2147483000; border-radius: ${SIDEBAR_ANIMATION_RADIUS_PX}px; overflow: hidden; }
  .pet[hidden] { display: none !important; }
  .pet img, .pet canvas { display: block; width: 100%; height: 100%; pointer-events: none; border-radius: inherit; }
  .pet [hidden] { display: none !important; }
  .menu, .settings {
    position: fixed; pointer-events: auto; z-index: 2147483001;
    box-sizing: border-box; color: #f2f4f7; background: #1c1f26;
    border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .menu { padding: 4px; min-width: 96px; }
  .menu button, .settings button {
    display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 6px;
    color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible, .settings button:hover, .settings button:focus-visible { background: rgba(255,255,255,.10); outline: none; }
  .settings { width: 248px; padding: 12px; }
  .settings h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
  .settings .role-row { display: flex; align-items: center; gap: 4px; }
  .settings .role-row label { flex: 1; }
  .settings label { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
  .settings label[data-locked] { cursor: default; color: #9aa2b1; }
  .settings input { accent-color: #4f8cff; pointer-events: auto; }
  .settings .preview-open {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; flex: 0 0 auto;
    color: #cfd6e4; background: transparent; border: 0; border-radius: 6px; cursor: pointer;
  }
  .settings .preview-open svg { width: 14px; height: 14px; display: block; }
  .settings .preview-open:hover, .settings .preview-open:focus-visible { background: rgba(255,255,255,.12); outline: none; }
  .settings .notice { min-height: 18px; margin: 6px 0 0; color: #ffb26b; }
  .settings .close { margin-top: 6px; text-align: right; }
  .settings .close button { display: inline-block; width: auto; padding: 3px 10px; background: rgba(255,255,255,.10); }
  .preview[hidden], .preview-menu[hidden], .preview [hidden] { display: none !important; }
  .preview {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55); pointer-events: auto;
  }
  .preview-dialog {
    position: relative; box-sizing: border-box;
    width: min(86vw, 980px); max-height: 86vh; display: flex; flex-direction: column;
    padding: 12px; color: #f2f4f7; background: #1c1f26; border: 1px solid rgba(255,255,255,.14);
    border-radius: 10px; box-shadow: 0 18px 48px rgba(0,0,0,.5);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .preview-title { margin: 0 28px 8px 0; font-size: 13px; font-weight: 600; }
  .preview-close {
    position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; padding: 0;
    color: inherit; background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1;
  }
  .preview-close:hover, .preview-close:focus-visible { background: rgba(255,255,255,.12); outline: none; }
  .preview-body { flex: 1; min-height: 120px; overflow: auto; display: flex; align-items: center; justify-content: center; }
  .preview-body img { display: block; max-width: 100%; max-height: 70vh; object-fit: contain; }
  .preview-missing { padding: 36px 16px; color: #9aa2b1; text-align: center; }
  .preview-status { min-height: 18px; margin: 6px 0 0; color: #7bd88f; }
  .fixed-pet {
    position: fixed; pointer-events: auto; z-index: 2147483000;
    cursor: grab; user-select: none; touch-action: none;
    /* No drop-shadow: for table-edge frames it painted a straight horizontal
       shadow band under the character, making the GIF look like a framed image. */
  }
  .fixed-pet:active { cursor: grabbing; }
  .desktop-banner {
    position: fixed; pointer-events: auto; z-index: 2147483000;
    cursor: grab; user-select: none; touch-action: none;
  }
  .desktop-banner:active { cursor: grabbing; }
  .desktop-banner[hidden] { display: none !important; }
  .desktop-banner img { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
  .banner-resize {
    position: absolute; right: 6px; bottom: 6px; width: 18px; height: 18px;
    border: 2px solid #fff; border-radius: 50%; background: #4f8cff;
    box-shadow: 0 2px 8px rgba(0,0,0,.35); cursor: nwse-resize; pointer-events: auto;
  }
  .settings .banner-row {
    margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.12);
  }
  .preview-menu {
    position: fixed; padding: 4px; min-width: 108px; pointer-events: auto;
    color: #f2f4f7; background: #1c1f26; border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .preview-menu button {
    display: block; width: 100%; padding: 6px 10px; color: inherit; background: transparent;
    border: 0; border-radius: 6px; font: inherit; text-align: left; cursor: pointer;
  }
  .preview-menu button:hover, .preview-menu button:focus-visible { background: rgba(255,255,255,.12); outline: none; }
`

/** localStorage without throwing (private mode / disabled storage). */
function safeStorage(window) {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Default three-view loader: one network request per preview open, reused for copying. */
async function defaultLoadThreeView(url) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`three-view asset missing: ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) throw new Error(`three-view asset is not an image: ${contentType}`)
  const blob = await response.blob()
  return { blob, objectUrl: URL.createObjectURL(blob) }
}

/** Default asset release for the object URL created by the loader. */
function defaultReleaseThreeView(objectUrl) {
  try {
    URL.revokeObjectURL(objectUrl)
  } catch {
    // Nothing to release (already revoked / unsupported).
  }
}

/** Canvas fallback: non-PNG three-view sources are re-encoded before clipboard.write. */
async function defaultToPngBlob(blob) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = () => resolve(undefined)
      image.onerror = () => reject(new Error('three-view decode failed'))
      image.src = objectUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, image.naturalWidth)
    canvas.height = Math.max(1, image.naturalHeight)
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('2d canvas unavailable')
    context.drawImage(image, 0, 0)
    const pngBlob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/png') })
    if (pngBlob === null) throw new Error('png encode failed')
    return pngBlob
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Mount the singleton overlay; returns the plugin-facing handle. */
export function mountOverlay(options = {}) {
  const document = options.document ?? globalThis.document
  const window = options.window ?? globalThis.window
  if (!document || !window) throw new Error('mountOverlay needs a document and a window')
  const animations = (Array.isArray(options.animations) ? options.animations : ANIMATIONS)
    .filter((animation) => animation && animation.enabled !== false)
  // ANIMATIONS now contains both selectable context variants; custom test libraries may omit tired.
  const animationLibrary = animations.some((animation) => animation.id === TIRED_ANIMATION.id)
    ? animations
    : [...animations, TIRED_ANIMATION]
  const storage = options.storage ?? safeStorage(window)
  const random = options.random ?? Math.random
  const size = Math.max(16, options.sizePx ?? DEFAULTS.sizePx)
  const gap = Math.max(0, options.gapPx ?? DEFAULTS.gapPx)
  const edge = Math.max(0, options.edgePx ?? DEFAULTS.edgePx)
  const zIndex = Math.max(1, options.zIndex ?? DEFAULTS.zIndex)
  const standardScale = options.standardScale ?? HOVER_DEFAULTS.scale
  const arbitrationGap = Math.max(0, options.arbitrationGapPx ?? ANIMATION_ARBITRATION_GAP)
  // Reduced motion: draw the GIF's first frame once onto a canvas (GIF cannot pause via CSS).
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  const fixedSize = Math.max(40, options.fixedSizePx ?? FIXED_DEFAULTS.sizePx)
  const fixedMargin = Math.max(0, options.fixedMarginPx ?? FIXED_DEFAULTS.marginPx)
  const bannerMargin = Math.max(0, options.bannerMarginPx ?? BANNER_DEFAULTS.marginPx)
  let bannerState = null
  let bannerDrag = null
  let bannerVisible = parseBannerVisible(storage?.getItem?.(BANNER_VISIBLE_KEY) ?? null)
  let running = new Map() // sessionId -> SessionSummary | null (only running sessions)
  const loadThreeView = options.loadThreeView ?? defaultLoadThreeView
  const releaseThreeView = options.releaseThreeView ?? defaultReleaseThreeView
  const toPngBlob = options.toPngBlob ?? defaultToPngBlob
  const clipboard = options.clipboard ?? window.navigator?.clipboard ?? null
  const ClipboardItemCtor = options.ClipboardItemCtor ?? window.ClipboardItem ?? globalThis.ClipboardItem ?? null
  let previewState = null // { animation, trigger, blob, objectUrl } while the modal is open
  let savedOverflow = null
  let fixedPosition = null
  let fixedDrag = null
  // Global show/hide is a long-lived user preference, not a per-page toggle.
  let uiHidden = !parseOverlayVisible(storage?.getItem?.(OVERLAY_VISIBLE_KEY) ?? null)

  let selection = normalizeSelection(
    parseSelection(storage?.getItem?.(STORAGE_KEY) ?? null),
    animations,
  )
  let destroyed = false
  let frame = null
  let boxes = []
  const nodes = new Map() // sessionId -> { el, img, animationId }
  const bindings = new Map() // sessionId -> animationId

  const host = document.createElement('div')
  host.setAttribute('data-xllh-pet-host', '')
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.pointerEvents = 'none'
  host.style.zIndex = String(zIndex)
  host.style.display = uiHidden ? 'none' : ''
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE
  shadow.append(style)
  const layer = document.createElement('div')
  layer.className = 'layer'
  layer.style.pointerEvents = 'none'
  shadow.append(layer)

  // Fixed desktop live banner: independent transparent image, draggable and scalable.
  const bannerWrap = document.createElement('div')
  bannerWrap.className = 'desktop-banner'
  bannerWrap.setAttribute('data-xllh-banner', '')
  bannerWrap.setAttribute('role', 'img')
  bannerWrap.setAttribute('aria-label', '蓝色大肥鱼！编程！启动~')
  bannerWrap.style.position = 'fixed'
  bannerWrap.style.pointerEvents = 'auto'
  bannerWrap.style.zIndex = String(zIndex)
  const bannerImg = document.createElement('img')
  bannerImg.setAttribute('data-xllh-banner-image', '')
  bannerImg.alt = ''
  bannerImg.draggable = false
  bannerImg.src = bannerUrl()
  const bannerResize = document.createElement('span')
  bannerResize.className = 'banner-resize'
  bannerResize.setAttribute('data-xllh-banner-resize', '')
  bannerResize.setAttribute('aria-hidden', 'true')
  bannerResize.title = '拖动调整横幅大小'
  bannerWrap.append(bannerImg, bannerResize)
  shadow.append(bannerWrap)

  // Fixed desktop character: independent of running sessions, draggable, persisted.
  const fixedPet = document.createElement('img')
  fixedPet.className = 'fixed-pet'
  fixedPet.setAttribute('data-xllh-pet-fixed', '')
  fixedPet.setAttribute('role', 'img')
  fixedPet.setAttribute('aria-label', `${FIXED_PET.name}桌宠`)
  fixedPet.draggable = false
  fixedPet.src = fixedPetUrl()
  fixedPet.style.position = 'fixed'
  fixedPet.style.pointerEvents = 'auto'
  fixedPet.style.width = `${fixedSize}px`
  fixedPet.style.height = `${fixedSize}px`
  fixedPet.style.zIndex = String(zIndex)
  shadow.append(fixedPet)

  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.setAttribute('data-xllh-pet-menu', '')
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  menu.style.pointerEvents = 'auto'
  menu.style.zIndex = String(zIndex + 1)
  const settingsButton = document.createElement('button')
  settingsButton.type = 'button'
  settingsButton.setAttribute('role', 'menuitem')
  settingsButton.textContent = '设置'
  settingsButton.addEventListener('click', () => {
    hideMenu()
    openSettings()
  })
  menu.append(settingsButton)
  shadow.append(menu)

  const settings = document.createElement('div')
  settings.className = 'settings'
  settings.setAttribute('data-xllh-pet-settings', '')
  settings.setAttribute('role', 'dialog')
  settings.setAttribute('aria-label', '动画设置')
  settings.hidden = true
  settings.style.pointerEvents = 'auto'
  settings.style.zIndex = String(zIndex + 1)
  // Center on the whole desktop without inventing a backdrop/mask.
  settings.style.left = '50%'
  settings.style.top = '50%'
  settings.style.transform = 'translate(-50%, -50%)'
  shadow.append(settings)

  // Singleton three-view preview modal (backdrop + centered dialog, no layout impact).
  const previewRoot = document.createElement('div')
  previewRoot.className = 'preview'
  previewRoot.setAttribute('data-xllh-pet-preview', '')
  previewRoot.hidden = true
  previewRoot.style.zIndex = String(zIndex + 3)
  previewRoot.style.pointerEvents = 'auto'
  const previewDialog = document.createElement('div')
  previewDialog.className = 'preview-dialog'
  previewDialog.setAttribute('data-xllh-pet-preview-dialog', '')
  previewDialog.setAttribute('role', 'dialog')
  previewDialog.setAttribute('aria-modal', 'true')
  const previewTitle = document.createElement('h2')
  previewTitle.className = 'preview-title'
  previewTitle.setAttribute('data-xllh-pet-preview-title', '')
  const previewClose = document.createElement('button')
  previewClose.type = 'button'
  previewClose.className = 'preview-close'
  previewClose.setAttribute('data-xllh-pet-preview-close', '')
  previewClose.setAttribute('aria-label', PREVIEW_MESSAGES.close)
  previewClose.textContent = '×'
  const previewBody = document.createElement('div')
  previewBody.className = 'preview-body'
  const previewImage = document.createElement('img')
  previewImage.setAttribute('data-xllh-pet-preview-image', '')
  previewImage.alt = ''
  previewImage.hidden = true
  const previewMissing = document.createElement('div')
  previewMissing.className = 'preview-missing'
  previewMissing.setAttribute('data-xllh-pet-preview-missing', '')
  previewMissing.textContent = PREVIEW_MESSAGES.missing
  previewMissing.hidden = true
  previewBody.append(previewImage, previewMissing)
  const previewStatus = document.createElement('p')
  previewStatus.className = 'preview-status'
  previewStatus.setAttribute('role', 'status')
  previewStatus.setAttribute('aria-live', 'polite')
  previewDialog.append(previewTitle, previewClose, previewBody, previewStatus)
  previewRoot.append(previewDialog)
  shadow.append(previewRoot)

  // Lightweight context menu for the preview image; the preview itself stays open.
  const previewMenu = document.createElement('div')
  previewMenu.className = 'preview-menu'
  previewMenu.setAttribute('data-xllh-pet-preview-menu', '')
  previewMenu.setAttribute('role', 'menu')
  previewMenu.hidden = true
  previewMenu.style.zIndex = String(zIndex + 4)
  previewMenu.style.pointerEvents = 'auto'
  const previewCopyButton = document.createElement('button')
  previewCopyButton.type = 'button'
  previewCopyButton.setAttribute('role', 'menuitem')
  previewCopyButton.setAttribute('data-xllh-pet-preview-copy', '')
  previewCopyButton.textContent = PREVIEW_MESSAGES.copy
  previewMenu.append(previewCopyButton)
  shadow.append(previewMenu)

  document.body.append(host)
  persist()
  applyStoredFixedPosition()
  applyStoredBannerState()

  function persist() {
    try {
      storage?.setItem?.(STORAGE_KEY, serializeSelection(selection))
    } catch {
      // Storage is a convenience; a refused write must not break the overlay.
    }
  }

  function viewportSize() {
    return { width: window.innerWidth, height: window.innerHeight }
  }

  function applyFixedPosition() {
    if (fixedPosition === null) return
    fixedPet.style.left = `${fixedPosition.x}px`
    fixedPet.style.top = `${fixedPosition.y}px`
  }

  function persistFixedPosition() {
    if (fixedPosition === null) return
    try {
      storage?.setItem?.(FIXED_POSITION_KEY, serializeFixedPosition(fixedPosition))
    } catch {
      // Position persistence is best effort.
    }
  }

  function applyStoredFixedPosition() {
    const stored = parseFixedPosition(storage?.getItem?.(FIXED_POSITION_KEY) ?? null)
    const fallback = defaultFixedPosition(viewportSize(), fixedSize, fixedMargin) ?? { x: fixedMargin, y: fixedMargin }
    fixedPosition = clampFixedPosition(stored ?? fallback, viewportSize(), fixedSize, fixedMargin) ?? fallback
    applyFixedPosition()
  }

  function clampFixedPositionNow() {
    if (fixedPosition === null) return
    const next = clampFixedPosition(fixedPosition, viewportSize(), fixedSize, fixedMargin)
    if (next !== null) {
      fixedPosition = next
      applyFixedPosition()
    }
  }

  function applyBannerState() {
    if (bannerState === null) return
    const size = bannerSize(bannerState.width)
    bannerWrap.style.width = `${size.width}px`
    bannerWrap.style.height = `${size.height}px`
    bannerWrap.style.left = `${bannerState.x}px`
    bannerWrap.style.top = `${bannerState.y}px`
    bannerWrap.hidden = !bannerVisible
  }

  function persistBannerState() {
    if (bannerState === null) return
    try {
      storage?.setItem?.(BANNER_POSITION_KEY, serializeBannerState(bannerState))
    } catch {
      // Banner state persistence is best effort.
    }
  }

  function applyStoredBannerState() {
    const stored = parseBannerState(storage?.getItem?.(BANNER_POSITION_KEY) ?? null)
    const width = clampBannerWidth(stored?.width ?? BANNER_DEFAULTS.widthPx)
    const fallback = defaultBannerPosition(viewportSize(), width, bannerMargin) ?? { x: bannerMargin, y: bannerMargin }
    const position = clampBannerPosition(stored ?? fallback, viewportSize(), width, bannerMargin) ?? fallback
    bannerState = { x: position.x, y: position.y, width }
    applyBannerState()
  }

  function clampBannerNow() {
    if (bannerState === null) return
    const position = clampBannerPosition(bannerState, viewportSize(), bannerState.width, bannerMargin)
    if (position === null) return
    bannerState = { ...position, width: bannerState.width }
    applyBannerState()
  }

  function setBannerVisible(visible) {
    bannerVisible = Boolean(visible)
    try {
      storage?.setItem?.(BANNER_VISIBLE_KEY, String(bannerVisible))
    } catch {
      // Visibility persistence is best effort.
    }
    if (bannerVisible && bannerState === null) applyStoredBannerState()
    applyBannerState()
  }

  function onBannerPointerDown(event) {
    if (destroyed || uiHidden || event.button !== 0 || bannerState === null) return
    const resize = event.target === bannerResize
      || (typeof event.target?.closest === 'function' && event.target.closest('[data-xllh-banner-resize]') !== null)
    bannerDrag = {
      mode: resize ? 'resize' : 'move',
      startX: event.clientX,
      startY: event.clientY,
      originX: bannerState.x,
      originY: bannerState.y,
      originWidth: bannerState.width,
      moved: false,
    }
    bannerWrap.setPointerCapture?.(event.pointerId)
    document.addEventListener('pointermove', onBannerPointerMove, true)
    document.addEventListener('pointerup', onBannerPointerUp, true)
    event.preventDefault()
  }

  function onBannerPointerMove(event) {
    if (bannerDrag === null) return
    const dx = event.clientX - bannerDrag.startX
    const dy = event.clientY - bannerDrag.startY
    if (!bannerDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) bannerDrag.moved = true
    if (bannerDrag.mode === 'resize') {
      const width = clampBannerWidth(bannerDrag.originWidth + dx)
      const position = clampBannerPosition(
        { x: bannerDrag.originX, y: bannerDrag.originY },
        viewportSize(),
        width,
        bannerMargin,
      )
      if (position === null) return
      bannerState = { x: position.x, y: position.y, width }
    } else {
      const position = clampBannerPosition(
        { x: bannerDrag.originX + dx, y: bannerDrag.originY + dy },
        viewportSize(),
        bannerState.width,
        bannerMargin,
      )
      if (position === null) return
      bannerState = { ...position, width: bannerState.width }
    }
    applyBannerState()
  }

  function onBannerPointerUp() {
    if (bannerDrag === null) return
    document.removeEventListener('pointermove', onBannerPointerMove, true)
    document.removeEventListener('pointerup', onBannerPointerUp, true)
    if (bannerDrag.moved) persistBannerState()
    bannerDrag = null
  }

  function onFixedPointerDown(event) {
    if (destroyed || uiHidden || event.button !== 0 || fixedPosition === null) return
    fixedDrag = {
      startX: event.clientX,
      startY: event.clientY,
      originX: fixedPosition.x,
      originY: fixedPosition.y,
      moved: false,
    }
    fixedPet.setPointerCapture?.(event.pointerId)
    document.addEventListener('pointermove', onFixedPointerMove, true)
    document.addEventListener('pointerup', onFixedPointerUp, true)
    event.preventDefault()
  }

  function onFixedPointerMove(event) {
    if (fixedDrag === null) return
    const dx = event.clientX - fixedDrag.startX
    const dy = event.clientY - fixedDrag.startY
    if (!fixedDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) fixedDrag.moved = true
    const next = clampFixedPosition(
      { x: fixedDrag.originX + dx, y: fixedDrag.originY + dy },
      viewportSize(),
      fixedSize,
      fixedMargin,
    )
    if (next === null) return
    fixedPosition = next
    applyFixedPosition()
    schedule()
  }

  function onFixedPointerUp() {
    if (fixedDrag === null) return
    document.removeEventListener('pointermove', onFixedPointerMove, true)
    document.removeEventListener('pointerup', onFixedPointerUp, true)
    if (fixedDrag.moved) persistFixedPosition()
    fixedDrag = null
    schedule()
  }

  function onFixedContextMenu(event) {
    if (destroyed || uiHidden) return
    event.preventDefault()
    event.stopPropagation()
    openMenu(event.clientX, event.clientY)
  }

  function toggleVisibility() {
    uiHidden = !uiHidden
    host.style.display = uiHidden ? 'none' : ''
    try {
      storage?.setItem?.(OVERLAY_VISIBLE_KEY, String(!uiHidden))
    } catch {
      // Visibility persistence is best effort; the in-memory toggle still works.
    }
    if (uiHidden) {
      hideMenu()
      hideSettings()
      closePreview()
      hidePreviewMenu()
      onFixedPointerUp()
    } else {
      schedule()
    }
  }

  function animationById(id) {
    return animationLibrary.find((animation) => animation.id === id)
  }

  function showAnimation(node, animationId) {
    const animation = animationById(animationId)
    if (animation === undefined) {
      node.el.hidden = true
      return
    }
    if (node.animationId !== animationId) {
      node.animationId = animationId
      node.img.hidden = false
      node.canvas.hidden = true
      node.img.src = animationUrl(animation)
      node.img.alt = animation.name
      node.img.dataset.animationId = animationId
      renderStillFrame(node)
    }
  }

  /** Static first frame for prefers-reduced-motion: canvas holds one decode, no loop. */
  function renderStillFrame(node) {
    if (!reduceMotion || node.img.complete !== true || node.img.naturalWidth === 0) return
    try {
      node.canvas.width = node.img.naturalWidth
      node.canvas.height = node.img.naturalHeight
      const context = node.canvas.getContext('2d')
      if (context === null) return
      context.drawImage(node.img, 0, 0)
      node.img.hidden = true
      node.canvas.hidden = false
    } catch {
      // Keep the GIF fallback if this browser refuses canvas drawing.
    }
  }

  function ensureNode(id, kind) {
    const existing = nodes.get(id)
    if (existing !== undefined) return existing
    const el = document.createElement('div')
    el.className = 'pet'
    el.setAttribute('aria-hidden', 'true')
    if (kind === 'workspace') {
      el.setAttribute('data-xllh-workspace-animation', '')
      el.setAttribute('data-workspace-id', id)
    } else {
      el.setAttribute('data-xllh-pet', '')
      el.setAttribute('data-session-id', id)
    }
    el.style.position = 'fixed'
    el.style.pointerEvents = 'none'
    el.style.zIndex = String(zIndex)
    // Inline rounding mirrors the stylesheet so a stale/partial stylesheet can
    // never leave one animation with square corners.
    el.style.borderRadius = `${SIDEBAR_ANIMATION_RADIUS_PX}px`
    el.style.overflow = 'hidden'
    el.style.clipPath = `inset(0 round ${SIDEBAR_ANIMATION_RADIUS_PX}px)`
    const img = document.createElement('img')
    img.src = ''
    img.alt = ''
    img.draggable = false
    img.style.pointerEvents = 'none'
    img.style.borderRadius = 'inherit'
    const canvas = document.createElement('canvas')
    canvas.hidden = true
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.pointerEvents = 'none'
    canvas.style.borderRadius = 'inherit'
    el.append(img, canvas)
    layer.append(el)
    const node = { el, img, canvas, animationId: null }
    img.addEventListener('load', () => renderStillFrame(node))
    nodes.set(id, node)
    return node
  }

  /** Accept legacy Map<id,true> and the richer Map<id,SessionSummary>; true alone = no metadata. */
  function runningEntries(runningBySession) {
    const map = new Map()
    if (runningBySession instanceof Map) {
      for (const [id, value] of runningBySession) {
        if (value) map.set(String(id), value && typeof value === 'object' ? value : null)
      }
    } else if (runningBySession && typeof runningBySession === 'object') {
      for (const [id, value] of Object.entries(runningBySession)) {
        if (value) map.set(id, value && typeof value === 'object' ? value : null)
      }
    }
    return map
  }

  function update(runningBySession) {
    if (destroyed) return
    running = runningEntries(runningBySession)
    schedule()
  }

  function rowVisible(rect) {
    return rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0
      && rect.left < window.innerWidth && rect.top < window.innerHeight
  }

  /** Basename of a session cwd; used to map hidden (collapsed-workspace) sessions. */
  function cwdBasename(meta) {
    if (meta === null || typeof meta !== 'object' || typeof meta.cwd !== 'string') return ''
    const parts = meta.cwd.split(/[\\/]/).filter((part) => part !== '')
    return parts.length === 0 ? '' : parts[parts.length - 1]
  }

  function median(values) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  function render() {
    frame = null
    if (destroyed) return
    const rows = []
    const sessionRowIds = new Set()
    const sessionHeights = []
    const workspaceHeights = []
    const workRows = []
    for (const row of document.querySelectorAll('[data-row-key]')) {
      const key = row.getAttribute('data-row-key') ?? ''
      const rect = row.getBoundingClientRect()
      if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) continue
      const sessionId = parseSessionRowKey(key)
      if (sessionId !== null) {
        if (rect.height > 0) sessionHeights.push(rect.height)
        sessionRowIds.add(sessionId)
        if (running.has(sessionId) && rowVisible(rect)) {
          const meta = running.get(sessionId)
          rows.push({
            id: sessionId,
            kind: 'conversation',
            running: true,
            anchorRect: rect,
            contextPercent: Number.isFinite(meta?.contextPercent) ? meta.contextPercent : null,
          })
        }
        continue
      }
      if (key.startsWith('workspace:')) {
        if (rect.height > 0) workspaceHeights.push(rect.height)
        workRows.push({ key, row, rect, collapsed: row.getAttribute('aria-expanded') === 'false' })
      }
    }

    // Collapsed workspace: one workspace-level animation for any running session
    // whose cwd basename matches the workspace header (expanded workspaces keep
    // their session rows and therefore never produce a workspace candidate).
    const hiddenRunning = [...running.keys()].filter((id) => !sessionRowIds.has(id))
    for (const workspace of workRows) {
      if (!workspace.collapsed) continue
      const name = (workspace.row.textContent ?? '').trim()
      if (name === '') continue
      const matched = hiddenRunning.filter((id) => cwdBasename(running.get(id)) === name)
      if (matched.length === 0 || !rowVisible(workspace.rect)) continue
      const percents = matched
        .map((id) => running.get(id)?.contextPercent)
        .filter((percent) => Number.isFinite(percent))
      rows.push({
        id: workspace.key,
        kind: 'workspace',
        running: true,
        anchorRect: workspace.rect,
        contextPercent: percents.length === 0 ? null : Math.max(...percents),
      })
    }

    const basePx = median(sessionHeights) || median(workspaceHeights) || size
    const animationSize = Math.max(1, Math.round(options.standardSizePx ?? standardAnimationSize(basePx, standardScale)))
    let benchmarkRect = null
    const fixedRect = fixedPet.getBoundingClientRect()
    if (rowVisible(fixedRect)) {
      benchmarkRect = { left: fixedRect.left, top: fixedRect.top, right: fixedRect.right, bottom: fixedRect.bottom }
    }
    const result = computeAnimationPlacements({
      candidates: rows,
      size: animationSize,
      gap: arbitrationGap,
      benchmarkRect,
    })
    const placements = [...result.placements]
    // Product rule: three or more running conversations should still show two
    // animations, both flush against the sidebar column. If strict geometry left
    // only one, stack the first hidden candidate in the same column (never in a
    // detached second column) so it can visually connect to the left rail.
    if (running.size >= 3 && placements.length === 1 && rows.length >= 2) {
      const placed = placements[0]
      const hidden = rows.find((candidate) => !result.visibleIds.includes(candidate.id))
      if (hidden !== undefined) {
        const left = placed.rect.left
        const naturalTop = hidden.anchorRect.top + (hidden.anchorRect.height - animationSize) / 2
        const overlapsPlaced = (top) => {
          const probe = { left, top, right: left + animationSize, bottom: top + animationSize }
          return rectsOverlap(probe, placed.rect, arbitrationGap)
        }
        let top = naturalTop
        if (overlapsPlaced(top)) {
          const below = placed.rect.bottom + arbitrationGap
          const above = placed.rect.top - arbitrationGap - animationSize
          if (below + animationSize <= window.innerHeight) top = below
          else if (above >= 0) top = above
          else top = null
        }
        if (top !== null) {
          const rect = { left, top, width: animationSize, height: animationSize, right: left + animationSize, bottom: top + animationSize }
          const fits = left >= 0 && top >= 0 && left + animationSize <= window.innerWidth && top + animationSize <= window.innerHeight
          const overlapsBenchmark = benchmarkRect !== null && rectsOverlap(rect, benchmarkRect, arbitrationGap)
          if (fits && !overlapsBenchmark) placements.push({ id: hidden.id, kind: hidden.kind, rect })
        }
      }
    }
    try {
      window.__DSH_ANIME_PET_DEBUG__ = {
        runningIds: [...running.keys()],
        candidates: rows.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          top: Math.round(candidate.anchorRect.top),
          height: Math.round(candidate.anchorRect.height),
          contextPercent: candidate.contextPercent,
        })),
        placements: placements.map((placement) => placement.id),
        animationSize,
      }
    } catch {
      // Diagnostics only; never break rendering because of a read-only window.
    }
    const visible = new Set(placements.map((placement) => placement.id))
    for (const [id, node] of nodes) {
      if (visible.has(id)) continue
      node.el.remove()
      nodes.delete(id)
      bindings.delete(id)
    }
    const candidatesById = new Map(rows.map((candidate) => [candidate.id, candidate]))
    boxes = []
    for (const placement of placements) {
      const node = ensureNode(placement.id, placement.kind)
      const contextPercent = candidatesById.get(placement.id)?.contextPercent ?? null
      const contextAnimationId = selectContextAnimation(selection, contextPercent)
      const animationId = contextAnimationId ?? bindAnimation(bindings, placement.id, selection, random)
      showAnimation(node, animationId)
      const rect = placement.rect
      node.el.style.width = `${animationSize}px`
      node.el.style.height = `${animationSize}px`
      node.el.style.left = `${Math.round(rect.left)}px`
      node.el.style.top = `${Math.round(rect.top)}px`
      boxes.push({
        id: placement.id,
        kind: placement.kind,
        sessionId: placement.kind === 'conversation' ? placement.id : null,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        visible: true,
      })
    }
    clampFixedPositionNow()
    clampBannerNow()
  }

  function schedule() {
    if (destroyed || frame !== null) return
    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(render)
    } else {
      frame = window.setTimeout(render, 16)
    }
  }

  function cancelFrame() {
    if (frame === null) return
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame)
    else window.clearTimeout(frame)
    frame = null
  }

  function hideMenu() {
    menu.hidden = true
  }

  function openMenu(clientX, clientY) {
    menu.hidden = false
    menu.style.left = `${Math.round(Math.min(clientX, window.innerWidth - 140))}px`
    menu.style.top = `${Math.round(Math.min(clientY, window.innerHeight - 60))}px`
    settingsButton.focus()
  }

  function renderSettings() {
    settings.replaceChildren()
    const title = document.createElement('h2')
    title.textContent = '动画设置'
    settings.append(title)
    for (const animation of animations) {
      const row = document.createElement('div')
      row.className = 'role-row'
      row.setAttribute('data-xllh-pet-role', animation.id)
      const label = document.createElement('label')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = selection.includes(animation.id)
      // 动画库只有一个动画时锁定，防止出现空勾选集合。
      if (animations.length <= 1) {
        checkbox.disabled = true
        label.setAttribute('data-locked', '')
      }
      checkbox.addEventListener('change', () => toggleSelection(animation.id, checkbox.checked))
      const name = document.createElement('span')
      name.textContent = animation.name
      label.append(checkbox, name)
      row.append(label)
      if (hasThreeView(animation)) {
        const viewButton = document.createElement('button')
        viewButton.type = 'button'
        viewButton.className = 'preview-open'
        viewButton.setAttribute('data-xllh-pet-preview-open', animation.id)
        viewButton.setAttribute('aria-label', PREVIEW_MESSAGES.actionLabel(characterLabel(animation)))
        viewButton.title = PREVIEW_MESSAGES.actionLabel(characterLabel(animation))
        viewButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="1.5" y="3" width="13" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="6.8" r="1.1" fill="currentColor"/><path d="M3.2 12l3.1-3.2 2.2 2.1 2-1.7 2.3 2.8" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>'
        viewButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          openPreview(animation, viewButton)
        })
        row.append(viewButton)
      }
      settings.append(row)
    }
    const bannerRow = document.createElement('label')
    bannerRow.className = 'banner-row'
    const bannerToggle = document.createElement('input')
    bannerToggle.type = 'checkbox'
    bannerToggle.setAttribute('data-xllh-banner-toggle', '')
    bannerToggle.checked = bannerVisible
    bannerToggle.addEventListener('change', () => setBannerVisible(bannerToggle.checked))
    const bannerLabel = document.createElement('span')
    bannerLabel.textContent = '展示桌面横幅'
    bannerRow.append(bannerToggle, bannerLabel)
    settings.append(bannerRow)
    const notice = document.createElement('p')
    notice.className = 'notice'
    notice.setAttribute('role', 'status')
    notice.setAttribute('aria-live', 'polite')
    settings.append(notice)
    const close = document.createElement('div')
    close.className = 'close'
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.textContent = '关闭'
    closeButton.addEventListener('click', () => hideSettings())
    close.append(closeButton)
    settings.append(close)
  }

  function setNotice(message) {
    const notice = settings.querySelector('[role="status"]')
    if (notice !== null) notice.textContent = message
  }

  function toggleSelection(id, checked) {
    const current = selection
    const result = selectionAfterToggle(current, id, animations)
    if (result.blocked) {
      setNotice(SETTINGS_MESSAGES[result.reason] ?? '')
      renderSettings()
      setNotice(SETTINGS_MESSAGES[result.reason] ?? '')
      return
    }
    applySelection(result.selected)
    renderSettings()
    setNotice('')
  }

  function applySelection(ids) {
    selection = normalizeSelection(ids, animations)
    persist()
    schedule()
  }

  function openSettings() {
    hideMenu()
    renderSettings()
    settings.hidden = false
    const first = settings.querySelector('input')
    first?.focus()
  }

  function hideSettings() {
    settings.hidden = true
  }

  function showPreviewMissing() {
    previewImage.hidden = true
    previewImage.removeAttribute('src')
    previewMissing.hidden = false
  }

  /** Open the singleton three-view modal for one character (no backdrop-free conflict). */
  function openPreview(animation, trigger) {
    if (previewState !== null) return
    const state = { animation, trigger, blob: null, objectUrl: null }
    previewState = state
    const character = characterLabel(animation)
    previewTitle.textContent = `${character} · ${PREVIEW_MESSAGES.titleSuffix}`
    previewDialog.setAttribute('aria-label', `${character} ${PREVIEW_MESSAGES.titleSuffix}`)
    previewImage.alt = `${character} ${PREVIEW_MESSAGES.titleSuffix}`
    previewImage.hidden = true
    previewImage.removeAttribute('src')
    previewMissing.hidden = true
    previewStatus.textContent = ''
    savedOverflow = {
      documentElement: document.documentElement.style.overflow,
      body: document.body.style.overflow,
    }
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    previewRoot.hidden = false
    previewClose.focus()
    const url = threeViewUrl(animation)
    if (url === null) {
      previewMissing.hidden = false
      return
    }
    loadThreeView(url).then((asset) => {
      if (previewState !== state) {
        // Closed while loading: release the late asset immediately.
        try {
          releaseThreeView(asset.objectUrl)
        } catch {
          // Resource release is best effort.
        }
        return
      }
      state.blob = asset.blob
      state.objectUrl = asset.objectUrl
      previewImage.src = asset.objectUrl
      previewImage.hidden = false
      previewMissing.hidden = true
    }).catch(() => {
      if (previewState !== state) return
      showPreviewMissing()
    })
  }

  function closePreview() {
    if (previewState === null) return
    const state = previewState
    previewState = null
    hidePreviewMenu()
    previewRoot.hidden = true
    previewImage.hidden = true
    previewImage.removeAttribute('src')
    previewMissing.hidden = true
    previewStatus.textContent = ''
    if (state.objectUrl !== null) releaseThreeView(state.objectUrl)
    if (savedOverflow !== null) {
      document.documentElement.style.overflow = savedOverflow.documentElement
      document.body.style.overflow = savedOverflow.body
      savedOverflow = null
    }
    state.trigger?.focus?.()
  }

  function previewFocusables() {
    const selector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    return [...previewDialog.querySelectorAll(selector)].filter((element) => !element.hidden)
  }

  /** Keep keyboard focus inside the modal while it is open. */
  function trapPreviewTab(event) {
    const focusables = previewFocusables()
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = shadow.activeElement ?? document.activeElement
    if (event.shiftKey) {
      if (active === first || !previewDialog.contains(active)) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last || !previewDialog.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  previewClose.addEventListener('click', () => closePreview())
  previewRoot.addEventListener('click', (event) => {
    if (event.target === previewRoot) closePreview()
  })
  previewImage.addEventListener('contextmenu', (event) => {
    if (previewState === null) return
    event.preventDefault()
    event.stopPropagation()
    openPreviewMenu(event.clientX, event.clientY)
  })
  previewImage.addEventListener('error', () => {
    if (previewState !== null) showPreviewMissing()
  })
  previewCopyButton.addEventListener('click', () => {
    hidePreviewMenu()
    void copyPreviewImage()
  })
  fixedPet.addEventListener('pointerdown', onFixedPointerDown)
  fixedPet.addEventListener('contextmenu', onFixedContextMenu)
  bannerWrap.addEventListener('pointerdown', onBannerPointerDown)

  function setPreviewStatus(text) {
    previewStatus.textContent = text ?? ''
  }

  function hidePreviewMenu() {
    previewMenu.hidden = true
  }

  function openPreviewMenu(clientX, clientY) {
    previewMenu.hidden = false
    previewMenu.style.left = `${Math.round(Math.min(clientX, window.innerWidth - 150))}px`
    previewMenu.style.top = `${Math.round(Math.min(clientY, window.innerHeight - 80))}px`
    previewCopyButton.focus()
  }

  /** Copy the ALREADY LOADED three-view blob (no second network request). */
  async function copyPreviewImage() {
    const state = previewState
    if (state === null || state.blob === null) {
      if (state !== null) setPreviewStatus(PREVIEW_MESSAGES.copyFailed)
      return
    }
    if (state.copying === true) return
    state.copying = true
    try {
      const pngBlob = state.blob.type === 'image/png' ? state.blob : await toPngBlob(state.blob)
      if (previewState !== state) return
      if (clipboard === null || typeof clipboard.write !== 'function' || ClipboardItemCtor === null) {
        throw new Error('clipboard unavailable')
      }
      await clipboard.write([new ClipboardItemCtor({ 'image/png': pngBlob })])
      if (previewState === state) setPreviewStatus(PREVIEW_MESSAGES.copySuccess)
    } catch {
      if (previewState === state) setPreviewStatus(PREVIEW_MESSAGES.copyFailed)
    } finally {
      if (previewState === state) state.copying = false
    }
  }

  function onPointerDown(event) {
    if (destroyed) return
    const path = event.composedPath?.() ?? []
    if (!previewMenu.hidden && !path.includes(previewMenu)) hidePreviewMenu()
    if (path.includes(host)) return
    hideMenu()
    if (!settings.hidden) hideSettings()
  }

  function onKeyDown(event) {
    if (destroyed) return
    if (event.ctrlKey && event.shiftKey && (event.key === 'F12' || event.code === 'F12')) {
      event.preventDefault()
      toggleVisibility()
      return
    }
    if (previewState !== null) {
      if (event.key === 'Escape') {
        event.preventDefault?.()
        if (!previewMenu.hidden) hidePreviewMenu()
        else closePreview()
        return
      }
      if (event.key === 'Tab' && previewMenu.hidden) {
        trapPreviewTab(event)
        return
      }
      return
    }
    if (event.key !== 'Escape') return
    if (!menu.hidden) hideMenu()
    if (!settings.hidden) hideSettings()
  }

  function onViewportChange() {
    schedule()
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', onViewportChange, true)
  window.addEventListener('scroll', onViewportChange, true)
  const observer = typeof window.MutationObserver === 'function'
    ? new window.MutationObserver(onViewportChange)
    : null
  observer?.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-row-key', 'style', 'class', 'aria-expanded'],
  })
  let resizeObserver = null
  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(onViewportChange)
    resizeObserver.observe(document.body)
  }

  return {
    update,
    openSettings,
    dispose() {
      if (destroyed) return
      destroyed = true
      cancelFrame()
      closePreview()
      hidePreviewMenu()
      onFixedPointerUp()
      onBannerPointerUp()
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange, true)
      window.removeEventListener('scroll', onViewportChange, true)
      observer?.disconnect()
      resizeObserver?.disconnect()
      for (const node of nodes.values()) node.el.remove()
      nodes.clear()
      bindings.clear()
      boxes = []
      host.remove()
    },
  }
}
