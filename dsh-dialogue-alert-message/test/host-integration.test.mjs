/**
 * 宿主集成测试：用最小 mock cordis Context 直接驱动 lib/index.js 的 apply，
 * 校验事件管线（assistant/message 计价、turn/end 幂等计次、顶层过滤）、
 * 余额查询（credentials seam + fetch 桩 + 失败降级）、/api/usage 输出与持久化。
 * 覆盖铁律 5（apply 兜底）不冒泡。
 * 运行：node --test test/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const built = await import(new URL('../lib/index.js', import.meta.url).href)

function makeCtx(overrides = {}) {
  const listeners = new Map()
  const effects = []
  const routes = new Map()
  const logs = { info: [], warn: [], error: [] }
  let fetchImpl = overrides.fetch ?? (async () => ({
    ok: true,
    json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }),
  }))
  const ctx = {
    on(type, handler, opts) {
      const list = listeners.get(type) ?? []
      list.push({ handler, opts })
      listeners.set(type, list)
      return () => {
        const l = listeners.get(type) ?? []
        listeners.set(type, l.filter(h => h.handler !== handler))
      }
    },
    effect(fn, label) {
      const disposer = fn()
      effects.push({ label, disposer })
      return disposer
    },
    get(name) {
      if (overrides.credentials === false) return undefined
      if (name === 'credentials') return { resolve: async () => ({ value: 'sk-test-123', source: 'env' }) }
      return undefined
    },
    logger: {
      info: (...a) => logs.info.push(a.join(' ')),
      warn: (...a) => logs.warn.push(a.join(' ')),
      error: (...a) => logs.error.push(a.join(' ')),
    },
    webServer: {
      register(route, label) {
        routes.set(route.path, { ...route, label })
      },
    },
    sessions: { list: () => [] },
  }
  ctx.emitListeners = (type, ...args) => {
    for (const { handler } of listeners.get(type) ?? []) handler(...args)
  }
  ctx.getRoute = (path) => routes.get(path)
  ctx.emitFlow = { awaitTick: (ms = 60) => new Promise(r => setTimeout(r, ms)) }
  ctx.dispose = () => {
    for (const e of effects) {
      try { e.disposer?.() } catch { /* ignore */ }
    }
  }
  return ctx
}

function makeSession(id, parented = false) {
  return { id, header: parented ? { id, parentSession: 'session-parent' } : { id } }
}

function getJson(route, method = 'GET') {
  let status = 0
  let body = ''
  const res = {
    writeHead(code) { status = code },
    end(text) { body = text },
  }
  route.handler({ method, url: route.path }, res)
  return { status, body: JSON.parse(body) }
}

test('host apply: 事件管线计价/计次/幂等/顶层过滤 + /api/usage + 持久化', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-alert-'))
  const statsFile = join(dir, 'stats.json')
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }),
  })
  try {
    const ctx = makeCtx()
    const config = built.Config({ statsFile })
    built.apply(ctx, config)

    const usageRoute = ctx.getRoute('/@dsh-external/dsh-dialogue-alert-message/api/usage')
    const statusRoute = ctx.getRoute('/@dsh-external/dsh-dialogue-alert-message/api/status')
    assert.ok(usageRoute, 'usage route registered')
    assert.ok(statusRoute, 'status route registered')

    // 模型 hook 必须转发
    let nextCalled = false
    ctx.emitListeners('llm/stream', { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' }, () => { nextCalled = true })
    assert.equal(nextCalled, true)

    const ts = Date.UTC(2026, 8, 2, 2, 0) // 周二 10:00 +08 高峰
    const sessTop = makeSession('session-1')
    const sessChild = makeSession('session-2', true)

    // 顶层会话两步 usage（各 1M in + 1M out → 高峰 1.5+4.5=6 元）
    ctx.emitListeners('session/event', sessTop, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } })
    ctx.emitListeners('session/event', sessTop, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } })
    // 子代理 usage 也计入消耗（账户口径）
    ctx.emitListeners('session/event', sessChild, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000 } } })

    // 完成轮：顶层 +1；重复回调幂等；子代理不计次数
    ctx.emitListeners('session/event', sessTop, { type: 'turn/end', time: ts + 1, data: { turn: 1, reason: { kind: 'completed' } } })
    ctx.emitListeners('session/event', sessTop, { type: 'turn/end', time: ts + 2, data: { turn: 1, reason: { kind: 'completed' } } })
    ctx.emitListeners('session/event', sessChild, { type: 'turn/end', time: ts + 3, data: { turn: 1, reason: { kind: 'completed' } } })
    ctx.emitListeners('session/event', sessTop, { type: 'turn/end', time: ts + 4, data: { turn: 2, reason: { kind: 'completed' } } })

    const first = getJson(usageRoute)
    assert.equal(first.status, 200)
    assert.equal(first.body.ok, true)
    assert.equal(first.body.data.dialogueCount, 2)
    // 顶层两轮 usage：2×(1M 输入+1M 输出)×高峰全价 = 12；子代理 1M 输入 = 1.5 → 13.5
    assert.equal(first.body.data.todayCost, 13.5)
    assert.ok(first.body.data.updatedAt > 0)

    // 余额查询：seam key + 节流（首次触发 → 60ms 后应到位）
    await ctx.emitFlow.awaitTick()
    const second = getJson(usageRoute)
    assert.equal(second.body.data.balance, 88.5)

    // 持久化已写盘
    assert.ok(existsSync(statsFile))
    const persisted = JSON.parse(readFileSync(statsFile, 'utf8'))
    assert.equal(persisted.dialogueCount, 2)
    assert.equal(persisted.todayCost, 13.5)
    assert.equal(persisted.balance, 88.5)

    // status 路由未破坏
    const st = getJson(statusRoute)
    assert.equal(st.status, 200)
    assert.equal(st.body.ok, true)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('host apply: 余额失败降级（保留上次缓存 + warn 日志 + 界面仍 200）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-alert-'))
  const statsFile = join(dir, 'stats.json')
  const realFetch = globalThis.fetch
  let fail = false
  globalThis.fetch = async () => {
    if (fail) throw new Error('network down')
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }) }
  }
  try {
    const ctx = makeCtx()
    built.apply(ctx, built.Config({ statsFile }))
    const usageRoute = ctx.getRoute('/@dsh-external/dsh-dialogue-alert-message/api/usage')
    await ctx.emitFlow.awaitTick()
    assert.equal(getJson(usageRoute).body.data.balance, 88.5)

    fail = true
    // 触发下一次刷新：绕过节流 → 直接 emit 一个完成轮（节流 30s 内不刷）→ 等待
    const sess = makeSession('session-9')
    ctx.emitListeners('session/event', sess, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    await ctx.emitFlow.awaitTick(150)
    const after = getJson(usageRoute)
    assert.equal(after.body.ok, true) // 不因失败崩 API
    assert.equal(after.body.data.balance, 88.5) // 保留上次成功值
    assert.ok(ctx.logger.warn.length > 0, '失败已记录日志')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('host apply: 无 credentials seam 时回退环境变量', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-alert-'))
  const statsFile = join(dir, 'stats.json')
  const realFetch = globalThis.fetch
  const realEnv = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-env-fallback'
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/user\/balance$/)
    assert.equal(init.headers.authorization, 'Bearer sk-env-fallback')
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] }) }
  }
  try {
    const ctx = makeCtx({ credentials: false })
    built.apply(ctx, built.Config({ statsFile }))
    const usageRoute = ctx.getRoute('/@dsh-external/dsh-dialogue-alert-message/api/usage')
    await ctx.emitFlow.awaitTick()
    assert.equal(getJson(usageRoute).body.data.balance, 10)
  } finally {
    globalThis.fetch = realFetch
    if (realEnv === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = realEnv
    ctx.dispose()
  }
})
