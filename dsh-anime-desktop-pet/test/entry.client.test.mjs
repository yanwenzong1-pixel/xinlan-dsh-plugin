/**
 * Client 插件入口：从 DSH sessions 快照把 running 映射成覆盖层动画；
 * 列表更新时同步；context effect 卸载时清理 overlay 与订阅。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { JSDOM } = require('jsdom')

const dom = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document

const { apply, inject } = await import('../src/client/index.mjs')
const flush = () => new Promise((resolve) => setTimeout(resolve, 40))

function row(sessionId) {
  const el = dom.window.document.createElement('div')
  el.setAttribute('data-row-key', `session:${sessionId}`)
  el.getBoundingClientRect = () => ({
    left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100,
    toJSON() { return this },
  })
  dom.window.document.getElementById('list').append(el)
  return el
}

function makeSessions(initial) {
  let value = initial
  const listeners = new Set()
  return {
    list: {
      getSnapshot: () => value,
      // DSH ObservableSnapshot.subscribe(fn) invalidates only — the callback gets NO snapshot.
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

test('入口：running 会话显示动画，状态更新同步移除，effect 卸载可逆清理', async () => {
  assert.deepEqual(inject, ['sessions'])
  row('s1')
  row('s2')
  const sessions = makeSessions({
    ids: ['s1', 's2'],
    byId: {
      s1: { running: true },
      s2: { running: false },
    },
  })
  let disposer
  const ctx = {
    get: (name) => (name === 'sessions' ? sessions : undefined),
    effect: (callback) => { disposer = callback() },
  }
  apply(ctx)
  await flush()

  const host = dom.window.document.querySelector('[data-xllh-pet-host]')
  assert.ok(host, 'overlay host mounted')
  const pets = [...host.shadowRoot.querySelectorAll('[data-xllh-pet]')]
  assert.deepEqual(pets.map((el) => el.getAttribute('data-session-id')), ['s1'], 'only running sessions get an animation')

  sessions.set({
    ids: ['s1', 's2'],
    byId: { s1: { running: false }, s2: { running: true } },
  })
  await flush()
  const after = [...host.shadowRoot.querySelectorAll('[data-xllh-pet]')]
  assert.deepEqual(after.map((el) => el.getAttribute('data-session-id')), ['s2'])
  assert.equal(sessions.listenerCount(), 1)

  disposer()
  assert.equal(dom.window.document.querySelector('[data-xllh-pet-host]'), null, 'unload removes the overlay host')
  assert.equal(sessions.listenerCount(), 0, 'unload drops the sessions subscription')
  dom.window.close()
})

test('入口：contextPressure 投影 >45% 且两个动画都勾选时渲染「蓝色大肥鱼很累」', async () => {
  const dom2 = new JSDOM('<!doctype html><html><body><div id="list"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom2.window
  globalThis.document = dom2.window.document
  dom2.window.localStorage.setItem('dsh-anime-desktop-pet/selection', JSON.stringify(['blue-fat-fish-working', 'blue-fat-fish-tired']))
  const el = dom2.window.document.createElement('div')
  el.setAttribute('data-row-key', 'session:ctx')
  el.getBoundingClientRect = () => ({
    left: 100, top: 100, width: 200, height: 40, right: 300, bottom: 140, x: 100, y: 100,
    toJSON() { return this },
  })
  dom2.window.document.getElementById('list').append(el)
  const sessions = makeSessions({
    ids: ['ctx'],
    byId: { ctx: { running: true, cwd: 'C:\\work\\test' } },
    projectionsBySession: {
      ctx: { values: { contextPressure: { projectedTokens: 75, contextWindow: 100 } } },
    },
  })
  let disposer
  const ctx = {
    get: (name) => (name === 'sessions' ? sessions : undefined),
    effect: (callback) => { disposer = callback() },
  }
  apply(ctx)
  await flush()
  const host = dom2.window.document.querySelector('[data-xllh-pet-host]')
  const pet = host?.shadowRoot.querySelector('[data-xllh-pet]')
  assert.ok(pet, 'running session mounts its animation')
  assert.match(pet.querySelector('img').src, /blue-fat-fish-tired\.gif/, '>60% uses the tired variant')
  disposer()
  assert.equal(dom2.window.document.querySelector('[data-xllh-pet-host]'), null)
  dom2.window.close()
})

test('入口：sessions 服务缺失时安静降级，不抛错', () => {
  assert.doesNotThrow(() => apply({ get: () => undefined }))
})
