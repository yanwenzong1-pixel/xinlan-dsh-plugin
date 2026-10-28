/**
 * Material-driven live-room scene renderer.
 *
 * The scene is a fixed full-viewport, overflow-hidden stage. Every visible
 * element comes from a sliced transparent asset and is positioned by
 * assets/slices/layout.json (normalized anchors + min-viewport scale). This
 * module only maps layout data to DOM/CSS and owns interaction/cleanup; all
 * decisions that are worth testing live in scene-core.mjs.
 */

import {
  OVERLAY_VISIBLE_KEY,
  parseOverlayVisible,
} from './core.mjs'
import {
  SCENE_POSITIONS_KEY,
  createSceneStateMachine,
  createSeededRandom,
  parseScenePositions,
  resolveSceneElement,
  sceneBreakpoint,
  serializeScenePositions,
  shouldPauseScene,
  staggerDelay,
  validateSceneLayout,
  validateSceneManifest,
} from './scene-core.mjs'

/** Prefix route for scene manifest/layout/@1x/@2x assets. */
export const SCENE_BASE_PATH = '/@dsh-external/dsh-anime-desktop-pet/assets/scene/'
export const SCENE_DEFAULTS = {
  basePath: SCENE_BASE_PATH,
  zIndex: 2147483046,
  seed: 20261026,
  bubbleIntervalMs: 1200,
  bubbleCap: 8,
  sleepAfterMs: 30000,
}

/** @param {string} file root-relative manifest file path */
export function sceneAssetRelative(file) {
  return String(file ?? '').replace(/^assets\/slices\//, '')
}

/** Pick @1x for standard screens, @2x for HiDPI; capped at 2x. */
export function sceneAssetUrl(basePath, slice, devicePixelRatio = 1) {
  const file = Number(devicePixelRatio) >= 2 ? slice.file : slice.file1x
  return `${basePath}${sceneAssetRelative(file)}`
}

function fetchJson(fetchImpl, url) {
  return Promise.resolve(fetchImpl(url, { credentials: 'same-origin' })).then(async (response) => {
    if (!response || response.ok !== true) throw new Error(`scene asset request failed: ${url} (${response?.status ?? 'network'})`)
    try {
      return await response.json()
    } catch {
      throw new Error(`scene asset is not valid JSON: ${url}`)
    }
  })
}

/**
 * Load and validate the scene manifest/layout from the host route.
 * @param {typeof fetch} fetchImpl
 * @param {string} [basePath]
 */
export async function loadSceneData(fetchImpl = globalThis.fetch, basePath = SCENE_BASE_PATH) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')
  const [manifest, layout] = await Promise.all([
    fetchJson(fetchImpl, `${basePath}manifest.json`),
    fetchJson(fetchImpl, `${basePath}layout.json`),
  ])
  const manifestCheck = validateSceneManifest(manifest)
  if (!manifestCheck.ok) throw new Error(`invalid scene manifest: ${manifestCheck.errors.slice(0, 3).join('; ')}`)
  const layoutCheck = validateSceneLayout(layout, manifest)
  if (!layoutCheck.ok) throw new Error(`invalid scene layout: ${layoutCheck.errors.slice(0, 3).join('; ')}`)
  return { manifest, layout }
}

const STYLE = `
:host { all: initial; }
.scene-stage {
  position: fixed; inset: 0; overflow: hidden; pointer-events: none;
  z-index: var(--scene-z, 2147483046); contain: layout paint style;
  --scene-unit: min(100vw, 100vh);
  --scene-responsive: 1;
}
.scene-stage[hidden] { display: none; }
.scene-element {
  position: absolute; width: calc(var(--scale) * var(--scene-unit) * var(--scene-responsive));
  left: var(--x); top: var(--y);
  transform: translate(-50%, -50%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
  transform-origin: 50% 85%;
  opacity: var(--opacity, 1); z-index: var(--z, 10);
}
.scene-element[data-width-mode="viewport"] { width: 100vw; }
.scene-element[data-width-mode="intrinsic"] { max-width: 100vw; }
.scene-element[data-align="bottom"] {
  transform: translate(-50%, -100%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
}
.scene-element[data-align="bottom-right"] {
  transform: translate(-100%, -100%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
}
.scene-element[data-interactive="true"] { pointer-events: auto; cursor: grab; touch-action: none; }
.scene-element[data-interactive="true"]:active { cursor: grabbing; }
.scene-element[data-draggable="true"] { pointer-events: auto; cursor: grab; touch-action: none; }
.scene-element[data-draggable="true"][data-dragging="true"] { cursor: grabbing; }
.scene-inner { animation-duration: var(--dur, 4s); animation-delay: var(--delay, 0ms); animation-iteration-count: infinite; animation-timing-function: ease-in-out; animation-play-state: var(--play-state, running); will-change: transform; }
.scene-element[data-anim="float"] .scene-inner { animation-name: scene-float; animation-direction: alternate; }
.scene-element[data-anim="sway"] .scene-inner { animation-name: scene-sway; animation-direction: alternate; }
.scene-element[data-anim="tailWave"] .scene-inner { animation-name: scene-tail; animation-direction: alternate; }
.scene-element[data-anim="finWave"] .scene-inner { animation-name: scene-fin; animation-direction: alternate; }
.scene-element[data-anim="blink"] .scene-inner { animation-name: scene-blink; animation-timing-function: steps(1, end); }
.scene-element[data-anim="bubbleRise"] .scene-inner { animation-name: scene-rise; animation-timing-function: ease-in-out; }
.scene-element img {
  display: block; width: 100%; height: auto; pointer-events: none; user-select: none;
  transform: scaleX(var(--mirror, 1)); transition: transform 180ms ease-out, filter 180ms ease-out;
}
.scene-element[data-interactive="true"] img { filter: drop-shadow(0 4px 8px rgba(39, 92, 160, 0.10)); }
.scene-element[data-mirror="true"] img { --mirror: -1; }
.scene-element[data-state="hover"] img { transform: scaleX(var(--mirror, 1)) scale(1.04); filter: drop-shadow(0 8px 14px rgba(39, 92, 160, 0.18)); }
.scene-element[data-state="pressed"] img { transform: scaleX(var(--mirror, 1)) scale(0.95, 0.9); }
.scene-element[data-state="dragging"] img { transition: none; filter: drop-shadow(0 14px 22px rgba(39, 92, 160, 0.22)); }
.scene-element[data-state="sleeping"] { opacity: calc(var(--opacity, 1) * 0.72); }
.scene-element[data-state="sleeping"] .scene-inner { animation-play-state: paused; }
.scene-stage[data-paused="true"] .scene-inner { animation-play-state: paused !important; }
.scene-light {
  position: absolute; inset: -12%; pointer-events: none; opacity: var(--sweep-opacity, 0.22);
  background: linear-gradient(115deg, transparent 32%, rgba(255,255,255,0.65) 48%, transparent 62%);
  background-size: 220% 220%; animation: scene-sweep var(--sweep-duration, 12s) ease-in-out infinite;
  will-change: transform;
}
.scene-bubble {
  position: absolute; width: calc(var(--bubble-width, 0.035) * var(--scene-unit)); pointer-events: none;
  animation: scene-bubble-rise var(--bubble-dur, 5200ms) ease-in forwards;
  opacity: 0; z-index: 35;
}
.scene-bubble img { width: 100%; height: auto; display: block; }
.scene-particle {
  position: absolute; width: var(--particle-size, 24px); pointer-events: none;
  opacity: 0; z-index: var(--particle-z, 34);
  animation: scene-particle-rise var(--particle-dur, 4000ms) ease-out forwards;
}
.scene-particle img { width: 100%; height: auto; display: block; }
.scene-stage[data-paused="true"] .scene-bubble,
.scene-stage[data-paused="true"] .scene-particle { animation-play-state: paused !important; }
.scene-status {
  position: absolute; left: 50%; bottom: max(12px, env(safe-area-inset-bottom));
  transform: translateX(-50%); pointer-events: none; opacity: 0;
  padding: 3px 10px; border-radius: 999px; font: 600 11px/1.4 system-ui, sans-serif;
  color: #24558c; background: rgba(255,255,255,0.72);
  transition: opacity 180ms ease-out; white-space: nowrap;
}
.scene-element[data-state="pressed"] + .scene-status,
.scene-element[data-state="hover"] + .scene-status { opacity: 1; }
@keyframes scene-float { from { transform: translateY(calc(var(--amp, 6px) * -0.55)); } to { transform: translateY(calc(var(--amp, 6px) * 0.55)); } }
@keyframes scene-sway { from { transform: rotate(calc(var(--amp, 2deg) * -0.5)); } to { transform: rotate(calc(var(--amp, 2deg) * 0.5)); } }
@keyframes scene-tail { 0%, 100% { transform: skewX(0deg); } 50% { transform: skewX(calc(var(--amp, 2deg) * 1)); } }
@keyframes scene-fin { 0%, 100% { transform: scaleX(0.98); } 50% { transform: scaleX(1.02); } }
@keyframes scene-blink { 0%, 93%, 100% { transform: scaleY(1); } 95%, 97% { transform: scaleY(0.94); } }
@keyframes scene-rise { 0% { transform: translateY(0); opacity: 0; } 18% { opacity: 0.9; } 80% { opacity: 0.75; } 100% { transform: translateY(calc(var(--amp, 18px) * -3)); opacity: 0; } }
@keyframes scene-bubble-rise { 0% { transform: translateY(10px) scale(0.7); opacity: 0; } 18% { opacity: 0.85; } 75% { opacity: 0.7; } 100% { transform: translateY(-80px) scale(1.15); opacity: 0; } }
@keyframes scene-particle-rise {
  0% { transform: translate(-50%, -50%) translateY(8px) scale(0.65) rotate(0deg); opacity: 0; }
  16% { opacity: 0.9; }
  72% { opacity: 0.78; }
  100% { transform: translate(-50%, -50%) translate(var(--particle-drift, 0px), calc(-1 * var(--particle-rise, 120px))) scale(1.08) rotate(var(--particle-rot, 0deg)); opacity: 0; }
}
@keyframes scene-sweep { 0%, 100% { transform: translateX(-18%); } 50% { transform: translateX(18%); } }
@media (max-width: 1279px) { .scene-stage { --scene-responsive: 0.86; } }
@media (max-width: 767px) {
  .scene-stage { --scene-responsive: 0.68; }
  .scene-element[data-layer="L3"] { display: none; }
  .scene-element[data-narrow-hidden="true"] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .scene-inner { animation: none !important; }
  .scene-light, .scene-bubble { display: none !important; }
  .scene-element img { transition: none; }
}
`

function resolveVisibility(options) {
  const storage = options.storage ?? options.window?.localStorage ?? null
  if (options.visible === false) return false
  return parseOverlayVisible(storage?.getItem?.(OVERLAY_VISIBLE_KEY) ?? null)
}

/**
 * Mount the scene layer. Returns immediately; `ready` resolves once manifest,
 * layout and all images have rendered.
 * @param {{document:Document, window:Window, manifest?:object, layout?:object, fetchImpl?:typeof fetch, options?:object}} input
 */
export function mountScene(input) {
  const doc = input.document
  const win = input.window
  const options = { ...SCENE_DEFAULTS, ...(input.options ?? {}) }
  const storage = options.storage ?? win?.localStorage ?? null
  const host = doc.createElement('div')
  host.setAttribute('data-xllh-scene-host', '')
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.pointerEvents = 'none'
  host.style.zIndex = String(options.zIndex)
  host.style.display = resolveVisibility({ ...options, storage, window: win }) ? '' : 'none'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = STYLE
  const stage = doc.createElement('div')
  stage.className = 'scene-stage'
  stage.setAttribute('aria-hidden', 'true')
  stage.style.setProperty('--scene-z', String(options.zIndex))
  shadow.append(style, stage)
  const light = doc.createElement('div')
  light.className = 'scene-light'
  stage.append(light)
  doc.body.append(host)

  const random = createSeededRandom(options.seed)
  const machine = createSceneStateMachine({ sleepAfterMs: options.sleepAfterMs })
  const cleanupFns = []
  const elementNodes = new Map()
  let disposed = false
  let manifest = input.manifest ?? null
  let layout = input.layout ?? null
  let positions = parseScenePositions(storage?.getItem?.(SCENE_POSITIONS_KEY) ?? null)
  let paused = false
  let hostHidden = host.style.display === 'none'
  let sleepingTimer = null
  let bubbleTimer = null
  let emitterTimer = null
  let emitterConfigs = []
  const particleNodes = new Set()
  const emitterActive = new Map()
  let activeBubbles = 0
  let dragged = null
  let interactiveNode = null
  let statusNode = null
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const addListener = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts)
    cleanupFns.push(() => target.removeEventListener(type, handler, opts))
  }
  const reducedMotion = () => typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  const hasMedia = typeof win.matchMedia === 'function'

  function assetFor(slice) {
    return sceneAssetUrl(options.basePath, slice, win.devicePixelRatio ?? 1)
  }

  function applyPause() {
    paused = hostHidden || shouldPauseScene({
      documentHidden: doc.hidden === true,
      reducedMotion: reducedMotion(),
      intersecting: options.intersecting !== false,
    })
    stage.dataset.paused = paused ? 'true' : 'false'
    if (paused) {
      stopBubbleTimer()
      stopEmitters()
    } else {
      startBubbleTimer()
      startEmitters()
    }
  }

  function createElementNode(element, slice, geom) {
    const wrapper = doc.createElement('div')
    const anchor = positions[element.instanceId] ?? element.anchor
    wrapper.className = 'scene-element'
    wrapper.dataset.elementId = element.instanceId
    wrapper.dataset.layer = element.layer
    wrapper.dataset.anim = element.animation?.type ?? 'none'
    wrapper.dataset.mirror = element.mirror === true ? 'true' : 'false'
    wrapper.dataset.state = 'idle'
    wrapper.dataset.interactive = element.interactive === true ? 'true' : 'false'
    wrapper.dataset.draggable = element.draggable === true ? 'true' : 'false'
    wrapper.dataset.widthMode = element.widthMode ?? 'scale'
    wrapper.dataset.align = element.align ?? 'center'
    if (element.widthMode === 'intrinsic') {
      // Respect the sliced asset's logical CSS size (@2x / 2) instead of stretching it.
      wrapper.style.width = `${Math.round(slice.width / 2)}px`
    }
    if (element.responsive?.narrow?.hidden === true) wrapper.dataset.narrowHidden = 'true'
    wrapper.style.setProperty('--x', `${anchor.x * 100}%`)
    wrapper.style.setProperty('--y', `${anchor.y * 100}%`)
    wrapper.style.setProperty('--scale', String(element.scale))
    wrapper.style.setProperty('--rot', `${element.rotation ?? 0}deg`)
    wrapper.style.setProperty('--opacity', String(element.opacity ?? 1))
    wrapper.style.setProperty('--z', String(element.zIndex ?? 10))
    wrapper.style.setProperty('--dur', `${element.animation?.duration ?? 4200}ms`)
    wrapper.style.setProperty('--delay', `${(element.animation?.delay ?? 0) + staggerDelay(elementNodes.size, options.seed, 800)}ms`)
    const angleAmplitude = element.animation?.type === 'sway' || element.animation?.type === 'tailWave'
    wrapper.style.setProperty('--amp', `${element.animation?.amplitude ?? 6}${angleAmplitude ? 'deg' : 'px'}`)
    const inner = doc.createElement('div')
    inner.className = 'scene-inner'
    const image = doc.createElement('img')
    image.alt = ''
    image.draggable = false
    image.decoding = 'async'
    image.loading = 'lazy'
    image.src = assetFor(slice)
    inner.append(image)
    wrapper.append(inner)
    stage.append(wrapper)
    elementNodes.set(element.instanceId, { wrapper, inner, image, element, slice, geom })
    return wrapper
  }

  function updatePausedState() {
    applyPause()
  }

  function setState(next) {
    for (const node of elementNodes.values()) {
      if (node.element.interactive === true) node.wrapper.dataset.state = next
    }
    if (statusNode !== null) {
      statusNode.textContent = next === 'sleeping' ? '呼呼…' : next === 'dragging' ? '拖动中' : next === 'pressed' ? '捏一下' : '蓝色大肥鱼在陪你'
    }
  }
  machine.subscribe((next) => setState(next))

  function finishDrag() {
    if (dragged === null) return
    const { wrapper } = dragged
    wrapper.style.setProperty('--dx', `${dragged.dx}px`)
    wrapper.style.setProperty('--dy', `${dragged.dy}px`)
    dragged = null
    machine.dragEnd()
  }

  function bindInteractive(wrapper) {
    const elementNode = elementNodes.get(wrapper.dataset.elementId)
    if (!elementNode) return
    const { image } = elementNode
    addListener(wrapper, 'pointerenter', () => {
      machine.pointerEnter()
      setState(machine.state)
    })
    addListener(wrapper, 'pointerleave', () => {
      wrapper.style.setProperty('--look', '0deg')
      if (dragged === null) {
        machine.pointerLeave()
        setState(machine.state)
      }
    })
    addListener(wrapper, 'pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return
      event.preventDefault()
      wrapper.setPointerCapture?.(event.pointerId)
      dragged = {
        pointerId: event.pointerId,
        wrapper,
        startX: event.clientX,
        startY: event.clientY,
        baseDx: parseFloat(wrapper.style.getPropertyValue('--dx')) || 0,
        baseDy: parseFloat(wrapper.style.getPropertyValue('--dy')) || 0,
        dx: parseFloat(wrapper.style.getPropertyValue('--dx')) || 0,
        dy: parseFloat(wrapper.style.getPropertyValue('--dy')) || 0,
        moved: false,
      }
      machine.pointerDown()
      setState(machine.state)
    })
    addListener(wrapper, 'pointermove', (event) => {
      if (dragged === null || dragged.pointerId !== event.pointerId) {
        const bounds = wrapper.getBoundingClientRect()
        const ratio = Math.max(-1, Math.min(1, (event.clientX - (bounds.left + bounds.width / 2)) / Math.max(1, bounds.width)))
        wrapper.style.setProperty('--look', `${(ratio * 2.2).toFixed(2)}deg`)
        machine.activity()
        return
      }
      const dx = dragged.baseDx + event.clientX - dragged.startX
      const dy = dragged.baseDy + event.clientY - dragged.startY
      if (!dragged.moved && Math.hypot(event.clientX - dragged.startX, event.clientY - dragged.startY) > 4) {
        dragged.moved = true
        machine.dragStart()
      }
      if (dragged.moved) {
        dragged.dx = dx
        dragged.dy = dy
        wrapper.style.setProperty('--dx', `${dx}px`)
        wrapper.style.setProperty('--dy', `${dy}px`)
        setState(machine.state)
      }
    })
    addListener(wrapper, 'pointerup', (event) => {
      if (dragged === null || dragged.pointerId !== event.pointerId) return
      const wasDrag = dragged.moved
      const clicked = !wasDrag && machine.pointerUp()
      if (wasDrag) {
        finishDrag()
        // Damped spring back toward the layout anchor.
        wrapper.style.transition = 'transform 260ms cubic-bezier(0.22, 1.2, 0.36, 1)'
        wrapper.style.setProperty('--dx', '0px')
        wrapper.style.setProperty('--dy', '0px')
        win.setTimeout(() => { wrapper.style.transition = '' }, 280)
      }
      setState(machine.state)
      if (clicked) {
        image.animate?.(
          [{ transform: 'scaleX(var(--mirror,1)) scale(1)' }, { transform: 'scaleX(var(--mirror,1)) scale(1.1,0.88)' }, { transform: 'scaleX(var(--mirror,1)) scale(1)' }],
          { duration: 220, easing: 'ease-out' },
        )
        spawnBubbles(layout?.interactions?.petClick?.bubbleCount ?? 3, wrapper)
        machine.activity()
      }
    })
    addListener(wrapper, 'pointercancel', () => {
      if (dragged !== null) {
        dragged = null
        wrapper.style.setProperty('--dx', '0px')
        wrapper.style.setProperty('--dy', '0px')
        machine.dragEnd()
        setState(machine.state)
      }
    })
    // Idle-to-sleep timer ticks only while the page is visible.
    sleepingTimer = win.setInterval(() => { machine.tick() }, 1000)
    cleanupFns.push(() => win.clearInterval(sleepingTimer))
    statusNode = doc.createElement('div')
    statusNode.className = 'scene-status'
    statusNode.textContent = '蓝色大肥鱼在陪你'
    stage.append(statusNode)
    interactiveNode = elementNode
  }

  function bindDraggable(wrapper) {
    const node = elementNodes.get(wrapper.dataset.elementId)
    if (!node) return
    let drag = null
    addListener(wrapper, 'pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return
      event.preventDefault()
      wrapper.setPointerCapture?.(event.pointerId)
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dx: 0,
        dy: 0,
        moved: false,
      }
      wrapper.dataset.dragging = 'true'
    })
    addListener(wrapper, 'pointermove', (event) => {
      if (drag === null || drag.pointerId !== event.pointerId) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true
      if (!drag.moved) return
      drag.dx = dx
      drag.dy = dy
      wrapper.style.setProperty('--dx', `${dx}px`)
      wrapper.style.setProperty('--dy', `${dy}px`)
    })
    addListener(wrapper, 'pointerup', (event) => {
      if (drag === null || drag.pointerId !== event.pointerId) return
      const wasMoved = drag.moved
      const { dx, dy } = drag
      drag = null
      wrapper.dataset.dragging = 'false'
      wrapper.style.setProperty('--dx', '0px')
      wrapper.style.setProperty('--dy', '0px')
      if (!wasMoved) return
      const W = Math.max(1, win.innerWidth)
      const H = Math.max(1, win.innerHeight)
      const width = node.geom?.width ?? 1
      const height = node.geom?.height ?? 1
      const currentX = parseFloat(wrapper.style.getPropertyValue('--x')) || 0
      const currentY = parseFloat(wrapper.style.getPropertyValue('--y')) || 0
      const marginX = Math.min(0.5, width / 2 / W)
      const marginY = Math.min(0.5, height / 2 / H)
      const x = Math.min(1 - marginX, Math.max(marginX, (currentX / 100 * W + dx) / W))
      const y = Math.min(1 - marginY, Math.max(marginY, (currentY / 100 * H + dy) / H))
      wrapper.style.setProperty('--x', `${(x * 100).toFixed(4)}%`)
      wrapper.style.setProperty('--y', `${(y * 100).toFixed(4)}%`)
      positions[node.element.instanceId] = { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)) }
      try {
        storage?.setItem?.(SCENE_POSITIONS_KEY, serializeScenePositions(positions))
      } catch {
        // Position persistence is best effort; the current drag still applies.
      }
    })
    addListener(wrapper, 'pointercancel', () => {
      drag = null
      wrapper.dataset.dragging = 'false'
      wrapper.style.setProperty('--dx', '0px')
      wrapper.style.setProperty('--dy', '0px')
    })
  }

  function bubbleConfig() {
    return layout?.interactions?.petClick ?? {}
  }

  function bubbleSlicePool() {
    const layer = bubbleConfig().bubbleLayer ?? 'L3'
    const configured = bubbleConfig().bubbleSlices
    if (Array.isArray(configured) && configured.length > 0) {
      return (manifest?.slices ?? []).filter((slice) => configured.includes(slice.id))
    }
    return (manifest?.slices ?? []).filter((slice) => slice.layer === layer)
  }

  function bubbleAssetUrl(slice) {
    // Bubble particles are shown larger than the tiny L3 confetti; force the
    // @2x asset so a 45-52px displayed bubble stays sharp on 1x screens too.
    const dpr = slice.id === 'fx-bubble-large' ? Math.max(2, win.devicePixelRatio ?? 1) : (win.devicePixelRatio ?? 1)
    return sceneAssetUrl(options.basePath, slice, dpr)
  }

  function defaultBubbleOrigin() {
    return elementNodes.get('fish-01')?.wrapper
      ?? [...elementNodes.values()].find((node) => node.element.draggable === true)?.wrapper
      ?? interactiveNode?.wrapper
      ?? null
  }

  function spawnBubbles(count = 1, originWrapper = null) {
    if (paused || disposed) return
    const pool = bubbleSlicePool()
    if (pool.length === 0) return
    const origin = originWrapper ?? defaultBubbleOrigin()
    if (!origin) return
    const originX = parseFloat(origin.style.getPropertyValue('--x')) || 50
    const cap = Math.min(12, bubbleConfig().bubbleCap ?? options.bubbleCap)
    for (let index = 0; index < count; index += 1) {
      if (activeBubbles >= cap) break
      const slice = pool[random.int(pool.length)]
      const bubble = doc.createElement('div')
      bubble.className = 'scene-bubble'
      bubble.style.left = `${Math.min(96, Math.max(2, originX + random.range(-24, 24)))}%`
      bubble.style.top = `${70 + random.range(-6, 6)}%`
      bubble.style.setProperty('--bubble-dur', `${Math.round(random.range(4200, 6800))}ms`)
      bubble.style.setProperty('--bubble-width', String(bubbleConfig().bubbleWidth ?? 0.045))
      const image = doc.createElement('img')
      image.alt = ''
      image.src = bubbleAssetUrl(slice)
      bubble.append(image)
      stage.append(bubble)
      activeBubbles += 1
      const remove = () => {
        bubble.remove()
        activeBubbles = Math.max(0, activeBubbles - 1)
      }
      bubble.addEventListener('animationend', remove, { once: true })
      cleanupFns.push(() => { bubble.remove(); activeBubbles = Math.max(0, activeBubbles - 1) })
    }
  }

  function startBubbleTimer() {
    if (bubbleTimer !== null || paused || reducedMotion() || disposed) return
    bubbleTimer = win.setInterval(() => {
      spawnBubbles(1)
    }, bubbleConfig().bubbleIntervalMs ?? options.bubbleIntervalMs)
    cleanupFns.push(() => { win.clearInterval(bubbleTimer); bubbleTimer = null })
  }
  function stopBubbleTimer() {
    if (bubbleTimer !== null) {
      win.clearInterval(bubbleTimer)
      bubbleTimer = null
    }
  }

  function scheduleEmitter() {
    if (emitterConfigs.length === 0) return
    const [min, max] = emitterConfigs[0].intervalMs
    const wait = Math.round(random.range(min, max))
    emitterTimer = win.setTimeout(() => {
      emitterTimer = null
      if (paused || disposed) return
      spawnEmitterParticles()
      scheduleEmitter()
    }, wait)
  }

  function startEmitters() {
    if (emitterTimer !== null || paused || reducedMotion() || disposed || emitterConfigs.length === 0) return
    scheduleEmitter()
  }

  function stopEmitters() {
    if (emitterTimer !== null) {
      win.clearTimeout(emitterTimer)
      emitterTimer = null
    }
  }

  function spawnEmitterParticles() {
    if (paused || disposed) return
    const slices = new Map((manifest?.slices ?? []).map((slice) => [slice.id, slice]))
    for (const emitter of emitterConfigs) {
      const activeForEmitter = emitterActive.get(emitter.id) ?? 0
      if (activeForEmitter >= emitter.cap) continue
      const target = elementNodes.get(emitter.attachTo)?.wrapper
      if (!target) continue
      const rect = target.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) continue
      const [minCount, maxCount] = emitter.perSpawn
      const count = random.int(maxCount - minCount + 1) + minCount
      let added = 0
      for (let index = 0; index < count; index += 1) {
        if (activeForEmitter + added >= emitter.cap) break
        const sliceId = emitter.slices[random.int(emitter.slices.length)]
        const slice = slices.get(sliceId)
        if (!slice) continue
        const size = random.range(emitter.sizePx[0], emitter.sizePx[1])
        const rise = random.range(emitter.risePx[0], emitter.risePx[1])
        const drift = random.range(-emitter.spreadPx * 0.6, emitter.spreadPx * 0.6)
        const duration = random.range(emitter.durationMs[0], emitter.durationMs[1])
        const left = rect.left + random.range(rect.width * 0.1, rect.width * 0.95)
        const top = rect.top + random.range(rect.height * 0.35, rect.height * 0.92)
        const particle = doc.createElement('div')
        particle.className = 'scene-particle'
        particle.style.left = `${left}px`
        particle.style.top = `${top}px`
        particle.style.setProperty('--particle-size', `${Math.round(size)}px`)
        particle.style.setProperty('--particle-rise', `${Math.round(rise)}px`)
        particle.style.setProperty('--particle-drift', `${Math.round(drift)}px`)
        particle.style.setProperty('--particle-rot', `${random.range(-24, 24).toFixed(1)}deg`)
        particle.style.setProperty('--particle-dur', `${Math.round(duration)}ms`)
        particle.style.setProperty('--particle-z', String(emitter.zIndex))
        const image = doc.createElement('img')
        image.alt = ''
        image.src = slice.id === 'fx-bubble-large'
          ? bubbleAssetUrl(slice)
          : sceneAssetUrl(options.basePath, slice, win.devicePixelRatio ?? 1)
        particle.append(image)
        stage.append(particle)
        particleNodes.add(particle)
        added += 1
        particle.addEventListener('animationend', () => {
          particle.remove()
          particleNodes.delete(particle)
          emitterActive.set(emitter.id, Math.max(0, (emitterActive.get(emitter.id) ?? 1) - 1))
        }, { once: true })
      }
      emitterActive.set(emitter.id, activeForEmitter + added)
    }
  }

  function render(data) {
    manifest = data.manifest
    layout = data.layout
    emitterConfigs = Array.isArray(layout.emitters) ? layout.emitters : []
    const breakpoint = sceneBreakpoint(win.innerWidth)
    const slices = new Map(manifest.slices.map((slice) => [slice.id, slice]))
    const sweep = layout.effects?.lightSweep ?? {}
    stage.style.setProperty('--sweep-duration', `${sweep.durationMs ?? 12000}ms`)
    stage.style.setProperty('--sweep-opacity', String(sweep.opacity ?? 0.22))
    // Render sorted by layer/z so painting order matches layout semantics.
    const sorted = [...layout.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    for (const element of sorted) {
      const slice = slices.get(element.slice)
      if (!slice) continue
      const geom = resolveSceneElement(element, slice, { width: win.innerWidth, height: win.innerHeight }, breakpoint, layout)
      const wrapper = createElementNode(element, slice, geom)
      if (geom.hidden) wrapper.style.display = 'none'
      if (element.interactive === true) bindInteractive(wrapper)
      if (element.draggable === true) bindDraggable(wrapper)
    }
    applyPause()
    startBubbleTimer()
    stage.dataset.ready = 'true'
    readyResolve({ host, stage, manifest, layout, elements: elementNodes })
  }

  if (manifest !== null && layout !== null) {
    try {
      render({ manifest, layout })
    } catch (error) {
      readyReject(error)
    }
  } else {
    loadSceneData(input.fetchImpl ?? win.fetch?.bind(win), options.basePath).then((data) => {
      if (!disposed) render(data)
    }).catch((error) => {
      if (!disposed) readyReject(error)
    })
  }

  addListener(doc, 'visibilitychange', updatePausedState)
  if (hasMedia) {
    const media = win.matchMedia('(prefers-reduced-motion: reduce)')
    const onMedia = () => applyPause()
    media.addEventListener?.('change', onMedia)
    cleanupFns.push(() => media.removeEventListener?.('change', onMedia))
  }
  if (typeof win.IntersectionObserver === 'function') {
    const observer = new win.IntersectionObserver((entries) => {
      options.intersecting = entries.some((entry) => entry.isIntersecting)
      applyPause()
    })
    observer.observe(host)
    cleanupFns.push(() => observer.disconnect())
  }
  // Global show/hide, persisted exactly like the legacy overlay.
  addListener(doc, 'keydown', (event) => {
    if (!(event.ctrlKey && event.shiftKey && (event.key === 'F12' || event.code === 'F12'))) return
    event.preventDefault()
    event.stopPropagation()
    const hidden = host.style.display === 'none'
    hostHidden = !hidden
    host.style.display = hidden ? '' : 'none'
    applyPause()
    try {
      storage?.setItem?.(OVERLAY_VISIBLE_KEY, String(hidden ? true : false))
    } catch {
      // best effort
    }
  }, true)

  return {
    host,
    stage,
    ready,
    get elements() { return elementNodes },
    get paused() { return paused },
    dispose() {
      if (disposed) return
      disposed = true
      stopBubbleTimer()
      stopEmitters()
      for (const particle of particleNodes) particle.remove()
      particleNodes.clear()
      emitterActive.clear()
      if (sleepingTimer !== null) win.clearInterval(sleepingTimer)
      for (const cleanup of cleanupFns.reverse()) {
        try { cleanup() } catch { /* noop */ }
      }
      elementNodes.clear()
      host.remove()
    },
  }
}
