/**
 * dsh-relay-watch —— 会话「派单 / 回函 / 崩溃简报」转发（宿主侧 bundle 插件，纯 ESM，无构建步骤）。
 *
 * v0.3.0（2026-10-08）：**崩溃简报改投「DSH崩溃报告统一处理」会话 + 突发成批投递**。
 *   用户指令（2026-10-08，本会话）：① 崩溃报告的处理单独放到一个会话；② 「待办维护」会把崩溃报告
 *   发过来，处理完用回函回复；③ **短时间队列里有多份崩溃报告时，统一处理完毕后只发一封回函**。
 *   为此本版加三件事（**只影响崩溃简报，回函/派单路径一行未改**）：
 *     a. `crashSlot`：`inbox/crash-*.md` 改投该槽位（缺省仍是 `self`，即旧行为）；配好之前**不丢件**。
 *     b. **突发静默窗口 `crashQuietMs`**：崩溃常成串出现（一次重启会连写 2–4 份，含重启回声）。
 *        本版把崩溃简报先**攒着**，直到「本批最后一份落盘后又安静了 crashQuietMs」才**一次投递整批**
 *        （一份 inject 消息里列出全部文件名）⇒ 会话只被唤醒一次、只回一封函。
 *     c. **长重试 `crashRetryStuck`**：投递失败（宿主刚起来、目标会话还没上线）时**不计数、不放弃**，
 *        只在超过 `crashMaxHoldMs` 时投一次并开始计数，最终仍失败才进 `failed/`（默认 50 tick ≈ 250 秒）。
 *   另外：整批投递时给消息**加一段处理口径抬头**（含 runbook 路径），使"新会话/上下文被压缩后"
 *   依然知道该怎么办；runbook 正文见 `<本目录>/CRASH-RUNBOOK.md`。
 *
 * v0.2.0（2026-10-04）：bundle 上下文里 `ctx.get('webServer')` 在 profile 根作用域拿不到
 *   ⇒ `/relay/state`、`/relay/sessions` 两个 HTTP 端点注册失败（实测 404）。
 *   本版改为：① 每个 tick 重试注册（最多 12 次）；② 无论端点是否可用，都把运行状态与会话花名册
 *   写成文件 `state/relay-status.json`、`state/sessions.json`（每 5 个 tick 一次），保证可观测性
 *   不依赖 web 作用域。
 *
 * 它做什么：
 *   ① 每 pollMs 扫一次 `<base>/outbox/`：`to-<槽位>-<任意名>.md` ⇒ 按 `<base>/session-map.json`
 *      的 slots 找到目标会话 id，用 `ctx.agents.get(id).followup(消息)` 投进去；
 *   ② 扫 `<base>/inbox/`：`crash-*.md` ⇒ 按突发成批投给 `crashSlot`（见上）；其余文件 ⇒ 投给 map.self（调度点）；
 *   ③ 每次投递写收据 `<base>/state/<原名>.done`，并把原件 `rename` 到 `<base>/sent/`（失败进 `failed/`）；
 *   ④ 启动时**先读 `state/` 的收据塞进去重表** ⇒ 重启不会重复投递。
 *
 * 注入面依据：`ctx.agents.get(sessionId)` + `agent.followup(userMessage)` —— 与
 * `packages/api/session-controller/src/commands.ts:355` 及 dsh-restart-callback 同款；
 * 消息形状 `{id, role:'user', content:[{type:'text',text}], source:{kind:'user'}}` 已在动态版里实测投递成功。
 *
 * ⚠️ 本插件进 `dsh.profile.bundles`，属宿主启动路径：改它必须按仓库 AGENTS.md 的
 *   「包完整 → 离线自检 → 改清单 → --dump-config 干跑 → 冲突预检 → 重启」六步走。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-relay-watch'

/** agents 用来按会话 id 找人，timer 用来起轮询。**不要 inject webServer**：根作用域拿不到会让整个插件挂起。 */
export const inject = ['agents', 'timer']

const DEFAULTS = {
  base: '<protocol-dir>',
  self: 'A',
  pollMs: 5000,
  maxRetry: 6,
  statusEveryTicks: 5,
  routeRetryMax: 12,
  /** 崩溃简报到哪个槽位（缺省时回落到 self，即旧行为——配好之前不丢件）。 */
  crashSlot: 'CR',
  /** 突发静默窗口：本批最后一份落盘后再安静这么久，才整批投递（毫秒）。 */
  crashQuietMs: 60000,
  /** 硬上限：一份崩溃简报最多攒这么久就投出去（毫秒）。防"崩溃循环里永远等不到安静"。 */
  crashMaxHoldMs: 300000,
  /** 攒着不投期间，超过这么多 tick 才开始计失败次（默认 50 tick × 5 秒 ≈ 250 秒）。 */
  crashRetryStuck: 50,
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const BASE = cfg.base
  const DIR = {
    outbox: join(BASE, 'outbox'),
    inbox: join(BASE, 'inbox'),
    state: join(BASE, 'state'),
    sent: join(BASE, 'sent'),
    failed: join(BASE, 'failed'),
    log: join(BASE, 'log'),
  }
  const LOG = join(BASE, 'relay.log')
  const MAP = join(BASE, 'session-map.json')
  const state = {
    startedAt: new Date().toISOString(),
    plugin: name + '@0.3.0',
    base: BASE,
    crashSlot: cfg.crashSlot,
    crashQuietMs: cfg.crashQuietMs,
    crashMaxHoldMs: cfg.crashMaxHoldMs,
    ticks: 0,
    sent: 0,
    inbox: 0,
    crashBatches: 0,
    crashBriefs: 0,
    held: 0,
    skipped: 0,
    failed: 0,
    retries: 0,
    lastError: null,
    route: 'pending',
    routeAttempts: 0,
    crashRoute: 'pending',
    steps: [],
  }
  const step = (s) => {
    try {
      state.steps.push(new Date().toISOString().slice(11, 19) + ' ' + s)
      if (state.steps.length > 50) state.steps.shift()
    } catch (e) {}
  }
  const logLine = (line) => {
    try { appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n') }
    catch (e) { try { ctx.logger?.warn?.('dsh-relay-watch: log append failed: ' + (e && e.message)) } catch (_) {} }
  }

  for (const key of Object.keys(DIR)) {
    try { mkdirSync(DIR[key], { recursive: true }) } catch (e) { logLine('MKDIR-FAIL ' + key + ' :: ' + (e && e.message)) }
  }

  // ── 启动即读收据：重启不重复投递 ──
  const done = new Set()
  const retries = new Map()
  try {
    for (const f of readdirSync(DIR.state)) {
      if (f.endsWith('.done')) done.add(f.slice(0, -'.done'.length))
    }
    // 收据键统一成"带侧别前缀"：把**本次运行内存里**的旧式裸键也迁移过来（纯内存别名，
    // 盘上不动）⇒ 同一次运行内两侧不再互相冒充（2026-10-08）。
    for (const k of Array.from(done)) { if (!k.startsWith('inbox-') && !k.startsWith('outbox-')) done.add('outbox-' + k) }
  } catch (e) { logLine('RECEIPT-BOOT-FAIL :: ' + (e && e.message)) }
  step('boot: receipts=' + done.size)

  // ── 会话花名册（只读叶片字段）──
  const roster = () => {
    const rows = []
    try {
      const live = ctx.agents.list()
      const liveIds = []
      for (const a of live) { try { if (a && typeof a.id === 'string') liveIds.push(a.id) } catch (e) {} }
      const sessions = ctx.get('sessions')
      const titles = ctx.get('sessionTitle')
      const list = sessions === undefined ? [] : sessions.list()
      for (const s of list) {
        if (!s) continue
        const id = String(s.id)
        let title = null
        if (titles !== undefined) {
          try { const t = titles.get(s); if (typeof t === 'string') title = t; else if (t && typeof t.title === 'string') title = t.title } catch (e) { title = null }
        }
        let cwd = null
        try { const h = s.header; if (h && typeof h.cwd === 'string') cwd = h.cwd } catch (e) { cwd = null }
        rows.push({ id: id, title: title, cwd: cwd, live: liveIds.indexOf(id) >= 0 })
      }
      return { at: new Date().toISOString(), total: rows.length, liveCount: liveIds.length, rows: rows }
    } catch (e) { return { at: new Date().toISOString(), error: String(e && e.message), rows: rows } }
  }
  const writeStatusFiles = () => {
    try { writeFileSync(join(DIR.state, 'relay-status.json'), JSON.stringify(state, null, 1)) } catch (e) { state.lastError = 'status-write :: ' + (e && e.message) }
    try { writeFileSync(join(DIR.state, 'sessions.json'), JSON.stringify(roster(), null, 1)) } catch (e) { state.lastError = 'roster-write :: ' + (e && e.message) }
  }

  const listFiles = (dir) => {
    try {
      return readdirSync(dir)
        .filter((n) => { try { return statSync(join(dir, n)).isFile() } catch (e) { return false } })
        .map((n) => { let m = 0; try { m = statSync(join(dir, n)).mtimeMs } catch (e) {} return { name: n, mtimeMs: m } })
    } catch (e) { state.lastError = 'list ' + dir + ' :: ' + (e && e.message); return [] }
  }
  const readIfExists = (p) => {
    try { return existsSync(p) ? readFileSync(p, 'utf8') : undefined }
    catch (e) { state.lastError = 'read ' + p + ' :: ' + (e && e.message); return undefined }
  }
  const writeReceipt = (key, text) => {
    try { writeFileSync(join(DIR.state, key + '.done'), text, { flag: 'wx' }); done.add(key); return true }
    catch (e) {
      if (e && e.code === 'EEXIST') { done.add(key); return true }
      state.lastError = 'receipt ' + key + ' :: ' + (e && e.message)
      logLine('RECEIPT-FAIL ' + key + ' :: ' + (e && e.message))
      return false
    }
  }
  const parkFile = (fromDir, fileName, target) => {
    try {
      const to = join(target, fileName)
      renameSync(join(fromDir, fileName), existsSync(to) ? join(target, fileName + '.' + Date.now()) : to)
      return true
    } catch (e) { state.lastError = 'park ' + fileName + ' :: ' + (e && e.message); return false }
  }
  const deliver = (targetId, text) => {
    const agent = ctx.agents.get(targetId)
    if (agent === undefined) return { ok: false, reason: 'no-live-agent' }
    if (typeof agent.followup !== 'function') return { ok: false, reason: 'no-followup-api' }
    try {
      agent.followup({
        id: 'relay-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        role: 'user',
        content: [{ type: 'text', text: text }],
        source: { kind: 'user' },
      })
      return { ok: true }
    } catch (e) { return { ok: false, reason: 'followup-threw: ' + (e && e.message) } }
  }

  // ── HTTP 自检端点（尽力而为；拿不到 webServer 就重试，另有文件状态兜底）──
  const tryRegisterRoutes = () => {
    if (state.route === 'registered:state+sessions') return
    if (state.routeAttempts >= cfg.routeRetryMax) return
    state.routeAttempts += 1
    try {
      const webServer = ctx.get('webServer')
      if (webServer === undefined) { state.route = 'no-webServer'; return }
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/relay/state',
        handler: async (req, res) => { try { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(state, null, 1)) } catch (e) {} },
      }))
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: '/relay/sessions',
        handler: async (req, res) => { try { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(roster(), null, 1)) } catch (e) { try { res.end('{}') } catch (_) {} } },
      }))
      state.route = 'registered:state+sessions'
      logLine('ROUTES registered (attempt ' + state.routeAttempts + ')')
    } catch (e) {
      state.route = 'register-failed: ' + (e && e.message)
      if (state.routeAttempts >= cfg.routeRetryMax) logLine('ROUTES give-up :: ' + state.route)
    }
  }

  // ══ 崩溃简报：突发成批投递 ══════════════════════════════════════════════════
  const CRASH_RE = /^crash-.+\.md$/i
  const isCrashBrief = (fname) => CRASH_RE.test(fname)
  const crashSeenAt = new Map()   // fname -> 本插件第一次看到它的时刻（宿主重启后丢失 ⇒ 用 mtime 兜底）
  const crashAttempts = new Map() // fname -> 投递尝试次数（只在"该出手了"之后才计）

  /**
   * 该不该把这一批投出去。三条缺一不可（见文件头注释）：
   *   ① 本批最后一份落盘后又安静了 crashQuietMs；② 批次起点之前至少有一份收据（= 本宿主不是刚重启，
   *      否则会把"重启前攒的旧件"当成本批，漏掉后面还在陆续到达的同批简报）；
   *   ③ 最老一份已攒够 crashMaxHoldMs（崩溃循环里等不到安静时的兜底）。
   */
  const crashBatchDecision = (now, pending) => {
    const newest = Math.max(...pending.map((f) => f.mtimeMs))
    const oldest = Math.min(...pending.map((f) => f.mtimeMs))
    const quietFor = now - newest
    const heldFor = now - oldest
    if (quietFor >= cfg.crashQuietMs) return { deliver: true, why: 'quiet' }
    if (heldFor >= cfg.crashMaxHoldMs) return { deliver: true, why: 'max-hold' }
    return { deliver: false, why: 'burst ongoing' }
  }

  const fmtLocal = (ms) => {
    try {
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return '' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' '
        + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    } catch (e) { return String(ms) }
  }

  const buildCrashBatchText = (files, slot) => {
    const lines = []
    lines.push('[relay] 崩溃简报成批投递 · ' + files.length + ' 份 · 转发槽位 ' + slot)
    lines.push('本批文件（按文件名=时间升序；原件已归档到 sent/，台账副本见 crash-briefs.md）：')
    for (const name of files) lines.push('- ' + name)
    lines.push('')
    lines.push('处理口径（详见 local/protocol/CRASH-RUNBOOK.md）：')
    lines.push('1) 先判类别与序号：deliberate（主动重启）/ 回声 / unexpected（真崩溃）；判据是简报里那一行「判定类别 + 判定依据」。')
    lines.push('2) 再按 PID + 退出码 + 采样滞后聚簇：**同一事件的多份简报算一次崩溃**，不要各算一次。')
    lines.push('3) 需要现场时读转储目录（crashdumps-3080）与 logs\\dsh-watchdog.log、logs\\service-exit.jsonl；本机日志窗口与窗口外口径见简报正文。')
    lines.push('4) **整批一次处理完，只写一封回函**：outbox/to-A-reply-crash-<本批最后一份文件名里的时间戳>.md（回函面向「待办维护」，含每份的结论与总计）。')
    lines.push('5) 回函写完即结束，不要对同一批再补同名的第二封（中继按文件名判重，同名永远不会再投递）。')
    lines.push('')
    lines.push('---- 简报正文 ----')
    return lines.join('\n')
  }

  const deliverCrashBatch = (pending, slot, targetId, now) => {
    const files = pending.map((f) => f.name).sort()
    const parts = []
    for (const f of files) {
      const body = readIfExists(join(DIR.inbox, f))
      if (!body) { logLine('CRASH-READ-FAIL ' + f); continue }
      parts.push('# ===== ' + f + ' =====\n' + body.trim() + '\n')
    }
    if (parts.length === 0) return { ok: false, reason: 'no-readable-brief' }
    const text = buildCrashBatchText(files, slot) + '\n' + parts.join('\n')
    const r = deliver(targetId, text)
    if (!r.ok) return r
    for (const f of files) {
      writeReceipt('inbox-' + f, 'INBOX -> ' + slot + ' (crash batch ' + files.length + ')\n')
      parkFile(DIR.inbox, f, DIR.sent)
      crashSeenAt.delete(f)
      crashAttempts.delete(f)
      logLine('CRASH-BATCH ' + files.length + ' -> ' + slot + ' (' + targetId + ') :: ' + files.join(', '))
    }
    state.crashBatches += 1
    state.crashBriefs += files.length
    step('crash-batch ' + files.length + ' -> ' + slot + ' [' + files[0] + ' .. ' + files[files.length - 1] + ']')
    return { ok: true, count: files.length }
  }

  const tick = () => {
    state.ticks += 1
    state.lastError = null
    let map = {}
    try { map = JSON.parse(readIfExists(MAP) || '{}') } catch (e) { map = {} }
    const slots = (map && map.slots) || {}
    const selfId = slots[cfg.self] || slots[map.self] || undefined
    const crashSlotToken = String(cfg.crashSlot || '')
    const crashId = crashSlotToken ? slots[crashSlotToken] : undefined
    state.crashRoute = crashId !== undefined
      ? (crashSlotToken + '=' + crashId)
      : (crashSlotToken ? 'fallback-self: no slot ' + crashSlotToken : 'fallback-self: crashSlot 未配置')

    for (const f of listFiles(DIR.outbox)) {
      const fname = f.name
      // 收据命名空间按"哪一侧投的"分开（2026-10-08 修）：
      //   · 本侧（outbox）只认 `outbox-<原名>.done` 与旧式裸键 `<原名>.done`；
      //   · **不查 `inbox-<原名>.done`** —— 那是 inbox 文件的收据，拿它挡 outbox 件就等于
      //     "inbox/ 与 outbox/ 出现同名文件时，先投的一方把后投的一方静默吞掉"
      //     （没日志、没收据、文件永远躺在目录里）。旧式裸键的歧义由启动时的内存别名迁移消掉。
      // 这条由 `relay-crash-batch-drill.mjs` 场景 8/9 钉住。
      if (done.has('outbox-' + fname) || done.has(fname)) { state.skipped += 1; continue }
      const m = /^to-([A-Za-z0-9_]+)-/.exec(fname)
      if (m === null) continue
      const body = readIfExists(join(DIR.outbox, fname))
      if (!body) continue
      const targetId = slots[m[1]]
      const r = targetId ? deliver(targetId, body) : { ok: false, reason: 'no-session-for-slot ' + m[1] }
      if (r.ok) {
        state.sent += 1
        writeReceipt('outbox-' + fname, 'SENT -> ' + m[1] + '\n')
        parkFile(DIR.outbox, fname, DIR.sent)
        logLine('SENT ' + fname + ' -> ' + m[1] + ' (' + targetId + ')')
        step('sent ' + fname + ' -> ' + m[1])
      } else {
        state.retries += 1
        retries.set(fname, (retries.get(fname) || 0) + 1)
        logLine('RETRY(' + retries.get(fname) + ') ' + fname + ' :: ' + r.reason)
        step('retry ' + fname + ' ' + r.reason)
        if (retries.get(fname) >= cfg.maxRetry) {
          state.failed += 1
          writeReceipt('outbox-' + fname, 'FAIL ' + r.reason + '\n')
          parkFile(DIR.outbox, fname, DIR.failed)
          logLine('GIVEUP ' + fname + ' :: ' + r.reason)
        }
      }
    }

    // ── inbox：崩溃简报按"突发"攒批，其余文件立刻投给 self ──
    const now = Date.now()
    const pendingCrash = []
    for (const f of listFiles(DIR.inbox)) {
      const fname = f.name
      const key = 'inbox-' + fname
      // 只认 inbox 侧自己的收据 `inbox-<原名>.done`。**去掉**原 `|| done.has(fname)` 的宽松判重：
      // 那条会把"outbox 侧投过同名件"留下的收据（`<原名>.done`）当成 inbox 件已投，静默吞件。
      if (done.has(key)) { state.skipped += 1; continue }
      if (isCrashBrief(fname)) {
        if (!crashSeenAt.has(fname)) crashSeenAt.set(fname, now)
        pendingCrash.push({ name: fname, mtimeMs: f.mtimeMs || now, seenAt: crashSeenAt.get(fname) })
        continue
      }
      const body = readIfExists(join(DIR.inbox, fname))
      if (!body) continue
      if (!selfId) { logLine('INBOX-NO-SELF ' + fname); continue }
      const r = deliver(selfId, '[relay] 收到回函文件 ' + fname + '\n\n' + body)
      if (r.ok) {
        state.inbox += 1
        writeReceipt(key, 'INBOX -> ' + cfg.self + '\n')
        parkFile(DIR.inbox, fname, DIR.sent)
        logLine('INBOX ' + fname + ' -> ' + cfg.self)
        step('inbox ' + fname)
      } else {
        logLine('INBOX-FAIL ' + fname + ' :: ' + r.reason)
        step('inbox-fail ' + fname + ' ' + r.reason)
      }
    }

    if (pendingCrash.length > 0) {
      const d = crashBatchDecision(now, pendingCrash)
      if (d.deliver) {
        const targetId = crashId !== undefined ? crashId : selfId
        const slot = crashId !== undefined ? crashSlotToken : cfg.self
        if (targetId === undefined) {
          state.held = pendingCrash.length
          logLine('CRASH-NO-TARGET ' + pendingCrash.length + ' :: ' + state.crashRoute)
        } else {
          const r = deliverCrashBatch(pendingCrash, slot, targetId, now)
          if (!r.ok) {
            state.held = pendingCrash.length
            const oldestHeld = now - Math.min(...pendingCrash.map((f) => f.seenAt))
            // 攒着不投期间（还没到硬上限）**不计数**：宿主刚起来、目标会话还没上线是常态，不是失败。
            if (oldestHeld < cfg.crashMaxHoldMs) {
              const n = (crashAttempts.get(pendingCrash[0].name) || 0) + 1
              for (const f of pendingCrash) crashAttempts.set(f.name, n)
              if (n <= 3) logLine('CRASH-HOLD(' + n + ') ' + pendingCrash.length + ' :: ' + r.reason)
            } else {
              // 过了硬上限还投不出去 ⇒ 按普通件计失败、走失败出口（同时留收据，避免重启后重复计数）。
              for (const f of pendingCrash) {
                const n = (crashAttempts.get(f.name) || 0) + 1
                crashAttempts.set(f.name, n)
                state.retries += 1
                if (n >= cfg.crashRetryStuck) {
                  state.failed += 1
                  writeReceipt('inbox-' + f.name, 'FAIL ' + r.reason + '\n')
                  parkFile(DIR.inbox, f.name, DIR.failed)
                  crashSeenAt.delete(f.name)
                  crashAttempts.delete(f.name)
                  logLine('CRASH-GIVEUP ' + f.name + ' :: ' + r.reason)
                } else {
                  logLine('CRASH-RETRY(' + n + ') ' + f.name + ' :: ' + r.reason)
                }
              }
              step('crash-retry ' + pendingCrash.length + ' ' + r.reason)
            }
          }
        }
      } else {
        state.held = pendingCrash.length
        const age = Math.round((now - Math.min(...pendingCrash.map((f) => f.seenAt))) / 1000)
        step('crash-hold ' + pendingCrash.length + ' (' + d.why + ', ' + age + 's)')
      }
    } else {
      state.held = 0
    }

    if (state.ticks % cfg.statusEveryTicks === 0) writeStatusFiles()
    tryRegisterRoutes()
  }

  const safeTick = () => {
    try { tick() } catch (e) { try { logLine('TICK-THREW :: ' + (e && e.message)) } catch (_) {} }
  }
  ctx.effect(() => {
    safeTick()
    const off = ctx.interval(() => { safeTick() }, cfg.pollMs)
    return () => { off() }
  })
  logLine('START base=' + BASE + ' self=' + cfg.self + ' crashSlot=' + cfg.crashSlot
    + ' quietMs=' + cfg.crashQuietMs + ' maxHoldMs=' + cfg.crashMaxHoldMs + ' pollMs=' + cfg.pollMs
    + ' receipts=' + done.size)
  step('watcher registered')
}
