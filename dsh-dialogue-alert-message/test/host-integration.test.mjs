/**
 * 宿主集成测试：用最小 mock cordis Context 直接驱动 lib/index.js 的 apply，
 * 校验事件管线（assistant/message 计价、turn/end 幂等计次、顶层过滤）、
 * 余额查询（credentials seam + fetch 桩 + 失败降级）、/api/usage 输出与持久化。
 * 覆盖铁律 5（apply 兜底）不冒泡。
 * 运行：node --test test/
 */
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const built = await import(new URL('../lib/index.js', import.meta.url).href)

/**
 * 每个 makeCtx 都登记在这里，由 afterEach 统一释放。
 * 为什么必须有：apply 会注册余额刷新 interval（src/index.ts:605），用例忘记 dispose
 * 时事件循环不空 —— 断言全部通过，node --test 进程却永远不退出（历史现象：60s 未结束）。
 */
const liveCtxs = []
afterEach(() => {
  while (liveCtxs.length > 0) {
    const ctx = liveCtxs.pop()
    try { ctx.dispose() } catch { /* 释放失败不改变用例结论 */ }
  }
})

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
  // 日志内容要能被断言：logger.warn 是函数（(...a) => 的 length 恒为 0），断言必须取数组。
  ctx.logs = logs
  ctx.emitListeners = (type, ...args) => {
    for (const { handler } of listeners.get(type) ?? []) handler(...args)
  }
  ctx.getRoute = (path) => routes.get(path)
  ctx.emitFlow = { awaitTick: (ms = 60) => new Promise(r => setTimeout(r, ms)) }
  let disposed = false
  ctx.dispose = () => {
    // 幂等：afterEach 兜底释放与用例内显式释放会各调一次；重复执行不得二次落盘、二次清定时器。
    if (disposed) return
    disposed = true
    for (const e of effects) {
      try { e.disposer?.() } catch { /* ignore */ }
    }
  }
  // 登记到 afterEach 释放清单：apply 注册的 interval 不释放会拖住 node --test 进程
  liveCtxs.push(ctx)
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

    // 持久化已写盘：queuePersist 有 500ms 防抖（src/index.ts:307-313），必须等过窗口再断言，
    // 只等一个 60ms tick 只会读到"还没写"。
    await ctx.emitFlow.awaitTick(700)
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
  const realNow = Date.now
  let nowSkew = 0
  Date.now = () => realNow() + nowSkew
  globalThis.fetch = async () => {
    if (fail) throw new Error('network down')
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }) }
  }
  try {
    const ctx = makeCtx()
    // 节流窗压到下限（Config 钳制 min 1000），再用时钟前移越过它 —— 不真等 30s
    built.apply(ctx, built.Config({ statsFile, balanceMinIntervalMs: 1_000 }))
    const usageRoute = ctx.getRoute('/@dsh-external/dsh-dialogue-alert-message/api/usage')
    await ctx.emitFlow.awaitTick()
    assert.equal(getJson(usageRoute).body.data.balance, 88.5)

    fail = true
    // 触发下一次刷新：顶层完成轮会调 refreshBalance（src/index.ts:409-416），
    // 但首次成功落在节流窗内 ⇒ 先把时钟推过 balanceMinIntervalMs，否则这次刷新被静默丢弃。
    nowSkew = 2_000
    const sess = makeSession('session-9')
    ctx.emitListeners('session/event', sess, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    await ctx.emitFlow.awaitTick(150)
    const after = getJson(usageRoute)
    assert.equal(after.body.ok, true) // 不因失败崩 API
    assert.equal(after.body.data.balance, 88.5) // 保留上次成功值
    // 断言日志数组，而不是 ctx.logger.warn.length（函数的 length = 形参个数，(...a) => 恒为 0）
    assert.ok(ctx.logs.warn.length > 0, '失败已记录日志')
  } finally {
    globalThis.fetch = realFetch
    Date.now = realNow
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
  let ctx
  try {
    ctx = makeCtx({ credentials: false })
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
