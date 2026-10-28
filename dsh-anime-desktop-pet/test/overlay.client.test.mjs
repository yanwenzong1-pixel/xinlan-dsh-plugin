/**
 * 覆盖层 DOM 行为（jsdom）：运行态显示/隐藏、多会话独立、左键穿透、右键命中与
 * 菜单、设置面板单选锁定/多选至少保留一个、动画绑定稳定与重绑、卸载清理。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ANIMATIONS, BANNER_POSITION_KEY, BANNER_VISIBLE_KEY, FIXED_POSITION_KEY, OVERLAY_VISIBLE_KEY } from '../src/client/core.mjs'
import { SETTINGS_MESSAGES, mountOverlay } from '../src/client/overlay.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { JSDOM } = require('jsdom')

const MULTI = [
  { id: 'anim-a', name: '动画 A', file: 'a.gif', enabled: true },
  { id: 'anim-b', name: '动画 B', file: 'b.gif', enabled: true },
  { id: 'anim-c', name: '动画 C', file: 'c.gif', enabled: true },
]

/** One jsdom page + row factory + overlay under test. */
function bench(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const { document } = window
  const stored = new Map(options.storedEntries ?? (options.stored === undefined ? [] : [['dsh-anime-desktop-pet/selection', options.stored]]))
  const storage = {
    getItem: (key) => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => { stored.set(key, value) },
  }
  let randomCalls = 0
  const random = options.random ?? (() => { randomCalls += 1; return 0 })
  const overlay = mountOverlay({
    document,
    window,
    animations: options.animations ?? ANIMATIONS,
    storage,
    random,
    ...options.overlay,
  })
  const addRow = (sessionId, rect = { left: 100, top: 100, width: 200, height: 40 }) => {
    const el = document.createElement('div')
    el.setAttribute('data-row-key', `session:${sessionId}`)
    el.textContent = sessionId
    document.getElementById('list').appendChild(el)
    stubRect(el, rect)
    return el
  }
  const addWorkspace = (key, rect, { expanded = false, text = 'test' } = {}) => {
    const el = document.createElement('div')
    el.setAttribute('data-row-key', `workspace:${key}`)
    el.setAttribute('aria-expanded', String(expanded))
    el.textContent = text
    document.getElementById('list').appendChild(el)
    stubRect(el, rect)
    return el
  }
  return { dom, window, document, overlay, addRow, addWorkspace, storage, stored, randomCalls: () => randomCalls }
}

function stubRect(el, { left, top, width, height }) {
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON() { return this },
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 40))

function petHost(document) {
  return document.querySelector('[data-xllh-pet-host]')
}

function pets(document) {
  return [...petHost(document).shadowRoot.querySelectorAll('[data-xllh-pet]')]
}

function petOf(document, sessionId) {
  return pets(document).find((el) => el.getAttribute('data-session-id') === sessionId)
}

function shadow(document) {
  return petHost(document).shadowRoot
}

function contextMenu(document, x, y) {
  const event = new document.defaultView.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
  })
  document.body.dispatchEvent(event)
  return event
}

function setPointer(document, x, y) {
  const event = new document.defaultView.MouseEvent('pointermove', {
    bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
  })
  document.body.dispatchEvent(event)
  return event
}

function petCenter(el) {
  return [
    parseFloat(el.style.left) + parseFloat(el.style.width) / 2,
    parseFloat(el.style.top) + parseFloat(el.style.height) / 2,
  ]
}

test('标准渲染：直接以 80px（行高×2.5）渲染，无 hover 两态、aria-hidden 且只挂载可见实例', async () => {
  const b = bench()
  b.addRow('s1', { left: 100, top: 100, width: 200, height: 32 })
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  const pet = petOf(b.document, 's1')
  assert.ok(pet, 'running session animation must mount')
  assert.equal(pet.style.width, '80px', 'STANDARD_ANIMATION_SIZE = 32 * 2.5')
  assert.equal(pet.style.height, '80px')
  assert.equal(pet.style.position, 'fixed')
  assert.equal(pet.style.pointerEvents, 'none')
  assert.equal(pet.getAttribute('aria-hidden'), 'true')
  assert.equal(pet.getAttribute('tabindex'), null, 'decorative animation must not be tabbable')
  assert.equal(pet.style.transform, '', 'no thumbnail -> hover two-state scaling')
  assert.equal(pet.style.borderRadius, '15px', 'every animation node carries the radius inline')
  assert.equal(pet.style.overflow, 'hidden')
  assert.match(pet.style.clipPath, /15px/)
  assert.match(shadow(b.document).querySelector('style').textContent, /\.pet \{[^}]*border-radius: 15px;/, 'sidebar animation card uses a 15px radius')
  assert.match(shadow(b.document).querySelector('style').textContent, /\.pet \{[^}]*overflow: hidden;/, 'rounded corners must clip the image/canvas')
  const img = pet.querySelector('img')
  const src = img.src
  setPointer(b.document, ...petCenter(pet))
  assert.equal(pet.style.transform, '', 'pointermove must never scale the standard animation')
  assert.equal(pet.querySelector('img'), img)
  assert.equal(pet.querySelector('img').src, src, 'GIF node/src must stay stable')
  b.dom.window.close()
})

test('R2 可见性仲裁：相邻运行仅上方展示、间隔运行展示；运行状态变化后全量重算且卸载旧实例', async () => {
  const b = bench()
  for (let index = 0; index < 7; index += 1) {
    b.addRow(`c${index + 1}`, { left: 100, top: 100 + index * 32, width: 200, height: 32 })
  }
  b.overlay.update(new Map([['c1', true], ['c3', true]]))
  await flush()
  assert.deepEqual(pets(b.document).map((pet) => pet.getAttribute('data-session-id')), ['c1'])

  b.overlay.update(new Map([['c1', true], ['c3', true], ['c4', true]]))
  await flush()
  assert.deepEqual(pets(b.document).map((pet) => pet.getAttribute('data-session-id')).sort(), ['c1', 'c4'])

  // #1 结束：#3 接替，#4 被 #3 遮挡；旧 #1 节点必须被卸载。
  b.overlay.update(new Map([['c3', true], ['c4', true]]))
  await flush()
  assert.deepEqual(pets(b.document).map((pet) => pet.getAttribute('data-session-id')), ['c3'])
  assert.equal(petOf(b.document, 'c1'), undefined, 'stale node must unmount')
  assert.equal(petOf(b.document, 'c4'), undefined)

  // #3 结束：#4 恢复。
  b.overlay.update(new Map([['c4', true]]))
  await flush()
  assert.deepEqual(pets(b.document).map((pet) => pet.getAttribute('data-session-id')), ['c4'])
  assert.equal(pets(b.document).length, 1)
  b.dom.window.close()
})

test('3 个相邻运行会话：严格仲裁只剩一个时，第二张动画同列堆叠且不脱离左边栏', async () => {
  const b = bench()
  b.addRow('c1', { left: 100, top: 100, width: 200, height: 32 })
  b.addRow('c2', { left: 100, top: 132, width: 200, height: 32 })
  b.addRow('c3', { left: 100, top: 164, width: 200, height: 32 })
  b.overlay.update(new Map([['c1', true], ['c2', true], ['c3', true]]))
  await flush()
  const mounted = pets(b.document)
  assert.equal(mounted.length, 2, 'three running conversations must show two animations')
  assert.deepEqual(mounted.map((pet) => pet.getAttribute('data-session-id')).sort(), ['c1', 'c2'])
  const [first, second] = mounted
  assert.equal(second.style.left, first.style.left, 'both animations stay flush against the sidebar column')
  const firstBottom = parseFloat(first.style.top) + parseFloat(first.style.height)
  const secondTop = parseFloat(second.style.top)
  assert.ok(secondTop >= firstBottom + 8, 'fallback is vertically stacked without overlap')
  for (const pet of mounted) {
    assert.equal(pet.style.borderRadius, '15px')
    assert.equal(pet.style.overflow, 'hidden')
  }
  b.dom.window.close()
})

test('上下文用量：两个动画都勾选时 >45% 很累、<=45% 工作，跨阈值立即切换', async () => {
  const b = bench({ storedEntries: [['dsh-anime-desktop-pet/selection', JSON.stringify(['blue-fat-fish-working', 'blue-fat-fish-tired'])]] })
  b.addRow('s1', { left: 100, top: 100, width: 200, height: 32 })
  b.overlay.update(new Map([['s1', { contextPercent: 45 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-working\.gif\?v=\d+$/)
  b.overlay.update(new Map([['s1', { contextPercent: 46 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /\/assets\/animated\/blue-fat-fish-tired\.gif\?v=\d+$/)
  b.overlay.update(new Map([['s1', { contextPercent: 92 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-tired\.gif/)
  // 回落到工作图；缺失/非法上下文按工作图处理。
  b.overlay.update(new Map([['s1', { contextPercent: 45 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-working\.gif/)
  b.overlay.update(new Map([['s1', { contextPercent: null }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-working\.gif/)
  b.dom.window.close()
})

test('只勾选一个动画时始终使用该动画：只选很累不回落，只选工作不被上下文替换', async () => {
  const tiredOnly = bench({ storedEntries: [['dsh-anime-desktop-pet/selection', JSON.stringify(['blue-fat-fish-tired'])]] })
  tiredOnly.addRow('s1', { left: 100, top: 100, width: 200, height: 32 })
  tiredOnly.overlay.update(new Map([['s1', { contextPercent: 5 }]]))
  await flush()
  assert.match(petOf(tiredOnly.document, 's1').querySelector('img').src, /blue-fat-fish-tired\.gif/)
  tiredOnly.overlay.update(new Map([['s1', { contextPercent: 99 }]]))
  await flush()
  assert.match(petOf(tiredOnly.document, 's1').querySelector('img').src, /blue-fat-fish-tired\.gif/)
  tiredOnly.dom.window.close()

  const workingOnly = bench()
  workingOnly.addRow('s1', { left: 100, top: 100, width: 200, height: 32 })
  workingOnly.overlay.update(new Map([['s1', { contextPercent: 99 }]]))
  await flush()
  assert.match(petOf(workingOnly.document, 's1').querySelector('img').src, /blue-fat-fish-working\.gif/)
  workingOnly.dom.window.close()
})

test('R3 折叠工作区：无会话行时在文件夹行显示一个 85px 动画，展开后回落会话级', async () => {
  const b = bench({ storedEntries: [['dsh-anime-desktop-pet/selection', JSON.stringify(['blue-fat-fish-working', 'blue-fat-fish-tired'])]] })
  const workspace = b.addWorkspace('w1', { left: 12, top: 100, width: 256, height: 34 }, { expanded: false, text: 'test' })
  b.overlay.update(new Map([['s1', { cwd: 'C:\\work\\test', running: true, contextPercent: 75 }]]))
  await flush()
  const workspacePet = shadow(b.document).querySelector('[data-xllh-workspace-animation]')
  assert.ok(workspacePet, 'collapsed workspace with a running session must show one workspace animation')
  assert.equal(workspacePet.getAttribute('data-workspace-id'), 'workspace:w1')
  assert.equal(workspacePet.style.width, '85px', '34 * 2.5')
  assert.match(workspacePet.querySelector('img').src, /blue-fat-fish-tired\.gif/, 'collapsed workspace uses max context percent')
  assert.equal(pets(b.document).length, 0, 'collapsed workspace must not mount session-level nodes')

  workspace.setAttribute('aria-expanded', 'true')
  b.addRow('s1', { left: 12, top: 140, width: 256, height: 32 })
  b.overlay.update(new Map([['s1', { cwd: 'C:\\work\\test', running: true, contextPercent: 30 }]]))
  await flush()
  assert.equal(shadow(b.document).querySelector('[data-xllh-workspace-animation]'), null)
  assert.equal(petOf(b.document, 's1')?.style.width, '80px')
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-working\.gif/)
  b.dom.window.close()
})

test('R4 固定基准遮挡：与固定形象矩形相交的侧栏动画不挂载，基准移开后可恢复', async () => {
  const b = bench()
  b.addRow('c1', { left: 100, top: 100, width: 200, height: 32 })
  b.addRow('c5', { left: 100, top: 228, width: 200, height: 32 })
  const fixed = fixedPet(b.document)
  fixed.getBoundingClientRect = () => ({
    left: 300, top: 76, width: 80, height: 80, right: 380, bottom: 156, x: 300, y: 76,
    toJSON() { return this },
  })
  b.overlay.update(new Map([['c1', true], ['c5', true]]))
  await flush()
  assert.equal(petOf(b.document, 'c1'), undefined, 'animation overlapping the fixed benchmark must stay unmounted')
  assert.ok(petOf(b.document, 'c5'))
  fixed.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0,
    toJSON() { return this },
  })
  b.overlay.update(new Map([['c1', true], ['c5', true]]))
  await flush()
  assert.ok(petOf(b.document, 'c1'), 'benchmark moved away -> recalculated and shown')
  b.dom.window.close()
})

test('卸载清理：宿主节点移除，之后右键不再被插件拦截', async () => {
  const b = bench()
  assert.ok(petHost(b.document), 'host must be appended to body')
  b.overlay.dispose()
  assert.equal(petHost(b.document), null)
  const event = contextMenu(b.document, 10, 10)
  assert.equal(event.defaultPrevented, false)
  b.dom.window.close()
})

test('无运行会话无动画；运行会话出现，停止后立即移除', async () => {
  const b = bench()
  b.overlay.update(new Map())
  await flush()
  assert.equal(pets(b.document).length, 0)

  b.addRow('s1')
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  const pet = petOf(b.document, 's1')
  assert.ok(pet, 'running session must get its own animation node')
  assert.match(pet.querySelector('img').src, /blue-fat-fish-working\.gif\?v=\d+$/)

  b.overlay.update(new Map([['s1', false]]))
  await flush()
  assert.equal(petOf(b.document, 's1'), undefined)
  b.dom.window.close()
})

test('行缺失/尺寸无效/滚出视口/被遮挡：候选不进入仲裁，不残留节点', async () => {
  const b = bench()
  b.addRow('s1', { left: 100, top: 100, width: 200, height: 40 })
  b.addRow('s2', { left: 100, top: 200, width: 0, height: 40 })
  b.addRow('s3', { left: 100, top: -500, width: 200, height: 40 })
  b.overlay.update(new Map([['s1', true], ['s2', true], ['s3', true], ['missing', true]]))
  await flush()
  assert.equal(pets(b.document).length, 1)
  assert.ok(petOf(b.document, 's1'))
  assert.equal(petOf(b.document, 's2'), undefined)
  assert.equal(petOf(b.document, 's3'), undefined)
  assert.equal(petOf(b.document, 'missing'), undefined)
  const pet = petOf(b.document, 's1')
  assert.equal(pet.style.position, 'fixed')
  assert.equal(pet.style.width, '100px', 'STANDARD size = row height 40 * 2.5')
  assert.equal(pet.style.height, '100px')
  b.dom.window.close()
})

function fixedPet(document) {
  return shadow(document).querySelector('[data-xllh-pet-fixed]')
}

function fixedCenter(el) {
  return [parseFloat(el.style.left) + parseFloat(el.style.width) / 2, parseFloat(el.style.top) + parseFloat(el.style.height) / 2]
}

test('左键穿透设计：动画层 pointer-events:none，固定形象自身可交互', async () => {
  const b = bench()
  b.addRow('s1')
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  assert.equal(petHost(b.document).style.pointerEvents, 'none')
  const pet = petOf(b.document, 's1')
  assert.equal(pet.style.pointerEvents, 'none')
  assert.equal(pet.querySelector('img').style.pointerEvents, 'none')
  assert.equal(fixedPet(b.document).style.pointerEvents, 'auto', '固定形象要能拖动/右键')
  b.dom.window.close()
})

test('固定形象：默认右下角、始终可见、加载 25 帧 GIF 资源', async () => {
  const b = bench()
  const fixed = fixedPet(b.document)
  assert.ok(fixed, 'fixed desktop character must exist')
  assert.equal(fixed.style.position, 'fixed')
  assert.equal(fixed.style.width, '220px')
  assert.equal(fixed.style.height, '220px')
  assert.equal(fixed.style.left, '780px', '1024 - 220 - 24')
  assert.equal(fixed.style.top, '524px', '768 - 220 - 24')
  assert.match(fixed.getAttribute('src'), /\/assets\/animated\/blue-fat-fish-eating\.gif\?v=\d+$/)
  assert.match(fixed.getAttribute('aria-label'), /蓝色大肥鱼/)
  assert.equal(fixed.hidden, false, 'fixed character shows even with no running sessions')
  b.dom.window.close()
})

test('侧栏图标右键不再弹插件菜单（保留图片缩放），固定形象右键弹设置菜单', async () => {
  const b = bench()
  b.addRow('s1')
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  // 侧栏图标：右键不拦截、不弹插件菜单，DSH 原生菜单保持
  const petEvent = contextMenu(b.document, 320, 100)
  assert.equal(petEvent.defaultPrevented, false, 'DSH native context menu must stay untouched')
  assert.equal(shadow(b.document).querySelector('[data-xllh-pet-menu]').hidden, true)

  // 固定形象：右键拦截并弹菜单，「设置」打开设置面板
  const fixed = fixedPet(b.document)
  const [fx, fy] = fixedCenter(fixed)
  const fixedEvent = new b.window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, composed: true, clientX: fx, clientY: fy,
  })
  fixed.dispatchEvent(fixedEvent)
  assert.equal(fixedEvent.defaultPrevented, true)
  const menu = shadow(b.document).querySelector('[data-xllh-pet-menu]')
  assert.equal(menu.hidden, false)
  assert.match(menu.textContent, /设置/)
  menu.querySelector('button').click()
  const settings = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  assert.equal(settings.hidden, false)
  b.document.body.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(settings.hidden, true)
  b.dom.window.close()
})

test('固定形象：可拖动并记住位置，越界被 clamp，重载恢复', async () => {
  const b = bench()
  const fixed = fixedPet(b.document)
  const [sx, sy] = fixedCenter(fixed)
  fixed.dispatchEvent(new b.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: sx, clientY: sy,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: sx - 200, clientY: sy - 300,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerup', {
    bubbles: true, composed: true, clientX: sx - 200, clientY: sy - 300,
  }))
  assert.equal(fixed.style.left, '580px')
  assert.equal(fixed.style.top, '224px')
  const saved = b.stored.get(FIXED_POSITION_KEY)
  assert.ok(saved, 'dragged position must persist')
  assert.deepEqual(JSON.parse(saved), { x: 580, y: 224 })

  // 拖出视口 → clamp 到边距
  const [x2, y2] = fixedCenter(fixed)
  fixed.dispatchEvent(new b.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: x2, clientY: y2,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: 5000, clientY: 5000,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerup', {
    bubbles: true, composed: true, clientX: 5000, clientY: 5000,
  }))
  assert.equal(fixed.style.left, '780px')
  assert.equal(fixed.style.top, '524px')

  // 重新挂载：从持久化位置恢复
  const b2 = bench({ storedEntries: [[FIXED_POSITION_KEY, JSON.stringify({ x: 300, y: 220 })]] })
  assert.equal(fixedPet(b2.document).style.left, '300px')
  assert.equal(fixedPet(b2.document).style.top, '220px')
  b.dom.window.close()
  b2.dom.window.close()
})

test('桌面横幅：默认展示、透明原图、可拖动并持久化，重载恢复', async () => {
  const b = bench()
  const banner = shadow(b.document).querySelector('[data-xllh-banner]')
  assert.ok(banner, 'desktop banner must always mount')
  assert.equal(banner.hidden, false, 'banner is visible by default')
  assert.equal(banner.style.width, '720px')
  assert.equal(banner.style.height, '240px', 'height follows the 2172x724 aspect ratio')
  assert.equal(banner.style.left, '152px')
  assert.equal(banner.style.top, '504px')
  assert.equal(banner.style.pointerEvents, 'auto')
  assert.match(banner.getAttribute('aria-label'), /蓝色大肥鱼/)
  assert.match(banner.querySelector('[data-xllh-banner-image]').getAttribute('src'), /\/assets\/banner\/blue-fat-fish-live-banner\.gif\?v=\d+$/)

  const sx = 512
  const sy = 624
  banner.dispatchEvent(new b.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: sx, clientY: sy,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: sx - 200, clientY: sy - 100,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerup', {
    bubbles: true, composed: true, clientX: sx - 200, clientY: sy - 100,
  }))
  assert.equal(banner.style.left, '24px', 'dragging clamps to the viewport margin')
  assert.equal(banner.style.top, '404px')
  assert.deepEqual(JSON.parse(b.stored.get(BANNER_POSITION_KEY)), { x: 24, y: 404, width: 720 })

  const b2 = bench({ storedEntries: [[BANNER_POSITION_KEY, JSON.stringify({ x: 300, y: 400, width: 600 })]] })
  const restored = shadow(b2.document).querySelector('[data-xllh-banner]')
  assert.equal(restored.style.width, '600px')
  assert.equal(restored.style.height, '200px')
  assert.equal(restored.style.left, '300px')
  assert.equal(restored.style.top, '400px')
  b.dom.window.close()
  b2.dom.window.close()
})

test('桌面横幅：右下角把手等比缩放，min/max clamp 且持久化', async () => {
  const b = bench()
  const banner = shadow(b.document).querySelector('[data-xllh-banner]')
  const handle = banner.querySelector('[data-xllh-banner-resize]')
  assert.ok(handle, 'resize handle must exist')
  handle.dispatchEvent(new b.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: 800, clientY: 700,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: 1040, clientY: 700,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerup', {
    bubbles: true, composed: true, clientX: 1040, clientY: 700,
  }))
  assert.equal(banner.style.width, '960px')
  assert.equal(banner.style.height, '320px', 'aspect ratio is preserved')
  assert.equal(banner.style.top, '424px', 'height growth clamps the banner into the viewport')
  assert.deepEqual(JSON.parse(b.stored.get(BANNER_POSITION_KEY)), { x: 40, y: 424, width: 960 })

  handle.dispatchEvent(new b.window.MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: 1000, clientY: 700,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointermove', {
    bubbles: true, composed: true, clientX: 0, clientY: 700,
  }))
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerup', {
    bubbles: true, composed: true, clientX: 0, clientY: 700,
  }))
  assert.equal(banner.style.width, '240px', 'min width clamps')
  assert.equal(banner.style.height, '80px')
  b.dom.window.close()
})

test('桌面横幅：设置复选框控制显示/隐藏并持久化，默认开启', async () => {
  const b = bench()
  const banner = shadow(b.document).querySelector('[data-xllh-banner]')
  b.overlay.openSettings()
  let toggle = shadow(b.document).querySelector('[data-xllh-banner-toggle]')
  assert.ok(toggle, 'settings must expose the banner toggle')
  assert.equal(toggle.checked, true)
  toggle.click()
  assert.equal(banner.hidden, true)
  assert.equal(b.stored.get(BANNER_VISIBLE_KEY), 'false')
  toggle.click()
  assert.equal(banner.hidden, false)
  assert.equal(b.stored.get(BANNER_VISIBLE_KEY), 'true')

  const b2 = bench({ storedEntries: [[BANNER_VISIBLE_KEY, 'false']] })
  assert.equal(shadow(b2.document).querySelector('[data-xllh-banner]').hidden, true)
  b2.overlay.openSettings()
  toggle = shadow(b2.document).querySelector('[data-xllh-banner-toggle]')
  assert.equal(toggle.checked, false)
  b.dom.window.close()
  b2.dom.window.close()
})

test('快捷键 Ctrl+Shift+F12 一键显示/隐藏整个桌宠组件', async () => {
  const b = bench()
  b.addRow('s1')
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  const press = () => {
    const event = new b.window.KeyboardEvent('keydown', {
      key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })
    b.document.body.dispatchEvent(event)
    return event
  }
  const hide = press()
  assert.equal(hide.defaultPrevented, true)
  assert.equal(petHost(b.document).style.display, 'none')
  assert.equal(b.stored.get(OVERLAY_VISIBLE_KEY), 'false', 'hidden state must persist')
  const show = press()
  assert.equal(show.defaultPrevented, true)
  assert.equal(petHost(b.document).style.display, '')
  assert.equal(b.stored.get(OVERLAY_VISIBLE_KEY), 'true')
  await flush()
  assert.equal(petOf(b.document, 's1').hidden, false)
  const plain = new b.window.KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true })
  b.document.body.dispatchEvent(plain)
  assert.equal(plain.defaultPrevented, false)
  b.dom.window.close()

  // Reload with a persisted hidden state: the overlay starts hidden and the shortcut restores it.
  const b2 = bench({ storedEntries: [[OVERLAY_VISIBLE_KEY, 'false']] })
  assert.equal(petHost(b2.document).style.display, 'none', 'refresh keeps the overlay hidden')
  const show2 = new b2.window.KeyboardEvent('keydown', {
    key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  })
  b2.document.body.dispatchEvent(show2)
  assert.equal(show2.defaultPrevented, true)
  assert.equal(petHost(b2.document).style.display, '')
  assert.equal(b2.stored.get(OVERLAY_VISIBLE_KEY), 'true')
  b2.dom.window.close()
})

test('设置面板：两个动画均可选，默认只勾工作图；可勾选很累、两个同时激活', async () => {
  const b = bench()
  b.overlay.openSettings()
  const dialog = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  assert.equal(dialog.hidden, false)
  let boxes = [...dialog.querySelectorAll('.role-row input[type="checkbox"]')]
  assert.equal(boxes.length, 2, 'working + tired are both selectable')
  assert.deepEqual(boxes.map((box) => box.checked), [true, false], 'default selection stays the working animation')
  assert.deepEqual(boxes.map((box) => box.disabled), [false, false], 'neither choice is locked now')
  assert.match(dialog.textContent, /蓝色大肥鱼正在工作/)
  assert.match(dialog.textContent, /蓝色大肥鱼很累/)

  boxes[1].click()
  const stored = JSON.parse(b.storage.getItem('dsh-anime-desktop-pet/selection'))
  assert.deepEqual(stored.sort(), ['blue-fat-fish-tired', 'blue-fat-fish-working'])
  b.addRow('s1', { left: 100, top: 100, width: 200, height: 32 })
  b.overlay.update(new Map([['s1', { contextPercent: 46 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-tired\.gif/)

  // 取消工作图，只留很累：低上下文也保持很累。
  b.overlay.openSettings()
  boxes = [...shadow(b.document).querySelectorAll('[data-xllh-pet-settings] .role-row input[type="checkbox"]')]
  boxes[0].click()
  b.overlay.update(new Map([['s1', { contextPercent: 1 }]]))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /blue-fat-fish-tired\.gif/)
  b.dom.window.close()
})

test('设置面板在整个桌面居中显示，且不引入蒙层', async () => {
  const b = bench()
  b.overlay.openSettings()
  const root = shadow(b.document)
  const dialog = root.querySelector('[data-xllh-pet-settings]')
  assert.equal(dialog.hidden, false)
  assert.equal(dialog.style.left, '50%', '水平居中：left 50%')
  assert.equal(dialog.style.top, '50%', '垂直居中：top 50%')
  assert.equal(dialog.style.transform, 'translate(-50%, -50%)', '用 translate 回正自身宽高')
  // 保持现状：设置面板不配蒙层/遮罩，点击面板外仍然关闭。
  assert.equal(root.querySelector('[data-xllh-pet-backdrop]'), null)
  assert.equal(root.querySelector('.backdrop, .mask, .overlay'), null)
  b.dom.window.close()
})

test('多动画：可多选，但拒绝取消最后一个并给出提示', async () => {
  const b = bench({ animations: MULTI, stored: '["anim-a","anim-b"]' })
  b.overlay.openSettings()
  const dialog = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  const boxes = [...dialog.querySelectorAll('.role-row input[type="checkbox"]')]
  assert.deepEqual(boxes.map((box) => box.checked), [true, true, false])
  assert.equal(boxes[0].disabled, false)

  // 取消 anim-b（anim-a 仍勾选）：允许，落盘
  boxes[1].checked = false
  boxes[1].dispatchEvent(new b.window.Event('change', { bubbles: true }))
  assert.equal(dialog.querySelector('[role="status"]').textContent, '')
  assert.equal(b.stored.get('dsh-anime-desktop-pet/selection'), '["anim-a"]')

  // 再取消 anim-a（最后一个）：应被拒绝 + 明确提示（面板会按当前选择重建复选框）
  const afterAllowed = [...dialog.querySelectorAll('.role-row input[type="checkbox"]')]
  afterAllowed[0].checked = false
  afterAllowed[0].dispatchEvent(new b.window.Event('change', { bubbles: true }))
  assert.equal(dialog.querySelector('[role="status"]').textContent, SETTINGS_MESSAGES.last)
  const afterBlocked = [...dialog.querySelectorAll('.role-row input[type="checkbox"]')]
  assert.deepEqual(afterBlocked.map((box) => box.checked), [true, false, false])
  assert.equal(b.stored.get('dsh-anime-desktop-pet/selection'), '["anim-a"]')
  b.dom.window.close()
})

test('随机绑定：同一运行期间滚动/重排保持稳定，勾选集合变化后重新校正', async () => {
  const sequence = [0, 0.9]
  const b = bench({ animations: MULTI, stored: '["anim-a","anim-b"]', random: () => sequence.shift() ?? 0 })
  b.addRow('s1')
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  const first = petOf(b.document, 's1').querySelector('img').src
  assert.match(first, /a\.gif\?v=\d+$/) // random 0 → 首个勾选项
  // 再次 update（模拟滚动/重排）不得重掷随机
  b.overlay.update(new Map([['s1', true]]))
  await flush()
  assert.equal(petOf(b.document, 's1').querySelector('img').src, first)

  // 取消 anim-a 后，运行中的 s1 必须重绑到仍勾选的 anim-b
  b.overlay.openSettings()
  const dialog = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  const boxA = [...dialog.querySelectorAll('.role-row input[type="checkbox"]')][0]
  boxA.checked = false
  boxA.dispatchEvent(new b.window.Event('change', { bubbles: true }))
  await flush()
  assert.match(petOf(b.document, 's1').querySelector('img').src, /b\.gif\?v=\d+$/)
  b.dom.window.close()
})

test('设置面板：Escape 关闭，点击面板外部关闭', async () => {
  const b = bench()
  b.overlay.openSettings()
  const dialog = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  b.document.body.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(dialog.hidden, true)

  b.overlay.openSettings()
  assert.equal(dialog.hidden, false)
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerdown', { bubbles: true, composed: true }))
  assert.equal(dialog.hidden, true)
  b.dom.window.close()
})

function previewRoot(document) {
  return shadow(document).querySelector('[data-xllh-pet-preview]')
}

function previewDialog(document) {
  return shadow(document).querySelector('[data-xllh-pet-preview-dialog]')
}

function previewButton(document, id = 'blue-fat-fish-working') {
  return shadow(document).querySelector(`[data-xllh-pet-preview-open="${id}"]`)
}

function makeThreeViewLoader(options = {}) {
  const state = { calls: 0, urls: [] }
  return {
    state,
    load: async (url) => {
      state.calls += 1
      state.urls.push(url)
      if (options.missing) throw new Error('three-view asset missing')
      return {
        blob: options.blob ?? new Blob(['fake-png'], { type: options.type ?? 'image/png' }),
        objectUrl: options.objectUrl ?? 'blob:three-view-test',
      }
    },
  }
}

async function openPreview(b, id = 'blue-fat-fish-working') {
  b.overlay.openSettings()
  const button = previewButton(b.document, id)
  assert.ok(button, `missing preview button for ${id}`)
  button.click()
  await flush()
  return button
}

test('设置面板：三视图按钮独立于角色选项，点击只打开预览、不切换选择', async () => {
  const loader = makeThreeViewLoader()
  const b = bench({ overlay: { loadThreeView: loader.load } })
  b.overlay.openSettings()
  const dialog = shadow(b.document).querySelector('[data-xllh-pet-settings]')
  const row = dialog.querySelector('[data-xllh-pet-role="blue-fat-fish-working"]')
  assert.ok(row, 'settings row must expose a data role hook')
  const button = row.querySelector('[data-xllh-pet-preview-open="blue-fat-fish-working"]')
  assert.ok(button, 'three-view capable rows need an image icon button')
  assert.equal(button.getAttribute('aria-label'), '查看蓝色大肥鱼三视图')
  assert.equal(button.getAttribute('type'), 'button')
  const checkbox = row.querySelector('input[type="checkbox"]')
  const storedBefore = b.stored.get('dsh-anime-desktop-pet/selection')
  button.click()
  await flush()
  assert.equal(checkbox.checked, true, 'opening the preview must not change the character selection')
  assert.equal(b.stored.get('dsh-anime-desktop-pet/selection'), storedBefore)
  const root = previewRoot(b.document)
  assert.equal(root.hidden, false)
  const panel = previewDialog(b.document)
  assert.equal(panel.getAttribute('role'), 'dialog')
  assert.equal(panel.getAttribute('aria-modal'), 'true')
  assert.match(panel.textContent, /蓝色大肥鱼/)
  assert.match(panel.textContent, /三视图/)
  assert.equal(loader.state.calls, 1)
  b.dom.window.close()
})

test('三视图能力按角色注册表扩展：仅声明 threeView 的角色出现按钮', async () => {
  const library = [
    { id: 'with-view', name: '有三视图', file: 'a.gif', enabled: true, threeView: 'three-view/with-view.png' },
    { id: 'no-view', name: '无三视图', file: 'b.gif', enabled: true },
  ]
  const b = bench({ animations: library })
  b.overlay.openSettings()
  assert.ok(previewButton(b.document, 'with-view'))
  assert.equal(previewButton(b.document, 'no-view'), null, '未声明三视图的角色不应出现入口')
  b.dom.window.close()
})

test('三视图缺失/加载失败：展示明确占位文案，不出现破图或空白弹层', async () => {
  const loader = makeThreeViewLoader({ missing: true })
  const b = bench({ overlay: { loadThreeView: loader.load } })
  await openPreview(b)
  const root = previewRoot(b.document)
  assert.equal(root.hidden, false)
  const missing = root.querySelector('[data-xllh-pet-preview-missing]')
  assert.ok(missing)
  assert.equal(missing.hidden, false)
  assert.match(missing.textContent, /三视图暂未提供/)
  const img = root.querySelector('img')
  assert.equal(img.hidden, true, 'failed image must not leave a broken <img> visible')
  b.dom.window.close()
})

test('三视图预览：成功加载即显示图片，关闭按钮释放滚动锁并回焦触发按钮', async () => {
  const loader = makeThreeViewLoader()
  const releases = []
  const b = bench({ overlay: { loadThreeView: loader.load, releaseThreeView: (url) => releases.push(url) } })
  const trigger = await openPreview(b)
  const root = previewRoot(b.document)
  const img = root.querySelector('img')
  assert.equal(root.hidden, false)
  assert.equal(img.hidden, false)
  assert.equal(img.getAttribute('src'), 'blob:three-view-test')
  assert.equal(img.getAttribute('alt'), '蓝色大肥鱼 三视图')
  assert.equal(b.document.documentElement.style.overflow, 'hidden')
  assert.equal(shadow(b.document).activeElement, root.querySelector('[data-xllh-pet-preview-close]'))
  root.querySelector('[data-xllh-pet-preview-close]').click()
  await flush()
  assert.equal(root.hidden, true)
  assert.equal(b.document.documentElement.style.overflow, '', 'closing must release the scroll lock')
  assert.deepEqual(releases, ['blob:three-view-test'])
  assert.equal(shadow(b.document).activeElement, trigger)
  b.dom.window.close()
})

test('三视图预览：Esc / 点击遮罩 / 点击内容区分明，重复触发不堆叠', async () => {
  const loader = makeThreeViewLoader()
  const b = bench({ overlay: { loadThreeView: loader.load } })
  const trigger = await openPreview(b)
  const root = previewRoot(b.document)
  // 重复触发（面板按钮再次点击）不得产生第二个实例
  trigger.click()
  await flush()
  assert.equal(shadow(b.document).querySelectorAll('[data-xllh-pet-preview]').length, 1)
  assert.equal(loader.state.calls, 1)

  b.document.body.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(root.hidden, true)
  assert.equal(shadow(b.document).activeElement, trigger)

  // 点击内容区不关闭
  trigger.click()
  await flush()
  previewDialog(b.document).click()
  assert.equal(root.hidden, false, 'inner clicks must keep the preview open')
  // 点击遮罩空白关闭
  root.click()
  assert.equal(root.hidden, true)
  b.dom.window.close()
})

test('三视图预览：打开时背景滚动锁定 + Tab 焦点陷阱，关闭后完全解除', async () => {
  const loader = makeThreeViewLoader()
  const b = bench({ overlay: { loadThreeView: loader.load } })
  await openPreview(b)
  const root = previewRoot(b.document)
  const closeButton = root.querySelector('[data-xllh-pet-preview-close]')
  assert.equal(root.querySelector('[data-xllh-pet-preview-save]'), null, '“另存为图片”已按要求移除')
  assert.equal(b.document.documentElement.style.overflow, 'hidden')

  closeButton.focus()
  const tab = new b.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  b.document.body.dispatchEvent(tab)
  assert.equal(tab.defaultPrevented, true, 'focus trap must intercept Tab')
  assert.equal(shadow(b.document).activeElement, closeButton, 'single focusable wraps to itself')

  const shiftTab = new b.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
  b.document.body.dispatchEvent(shiftTab)
  assert.equal(shiftTab.defaultPrevented, true)
  assert.equal(shadow(b.document).activeElement, closeButton)

  assert.equal(b.document.documentElement.style.overflow, 'hidden')
  b.document.body.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(root.hidden, true)
  assert.equal(b.document.documentElement.style.overflow, '')
  // 关闭后 Tab 不再被拦截
  const after = new b.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  b.document.body.dispatchEvent(after)
  assert.equal(after.defaultPrevented, false)
  b.dom.window.close()
})

test('三视图图片解码失败：同样回退占位文案而不是破图', async () => {
  const loader = makeThreeViewLoader()
  const b = bench({ overlay: { loadThreeView: loader.load } })
  await openPreview(b)
  const root = previewRoot(b.document)
  const img = root.querySelector('img')
  assert.equal(img.hidden, false)
  img.dispatchEvent(new b.window.Event('error'))
  assert.equal(img.hidden, true, 'decode failure hides the broken image')
  assert.equal(root.querySelector('[data-xllh-pet-preview-missing]').hidden, false)
  assert.match(root.querySelector('[data-xllh-pet-preview-missing]').textContent, /三视图暂未提供/)
  b.dom.window.close()
})

test('三视图预览：卸载时关闭并释放资源、解除滚动锁', async () => {
  const loader = makeThreeViewLoader()
  const releases = []
  const b = bench({ overlay: { loadThreeView: loader.load, releaseThreeView: (url) => releases.push(url) } })
  await openPreview(b)
  assert.equal(b.document.documentElement.style.overflow, 'hidden')
  b.overlay.dispose()
  assert.equal(petHost(b.document), null)
  assert.deepEqual(releases, ['blob:three-view-test'])
  assert.equal(b.document.documentElement.style.overflow, '')
  b.dom.window.close()
})

function previewMenu(document) {
  return shadow(document).querySelector('[data-xllh-pet-preview-menu]')
}

function makeClipboard(options = {}) {
  const calls = []
  const clipboard = options.unavailable === true
    ? undefined
    : {
        write: async (items) => {
          if (options.fail === true) throw new Error('clipboard denied')
          calls.push(items)
        },
      }
  class FakeClipboardItem {
    constructor(data) {
      this.data = data
      this.types = Object.keys(data)
    }
  }
  return { clipboard, ClipboardItemCtor: FakeClipboardItem, calls }
}

function openImageMenu(b) {
  const img = previewRoot(b.document).querySelector('img')
  const event = new b.window.MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, composed: true, clientX: 240, clientY: 180,
  })
  img.dispatchEvent(event)
  return { img, event, menu: previewMenu(b.document) }
}

test('图片右键菜单：复制 PNG 走 clipboard.write，只加载一次资源，成功有轻提示且不关弹层', async () => {
  const loader = makeThreeViewLoader()
  const clipboard = makeClipboard()
  let conversions = 0
  const b = bench({
    overlay: {
      loadThreeView: loader.load,
      clipboard: clipboard.clipboard,
      ClipboardItemCtor: clipboard.ClipboardItemCtor,
      toPngBlob: async () => { conversions += 1; throw new Error('png source must not convert') },
    },
  })
  await openPreview(b)
  const { event, menu } = openImageMenu(b)
  assert.equal(event.defaultPrevented, true, '图片右键必须拦截浏览器默认菜单')
  assert.equal(menu.hidden, false)
  assert.match(menu.textContent, /复制图片/)
  menu.querySelector('[data-xllh-pet-preview-copy]').click()
  await flush()
  assert.equal(conversions, 0)
  assert.equal(clipboard.calls.length, 1)
  const item = clipboard.calls[0][0]
  assert.deepEqual(Object.keys(item.data), ['image/png'])
  assert.equal(item.data['image/png'].type, 'image/png')
  assert.equal(loader.state.calls, 1, 'copy must reuse the loaded resource, not refetch')
  assert.equal(menu.hidden, true, 'copying hides the lightweight menu')
  const root = previewRoot(b.document)
  assert.equal(root.hidden, false, 'copy must not change the preview state')
  assert.match(root.querySelector('[role="status"]').textContent, /已复制/)
  b.dom.window.close()
})

test('图片复制：非 PNG 源先经 canvas 转成 PNG 再写剪贴板', async () => {
  const loader = makeThreeViewLoader({ type: 'image/jpeg' })
  const clipboard = makeClipboard()
  const pngBlob = new Blob(['converted-png'], { type: 'image/png' })
  const convertedFrom = []
  const b = bench({
    overlay: {
      loadThreeView: loader.load,
      clipboard: clipboard.clipboard,
      ClipboardItemCtor: clipboard.ClipboardItemCtor,
      toPngBlob: async (blob) => { convertedFrom.push(blob); return pngBlob },
    },
  })
  await openPreview(b)
  openImageMenu(b).menu.querySelector('[data-xllh-pet-preview-copy]').click()
  await flush()
  assert.equal(convertedFrom.length, 1)
  assert.equal(convertedFrom[0].type, 'image/jpeg')
  assert.equal(clipboard.calls[0][0].data['image/png'], pngBlob)
  b.dom.window.close()
})

test('图片复制失败：给出明确提示，不存在「另存为图片」入口', async () => {
  const loader = makeThreeViewLoader()
  const clipboard = makeClipboard({ unavailable: true })
  const b = bench({
    overlay: {
      loadThreeView: loader.load,
      clipboard: clipboard.clipboard,
      ClipboardItemCtor: clipboard.ClipboardItemCtor,
    },
  })
  await openPreview(b)
  const { menu } = openImageMenu(b)
  assert.equal(menu.querySelector('[data-xllh-pet-preview-menu-save]'), null, '菜单里不再有另存为')
  assert.equal(menu.textContent.includes('另存为'), false)
  menu.querySelector('[data-xllh-pet-preview-copy]').click()
  await flush()
  const root = previewRoot(b.document)
  assert.match(root.querySelector('[role="status"]').textContent, /复制失败/)
  assert.equal(root.hidden, false)
  assert.equal(root.querySelector('[data-xllh-pet-preview-save]'), null, 'footer 不再有另存为按钮')
  b.dom.window.close()
})

test('图片复制：剪贴板写入被拒绝时不静默失败', async () => {
  const loader = makeThreeViewLoader()
  const clipboard = makeClipboard({ fail: true })
  const b = bench({
    overlay: {
      loadThreeView: loader.load,
      clipboard: clipboard.clipboard,
      ClipboardItemCtor: clipboard.ClipboardItemCtor,
    },
  })
  await openPreview(b)
  openImageMenu(b).menu.querySelector('[data-xllh-pet-preview-copy]').click()
  await flush()
  assert.match(previewRoot(b.document).querySelector('[role="status"]').textContent, /复制失败/)
  b.dom.window.close()
})

test('图片右键菜单：Esc 只关菜单不关弹层；点击外部关闭菜单', async () => {
  const loader = makeThreeViewLoader()
  const b = bench({ overlay: { loadThreeView: loader.load } })
  await openPreview(b)
  const root = previewRoot(b.document)
  openImageMenu(b)
  b.document.body.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(previewMenu(b.document).hidden, true)
  assert.equal(root.hidden, false, 'Escape must close the menu before the modal')

  openImageMenu(b)
  assert.equal(previewMenu(b.document).hidden, false)
  b.document.body.dispatchEvent(new b.window.MouseEvent('pointerdown', { bubbles: true, composed: true }))
  assert.equal(previewMenu(b.document).hidden, true)
  b.dom.window.close()
})

test('持久化：启动时恢复勾选；损坏值回退到首个可用动画', async () => {
  const good = bench({ animations: MULTI, stored: '["anim-c"]' })
  good.overlay.openSettings()
  const dialog = shadow(good.document).querySelector('[data-xllh-pet-settings]')
  assert.deepEqual([...dialog.querySelectorAll('.role-row input')].map((box) => box.checked), [false, false, true])
  good.dom.window.close()

  const broken = bench({ animations: MULTI, stored: 'not-json' })
  broken.overlay.openSettings()
  const dialog2 = shadow(broken.document).querySelector('[data-xllh-pet-settings]')
  assert.deepEqual([...dialog2.querySelectorAll('.role-row input')].map((box) => box.checked), [true, false, false])
  assert.equal(broken.stored.get('dsh-anime-desktop-pet/selection'), '["anim-a"]')
  broken.dom.window.close()
})
