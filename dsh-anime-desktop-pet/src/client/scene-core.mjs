/**
 * Pure scene logic: asset validation, normalized layout geometry, deterministic
 * random/stagger, pause rules and the single-active-state interaction machine.
 * The DOM renderer in scene.mjs only maps these decisions to nodes/CSS.
 */

/** Allowed draw layers, bottom to top. */
export const SCENE_LAYERS = ['L0', 'L1', 'L2', 'L3', 'L4']

/** Animation primitives supported by layout.json. */
export const SCENE_ANIMATION_TYPES = ['none', 'float', 'sway', 'tailWave', 'finWave', 'blink', 'bubbleRise', 'lightSweep']

/** Persisted normalized positions for draggable scene elements. */
export const SCENE_POSITIONS_KEY = 'dsh-anime-desktop-pet/scene-positions'

/** Parse the positions map defensively; any invalid entry is ignored. */
export function parseScenePositions(raw) {
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const value = JSON.parse(raw)
    if (!isObject(value)) return {}
    const clean = {}
    for (const [id, position] of Object.entries(value)) {
      if (typeof id !== 'string' || !isObject(position)) continue
      if (!isUnitNumber(position.x) || !isUnitNumber(position.y)) continue
      clean[id] = { x: Number(position.x.toFixed(6)), y: Number(position.y.toFixed(6)) }
    }
    return clean
  } catch {
    return {}
  }
}

/** @param {Record<string, {x:number,y:number}>} positions */
export function serializeScenePositions(positions) {
  return JSON.stringify(positions ?? {})
}

const BREAKPOINTS = { wide: 1280, medium: 768 }

/** @typedef {'wide' | 'medium' | 'narrow'} SceneBreakpoint */

/** @param {number} width @returns {SceneBreakpoint} */
export function sceneBreakpoint(width) {
  if (Number.isFinite(width) && width >= BREAKPOINTS.wide) return 'wide'
  if (Number.isFinite(width) && width >= BREAKPOINTS.medium) return 'medium'
  return 'narrow'
}

/** @param {{width:number,height:number}} viewport */
export function sceneUnit(viewport) {
  const width = Number.isFinite(viewport?.width) ? viewport.width : 0
  const height = Number.isFinite(viewport?.height) ? viewport.height : 0
  return Math.max(1, Math.min(width || height || 1, height || width || 1))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUnitNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/** Validate manifest.json shape and @1x/@2x naming invariants. */
export function validateSceneManifest(manifest) {
  const errors = []
  if (!isObject(manifest)) return { ok: false, errors: ['manifest must be an object'] }
  if (manifest.version !== 1) errors.push('manifest.version must be 1')
  if (!isObject(manifest.stage) || !(manifest.stage.width > 0) || !(manifest.stage.height > 0)) {
    errors.push('manifest.stage must have positive width/height')
  }
  if (!Array.isArray(manifest.slices) || manifest.slices.length === 0) {
    errors.push('manifest.slices must be a non-empty array')
    return { ok: false, errors }
  }
  const ids = new Set()
  for (const [index, slice] of manifest.slices.entries()) {
    const label = `slices[${index}]`
    if (!isObject(slice)) {
      errors.push(`${label} must be an object`)
      continue
    }
    if (typeof slice.id !== 'string' || slice.id === '') errors.push(`${label}.id is required`)
    else if (ids.has(slice.id)) errors.push(`${label}.id duplicated: ${slice.id}`)
    else ids.add(slice.id)
    if (!SCENE_LAYERS.includes(slice.layer)) errors.push(`${label}.layer invalid: ${slice.layer}`)
    if (!Array.isArray(slice.tags) || slice.tags.some((tag) => typeof tag !== 'string')) errors.push(`${label}.tags must be string[]`)
    if (!isObject(slice.pivot) || !isUnitNumber(slice.pivot.x) || !isUnitNumber(slice.pivot.y)) errors.push(`${label}.pivot must be normalized 0..1`)
    if (!(Number.isInteger(slice.width) && slice.width > 1 && slice.width % 2 === 0)) errors.push(`${label}.width must be an even positive integer`)
    if (!(Number.isInteger(slice.height) && slice.height > 1 && slice.height % 2 === 0)) errors.push(`${label}.height must be an even positive integer`)
    if (typeof slice.file !== 'string' || !slice.file.includes('@2x/') || !slice.file.includes(`/${slice.id}@2x.png`)) {
      errors.push(`${label}.file must point at @2x/${slice.id}@2x.png`)
    }
    if (typeof slice.file1x !== 'string' || !slice.file1x.includes('@1x/') || !slice.file1x.includes(`/${slice.id}@1x.png`)) {
      errors.push(`${label}.file1x must point at @1x/${slice.id}@1x.png`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Validate layout.json against the manifest. Layout changes never require code edits.
 * @param {unknown} layout
 * @param {unknown} manifest
 */
export function validateSceneLayout(layout, manifest) {
  const errors = []
  if (!isObject(layout)) return { ok: false, errors: ['layout must be an object'] }
  if (layout.version !== 1) errors.push('layout.version must be 1')
  if (!Array.isArray(layout.elements) || layout.elements.length === 0) {
    errors.push('layout.elements must be a non-empty array')
    return { ok: false, errors }
  }
  if (layout.elements.length > 60) errors.push('layout.elements must stay <= 60 DOM nodes')
  if (layout.interactions !== undefined && !isObject(layout.interactions)) errors.push('layout.interactions must be an object')
  if (layout.effects !== undefined && !isObject(layout.effects)) errors.push('layout.effects must be an object')
  if (layout.effects?.lightSweep !== undefined) {
    const sweep = layout.effects.lightSweep
    if (!isObject(sweep)) errors.push('layout.effects.lightSweep must be an object')
    else {
      if (sweep.durationMs !== undefined && !(sweep.durationMs >= 8000 && sweep.durationMs <= 15000)) errors.push('lightSweep.durationMs out of range')
      if (sweep.opacity !== undefined && !(sweep.opacity >= 0 && sweep.opacity <= 0.35)) errors.push('lightSweep.opacity out of range')
    }
  }
  if (layout.interactions?.petClick !== undefined) {
    const petClick = layout.interactions.petClick
    if (!isObject(petClick)) errors.push('layout.interactions.petClick must be an object')
    else {
      if (petClick.bubbleCount !== undefined && !(Number.isInteger(petClick.bubbleCount) && petClick.bubbleCount >= 1 && petClick.bubbleCount <= 12)) errors.push('petClick.bubbleCount out of range')
      if (petClick.bubbleLayer !== undefined && !SCENE_LAYERS.includes(petClick.bubbleLayer)) errors.push('petClick.bubbleLayer invalid')
      if (petClick.bubbleIntervalMs !== undefined && !(petClick.bubbleIntervalMs >= 600 && petClick.bubbleIntervalMs <= 1500)) errors.push('petClick.bubbleIntervalMs out of range')
      if (petClick.bubbleCap !== undefined && !(Number.isInteger(petClick.bubbleCap) && petClick.bubbleCap >= 0 && petClick.bubbleCap <= 12)) errors.push('petClick.bubbleCap out of range')
      if (petClick.bubbleSlices !== undefined) {
        if (!Array.isArray(petClick.bubbleSlices) || petClick.bubbleSlices.length === 0) errors.push('petClick.bubbleSlices must be non-empty')
        else for (const sliceId of petClick.bubbleSlices) {
          const slice = Array.isArray(manifest?.slices) ? manifest.slices.find((entry) => entry?.id === sliceId) : undefined
          if (slice === undefined) errors.push(`petClick.bubbleSlices unknown: ${sliceId}`)
          else if (slice.layer !== 'L3') errors.push(`petClick.bubbleSlices must be L3: ${sliceId}`)
        }
      }
      if (petClick.bubbleWidth !== undefined && !(petClick.bubbleWidth > 0.01 && petClick.bubbleWidth <= 0.12)) errors.push('petClick.bubbleWidth out of range')
    }
  }
  const slices = new Map(
    (Array.isArray(manifest?.slices) ? manifest.slices : []).map((slice) => [slice?.id, slice]),
  )
  const ids = new Set()
  for (const [index, element] of layout.elements.entries()) {
    const label = `elements[${index}]`
    if (!isObject(element)) {
      errors.push(`${label} must be an object`)
      continue
    }
    if (typeof element.instanceId !== 'string' || element.instanceId === '') errors.push(`${label}.instanceId is required`)
    else if (ids.has(element.instanceId)) errors.push(`${label}.instanceId duplicated: ${element.instanceId}`)
    else ids.add(element.instanceId)
    if (!slices.has(element.slice)) errors.push(`${label}.slice unknown: ${element.slice}`)
    else if (element.layer !== slices.get(element.slice).layer) errors.push(`${label}.layer must match slice layer`)
    if (!SCENE_LAYERS.includes(element.layer)) errors.push(`${label}.layer invalid: ${element.layer}`)
    if (!isObject(element.anchor) || !isUnitNumber(element.anchor.x) || !isUnitNumber(element.anchor.y)) errors.push(`${label}.anchor must be normalized`)
    if (!(typeof element.scale === 'number' && Number.isFinite(element.scale) && element.scale > 0 && element.scale <= 1.5)) errors.push(`${label}.scale out of range`)
    if (!(typeof element.opacity === 'number' && element.opacity >= 0 && element.opacity <= 1)) errors.push(`${label}.opacity out of range`)
    if (!Number.isInteger(element.zIndex)) errors.push(`${label}.zIndex must be an integer`)
    if (element.draggable !== undefined && typeof element.draggable !== 'boolean') errors.push(`${label}.draggable must be boolean`)
    if (element.interactive !== undefined && typeof element.interactive !== 'boolean') errors.push(`${label}.interactive must be boolean`)
    if (element.widthMode !== undefined && !['scale', 'viewport', 'intrinsic'].includes(element.widthMode)) errors.push(`${label}.widthMode invalid`)
    if (element.align !== undefined && !['center', 'bottom', 'bottom-right'].includes(element.align)) errors.push(`${label}.align invalid`)
    if (element.animation !== undefined) {
      if (!isObject(element.animation) || !SCENE_ANIMATION_TYPES.includes(element.animation.type)) errors.push(`${label}.animation.type invalid`)
      if (!(element.animation.duration === undefined || (element.animation.duration >= 800 && element.animation.duration <= 30000))) errors.push(`${label}.animation.duration out of range`)
    }
    if (element.responsive !== undefined && !isObject(element.responsive)) errors.push(`${label}.responsive must be an object`)
    for (const breakpoint of ['medium', 'narrow']) {
      const override = element.responsive?.[breakpoint]
      if (override !== undefined) {
        if (!isObject(override)) errors.push(`${label}.responsive.${breakpoint} must be an object`)
        else {
          if (override.hidden !== undefined && typeof override.hidden !== 'boolean') errors.push(`${label}.responsive.${breakpoint}.hidden must be boolean`)
          if (override.scaleMultiplier !== undefined && !(override.scaleMultiplier > 0 && override.scaleMultiplier <= 2)) errors.push(`${label}.responsive.${breakpoint}.scaleMultiplier out of range`)
        }
      }
    }
  }
  if (layout.emitters !== undefined) {
    if (!Array.isArray(layout.emitters)) errors.push('layout.emitters must be an array')
    else {
      const emitterIds = new Set()
      for (const [index, emitter] of layout.emitters.entries()) {
        const label = `emitters[${index}]`
        if (!isObject(emitter)) {
          errors.push(`${label} must be an object`)
          continue
        }
        if (typeof emitter.id !== 'string' || emitter.id === '') errors.push(`${label}.id is required`)
        else if (emitterIds.has(emitter.id)) errors.push(`${label}.id duplicated`)
        else emitterIds.add(emitter.id)
        if (!ids.has(emitter.attachTo)) errors.push(`${label}.attachTo unknown element: ${emitter.attachTo}`)
        if (!Array.isArray(emitter.slices) || emitter.slices.length === 0) errors.push(`${label}.slices must be non-empty`)
        else for (const sliceId of emitter.slices) {
          if (!slices.has(sliceId)) errors.push(`${label}.slices unknown: ${sliceId}`)
          else if (slices.get(sliceId).layer !== 'L3') errors.push(`${label}.slices must reference L3 fx: ${sliceId}`)
        }
        const pair = (key, min, max, integer = false) => {
          const value = emitter[key]
          if (!Array.isArray(value) || value.length !== 2) {
            errors.push(`${label}.${key} must be [min,max]`)
            return
          }
          const [low, high] = value
          const valid = typeof low === 'number' && typeof high === 'number' && Number.isFinite(low) && Number.isFinite(high)
            && low >= min && high <= max && low <= high && (!integer || (Number.isInteger(low) && Number.isInteger(high)))
          if (!valid) errors.push(`${label}.${key} out of range`)
        }
        pair('intervalMs', 300, 3000)
        pair('perSpawn', 1, 3, true)
        pair('durationMs', 1000, 8000)
        pair('risePx', 20, 400)
        pair('sizePx', 8, 80)
        if (!Number.isInteger(emitter.cap) || emitter.cap < 1 || emitter.cap > 12) errors.push(`${label}.cap out of range`)
        if (!(typeof emitter.spreadPx === 'number' && emitter.spreadPx >= 0 && emitter.spreadPx <= 400)) errors.push(`${label}.spreadPx out of range`)
        if (!Number.isInteger(emitter.zIndex)) errors.push(`${label}.zIndex must be an integer`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Resolve one layout element to viewport pixels.
 * @param {any} element
 * @param {any} slice
 * @param {{width:number,height:number}} viewport
 * @param {SceneBreakpoint} breakpoint
 * @param {any} layout
 */
export function resolveSceneElement(element, slice, viewport, breakpoint = 'wide', layout = undefined) {
  const unit = sceneUnit(viewport)
  const responsive = layout?.responsive?.[breakpoint] ?? {}
  const own = element?.responsive?.[breakpoint] ?? {}
  const multiplier = (responsive.scaleMultiplier ?? 1) * (own.scaleMultiplier ?? 1)
  const width = Math.max(1, (element?.scale ?? 0) * unit * multiplier)
  const aspect = slice?.width > 0 && slice?.height > 0 ? slice.height / slice.width : 1
  const hidden = own.hidden === true
    || (Array.isArray(responsive.hideLayers) && responsive.hideLayers.includes(element?.layer))
  return {
    left: (element?.anchor?.x ?? 0) * (viewport?.width ?? 0),
    top: (element?.anchor?.y ?? 0) * (viewport?.height ?? 0),
    width,
    height: width * aspect,
    opacity: element?.opacity ?? 1,
    hidden,
    breakpoint,
  }
}

/** Deterministic xorshift32 PRNG; every scene random value is seeded. */
export function createSeededRandom(seed = 1) {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0
  if (state === 0) state = 0x9e3779b9
  return {
    next() {
      state ^= state << 13
      state >>>= 0
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      return state / 0x100000000
    },
    int(maxExclusive) {
      return Math.floor(this.next() * Math.max(1, maxExclusive))
    },
    range(min, max) {
      return min + this.next() * (max - min)
    },
  }
}

/** Deterministic 0..maxMs stagger so elements never start in lockstep. */
export function staggerDelay(index, seed = 1, maxMs = 800) {
  const random = createSeededRandom((Number(seed) || 1) + (Number(index) || 0) * 2654435761)
  return Math.round(random.next() * Math.max(0, maxMs))
}

/** Pause all loops when the tab is hidden, reduced motion is requested, or the stage is offscreen. */
export function shouldPauseScene({ documentHidden = false, reducedMotion = false, intersecting = true } = {}) {
  return documentHidden === true || reducedMotion === true || intersecting === false
}

const TRANSITIONS = {
  idle: new Set(['hover', 'pressed', 'sleeping']),
  hover: new Set(['idle', 'pressed', 'sleeping']),
  pressed: new Set(['hover', 'idle', 'dragging']),
  dragging: new Set(['idle', 'hover']),
  sleeping: new Set(['idle', 'hover', 'pressed']),
}

/**
 * Single-active-state machine for the interactive main pet.
 * States: idle, hover, pressed, dragging, sleeping.
 * @param {{sleepAfterMs?:number, now?:() => number, onChange?:(next:string, previous:string) => void}} [options]
 */
export function createSceneStateMachine(options = {}) {
  const sleepAfterMs = Math.max(1000, options.sleepAfterMs ?? 30000)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let state = 'idle'
  let idleSince = now()
  let clickPending = false
  const listeners = new Set()

  const machine = {
    get state() {
      return state
    },
    /** @param {string} next */
    transition(next) {
      if (!TRANSITIONS[state]?.has(next)) return false
      const previous = state
      state = next
      if (next === 'idle') idleSince = now()
      if (next === 'sleeping') clickPending = false
      options.onChange?.(next, previous)
      for (const listener of listeners) listener(next, previous)
      return true
    },
    activity() {
      if (state === 'sleeping') {
        idleSince = now()
        machine.transition('idle')
      } else if (state === 'idle') {
        idleSince = now()
      }
    },
    pointerEnter() {
      if (state === 'sleeping') {
        idleSince = now()
        machine.transition('idle')
        machine.transition('hover')
      } else {
        machine.transition('hover')
      }
    },
    pointerLeave() {
      if (state === 'hover') machine.transition('idle')
    },
    pointerDown() {
      clickPending = false
      if (!machine.transition('pressed')) return false
      clickPending = true
      idleSince = now()
      return true
    },
    pointerUp() {
      if (state !== 'pressed') return false
      const clicked = clickPending
      clickPending = clicked
      machine.transition('hover')
      return clicked
    },
    dragStart() {
      return machine.transition('dragging')
    },
    dragEnd() {
      clickPending = false
      if (state !== 'dragging') return false
      return machine.transition('hover')
    },
    tick() {
      if (state !== 'idle') return false
      if (now() - idleSince < sleepAfterMs) return false
      return machine.transition('sleeping')
    },
    consumeClick() {
      const value = clickPending
      clickPending = false
      return value
    },
    /** @param {(next:string, previous:string) => void} listener */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    remainingSleepMs() {
      return Math.max(0, sleepAfterMs - (now() - idleSince))
    },
  }
  return machine
}
