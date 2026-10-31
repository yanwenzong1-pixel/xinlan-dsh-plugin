import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import {
  SCENE_BASE_PATH,
  loadSceneData,
  mountScene,
  sceneAssetRelative,
  sceneAssetUrl,
} from '../src/client/scene.mjs'
import { validateSceneLayout, validateSceneManifest } from '../src/client/scene-core.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'assets', 'slices', 'manifest.json'), 'utf8'))
const layout = JSON.parse(readFileSync(join(root, 'assets', 'slices', 'layout.json'), 'utf8'))

function pngSize(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG')
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const colorType = buffer.readUInt8(25)
  return { width, height, colorType }
}

test('scene manifest/layout are valid and cover all sliced assets', () => {
  assert.deepEqual(validateSceneManifest(manifest), { ok: true, errors: [] })
  assert.deepEqual(validateSceneLayout(layout, manifest), { ok: true, errors: [] })
  assert.ok(manifest.slices.length >= 25, 'all recognizable elements are sliced')
  const ids = new Set(manifest.slices.map((slice) => slice.id))
  for (const id of ['ui-banner-main', 'ui-badge-live', 'ui-plaque-cheer', 'pet-girl-main', 'prop-books-mug']) {
    assert.ok(ids.has(id), `missing core slice ${id}`)
  }
  assert.ok(layout.elements.length >= 18 && layout.elements.length <= 60)
  assert.deepEqual(layout.interactions.petClick.bubbleSlices, ['fx-bubble-large'], 'rising bubbles use the large bubble asset')
  assert.equal(layout.emitters.length, 2, 'left plaque and bottom-right strip have ambience emitters')
  assert.equal(layout.emitters.find((emitter) => emitter.attachTo === 'bottom-strip')?.slices.includes('fx-bubble-large'), true)
  for (const element of layout.elements) assert.ok(ids.has(element.slice), `layout slice missing: ${element.slice}`)
})

test('every slice has @1x/@2x transparent PNG with strict 2x dimensions', () => {
  for (const slice of manifest.slices) {
    const twoPath = join(root, slice.file)
    const onePath = join(root, slice.file1x)
    assert.ok(existsSync(twoPath), `missing @2x ${slice.file}`)
    assert.ok(existsSync(onePath), `missing @1x ${slice.file1x}`)
    const two = pngSize(readFileSync(twoPath))
    const one = pngSize(readFileSync(onePath))
    assert.equal(two.colorType, 6, `${slice.id} @2x must keep RGBA`)
    assert.equal(one.colorType, 6, `${slice.id} @1x must keep RGBA`)
    assert.deepEqual([two.width, two.height], [slice.width, slice.height])
    assert.deepEqual([one.width, one.height], [two.width / 2, two.height / 2], `${slice.id} must be exactly 2x`)
  }
})

test('scene asset URLs resolve @1x/@2x from the host prefix', () => {
  const banner = manifest.slices.find((slice) => slice.id === 'ui-banner-main')
  assert.equal(sceneAssetRelative(banner.file), '@2x/ui-banner-main@2x.png')
  assert.equal(sceneAssetUrl(SCENE_BASE_PATH, banner, 1), `${SCENE_BASE_PATH}@1x/ui-banner-main@1x.png`)
  assert.equal(sceneAssetUrl(SCENE_BASE_PATH, banner, 2), `${SCENE_BASE_PATH}@2x/ui-banner-main@2x.png`)
  assert.equal(sceneAssetUrl(SCENE_BASE_PATH, banner, 3), `${SCENE_BASE_PATH}@2x/ui-banner-main@2x.png`, 'DPR is capped at 2x')
})

test('loader fetches and validates manifest/layout; invalid payload rejects', async () => {
  const responses = new Map([
    [`${SCENE_BASE_PATH}manifest.json`, manifest],
    [`${SCENE_BASE_PATH}layout.json`, layout],
  ])
  const fetchImpl = async (url) => ({
    ok: responses.has(url),
    status: responses.has(url) ? 200 : 404,
    json: async () => responses.get(url),
  })
  const data = await loadSceneData(fetchImpl)
  assert.equal(data.manifest.slices.length, manifest.slices.length)
  assert.equal(data.layout.elements.length, layout.elements.length)
  await assert.rejects(() => loadSceneData(async () => ({ ok: true, status: 200, json: async () => ({ version: 1, slices: [] }) })))
})

test('mountScene renders every layout element with the expected CSS/asset mapping', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test', pretendToBeVisual: true })
  Object.defineProperty(dom.window, 'devicePixelRatio', { value: 1, configurable: true })
  const storage = new Map([['dsh-anime-desktop-pet/overlay-visible-v2', 'true']])
  const scene = mountScene({
    document: dom.window.document,
    window: dom.window,
    manifest,
    layout,
    options: {
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      seed: 7,
    },
  })
  await scene.ready
  assert.equal(scene.elements.size, layout.elements.length)
  assert.equal(scene.host.getAttribute('data-xllh-scene-host'), '')
  const images = [...scene.stage.querySelectorAll('img')]
  assert.ok(images.length >= layout.elements.length)
  assert.ok(images.every((image) => image.src.includes('/assets/scene/@1x/')), 'standard DPR uses @1x')
  assert.ok(images.some((image) => image.src.includes('ui-badge-live@1x.png')), 'LIVE badge slice must be rendered')
  const interactive = [...scene.stage.querySelectorAll('.scene-element[data-interactive="true"]')]
  assert.equal(interactive.length, 0, 'girl pets are intentionally removed')
  const draggable = [...scene.stage.querySelectorAll('.scene-element[data-draggable="true"]')]
  assert.equal(draggable.length, 10, 'LIVE, plaque, four bubbles and four fish are movable')
  const strip = scene.elements.get('bottom-strip').wrapper
  const stripSlice = manifest.slices.find((slice) => slice.id === 'ui-bottom-strip')
  assert.equal(strip.dataset.widthMode, 'intrinsic', 'bottom strip keeps its original asset width')
  assert.equal(strip.dataset.align, 'bottom-right', 'bottom strip is anchored to the bottom-right')
  assert.equal(strip.style.width, `${stripSlice.width / 2}px`, 'bottom strip uses @2x/2 logical pixels')
  assert.match(strip.querySelector('img').src, /ui-bottom-strip@1x\.png/, 'bottom strip uses the full bottom asset')
  assert.equal(scene.stage.dataset.paused, 'false')

  // Dragging a movable label persists a normalized position for the next mount.
  const badge = scene.elements.get('badge-live').wrapper
  badge.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }))
  badge.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: 140, clientY: 124 }))
  badge.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: 140, clientY: 124 }))
  const storedPositions = JSON.parse(storage.get('dsh-anime-desktop-pet/scene-positions'))
  assert.ok(storedPositions['badge-live'], 'dragged label position must persist')
  assert.ok(storedPositions['badge-live'].x > 0 && storedPositions['badge-live'].x < 1)
  assert.ok(storedPositions['badge-live'].y > 0 && storedPositions['badge-live'].y < 1)

  // Persisted show/hide works exactly like the legacy overlay.
  dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }))
  assert.equal(scene.host.style.display, 'none')
  assert.equal(storage.get('dsh-anime-desktop-pet/overlay-visible-v2'), 'false')
  dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  }))
  assert.equal(scene.host.style.display, '')
  assert.equal(storage.get('dsh-anime-desktop-pet/overlay-visible-v2'), 'true')

  scene.dispose()
  assert.equal(dom.window.document.querySelector('[data-xllh-scene-host]'), null, 'dispose removes the host')
  dom.window.close()
})

test('mountScene defaults to hidden with no persisted preference', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test', pretendToBeVisual: true })
  const scene = mountScene({
    document: dom.window.document,
    window: dom.window,
    manifest,
    layout,
    options: {
      storage: { getItem: () => null, setItem() {} },
    },
  })
  await scene.ready
  assert.equal(scene.host.style.display, 'none', 'scene must be hidden on first mount')
  assert.equal(scene.stage.dataset.paused, 'true', 'hidden scene must not run animations')
  scene.dispose()
  dom.window.close()
})

test('mountScene honors persisted hidden state and reduced-motion pause', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test', pretendToBeVisual: true })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  const scene = mountScene({
    document: dom.window.document,
    window: dom.window,
    manifest,
    layout,
    options: {
      storage: { getItem: () => 'false', setItem() {} },
    },
  })
  await scene.ready
  assert.equal(scene.host.style.display, 'none', 'F5 keeps a hidden scene hidden')
  assert.equal(scene.stage.dataset.paused, 'true', 'reduced motion pauses all loops')
  scene.dispose()
  dom.window.close()
})

test('mount/dispose 20 cycles leaves no scene hosts behind', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test', pretendToBeVisual: true })
  for (let index = 0; index < 20; index += 1) {
    const scene = mountScene({
      document: dom.window.document,
      window: dom.window,
      manifest,
      layout,
      options: { seed: index + 1, storage: { getItem: () => null, setItem() {} } },
    })
    await scene.ready
    assert.equal(dom.window.document.querySelectorAll('[data-xllh-scene-host]').length, 1)
    scene.dispose()
    assert.equal(dom.window.document.querySelectorAll('[data-xllh-scene-host]').length, 0)
  }
  dom.window.close()
})
