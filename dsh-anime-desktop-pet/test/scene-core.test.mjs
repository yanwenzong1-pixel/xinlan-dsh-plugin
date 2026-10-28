import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SCENE_ANIMATION_TYPES,
  SCENE_LAYERS,
  SCENE_POSITIONS_KEY,
  createSceneStateMachine,
  createSeededRandom,
  parseScenePositions,
  resolveSceneElement,
  sceneBreakpoint,
  sceneUnit,
  serializeScenePositions,
  shouldPauseScene,
  staggerDelay,
  validateSceneLayout,
  validateSceneManifest,
} from '../src/client/scene-core.mjs'

const manifest = {
  version: 1,
  stage: { width: 1536, height: 1024 },
  slices: [
    { id: 'ui-banner-main', layer: 'L4', tags: ['loop'], pivot: { x: 0.5, y: 0.5 }, file: 'assets/slices/@2x/ui-banner-main@2x.png', file1x: 'assets/slices/@1x/ui-banner-main@1x.png', width: 100, height: 50 },
    { id: 'pet-girl-main', layer: 'L2', tags: ['loop'], pivot: { x: 0.5, y: 0.9 }, file: 'assets/slices/@2x/pet-girl-main@2x.png', file1x: 'assets/slices/@1x/pet-girl-main@1x.png', width: 80, height: 120 },
  ],
}

const layout = {
  version: 1,
  breakpoints: { wide: 1280, medium: 768 },
  responsive: {
    medium: { scaleMultiplier: 0.8 },
    narrow: { scaleMultiplier: 0.5, hideLayers: ['L3'] },
  },
  elements: [
    { instanceId: 'banner', slice: 'ui-banner-main', layer: 'L4', anchor: { x: 0.5, y: 0.25 }, scale: 0.2, rotation: -1, opacity: 1, zIndex: 40, animation: { type: 'float', duration: 4000, amplitude: 8 }, mirror: false, interactive: false },
    { instanceId: 'girl', slice: 'pet-girl-main', layer: 'L2', anchor: { x: 0.2, y: 0.8 }, scale: 0.1, rotation: 0, opacity: 1, zIndex: 10, animation: { type: 'sway', duration: 5000, amplitude: 2 }, mirror: true, interactive: true },
  ],
}

test('scene breakpoints: wide/medium/narrow thresholds', () => {
  assert.equal(sceneBreakpoint(1600), 'wide')
  assert.equal(sceneBreakpoint(1280), 'wide')
  assert.equal(sceneBreakpoint(1279), 'medium')
  assert.equal(sceneBreakpoint(768), 'medium')
  assert.equal(sceneBreakpoint(767), 'narrow')
  assert.equal(sceneBreakpoint(375), 'narrow')
  assert.equal(sceneUnit({ width: 1920, height: 1080 }), 1080)
  assert.equal(sceneUnit({ width: 375, height: 812 }), 375)
})

test('manifest validation: valid input passes, bad layer/file/scale fails', () => {
  assert.deepEqual(validateSceneManifest(manifest), { ok: true, errors: [] })
  const duplicated = structuredClone(manifest)
  duplicated.slices.push({ ...duplicated.slices[0] })
  assert.equal(validateSceneManifest(duplicated).ok, false)
  const badLayer = structuredClone(manifest)
  badLayer.slices[0].layer = 'L9'
  assert.equal(validateSceneManifest(badLayer).ok, false)
  const badScale = structuredClone(manifest)
  badScale.slices[0].width = 0
  assert.equal(validateSceneManifest(badScale).ok, false)
  const mismatched = structuredClone(manifest)
  mismatched.slices[0].file1x = mismatched.slices[0].file
  assert.equal(validateSceneManifest(mismatched).ok, false)
})

test('layout validation: unique ids, anchors, slices, animation types', () => {
  assert.deepEqual(validateSceneLayout(layout, manifest), { ok: true, errors: [] })
  const missingSlice = structuredClone(layout)
  missingSlice.elements[0].slice = 'nope'
  assert.equal(validateSceneLayout(missingSlice, manifest).ok, false)
  const badAnchor = structuredClone(layout)
  badAnchor.elements[0].anchor.x = 1.2
  assert.equal(validateSceneLayout(badAnchor, manifest).ok, false)
  const duplicate = structuredClone(layout)
  duplicate.elements[1].instanceId = duplicate.elements[0].instanceId
  assert.equal(validateSceneLayout(duplicate, manifest).ok, false)
  const badAnimation = structuredClone(layout)
  badAnimation.elements[0].animation.type = 'explode'
  assert.equal(validateSceneLayout(badAnimation, manifest).ok, false)
  assert.ok(SCENE_LAYERS.includes('L2'))
  assert.ok(SCENE_ANIMATION_TYPES.includes('bubbleRise'))
  assert.ok(SCENE_ANIMATION_TYPES.includes('tailWave'))
  assert.ok(SCENE_ANIMATION_TYPES.includes('finWave'))
  assert.ok(SCENE_ANIMATION_TYPES.includes('blink'))
  const badInteraction = structuredClone(layout)
  badInteraction.interactions = { petClick: { bubbleCount: 13, bubbleIntervalMs: 200 } }
  assert.equal(validateSceneLayout(badInteraction, manifest).ok, false)
})

test('resolved geometry: normalized anchor + min-viewport unit + responsive multiplier', () => {
  const viewport = { width: 1000, height: 600 }
  const banner = resolveSceneElement(layout.elements[0], manifest.slices[0], viewport, 'wide', layout)
  assert.deepEqual(banner, { left: 500, top: 150, width: 120, height: 60, opacity: 1, hidden: false, breakpoint: 'wide' })
  const medium = resolveSceneElement(layout.elements[1], manifest.slices[1], viewport, 'medium', layout)
  assert.equal(medium.width, 48) // 600 * 0.1 * 0.8
  assert.equal(medium.height, 72)
  const narrowPaused = resolveSceneElement(
    { ...layout.elements[0], layer: 'L3' },
    manifest.slices[0],
    { width: 375, height: 812 },
    'narrow',
    layout,
  )
  assert.equal(narrowPaused.hidden, true)
})

test('seeded random + stagger are deterministic and bounded', () => {
  const first = createSeededRandom(42)
  const second = createSeededRandom(42)
  const values = Array.from({ length: 8 }, () => first.next())
  assert.deepEqual(values, Array.from({ length: 8 }, () => second.next()))
  for (const value of values) assert.ok(value >= 0 && value < 1)
  const delays = Array.from({ length: 12 }, (_, index) => staggerDelay(index, 42, 800))
  assert.deepEqual(delays, Array.from({ length: 12 }, (_, index) => staggerDelay(index, 42, 800)))
  for (const delay of delays) assert.ok(delay >= 0 && delay <= 800)
  assert.notEqual(delays[0], delays[1])
})

test('state machine: one active state, press/click, drag, sleep and wake', () => {
  let now = 0
  const events = []
  const machine = createSceneStateMachine({
    sleepAfterMs: 1000,
    now: () => now,
    onChange: (next, previous) => events.push([previous, next]),
  })
  assert.equal(machine.state, 'idle')
  machine.pointerEnter()
  assert.equal(machine.state, 'hover')
  machine.pointerDown()
  assert.equal(machine.state, 'pressed')
  machine.pointerUp()
  assert.equal(machine.state, 'hover')
  assert.equal(machine.consumeClick(), true)
  assert.equal(machine.consumeClick(), false)
  machine.dragStart()
  assert.equal(machine.state, 'hover')
  machine.pointerDown()
  machine.dragStart()
  assert.equal(machine.state, 'dragging')
  machine.dragEnd()
  assert.equal(machine.state, 'hover')
  machine.pointerLeave()
  assert.equal(machine.state, 'idle')
  now = 999
  assert.equal(machine.tick(), false)
  now = 1000
  assert.equal(machine.tick(), true)
  assert.equal(machine.state, 'sleeping')
  machine.pointerEnter()
  assert.equal(machine.state, 'hover')
  assert.ok(events.length >= 8)
})

test('pause rule: hidden tab or reduced motion pauses the loop', () => {
  assert.equal(shouldPauseScene({ documentHidden: true, reducedMotion: false, intersecting: true }), true)
  assert.equal(shouldPauseScene({ documentHidden: false, reducedMotion: true, intersecting: true }), true)
  assert.equal(shouldPauseScene({ documentHidden: false, reducedMotion: false, intersecting: false }), true)
  assert.equal(shouldPauseScene({ documentHidden: false, reducedMotion: false, intersecting: true }), false)
})

test('scene positions: invalid JSON/entries are ignored, valid positions round-trip', () => {
  assert.equal(SCENE_POSITIONS_KEY, 'dsh-anime-desktop-pet/scene-positions')
  assert.deepEqual(parseScenePositions(null), {})
  assert.deepEqual(parseScenePositions('not json'), {})
  assert.deepEqual(parseScenePositions('[]'), {})
  const parsed = parseScenePositions(JSON.stringify({
    'badge-live': { x: 0.12, y: 0.34 },
    broken: { x: 2, y: 0.5 },
    note: 'ignored',
  }))
  assert.deepEqual(parsed, { 'badge-live': { x: 0.12, y: 0.34 } })
  assert.deepEqual(JSON.parse(serializeScenePositions(parsed)), parsed)
})
