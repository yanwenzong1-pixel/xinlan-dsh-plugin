#!/usr/bin/env node
/**
 * init-slots.mjs — 槽位自举（幂等 + 干跑）
 *
 * 目标：新机器上一次跑完就能建出 9 个槽位会话并绑定，且**重复跑不会重复建**。
 *
 * 用法
 *   node scripts/init-slots.mjs --dry-run              # 只打印计划：不联网、不写盘（推荐先跑这个）
 *   node scripts/init-slots.mjs --dry-run --only G,H   # 只看某几个槽位
 *   node scripts/init-slots.mjs                        # 真跑（会真的建会话、会改 session-map.json）
 *   node scripts/init-slots.mjs --only C --force        # 即使"已绑定且在线"也重建（慎用）
 *
 * 判据（每个槽位三选一）
 *   skip    ：session-map 里有绑定 + 花名册里该 id 存在且 live=true + 标题匹配 → 什么都不做
 *   rename  ：绑定还在、但在线会话的标题不匹配 → 只改名 + 更新绑定
 *   create  ：没有绑定或绑定已失效 → session/create(cwd) → session/rename(title) → 写绑定
 *
 * 前置条件
 *   1) dev 宿主在跑（默认 http://127.0.0.1:3090），且 staging-url.txt 有效（里面是带 token 的登录 URL）
 *   2) 可写 <repo>/local/protocol/session-map.json
 *   3) --dry-run 不依赖上面两条：它只读本地文件
 *
 * 环境变量（全部可选；脚本内**没有**硬编码的用户路径）
 *   DSH_REPO              业务仓根（默认：本脚本所在目录的上一级）
 *   DSH_PROTOCOL_DIR      协议目录（默认 <DSH_REPO>/local/protocol）
 *   DSH_BASE_URL          宿主 base（默认 http://127.0.0.1:3090）
 *   DSH_STAGING_URL_FILE  staging-url.txt（默认 <DSH_HOME>/staging-url.txt）
 *   DSH_QUOTE_REPO        行情仓根（默认 <DSH_REPO>/../{{QUOTE_REPO}}）
 *   DSH_TEST_REPO         测试仓根（默认 <DSH_REPO>/../test）
 *   DSH_RELAY_BASE        relay base（可选；设了才在真跑时用 /relay/sessions 校正 live，dry-run 永不联网）
 *   INIT_SLOTS_CONFIG     槽位表覆盖（默认 <DSH_REPO>/automation.config.json，存在才读）
 *   INIT_SLOTS_MAP        session-map 覆盖（默认 <DSH_PROTOCOL_DIR>/session-map.json）
 *   INIT_SLOTS_ROSTER     花名册快照覆盖（默认 <DSH_PROTOCOL_DIR>/state/sessions.json）
 *
 * RPC 形态（2026-10-19 由 create-github-slots.mjs 实测通过，本脚本沿用）
 *   POST <base>/api/session/<method>
 *   body: {"type":"client-request","rpcId":"<uuid>","method":"session/<m>","payload":{"args":{"request":{...}}}}
 *   · args 只接受一个 plain-object 字段且必须叫 request
 *   · rpcId 每次唯一（复用会 400）
 *   · 先 GET staging-url.txt 里的 URL（redirect:manual）换 cookie，再带 cookie 调 RPC
 *   · session/create 的 request 支持 { cwd?, workspaceId?, sessionId?, agentPreset? }
 *   · session/rename 的 request = { sessionId, title }
 *   · 标题含 emoji/中文：本文件是 UTF-8，直接走常量即可（不要经 PowerShell 命令行传字符串）
 *
 * 安全
 *   · 不打印 staging-url.txt 的内容（里面有 token），失败只报 HTTP 状态码
 *   · 写 session-map.json 前先备份：session-map.json.bak-before-init-slots-<时间戳>
 *   · 只改 map 的 slots 字段，_note / slots_meta 原样保留
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(process.env.DSH_REPO || join(HERE, '..'))
const PROTOCOL_DIR = resolve(process.env.DSH_PROTOCOL_DIR || join(REPO, 'local', 'protocol'))
const MAP_FILE = resolve(process.env.INIT_SLOTS_MAP || join(PROTOCOL_DIR, 'session-map.json'))
const ROSTER_FILE = resolve(process.env.INIT_SLOTS_ROSTER || join(PROTOCOL_DIR, 'state', 'sessions.json'))
const CONFIG_FILE = resolve(process.env.INIT_SLOTS_CONFIG || join(REPO, 'automation.config.json'))
const BASE_URL = (process.env.DSH_BASE_URL || 'http://127.0.0.1:3090').replace(/\/+$/, '')
const RELAY_BASE = (process.env.DSH_RELAY_BASE || '').replace(/\/+$/, '')
const STAGING_URL_FILE = process.env.DSH_STAGING_URL_FILE
  || join(process.env.DSH_HOME || '', 'staging-url.txt')
const HOOK_SCRIPT = join(HERE, 'backup-on-slots-change.ps1')
const HOOK_TIMEOUT_MS = 30000

/** 内置槽位表：2026-10-19 dev 花名册的实际标题与 cwd；`automation.config.json` 落地后可整体覆盖。 */
const BUILTIN_SLOTS = {
  A: { title: '⌛️-2-待办维护',    cwd: REPO },
  B: { title: '🏭-24-插件生产',   cwd: REPO },
  F: { title: '🏭-25-插件生产',   cwd: REPO },
  C: { title: '✈️-发布 Release', cwd: REPO },
  D: { title: '🏭-5-crawler生产', cwd: process.env.DSH_QUOTE_REPO || resolve(REPO, '..', '{{QUOTE_REPO}}') },
  E: { title: '💥-崩溃报告',      cwd: REPO },
  T: { title: '⚙️-test',         cwd: process.env.DSH_TEST_REPO || resolve(REPO, '..', 'test') },
  G: { title: '⬆️-Github-投研仓', cwd: REPO },
  H: { title: '⬆️-Github-行情仓', cwd: process.env.DSH_QUOTE_REPO || resolve(REPO, '..', '{{QUOTE_REPO}}') },
}

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const out = { dryRun: false, only: null, force: false, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run' || a === '-n') out.dryRun = true
    else if (a === '--force') out.force = true
    else if (a === '--json') out.json = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a === '--only') out.only = (argv[++i] || '').split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase())
    else if (a.startsWith('--only=')) out.only = a.slice(7).split(/[,\s]+/).filter(Boolean).map((s) => s.toUpperCase())
    else { console.error(`未知参数: ${a}（用 --help 看用法）`); process.exit(2) }
  }
  return out
}

const HELP = `init-slots.mjs — 槽位自举（幂等 + 干跑）

用法:
  node scripts/init-slots.mjs --dry-run [--only G,H] [--json]
  node scripts/init-slots.mjs [--only C] [--force]

参数:
  --dry-run, -n   只打印计划：不联网、不写盘
  --only a,b      只处理指定槽位（逗号分隔）
  --force         已绑定且在线也重建
  --json          额外输出一行机器可读的 PLAN=/RESULT=
  --help, -h      本帮助

环境变量见文件头注释。`

// ---------------------------------------------------------------- 配置 / 状态
function loadJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** backup.onSlotsChange 缺省视为 true；显式 false 才关闭。 */
function backupOnSlotsChangeEnabled() {
  const cfg = existsSync(CONFIG_FILE) ? loadJson(CONFIG_FILE) : null
  return !(cfg && cfg.backup && cfg.backup.onSlotsChange === false)
}

/**
 * 槽位变更钩子：写完 session-map 后触发一次本地备份。
 * 失败只 warn，不改变 init-slots 的退出码（备份是可选的旁路）。
 */
function runBackupOnSlotsChange() {
  if (!backupOnSlotsChangeEnabled()) {
    console.log('HOOK skipped: backup.onSlotsChange=false')
    return
  }
  if (!existsSync(HOOK_SCRIPT)) {
    console.warn(`WARN 备份钩子缺失，跳过：${HOOK_SCRIPT}`)
    return
  }
  const ps = process.env.DSH_HOOK_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh')
  const started = Date.now()
  let res
  try {
    res = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HOOK_SCRIPT], {
      timeout: HOOK_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn(`WARN 备份钩子启动失败（${err && err.message ? err.message : err}），不阻断 init-slots`)
    return
  }
  const out = String(res.stdout || '').trim()
  const errOut = String(res.stderr || '').trim()
  if (res.error || res.status !== 0) {
    const reason = res.error
      ? (res.error.code === 'ETIMEDOUT' ? `${HOOK_TIMEOUT_MS / 1000}s 超时` : String(res.error.message || res.error.code || res.error))
      : `exit=${res.status}${res.signal ? ` signal=${res.signal}` : ''}`
    console.warn(`WARN 备份钩子失败（${reason}），不阻断 init-slots`)
    if (out) console.warn(out)
    if (errOut) console.warn(errOut)
    return
  }
  if (out) console.log(out)
  if (errOut) console.warn(errOut)
  console.log(`HOOK backup-on-slots-change ok（${Date.now() - started}ms）`)
}

/**
 * 展开 cwd 里的路径占位符（换机器时只改配置，不改代码）：
 *   {{repoRoot}}   仓库根
 *   {{dshHome}}    当前 profile 的 DSH_HOME（取自 automation.config.json 的 paths.dshHome）
 *   {{dshCheckout}} DSH checkout（取自 dsh.checkout）
 *   {{userHome}}   用户主目录（USERPROFILE / HOME）
 */
const CONFIG = existsSync(CONFIG_FILE) ? loadJson(CONFIG_FILE) : null

function expandPathVars(value) {
  const text = String(value || '')
  const userHome = process.env.USERPROFILE || process.env.HOME || ''
  const dshHome = String((CONFIG && CONFIG.paths && CONFIG.paths.dshHome) || process.env.DSH_HOME || '')
  const dshCheckout = String((CONFIG && CONFIG.dsh && CONFIG.dsh.checkout) || '')
  return text
    .replace(/{{repoRoot}}/g, REPO)
    .replace(/{{dshHome}}/g, dshHome)
    .replace(/{{dshCheckout}}/g, dshCheckout)
    .replace(/{{userHome}}/g, userHome)
}

/** 槽位表：配置优先，缺字段用内置值；内置键是 9 个槽位，配置可以加键。 */
function loadSlots() {
  const builtin = Object.fromEntries(Object.entries(BUILTIN_SLOTS).map(([k, v]) => [k, { ...v }]))
  if (!existsSync(CONFIG_FILE)) return { slots: builtin, source: 'builtin（未找到 automation.config.json）' }
  const cfg = loadJson(CONFIG_FILE)
  if (!cfg || typeof cfg !== 'object') return { slots: builtin, source: 'builtin（配置解析失败）' }
  const fromCfg = cfg.slots || cfg.slotTable || null
  if (!fromCfg || typeof fromCfg !== 'object') return { slots: builtin, source: 'builtin（配置里没有 slots）' }
  const merged = { ...builtin }
  const rows = Array.isArray(fromCfg)
    ? fromCfg.map((v) => [v && (v.id || v.key || v.slot), v])
    : Object.entries(fromCfg)
  for (const [k, v] of rows) {
    const key = String(k || '').toUpperCase()
    if (!key || !v || typeof v !== 'object') continue
    const base = builtin[key] || {}
    const entry = { title: v.title || base.title || key, cwd: expandPathVars(v.cwd || base.cwd || REPO) }
    if (v.role) entry.role = String(v.role)
    merged[key] = entry
  }
  return { slots: merged, source: `config: ${CONFIG_FILE}` }
}

function loadRoster() {
  if (!existsSync(ROSTER_FILE)) return { rows: [], source: `无花名册快照（${ROSTER_FILE} 不存在）` }
  const j = loadJson(ROSTER_FILE)
  const rows = (j && Array.isArray(j.rows)) ? j.rows : []
  return { rows, source: ROSTER_FILE }
}

/**
 * 可选：真跑时用 relay 的实时端点 `/relay/sessions` 校正 live/标题。
 * 只在「非 dry-run 且设了 DSH_RELAY_BASE」时调用 —— dry-run 必须保持纯离线。
 * 该端点在旧构建里曾 404（relay 插件头部有记录），所以失败只警告、不中断；
 * 兜底数据就是插件每 5 tick 落盘的 state/sessions.json。
 */
async function augmentRosterFromRelay(roster) {
  if (!RELAY_BASE) return { rows: roster.rows, source: roster.source }
  try {
    const res = await fetch(`${RELAY_BASE}/relay/sessions`, { redirect: 'manual' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = await res.json()
    const live = Array.isArray(j) ? j : (j.rows || j.sessions || [])
    if (!Array.isArray(live) || live.length === 0) throw new Error('返回体里没有行')
    const byId = new Map(roster.rows.map((r) => [r.id, { ...r }]))
    for (const x of live) {
      const id = x.id || x.sessionId
      if (!id) continue
      const cur = byId.get(id) || { id }
      byId.set(id, { ...cur, live: x.live === undefined ? cur.live : Boolean(x.live), title: x.title || cur.title, cwd: x.cwd || cur.cwd })
    }
    return { rows: [...byId.values()], source: `${roster.source} + ${RELAY_BASE}/relay/sessions` }
  } catch (err) {
    console.error(`WARN 实时端点不可用（${err.message}）⇒ 只用花名册快照`)
    return { rows: roster.rows, source: roster.source }
  }
}

// ---------------------------------------------------------------- 决策
function decide(key, slot, map, roster, force) {
  const bound = map.slots && map.slots[key] ? String(map.slots[key]) : null
  const row = bound ? roster.rows.find((r) => r.id === bound) : null
  const titleOk = Boolean(row && typeof row.title === 'string' && row.title === slot.title)
  if (!force && bound && row && row.live === true && titleOk) {
    return { key, action: 'skip', bound, sessionId: bound, reason: '已绑定 + 花名册在线 + 标题匹配' }
  }
  if (!force && bound && row && row.live === true && !titleOk) {
    return { key, action: 'rename', bound, sessionId: bound, reason: `已绑定在线但标题不符（现为「${row.title || ''}」）` }
  }
  if (!force && bound && row && row.live !== true) {
    return { key, action: 'create', bound, sessionId: null, reason: '已绑定但花名册里不在线' }
  }
  if (!force && !bound) {
    return { key, action: 'create', bound: null, sessionId: null, reason: 'session-map 里没有绑定' }
  }
  if (force) {
    return { key, action: 'create', bound, sessionId: null, reason: '--force：忽略已有绑定' }
  }
  return { key, action: 'create', bound, sessionId: null, reason: '绑定存在但花名册无该会话' }
}

// ---------------------------------------------------------------- RPC
async function getCookie() {
  if (!STAGING_URL_FILE || !existsSync(STAGING_URL_FILE)) {
    throw new Error(`找不到 staging-url.txt（看 DSH_STAGING_URL_FILE / DSH_HOME）：${STAGING_URL_FILE || '(未设置)'}`)
  }
  const url = readFileSync(STAGING_URL_FILE, 'utf8').trim()
  if (!url) throw new Error('staging-url.txt 是空的')
  const res = await fetch(url, { redirect: 'manual' })
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const cookie = raw.map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`换 cookie 失败（HTTP ${res.status}）`)
  return cookie
}

function makeRpc(cookie) {
  return async function rpc(method, request) {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: `slots-${randomUUID()}`,
      method,
      payload: { args: { request } },
    })
    const res = await fetch(`${BASE_URL}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 保留原文 */ }
    return { status: res.status, json, text }
  }
}

function rpcOk(r) {
  return Boolean(r && r.json && r.json.result && r.json.result.ok)
}

// ---------------------------------------------------------------- 写 map（保留 _note / slots_meta）
function writeMap(map, updates, dryRun) {
  const next = { ...(map || {}) }
  next.slots = { ...((map && map.slots) || {}) }
  for (const [k, v] of Object.entries(updates)) if (v) next.slots[k] = v
  if (dryRun) return null
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  if (existsSync(MAP_FILE)) copyFileSync(MAP_FILE, `${MAP_FILE}.bak-before-init-slots-${ts}`)
  const tmp = `${MAP_FILE}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  renameSync(tmp, MAP_FILE)
  return { file: MAP_FILE, backup: existsSync(`${MAP_FILE}.bak-before-init-slots-${ts}`) ? `${MAP_FILE}.bak-before-init-slots-${ts}` : null }
}

// ---------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(HELP); return 0 }

  const { slots, source } = loadSlots()
  const keys = Object.keys(slots).sort()
  if (args.only) {
    const bad = args.only.filter((k) => !slots[k])
    if (bad.length) { console.error(`--only 里有未知槽位：${bad.join(',')}（可用：${keys.join(',')}）`); return 2 }
  }
  const selected = args.only ? keys.filter((k) => args.only.includes(k)) : keys

  const map = (existsSync(MAP_FILE) ? loadJson(MAP_FILE) : null) || { slots: {} }
  let roster = loadRoster()
  if (!args.dryRun) roster = await augmentRosterFromRelay(roster)

  const plan = selected.map((k) => decide(k, slots[k], map, roster, args.force))

  console.log(`# init-slots${args.dryRun ? ' [DRY-RUN]' : ''}`)
  console.log(`repo=${REPO}`)
  console.log(`map=${MAP_FILE}${existsSync(MAP_FILE) ? '' : '（不存在，真跑会新建）'}`)
  console.log(`roster=${roster.source}`)
  console.log(`slots=${source}`)
  console.log('')
  console.log('| 槽位 | 动作 | 标题 | cwd | 依据 |')
  console.log('|---|---|---|---|---|')
  for (const p of plan) {
    const s = slots[p.key]
    console.log(`| ${p.key} | ${p.action} | ${s.title} | ${s.cwd} | ${p.reason} |`)
  }
  console.log('')
  const counts = plan.reduce((acc, p) => (acc[p.action] = (acc[p.action] || 0) + 1, acc), {})
  console.log(`PLAN ${JSON.stringify({ total: plan.length, ...counts })}`)
  if (args.json) console.log('PLAN=' + JSON.stringify(plan))

  if (args.dryRun) {
    console.log('')
    console.log(`HOOK backup.onSlotsChange=${backupOnSlotsChangeEnabled()} → 真跑写完 session-map 后调用 scripts/backup-on-slots-change.ps1（dry-run 不触发备份）`)
    console.log('DRY-RUN：不联网、不写盘。去掉 --dry-run 才会真的建会话。')
    return 0
  }

  // ---- 真跑 ----
  const todo = plan.filter((p) => p.action !== 'skip')
  if (todo.length === 0) { console.log('无需动作（全部 skip）'); return 0 }

  const cookie = await getCookie()
  const rpc = makeRpc(cookie)
  const updates = {}
  const results = []

  for (const p of todo) {
    const s = slots[p.key]
    let sessionId = p.action === 'rename' ? p.sessionId : null
    let created = false
    if (!sessionId) {
      const c = await rpc('session/create', { cwd: s.cwd })
      if (!rpcOk(c)) {
        results.push({ key: p.key, ok: false, step: 'create', status: c.status, error: (c.json && c.json.result && c.json.result.error) || c.text.slice(0, 160) })
        continue
      }
      sessionId = c.json.result.value.sessionId
      created = true
    }
    const r = await rpc('session/rename', { sessionId, title: s.title })
    const renamed = rpcOk(r)
    if (renamed) updates[p.key] = sessionId
    results.push({
      key: p.key, ok: renamed, sessionId, created, renamed,
      error: renamed ? null : ((r.json && r.json.result && r.json.result.error) || r.text.slice(0, 160)),
    })
  }

  const written = writeMap(map, updates, false)
  runBackupOnSlotsChange()
  console.log('')
  console.log(`RESULT ${JSON.stringify({ ok: results.every((x) => x.ok), map: written, rows: results })}`)
  return results.every((x) => x.ok) ? 0 : 1
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('FATAL ' + (err && err.message ? err.message : String(err)))
  process.exit(1)
})
