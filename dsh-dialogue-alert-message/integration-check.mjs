/**
 * 宿主链路手动驱动（绕过 node:test 子进程怪癖）：node integration-check.mjs
 * 验证 apply 全链路：事件计价/幂等计次/顶层过滤、余额查询（seam + 回退）、
 * 失败降级、/api/usage、/api/status、持久化落盘。所有断言失败即 exit 1。
 */
const built = await import(new URL('./lib/index.js', import.meta.url))
const { mkdtempSync, existsSync, readFileSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

function makeCtx(overrides = {}) {
  const listeners = new Map()
  const effects = []
  const routes = new Map()
  const ctx = {
    on(type, handler) {
      const list = listeners.get(type) ?? []
      list.push({ handler })
      listeners.set(type, list)
      return () => listeners.set(type, (listeners.get(type) ?? []).filter(h => h.handler !== handler))
    },
    effect(fn, label) {
      const disposer = fn()
      effects.push({ label, disposer })
      return disposer
    },
    get(name) {
      ctx.getCalls.push(name)
      if (overrides.credentials === false) return undefined
      if (name === 'credentials') return { resolve: async () => ({ value: 'sk-test-123', source: 'env' }) }
      if (name === 'alertHub' && overrides.alertHub) return overrides.alertHub
      return undefined
    },
    logger: {
      info: () => {},
      warn: (...a) => ctx._warns.push(String(a[0])),
      error: (...a) => ctx._errors.push(String(a[0])),
    },
    webServer: { register: (route, label) => routes.set(route.path, { ...route, label }) },
    sessions: { list: () => [] },
  }
  ctx._warns = []
  ctx._errors = []
  ctx.getCalls = []
  ctx.emit = (type, ...args) => { for (const { handler } of listeners.get(type) ?? []) handler(...args) }
  ctx.route = path => routes.get(path)
  ctx.dispose = () => { for (const e of effects) { try { e.disposer?.() } catch { /* */ } } }
  return ctx
}

function getJson(route) {
  let body = ''
  const res = { writeHead() {}, end: t => { body = t } }
  route.handler({ method: 'GET', url: route.path }, res)
  return JSON.parse(body)
}

/** 构造带 async 迭代体（POST 用）的 mock req。 */
function makeReq(method, url, body) {
  const text = String(body ?? '')
  let sent = false
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (!sent) {
        sent = true
        if (text.length > 0) yield Buffer.from(text, 'utf8')
      }
    },
  }
}

async function postJson(route, body) {
  let status = 0
  let out = ''
  await route.handler(makeReq('POST', route.path, JSON.stringify(body)), {
    writeHead(c) { status = c },
    end: t => { out = t },
  })
  return { status, body: JSON.parse(out) }
}

const ALARM_KINDS = ['tool-error', 'forced-cancel', 'session-evicted', 'host-restart']

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg)
}

const realFetch = globalThis.fetch

// ===== 场景 1：计价/计数/幂等/顶层过滤 + balance + 持久化 =====
{
  const statsFile = join(mkdtempSync(join(tmpdir(), 'ds-alert-')), 'stats.json')
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }),
  })
  const ctx = makeCtx()
  built.apply(ctx, built.Config({ statsFile }))
  const usage = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/usage')
  const status = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/status')
  assert(usage, 'usage route registered')
  assert(status, 'status route registered')

  let nextCalled = false
  ctx.emit('llm/stream', { provider: 'x', model: 'deepseek-v4-flash-vision-exp' }, () => { nextCalled = true })
  assert(nextCalled, 'llm/stream hook forwards next()')

  const ts = Date.UTC(2026, 8, 2, 2, 0) // 周二 10:00 +08 高峰
  const top = { id: 'session-1', header: { id: 'session-1' } }
  const child = { id: 'session-2', header: { id: 'session-2', parentSession: 'p' } }
  ctx.emit('session/event', top, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } })
  ctx.emit('session/event', top, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } } })
  ctx.emit('session/event', child, { type: 'assistant/message', time: ts, data: { usage: { inputTokens: 1_000_000 } } })
  ctx.emit('session/event', top, { type: 'turn/end', time: ts + 1, data: { turn: 1, reason: { kind: 'completed' } } })
  ctx.emit('session/event', top, { type: 'turn/end', time: ts + 2, data: { turn: 1, reason: { kind: 'completed' } } })
  ctx.emit('session/event', child, { type: 'turn/end', time: ts + 3, data: { turn: 1, reason: { kind: 'completed' } } })
  ctx.emit('session/event', top, { type: 'turn/end', time: ts + 4, data: { turn: 2, reason: { kind: 'completed' } } })

  const first = getJson(usage)
  assert(first.ok, 'usage ok')
  assert(first.data.dialogueCount === 2, 'dialogueCount=2 got ' + first.data.dialogueCount)
  assert(first.data.todayCost === 13.5, 'todayCost=13.5 got ' + first.data.todayCost)
  assert(first.data.updatedAt > 0, 'updatedAt>0')

  await new Promise(r => setTimeout(r, 80))
  const second = getJson(usage)
  assert(second.data.balance === 88.5, 'balance=88.5 got ' + second.data.balance)
  await new Promise(r => setTimeout(r, 700)) // 等待写盘防抖（500ms）
  assert(existsSync(statsFile), 'stats file written')
  const persisted = JSON.parse(readFileSync(statsFile, 'utf8'))
  assert(persisted.dialogueCount === 2, 'persisted count')
  assert(persisted.balance === 88.5, 'persisted balance')

  const st = getJson(status)
  assert(st.ok, 'status ok intakt')
  assert(st.counts && typeof st.counts.completed === 'number', 'status counts shape')
  ctx.dispose()
  console.log('[1] 场景1 PASS：计价/幂等/顶层过滤/余额/持久化/status')
}

// ===== 场景 2：余额失败降级 =====
{
  const statsFile = join(mkdtempSync(join(tmpdir(), 'ds-alert-')), 'stats.json')
  let fail = false
  globalThis.fetch = async () => {
    if (fail) throw new Error('network down')
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }) }
  }
  const ctx = makeCtx()
  built.apply(ctx, built.Config({ statsFile, balanceMinIntervalMs: 1000 }))
  const usage = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/usage')
  await new Promise(r => setTimeout(r, 80))
  assert(getJson(usage).data.balance === 88.5, 'initial balance')
  fail = true
  await new Promise(r => setTimeout(r, 1100)) // 越过节流窗
  ctx.emit('session/event', { id: 's9', header: { id: 's9' } }, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
  await new Promise(r => setTimeout(r, 150))
  const after = getJson(usage)
  assert(after.ok, 'api not broken on failure')
  assert(after.data.balance === 88.5, 'keeps last cached balance')
  assert(ctx._warns.length > 0, 'failure logged (warn)')
  ctx.dispose()
  console.log('[2] 场景2 PASS：失败降级（缓存余额 + 日志 + 接口不崩）')
}

// ===== 场景 3：无 credentials seam → 环境变量回退 =====
{
  const statsFile = join(mkdtempSync(join(tmpdir(), 'ds-alert-')), 'stats.json')
  const realEnv = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-env-fallback'
  const auths = []
  globalThis.fetch = async (url, init) => {
    auths.push(init.headers.authorization)
    assert(String(url).endsWith('/user/balance'), 'balance url')
    return { ok: true, json: async () => ({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] }) }
  }
  const ctx = makeCtx({ credentials: false })
  built.apply(ctx, built.Config({ statsFile }))
  const usage = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/usage')
  await new Promise(r => setTimeout(r, 80))
  assert(getJson(usage).data.balance === 10, 'env fallback balance')
  assert(auths[0] === 'Bearer sk-env-fallback', 'auth header from env (first call)')
  ctx.dispose()
  if (realEnv === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = realEnv
  console.log('[3] 场景3 PASS：env 回退 + Bearer 头')
}

// ===== 场景 4：强制中断全链路（无 alertHub → 内部降级发声；去重/门控/日志/ack） =====
{
  const dir = mkdtempSync(join(tmpdir(), 'ds-alarm-'))
  const statsFile = join(dir, 'stats.json')
  const alarmSettingsFile = join(dir, 'alarm-settings.json')
  const alarmLogFile = join(dir, 'alarm.log')
  const ctx = makeCtx()
  built.apply(ctx, built.Config({ statsFile, alarmSettingsFile }))
  const alarmApi = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/alarm')
  const alarmSettings = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/alarm-settings')
  const top = { id: 's-int-1', header: { id: 's-int-1' } }

  // 工具报错 → 重要级内部降级通知（音色 double）
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { message: 'tool boom', code: 'TOOL_FAIL' } } } })
  let items = getJson(alarmApi).items
  assert(items.length === 1, 'tool-error 内部通知 1 条，got ' + items.length)
  assert(items[0].soundType === 'double', 'tool-error 音色 double')
  assert(items[0].level === '重要', 'tool-error 等级 重要')

  // 同一中断重复广播 → 去重，不新增（对照：客户端 ack 前重复广播也不会双响）
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { message: 'tool boom', code: 'TOOL_FAIL' } } } })
  assert(getJson(alarmApi).items.length === 1, '重复广播去重')

  // 用户主动取消 → 静默（无新通知）
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert(getJson(alarmApi).items.length === 1, '用户取消不报警')

  // max-tokens 截断 → 不报警
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 3, reason: { kind: 'max-tokens' } } })
  assert(getJson(alarmApi).items.length === 1, 'max-tokens 不报警')

  // 宿主重启恢复：create 开放轮种子 → 高危（音色 triple）
  ctx.emit('session/created', { id: 's-int-2', events: [{ type: 'turn/start', data: { turn: 4 } }] })
  items = getJson(alarmApi).items
  assert(items.length === 2, 'host-restart 通知 +1，got ' + items.length)
  assert(items[1].soundType === 'triple' && items[1].level === '高危', 'host-restart 高危/triple')

  // 会话失效销毁：dispose 开放轮 → 重要级
  ctx.emit('session/disposed', { id: 's-int-3', events: [{ type: 'turn/start', data: { turn: 1 } }] })
  items = getJson(alarmApi).items
  assert(items.length === 3, 'session-evicted 通知 +1')

  // 结构化日志：成功 3 条 + dedup 1 条 + 取消不记（取消无日志行）；字段完整性
  await new Promise(r => setTimeout(r, 100))
  const logLines = String(readFileSync(alarmLogFile, 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  const alertedLines = logLines.filter(l => l.alerted === true)
  assert(alertedLines.length === 3, 'alerted 日志 3 条，got ' + alertedLines.length)
  assert(logLines.some(l => l.mutedBy === 'dedup'), 'dedup 日志留痕')
  for (const l of alertedLines) {
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(l.ts), 'ts UTC ISO8601: ' + l.ts)
    assert(typeof l.sessionId === 'string' && l.sessionId.length > 0, 'sessionId 字段')
    assert(ALARM_KINDS.includes(l.kind), 'kind 枚举字段: ' + l.kind)
    assert(typeof l.level === 'string', 'level 字段')
  }

  // 门控：全局静音 → 新中断不发声但日志留痕 mutedBy；恢复后新中断可再次报警
  assert(postJson(alarmSettings, { muteAll: true }).body.data.muteAll === true, 'POST muteAll 生效并 clamp')
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 5, reason: { kind: 'error', error: { message: 'x', code: 'Y' } } } })
  assert(getJson(alarmApi).items.length === 3, '静音期间不新增内部通知')
  const logAfterMute = String(readFileSync(alarmLogFile, 'utf8')).trim().split('\n').map(l => JSON.parse(l))
  assert(logAfterMute.some(l => l.mutedBy === 'muteAll'), '静音过滤日志留痕')
  assert(postJson(alarmSettings, { muteAll: false }).body.data.muteAll === false, '解除静音')
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 6, reason: { kind: 'error', error: { message: 'y', code: 'Z' } } } })
  assert(getJson(alarmApi).items.length === 4, '解除静音后新中断可再次报警')

  // ack 清除
  const ids = getJson(alarmApi).items.map(i => i.id)
  assert(postJson(alarmApi, { ids }).body.ok === true, 'ack ok')
  assert(getJson(alarmApi).items.length === 0, 'ack 后队列清空')
  ctx.dispose()
  console.log('[4] 场景4 PASS：三类中断/去重/静默过滤/日志/ack/自包含内部发声')
}

// ===== 场景 5：自包含（用户指令 v0.2.1）——不与其他任何插件交互，发声全走本插件内部通道 =====
{
  const dir = mkdtempSync(join(tmpdir(), 'ds-alarm-'))
  const statsFile = join(dir, 'stats.json')
  const alarmSettingsFile = join(dir, 'alarm-settings.json')
  const ctx = makeCtx()
  built.apply(ctx, built.Config({ statsFile, alarmSettingsFile }))
  const alarmApi = ctx.route('/@dsh-external/dsh-dialogue-alert-message/api/alarm')
  const top = { id: 's-self-1', header: { id: 's-self-1' } }

  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { message: 'e', code: 'E' } } } })
  ctx.emit('session/event', top, { type: 'turn/end', time: Date.now(), data: { turn: 1, reason: { kind: 'error', error: { message: 'e', code: 'E' } } } })
  ctx.emit('session/created', { id: 's-self-2', events: [{ type: 'turn/start', data: { turn: 2 } }] })
  // 绝不访问其他插件（alertHub 等外来服务名未发生；仅平台自身凭据 seam credentials 允许）
  assert(
    !ctx.getCalls.includes('alertHub') && !ctx.getCalls.includes('eventbus'),
    '不与其他插件交互；get 调用: ' + JSON.stringify(ctx.getCalls),
  )
  let items = getJson(alarmApi).items
  assert(items.length === 2, '内部通知 2 条（去重后：error+restart），got ' + items.length)
  assert(items[0].level === '重要' && items[0].soundType === 'double', 'items[0] 重要/double')
  assert(items[1].level === '高危' && items[1].soundType === 'triple', 'items[1] 高危/triple')
  await new Promise(r => setTimeout(r, 1200))
  const saved = JSON.parse(readFileSync(alarmSettingsFile, 'utf8'))
  assert(Array.isArray(saved.recentAlertKeys) && saved.recentAlertKeys.length === 2, '去重键持久化')
  ctx.dispose()
  console.log('[5] 场景5 PASS：自包含（零外部交互）+ 内部发声队列 + 去重键持久化')
}

globalThis.fetch = realFetch
console.log('ALL INTEGRATION SCENARIOS PASS')
process.exit(0)
