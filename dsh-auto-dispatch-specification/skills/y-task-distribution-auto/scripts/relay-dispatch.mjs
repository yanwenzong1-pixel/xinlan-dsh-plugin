#!/usr/bin/env node
/**
 * relay-dispatch.mjs —— 「派单」的唯一安全入口（技能 y-task-distribution-auto）
 *
 * 它做的事：体检 → 组报文 → （默认只干跑）→ --confirm 落盘 outbox/ → 等收据证明「已送达」。
 *
 * 为什么需要它（血账，来自转发插件 lib/index.js 的真实行为）：
 *   · 文件名不匹配 /^to-([A-Za-z0-9_]+)-/ 的文件被静默 continue（198-199 行）⇒ 永远发不出去、还没日志；
 *   · 收据用 wx 写一次（132 行）+ 启动读 state/*.done 塞去重表（88-90 行）+ tick 里 done.has() 静默跳过（197 行）
 *     ⇒ 同一个文件名永远只投一次，**FAIL 收据也一样挡住重发**；
 *   · 目标必须是在线 agent（148-149 行），重试 6 次（36 / 215 行）后写 FAIL 并把原件扔进 failed/；
 *   · 重试计数只在内存（86 行），宿主重启就归零 ⇒ 别拿它当队列。
 *
 * 退出码：0 成功 · 2 用法/体检拒绝（没写盘） · 3 投递 FAIL · 4 等收据超时（已写盘，待投递）
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const DEFAULT_PROTOCOL = join(REPO, 'local', 'protocol')

const SLOTS = {
  // 2026-10-20 用户指示：新增「用户决策」槽位（唯一用户入口，置顶）。
  //   只做四件事：把用户需求原样转给 A、把 A 的短通知/状态摘要转给用户、把 A 转来的问题问用户并回答案；
  //   **不派单给其它槽位、不改代码、不查库**。派给它的 kind 固定为 `user`。
  U: { title: '💬-1-用户决策', titleKey: '用户决策', kinds: ['user'], note: '用户决策入口（只与用户对接，不派单）' },
  A: { title: '⌛️-待办维护', titleKey: '待办维护', kinds: ['coord'], note: '调度点（默认发起方）' },
  B: { title: '🏭-21-插件生产', titleKey: '插件生产', kinds: ['dev', 'ops'], note: '开发面（第一生产槽位）' },
  F: { title: '🏭-25-插件生产', titleKey: '🏭-25', kinds: ['dev', 'ops'], note: '开发面（第二生产槽位，与 B 并行）' },
  // 【2026-10-22 用户指示】新增**第三个生产槽位** I = `🏭-28-插件生产`（{{SESSION_ID_1}}…）。
  //   与 B/F 同角色（dev/ops），组名 `--to prod` 自动挑选成员变为 B、F、I 三个；
  //   titleKey 用带编号的 `🏭-28`（三个生产槽位并存 ⇒ 编号写错必须响亮失败，宽松键抓不出来）。
  I: { title: '🏭-28-插件生产', titleKey: '🏭-28', kinds: ['dev', 'ops'], note: '开发面（第三生产槽位，与 B/F 并行）' },
  // ⚠️ 换手提醒：F / I 的 titleKey 取**带编号**的键（三个生产槽位并存后，"编号绑错"用宽松键抓不出来）。
  //    以后换手到新编号的窗口时：除了改 session-map.json 的 slots.F，**这里也要一起改** ——
  //    不改的话 check 会硬失败并逐字打印期望值（响亮失败，不会静默放行）。
  //    沿革：`🏭-22`（{{SESSION_ID_2}}…，2026-10-16 09:3x–14:0x，余量尽、零改动交回）
  //      → **`🏭-25`（{{SESSION_ID_3}}…，2026-10-16 14:0x 起，换手指令 = 用户逐字「甲（推荐）：你开一个新窗口给我」）**。

  C: { title: '✈️-发布 Release', titleKey: '发布', kinds: ['release'], note: '只做发布与发布面救火' },
  D: { title: '🏭-4-crawler生产', titleKey: 'crawler', kinds: ['data'], note: '行情服务端' },
  E: { title: '💥-崩溃报告', titleKey: '崩溃报告', kinds: ['crash', 'ops'], note: '崩溃简报处理与宿主故障取证' },
  T: { title: '⚙️-test', titleKey: 'test', kinds: ['selftest'], note: '诊断位（只用于通道自检）' },
  // 2026-10-19 用户指示：新增两个 GitHub 上传槽位，各管各的仓。
  G: { title: '⬆️-Github-投研仓', titleKey: '⬆️-Github-投研', kinds: ['git'], note: '投研仓 GitHub 上传（{{REPO_NAME}}）' },
  H: { title: '⬆️-Github-行情仓', titleKey: '⬆️-Github-行情', kinds: ['git'], note: '行情仓 GitHub 上传（{{QUOTE_REPO}}）' },
  // 2026-10-26 用户指示新增：用户中心维护槽位（{{DSH_HELPER_DIR}} 工作区；kind 复用 dev/ops）。
  J: { title: '🙋‍♀️-1-用户中心', titleKey: '用户中心', kinds: ['dev', 'ops'], note: '用户中心 & DSH 崩溃修复项目维护（{{DSH_HELPER_DIR}} 工作区；不碰本仓业务插件）' },
}
const KINDS = ['dev', 'release', 'data', 'ops', 'coord', 'crash', 'selftest', 'git', 'user']
/**
 * 【2026-10-16 用户指示】**生产面从一个槽位扩到两个**（B = `🏭-21-插件生产`、F = `🏭-22-插件生产`）；
 * 【2026-10-22 用户指示】**再增第三个**（I = `🏭-28-插件生产`，与 B/F 并行）：
 * 待办里有些任务可以并行开发 ⇒ 派单时可以只写**组名** `--to prod`，由脚本按"谁在跑得少"自动挑一个；
 * 明确写 `--to B` / `--to F` / `--to I` 的照旧，不做任何改写。
 *
 * 挑法（**确定性、可复算**，不给"随机 / 凭感觉"留缝）：
 *   ① 先比 `AUTO_PICK_WINDOW_H` 小时内**发出且未回函**的派单条数 —— 少者优先；
 *   ② 条数相同 ⇒ 取"最近一次派单更早"的那个（LRU）；③ 再相同 ⇒ 按组内声明顺序。
 *   只在"在线且角色匹配"的成员里挑；一个都没有 ⇒ **拒绝派单**并逐个给出原因（绝不静默改派别人）。
 */
const SLOT_GROUPS = { prod: ['B', 'F', 'I'] }
const AUTO_PICK_WINDOW_H = 6
const OUTBOX_RE = /^to-([A-Za-z0-9_]+)-/
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const INLINE_LIMIT = 8000
const ROSTER_MAX_AGE = 90 // 秒；花名册/状态每 5 tick（≈25 秒）落盘一次

// ────────────────────────────── 基础工具 ──────────────────────────────

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (typeof a === 'string' && a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || (typeof next === 'string' && next.startsWith('--'))) { out[key] = true; continue }
      out[key] = next
      i++
    } else {
      out._.push(a)
    }
  }
  return out
}

function readText(p) {
  try { return existsSync(p) ? readFileSync(p, 'utf8') : undefined } catch (e) { return undefined }
}
function readJson(p) {
  const t = readText(p)
  if (t === undefined) return undefined
  try { return JSON.parse(t) } catch (e) { return undefined }
}
function ageSec(p) {
  try { return (Date.now() - statSync(p).mtimeMs) / 1000 } catch (e) { return undefined }
}
function sha12(s) { return createHash('sha256').update(s).digest('hex').slice(0, 12) }
// 【2026-10-16】全 64 位指纹：派单消息里印全值，收件方**照抄**即可 ——
// 起因：消息里只印 12 位前缀时，收件方为了写「实测」指纹会把不知道的尾部凭空补全（当天两例实证）。
function shaFull(s) { return createHash('sha256').update(s).digest('hex') }
function listFiles(dir) {
  try {
    return readdirSync(dir).filter((n) => { try { return statSync(join(dir, n)).isFile() } catch (e) { return false } })
  } catch (e) { return [] }
}
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch (e) { /* 退化为不睡 */ }
}
function settle(code) { process.exitCode = code }
function line(s) { process.stdout.write(s + '\n') }

// ────────────────────────────── 载入协议目录 ──────────────────────────────

function loadProtocol(protocol) {
  const P = {
    dir: protocol,
    mapPath: join(protocol, 'session-map.json'),
    stateDir: join(protocol, 'state'),
    outboxDir: join(protocol, 'outbox'),
    sentDir: join(protocol, 'sent'),
    inboxDir: join(protocol, 'inbox'),
    failedDir: join(protocol, 'failed'),
    logPath: join(protocol, 'relay.log'),
    ledgerPath: join(protocol, 'dispatch-ledger.jsonl'),
  }
  P.exists = existsSync(protocol)
  P.map = readJson(P.mapPath)
  P.slots = (P.map && P.map.slots) || {}
  P.meta = (P.map && P.map.slots_meta) || {}
  P.relay = readJson(join(P.stateDir, 'relay-status.json'))
  P.relayAge = ageSec(join(P.stateDir, 'relay-status.json'))
  const roster = readJson(join(P.stateDir, 'sessions.json'))
  P.rosterAt = roster && roster.at
  P.rows = roster && Array.isArray(roster.rows) ? roster.rows : []
  P.rosterAge = ageSec(join(P.stateDir, 'sessions.json'))
  P.receipts = new Map()
  for (const f of listFiles(P.stateDir)) {
    if (!f.endsWith('.done')) continue
    P.receipts.set(f.slice(0, -'.done'.length), String(readText(join(P.stateDir, f)) || '').trim())
  }
  P.outbox = listFiles(P.outboxDir)
  P.sent = listFiles(P.sentDir)
  P.inbox = listFiles(P.inboxDir)
  P.failed = listFiles(P.failedDir)
  P.ledger = String(readText(P.ledgerPath) || '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => { try { return JSON.parse(l) } catch (e) { return undefined } })
    .filter(Boolean)
  return P
}

function rowOf(P, id) {
  for (const r of P.rows) { if (r && r.id === id) return r }
  return undefined
}

/** 硬体检：返回问题数组（空 = 可以派单）。check 与 send 共用，保证"体检不过就不发"。 */
function preflight(P) {
  const hard = []
  const warn = []
  if (!P.exists) { hard.push('协议目录不存在：' + P.dir); return { hard, warn } }
  if (P.map === undefined) hard.push('session-map.json 缺失或不是合法 JSON')
  if (P.relay === undefined) {
    hard.push('relay-status.json 缺失 ⇒ 转发插件可能没在跑')
  } else if (typeof P.relayAge === 'number' && P.relayAge > ROSTER_MAX_AGE) {
    hard.push('relay-status.json 已 ' + Math.round(P.relayAge) + ' 秒未更新（> ' + ROSTER_MAX_AGE + 's）⇒ 插件可能停了')
  } else if (typeof P.relayAge === 'number' && P.relayAge > 45) {
    warn.push('relay-status.json 已 ' + Math.round(P.relayAge) + ' 秒未更新，接近阈值')
  }
  if (P.relay && typeof P.relay.route === 'string' && !P.relay.route.startsWith('registered')) {
    warn.push('HTTP 自检端点未注册（route=' + P.relay.route + '）；不影响文件投递，但 /relay/state 会 404')
  }
  if (P.rows.length === 0) hard.push('sessions.json 缺失或为空 ⇒ 无法校验目标是否在线')
  else if (typeof P.rosterAge === 'number' && P.rosterAge > ROSTER_MAX_AGE) warn.push('花名册已 ' + Math.round(P.rosterAge) + ' 秒未更新')
  for (const s of Object.keys(SLOTS)) {
    if (s === 'T') continue
    if (typeof P.slots[s] !== 'string' || P.slots[s].length === 0) hard.push('槽位 ' + s + ' 未绑定会话 id')
  }
  return { hard, warn }
}

function slotView(P, s) {
  const id = P.slots[s]
  const row = typeof id === 'string' ? rowOf(P, id) : undefined
  const title = row && typeof row.title === 'string' ? row.title : null
  const live = row ? row.live === true : false
  const titleOk = title !== null && title.includes(SLOTS[s].titleKey)
  const pending = P.outbox.filter((f) => f.startsWith('to-' + s + '-'))
  return { slot: s, id: id === undefined ? null : id, title, live, titleOk, cwd: row ? row.cwd : null, pending }
}

/** 单个槽位的问题，分「硬」与「提醒」两类。check 全查，send 只查目标。
 *  硬：槽位没绑定 / 标题与角色不符（绑定错了，必须人工核）。
 *  提醒：会话不在花名册或离线 —— 宿主重启后窗口没打开属正常现象，只影响那一个槽位（派给它会被拒），
 *  不该把整份体检判死（2026-10-04 实测：重启后仅 2/7 会话在线，体检被误判成 FAIL）。 */
function slotProblems(P, s) {
  const hard = []
  const warn = []
  const v = slotView(P, s)
  if (v.id === null) return { hard, warn } // 未绑定由 preflight 统一报，避免重复
  if (v.title === null) warn.push('槽位 ' + s + ' 的会话不在花名册（离线；若目标正是它，send 会拒绝）')
  else if (v.live !== true) warn.push('槽位 ' + s + ' 离线：' + v.title + '（若目标正是它，send 会拒绝）')
  else if (v.titleOk !== true) hard.push('槽位 ' + s + ' 标题与预期角色不符：' + v.title + '（期望含「' + SLOTS[s].titleKey + '」）')
  return { hard, warn }
}

/**
 * 收据 key 的两级回落（口径与中继插件 lib/index.js:316 的判重**同源**，2026-10-08 定）：
 *   一级 `outbox-<fname>` = 插件当前的**真实写法**（index.js:325 `writeReceipt('outbox-' + fname, ...)`）；
 *   二级 `<fname>` = 历史收据 / 旧版插件兼容。
 *   **不认 `inbox-<fname>`** —— 那是反方向（inbox/ 里的文件）的凭据，认它等于把"没投出去"记成"已送达"。
 */
function receiptKeyOrder(fname) { return ['outbox-' + fname, fname] }

/** 在已载入的收据表里按两级回落找；返回 { key, text } —— key 是**真正命中的那个 key**（用于文案）——或 undefined。 */
function findReceipt(P, fname) {
  for (const k of receiptKeyOrder(fname)) {
    if (P.receipts.has(k)) return { key: k, text: P.receipts.get(k) }
  }
  return undefined
}

/** 把收据 key 归一化成 outbox 文件名的形态：剥掉 `outbox-` 前缀（插件真实形态），其余原样返回。 */
function normalizeReceiptKey(k) { return k.startsWith('outbox-') ? k.slice('outbox-'.length) : k }

/**
 * 已送达派单清单 = 台账 SENT 记录 ∪ state/ 里内容为 SENT 的 outbox 收据。
 * 为什么要并收据：send 等收据超时（退出码 4）之后插件仍可能投递成功 —— 那次投递脚本没在现场，
 * 台账里不会有 SENT，光看台账会把"已经送达"记成"没发出去"。
 *
 * 返回 `{ records, replyRecords }`：
 *   · records      = 真正的**派单**（等回函的对象）；
 *   · replyRecords = **回函登记**（`id` 以 `reply-` 开头）—— 那是**别人写回给 A 的回函原件**被投递时
 *     留下的收据（例 `sent/to-A-reply-crash-20261008-111424.md`）。它有 `to-<槽位>-<id>.md` 的形状，
 *     会被解析成一条"派单"，于是**回函本身被要求再回一次函**（2026-10-11 实测：22 条误报里 3 条属此类）。
 *     两处**都从"已送达"总数里保留**（它们确实投递过），只是**不进入"待回函"**，并且分开显示。
 */
function dispatchRecords(P) {
  const out = new Map()
  for (const r of P.ledger) {
    if (!r || r.result !== 'SENT' || typeof r.file !== 'string') continue
    out.set(r.file, { id: r.id, slot: r.slot, file: r.file, ts: r.ts || null, source: '台账' })
  }
  for (const [raw, v] of P.receipts) {
    // 归一化：插件把收据写成 `outbox-<fname>.done`（lib/index.js:325），这里先剥掉 `outbox-` 前缀，
    // 再按既有的 `to-<slot>-<id>.md` 规则解析 —— 否则真实形态的 SENT 收据**永远进不了这份清单**，
    // 与本函数开头「send 等收据超时后插件仍可能投递成功，光看台账会把已送达记成没发出去」的注释直接冲突
    // （2026-10-08 实测：7 张单台账 result:"TIMEOUT" 而实际已送达，兜底通道本该捡回却捡不回来）。
    // 归一化后**仍须**以 `to-` 开头、`.md` 结尾：挡掉 `inbox-*` 与其它形态，防"宽松过头"。
    const k = normalizeReceiptKey(raw)
    if (!k.startsWith('to-') || !k.endsWith('.md')) continue
    if (v.startsWith('SENT') === false) continue
    if (out.has(k)) continue
    const m = /^to-([A-Za-z0-9_]+)-(.+)\.md$/.exec(k)
    if (m === null) continue
    out.set(k, { id: m[2], slot: m[1], file: k, ts: null, source: '收据推导' })
  }
  const all = [...out.values()]
  return { records: all.filter((r) => isReplyRecord(r) === false), replyRecords: all.filter(isReplyRecord) }
}

/**
 * 回函是否已到（判「待回函」的唯一判据）。两级证据都要查：
 *   ① 收据：`state/` 里**该号对应的回函收据**。归一化掉 `outbox-` 前缀后，接受两种写法：
 *      `reply-<id>[.md|-后缀]` 与 `inbox-reply-<id>[.md|-后缀]`（`.md` 后缀两种都要认，
 *      因为收据名带不带后缀是历史写法差异）。旧代码硬要求 `k.startsWith('inbox-')`，于是两处漏判：
 *        · `state/outbox-reply-<id>.md.done`（同一回函文件被中继按 outbox 形态记收据）**永远不被采信**；
 *        · 收据缺失但回函文件已在盘时，也只报"待回函"。
 *   ② 文件：`sent/reply-<id>*` 或 `inbox/reply-<id>*` 在盘即算已回函（收据可能因中继重启/写失败而缺）。
 *
 * ⛔ 这里**不能**退化成"任何含该号的收据都算回函"：投递收据 `to-<槽位>-<id>.md` / `outbox-to-…` 是
 *    **"发出去了"**的凭据，把它当成"回来了"会把 549 条已送达**全部**误判成已回函、待回函直接归零
 *    （2026-10-11 本件实现时就踩了这一脚，被"真协议目录 待回函 0 条"当场抓到）。
 *    这与 `dispatchRecords()` 的**投递判真**（必须认 `outbox-`，认 `inbox-` 会把"没投出去"记成"已送达"）
 *    是**两件事**，别把两处口径混成一条。
 * 只查"这个号有没有回来"，**不**用文件名规则反推派单号是否合法。
 */
function replyFor(P, id) {
  const marker = 'reply-' + id
  for (const [raw, v] of P.receipts) {
    const k = normalizeReceiptKey(raw)
    const body = k.startsWith('inbox-' + marker) ? k.slice('inbox-'.length) : k
    if (body === marker || body.startsWith(marker + '.') || body.startsWith(marker + '-')) return { key: k, text: v }
  }
  const prefix = 'reply-' + id
  const hit = (P.sent || []).find((f) => f.startsWith(prefix)) || (P.inbox || []).find((f) => f.startsWith(prefix))
  if (hit !== undefined) return { key: hit, text: '(按回函文件判定：sent/ 或 inbox/ 在盘，收据缺失)', file: true }
  return undefined
}

/** 回函登记（≠ 派单）：`id` 以 `reply-` 开头 —— 那是**回函原件**被投递留下的记录，不是等回函的派单。 */
function isReplyRecord(rec) { return typeof rec.id === 'string' && rec.id.startsWith('reply-') }

/** 台账 `ts` 的形态是 `nowLocal()` 写的 `YYYY-MM-DD HH:mm:ss`（本地时区）⇒ 归一成可 Date.parse 的串。 */
function tsOfLocal(s) {
  if (typeof s !== 'string' || s.length === 0) return null
  const t = Date.parse(s.replace(' ', 'T'))
  return Number.isNaN(t) ? null : t
}

/**
 * 【`--to <组名>` 的挑槽算法】见 `SLOT_GROUPS` 上方注释（2026-10-16 用户指示）。
 * 返回 `{ chosen, note, rows, usable }`：
 *   · `rows`   每个成员一行，带 `inFlight`（窗口内未回函数）、`last`（最近派单时刻）、`ok`（在线且角色匹配）；
 *   · `note`   一句给人看的理由（**必须写进派单计划里**，事后能复算"为什么挑了它"）；
 *   · `usable` 是否有可用成员；全不可用时由调用方拒绝（并把 rows 的原因列出来）。
 */
function pickSlotForGroup(P, group) {
  const members = SLOT_GROUPS[group] || []
  const recs = dispatchRecords(P).records
  const cutoff = Date.now() - AUTO_PICK_WINDOW_H * 3600 * 1000
  const rows = members.map((s) => {
    const mine = recs.filter((r) => r.slot === s)
    const noReply = mine.filter((r) => replyFor(P, r.id) === undefined)
    // 台账里 `ts` 可能为 null（由收据推导出来的记录）⇒ 不当成"最近"，避免把历史件算成在跑
    const inFlight = noReply.filter((r) => { const t = tsOfLocal(r.ts); return t !== null && t >= cutoff }).length
    const stamps = mine.map((r) => tsOfLocal(r.ts)).filter((t) => t !== null)
    const last = stamps.length === 0 ? null : Math.max(...stamps)
    const v = slotView(P, s)
    const ok = v.id !== null && v.live === true && v.titleOk === true
    /** 最近一次派单的人类可读形态（理由行里要看得见"为什么是它"，光给两个 0 说不清）。 */
    const lastTxt = last === null ? '从未派单' : (() => {
      const d = new Date(last)
      const p = (n) => String(n).padStart(2, '0')
      return '最近派单 ' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    })()
    return { slot: s, title: v.title, ok, inFlight, pendingAll: noReply.length, last, lastTxt }
  })
  const usable = rows.filter((r) => r.ok === true)
  const pool = usable.length > 0 ? usable : rows
  const sorted = [...pool].sort((a, b) => {
    if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight
    const la = a.last === null ? -1 : a.last
    const lb = b.last === null ? -1 : b.last
    if (la !== lb) return la - lb
    return members.indexOf(a.slot) - members.indexOf(b.slot)
  })
  const chosen = sorted[0]
  const detail = rows.map((r) => r.slot + '（窗口内未回函 ' + r.inFlight + '，' + r.lastTxt + (r.ok ? '' : '，不可派') + '）').join(' / ')
  const note = '组 ' + group + ' = ' + members.join('、') + '；挑生产槽位规则 = 窗口 ' + AUTO_PICK_WINDOW_H +
    ' 小时内未回函少者优先、相同取更早派单 ⇒ 选 ' + chosen.slot + '（' + detail + '）'
  return { chosen, note, rows, usable: usable.length > 0 }
}

function dispatchState(P, rec) {
  const reply = replyFor(P, rec.id)
  if (reply !== undefined) return { state: '已回函', reply }
  const file = rec.file
  if (file !== undefined && P.outbox.includes(file)) return { state: '待投递（还在 outbox）' }
  return { state: '待回函', reply: undefined }
}

function appendLedger(P, rec) {
  try {
    appendFileSync(P.ledgerPath, JSON.stringify(rec) + '\n')
  } catch (e) {
    line('⚠️ 台账写入失败（不影响本次派单）：' + String(e && e.message))
  }
}

function nowLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

// ────────────────────────────── check ──────────────────────────────

function runCheck(opt) {
  const protocol = opt.protocol ? resolve(String(opt.protocol)) : DEFAULT_PROTOCOL
  const P = loadProtocol(protocol)
  const pre = preflight(P)
  const hard = [...pre.hard]
  const warn = [...pre.warn]
  for (const s of Object.keys(SLOTS)) {
    if (s === 'T') continue
    const sp = slotProblems(P, s)
    hard.push(...sp.hard)
    warn.push(...sp.warn)
  }
  const orphans = P.outbox.filter((f) => OUTBOX_RE.exec(f) === null)
  const failReceipts = [...P.receipts.entries()].filter(([, v]) => v.startsWith('FAIL'))
  const records = dispatchRecords(P)
  const dispatchRecs = records.records
  const replyRecords = records.replyRecords
  const replyView = new Map(dispatchRecs.map((r) => [r.id, replyFor(P, r.id)]))
  const awaiting = dispatchRecs.filter((r) => replyView.get(r.id) === undefined)
  /**
   * 【2026-10-16】每个槽位"在跑"的条数 = `AUTO_PICK_WINDOW_H` 小时内**发出且未回函**的派单。
   * 为什么不直接数"全部未回函"：本仓台账里有几十条远古未回函件（历史遗留），数全量会让**每个**槽位看着都满，
   * 于是"挑空闲的那个"永远挑不出来。窗口口径与 `pickSlotForGroup()` 完全同源（同一常量），别各写一份。
   */
  const inflightCut = Date.now() - AUTO_PICK_WINDOW_H * 3600 * 1000
  const inFlightBySlot = new Map()
  for (const r of awaiting) {
    const t = tsOfLocal(r.ts)
    if (t !== null && t >= inflightCut) inFlightBySlot.set(r.slot, (inFlightBySlot.get(r.slot) || 0) + 1)
  }

  if (opt.json === true) {
    const payload = {
      protocol, pass: hard.length === 0, hard, warn,
      plugin: P.relay ? P.relay.plugin : null,
      ticks: P.relay ? P.relay.ticks : null,
      route: P.relay ? P.relay.route : null,
      relayAgeSec: P.relayAge === undefined ? null : Math.round(P.relayAge),
      rosterAgeSec: P.rosterAge === undefined ? null : Math.round(P.rosterAge),
      slots: Object.keys(SLOTS).map((s) => ({ ...slotView(P, s), inFlight: inFlightBySlot.get(s) || 0 })),
      slotGroups: SLOT_GROUPS,
      inFlightWindowH: AUTO_PICK_WINDOW_H,
      dispatchable: Object.keys(SLOTS).filter((s) => {
        if (s === 'T') return false
        const v = slotView(P, s)
        return v.id !== null && v.live === true && v.titleOk === true
      }),
      orphans, failReceipts: failReceipts.map(([k, v]) => ({ key: k, text: v })),
      awaitingReply: awaiting.map((r) => ({ id: r.id, slot: r.slot, ts: r.ts, source: r.source })),
      replyRegistrations: replyRecords.map((r) => ({ id: r.id, slot: r.slot, ts: r.ts, source: r.source })),
      delivered: dispatchRecs.length + replyRecords.length,
      deliveredDispatch: dispatchRecs.length,
      pending: P.outbox,
    }
    line(JSON.stringify(payload, null, 1))
    settle(hard.length === 0 ? 0 : 2)
    return
  }

  line('== 派单前体检 ==')
  line('协议目录: ' + protocol)
  if (P.relay) {
    line('插件: ' + P.relay.plugin + '  ticks=' + P.relay.ticks + '  route=' + P.relay.route +
      '  状态文件 ' + (P.relayAge === undefined ? '?' : Math.round(P.relayAge)) + ' 秒前更新')
  }
  line('花名册: ' + P.rows.length + ' 个会话 / 在线 ' + P.rows.filter((r) => r && r.live === true).length +
    '   ' + (P.rosterAge === undefined ? '?' : Math.round(P.rosterAge)) + ' 秒前更新' + (P.rosterAt ? '（' + P.rosterAt + '）' : ''))
  line('')
  for (const s of Object.keys(SLOTS)) {
    const v = slotView(P, s)
    if (s === 'T') {
      line('[ T ] ' + (v.title || '（不在线）') + '  诊断位 —— 只允许 --kind selftest')
      continue
    }
    line('[ ' + s + ' ] ' + (v.title || '（不在线）') +
      '  在线=' + (v.live ? '✅' : '❌') +
      '  角色匹配=' + (v.titleOk ? '✅' : '❌') +
      '  待投递=' + v.pending.length +
      '  在跑=' + (inFlightBySlot.get(s) || 0) +
      '  id=' + (v.id || '—'))
  }
  if (Object.keys(SLOT_GROUPS).length > 0) {
    line('角色组: ' + Object.keys(SLOT_GROUPS).map((g) => g + ' = ' + SLOT_GROUPS[g].join('、')).join('    ') +
      '（可写 `--to <组名>` 自动挑：' + AUTO_PICK_WINDOW_H + ' 小时内未回函少者优先）')
  }
  line('')
  const okSlots = Object.keys(SLOTS).filter((s) => {
    if (s === 'T') return false
    const v = slotView(P, s)
    return v.id !== null && v.live === true && v.titleOk === true
  })
  const offSlots = Object.keys(SLOTS).filter((s) => s !== 'T' && okSlots.includes(s) === false)
  line('可派单槽位: ' + (okSlots.length > 0 ? okSlots.join('、') + '（在线且角色匹配）' : '无') +
    (offSlots.length > 0 ? '    离线/不可派: ' + offSlots.join('、') + '（窗口没打开；派给它会被拒）' : ''))
  const mine = dispatchRecs
  line('派单台账: 已送达 ' + mine.length + ' 条 / 其中待回函 ' + awaiting.length + ' 条' +
    (replyRecords.length > 0 ? '（另有 ' + replyRecords.length + ' 条为「回函登记」，不计入待回函）' : '') +
    '   （台账 + state/ 收据合并口径）')
  if (awaiting.length > 0) {
    for (const r of awaiting) line('  · 待回函 ' + r.id + ' → ' + r.slot + '（' + (r.ts || r.source) + '）')
  }
  if (replyRecords.length > 0) {
    for (const r of replyRecords) line('  · 回函登记 ' + r.id + ' → ' + r.slot + '（' + (r.ts || r.source) + '；本身是回函，不等回函）')
  }
  if (P.outbox.length > 0) line('outbox 待投递: ' + P.outbox.join(', '))
  if (orphans.length > 0) line('⚠️ 孤儿文件（命名不合规范 ⇒ 永远不会被投递）: ' + orphans.join(', '))
  if (failReceipts.length > 0) {
    line('⚠️ 历史 FAIL 收据 ' + failReceipts.length + ' 条（同名会永久挡住重发）: ' +
      failReceipts.map(([k]) => k).join(', '))
  }
  for (const w of warn) line('⚠️ ' + w)
  for (const h of hard) line('❌ ' + h)
  line('')
  line(hard.length === 0 ? '体检结论: PASS（可以派单）' : '体检结论: FAIL（硬问题 ' + hard.length + ' 条 ⇒ 先解决，别派单）')
  settle(hard.length === 0 ? 0 : 2)
}

// ────────────────────────────── send ──────────────────────────────

function composer(P, cfg) {
  const head = [
    '【派单 ' + cfg.id + '】A（调度点） → ' + cfg.slot + ' ' + (cfg.targetTitle || SLOTS[cfg.slot].title) +
      (cfg.slotGroup ? '（组 ' + cfg.slotGroup + ' 自动选）' : ''),
    '类型: ' + cfg.kind,
    '规格文件: ' + cfg.specPath + '（sha256 全值:' + (cfg.specShaFull || cfg.specSha) + '，' + cfg.specBytes + ' 字节）',
    '指纹写法: **照抄上面那串全值**；台账/声明里只记前 12 位 ' + cfg.specSha + ' —— 不要自己补全哈希尾部',
    '回函: 把回函写进 ' + join(P.dir, 'inbox', 'reply-' + cfg.id + '.md') + '（文件名必须含派单号 ' + cfg.id + '）',
    '派单时间: ' + nowLocal(),
    '',
  ]
  const tail = ['', '──── 正文结束 ────']
  let body
  if (cfg.inline === 'pointer') {
    body = ['（正文较长，未内联。请先读规格文件，再按其中的判据与边界执行。）']
  } else if (cfg.inline === 'summary') {
    const lines = cfg.specText.split(/\r?\n/)
    body = lines.slice(0, 60)
    if (lines.length > 60) body.push('……（后续 ' + (lines.length - 60) + ' 行省略，务必打开规格文件全文）')
  } else {
    body = [cfg.specText]
  }
  return head.concat(['──── 规格正文（' + cfg.inline + '）────'], body, tail).join('\n')
}

function refuse(P, cfg, reason, remedy) {
  line('❌ 拒绝派单：' + reason)
  if (remedy) line('   怎么办：' + remedy)
  line('   （没有写任何文件到 outbox/ —— 可以放心修正后重来）')
  if (P && P.exists) {
    appendLedger(P, {
      ts: new Date().toISOString(), id: cfg.id || null, slot: cfg.slot || null, kind: cfg.kind || null,
      file: cfg.file || null, spec: cfg.specPath || null, result: 'REFUSED', detail: reason,
    })
  }
  settle(2)
}

function runSend(opt) {
  const protocol = opt.protocol ? resolve(String(opt.protocol)) : DEFAULT_PROTOCOL
  const P = loadProtocol(protocol)
  const cfg = {
    slot: typeof opt.to === 'string' ? opt.to.toUpperCase() : undefined,
    kind: typeof opt.kind === 'string' ? opt.kind.toLowerCase() : undefined,
    id: typeof opt.id === 'string' ? opt.id : undefined,
    file: typeof opt.file === 'string' ? opt.file : undefined,
    specPath: null, specText: null, specSha: null, specShaFull: null, specBytes: null, inline: null,
    message: null, targetTitle: null, confirm: opt.confirm === true,
    slotGroup: null, pickNote: null,
  }

  if (P.exists === false) { refuse(P, cfg, '协议目录不存在：' + P.dir, '确认路径，或用 --protocol <目录> 指定'); return }
  const { hard } = preflight(P)
  if (hard.length > 0) { refuse(P, cfg, '体检未通过 —— ' + hard.join('；'), '先跑 `relay-dispatch.mjs check` 看清问题'); return }
  if (cfg.slot === undefined) { refuse(P, cfg, '缺 --to <槽位>', '槽位取 ' + Object.keys(SLOTS).join('/') + '，或角色组 ' + Object.keys(SLOT_GROUPS).join('/')); return }
  // 【2026-10-16】角色组别名：`--to prod` ⇒ 在生产槽位之间按 `pickSlotForGroup()` 自动挑一个。
  // 为什么放在这一层：解析成**具体槽位**之后，下面所有校验（类型匹配 / 未绑定 / 离线 / 标题 / 重名）原样生效，
  // 不给"走组名就绕开门禁"留后门。挑的结果与理由都要打印出来（事后可复算）。
  // 组名一律小写比较（`--to` 的值在这一行会被大写化 ⇒ 组名要用小写键去找）
  const groupName = cfg.slot === undefined ? null : String(cfg.slot).toLowerCase()
  if (groupName !== null && SLOT_GROUPS[groupName] !== undefined) {
    const pick = pickSlotForGroup(P, groupName)
    if (pick.usable === false) {
      refuse(P, cfg, '组 ' + groupName + ' 里没有可派单的槽位：' +
        pick.rows.map((r) => r.slot + '（' + (r.title || '不在花名册') + '）').join('；'),
      '把对应窗口打开 → 重跑 check 确认在线与标题 → 用同一个派单号再发（本次没写盘，无副作用）')
      return
    }
    cfg.slotGroup = groupName
    cfg.pickNote = pick.note
    cfg.slot = pick.chosen.slot
  }
  if (SLOTS[cfg.slot] === undefined) { refuse(P, cfg, '未知槽位 ' + cfg.slot, '槽位取 ' + Object.keys(SLOTS).join('/') + '，或角色组 ' + Object.keys(SLOT_GROUPS).join('/')); return }
  if (cfg.kind === undefined) { refuse(P, cfg, '缺 --kind <任务类型>', '取 ' + KINDS.join('/')); return }
  if (KINDS.includes(cfg.kind) === false) { refuse(P, cfg, '未知 --kind ' + cfg.kind, '取 ' + KINDS.join('/')); return }
  if (cfg.id === undefined) { refuse(P, cfg, '缺 --id <派单号>', '格式 <需求号>-<短名>-r<轮次>，例 REQ01-dev-r1'); return }
  if (ID_RE.test(cfg.id) === false || cfg.id.length > 60) {
    refuse(P, cfg, '派单号不合法：' + cfg.id, '只允许字母数字与 . _ -，且以字母数字开头，≤60 字符')
    return
  }
  if ((cfg.file === undefined) === (typeof opt.text !== 'string')) {
    refuse(P, cfg, '正文来源要二选一：--file <路径> 或 --text "<正文>"', '长任务用 --file，一句话派单用 --text')
    return
  }

  // ── 【N52 · 2026-10-04 实测事故后加的护栏】───────────────────────────────
  // 事故：`send --text "<长正文且含双引号>" --confirm --wait 45`
  //   PowerShell 未转义正文里的内层引号 ⇒ 引号"永远不闭合" ⇒ 后面的 `--confirm --wait 45`
  //   被整段吞进 `--text` 的值里 ⇒ 脚本看不到 --confirm ⇒ **静默走干跑**（只打印一行"干跑结束"）。
  //   当时的实际后果：差一点把"没发出去"当成"已发出"。
  // 处置：① 正文里出现 `--confirm` / `--wait` 且本次**没有** --confirm ⇒ 硬拦并给改法；
  //       ② 正文含双引号或偏长 ⇒ 只出声提醒（不拦，避免误伤正常内容）。
  if (typeof opt.text === 'string') {
    const leaked = opt.text.match(/--(?:confirm|wait)\b/g)
    if (leaked && opt.confirm !== true) {
      refuse(P, cfg, '正文里出现了命令行开关：' + Array.from(new Set(leaked)).join(' '),
        '典型症状 = shell 引号把 flag 吞进正文（**本次会静默干跑、什么都不会发**）。改法：把正文写成文件，用 --file <路径> 发送；或把 --confirm 放在最前面')
      return
    }
    if (leaked) {
      line('⚠️  提醒：正文里出现了开关字样（' + Array.from(new Set(leaked)).join(' ') + '）—— 若你并不是有意写进正文，请核对 --confirm 是否真的生效')
    }
    if (opt.text.includes('"')) {
      line('⚠️  提醒：--text 正文含双引号 —— PowerShell 可能吞掉内层引号并把后续开关并入正文；**长正文请改用 --file <路径>**（本次 ' + opt.text.length + ' 字符）')
    } else if (opt.text.length > 1500) {
      line('⚠️  提醒：--text 正文较长（' + opt.text.length + ' 字符）—— 建议改用 --file <路径>（可避免引号/换行被 shell 改写）')
    }
  }

  // 角色 / 类型硬匹配 —— 防止"开发需求误发给发布会话"这类最高危错误
  if (cfg.slot === 'T' && opt.selftest !== true) {
    refuse(P, cfg, 'T 是诊断位，只允许通道自检', '真派单请用 A/B/C/D；确实要自检就加 --selftest 且 --kind selftest')
    return
  }
  if (SLOTS[cfg.slot].kinds.includes(cfg.kind) === false) {
    refuse(P, cfg, '角色与类型不匹配：槽位 ' + cfg.slot + '（' + SLOTS[cfg.slot].note + '）不接受 --kind ' + cfg.kind,
      '该槽位只接受 ' + SLOTS[cfg.slot].kinds.join(' / ') + '；换槽位或换类型')
    return
  }

  const target = slotView(P, cfg.slot)
  cfg.targetTitle = target.title
  if (target.id === null) { refuse(P, cfg, '槽位 ' + cfg.slot + ' 未绑定会话 id', '把会话 id 填进 session-map.json 的 slots.' + cfg.slot); return }
  if (target.live !== true) {
    refuse(P, cfg, '目标会话不在线（' + (target.title || cfg.slot) + '）',
      '把那个会话打开 → 重跑 check 确认在线 → 用同一个派单号再发（本次没写盘，无副作用）')
    return
  }
  if (target.titleOk !== true && opt['force-title'] !== true) {
    refuse(P, cfg, '槽位标题与预期角色不符：期望含「' + SLOTS[cfg.slot].titleKey + '」，实际「' + String(target.title) + '」',
      '先核对 session-map.json 的槽位绑定；确有把握再加 --force-title（并在派单说明里写明理由）')
    return
  }

  const fname = 'to-' + cfg.slot + '-' + cfg.id + '.md'
  const m = OUTBOX_RE.exec(fname)
  if (m === null || m[1] !== cfg.slot) { refuse(P, cfg, '内部命名自检失败：' + fname, '这是脚本 bug，请报告'); return }

  // 去重：同名收据（含 FAIL）会永久挡住重发 ⇒ 必须换号。
  // 收据 key 两级回落，口径与中继 lib/index.js:316 的判重**同源**（2026-10-08 修）：
  //   · 新式 `outbox-<fname>.done` 优先 —— 这是插件当前的**真实写法**（index.js:325
  //     `writeReceipt('outbox-' + fname, ...)`），旧代码只看裸名 ⇒ 这条去重**永不命中**；
  //   · 其次旧式裸键 `<fname>.done`（兼容历史收据 / 旧版插件）；
  //   · **不查 `inbox-<fname>.done`** —— 那是 inbox 文件的收据，拿它挡 outbox 件等于
  //     "inbox/ 与 outbox/ 同名时先投的一方静默吞掉后投的一方"（插件注释 index.js:310-315 同款理由）。
  // 文案带出**真实命中的那个 key**，避免只报裸名让人以为收据叫别的名字。
  const receiptKey = ['outbox-' + fname, fname].find((k) => P.receipts.has(k))
  if (receiptKey !== undefined) {
    const t = P.receipts.get(receiptKey)
    refuse(P, cfg, '同名收据已存在：state/' + receiptKey + '.done ⇒ ' + t, '换派单号（例 ' + cfg.id + '-r2）；动手前先看回函，别重复派同一件事')
    return
  }
  for (const d of [[P.outbox, 'outbox'], [P.sent, 'sent'], [P.failed, 'failed']]) {
    if (d[0].includes(fname)) { refuse(P, cfg, '同名原件已存在于 ' + d[1] + '/：' + fname, '换派单号（例 ' + cfg.id + '-r2）'); return }
  }
  const dup = P.ledger.find((r) => r && r.id === cfg.id && r.slot === cfg.slot && r.result === 'SENT')
  if (dup !== undefined) { refuse(P, cfg, '台账里已有同号已送达记录：' + cfg.id + ' → ' + cfg.slot + '（' + dup.ts + '）', '换派单号；或在台账里核对该单的回函状态'); return }

  // 正文
  if (cfg.file !== undefined) {
    const p = resolve(cfg.file)
    if (existsSync(p) === false) { refuse(P, cfg, '规格文件不存在：' + p, '检查路径（相对路径按当前工作目录解析）'); return }
    const t = String(readText(p) || '')
    if (t.trim().length === 0) { refuse(P, cfg, '规格文件是空的：' + p, '把「任务号/要做什么/判据/边界/回函要求」写进去'); return }
    cfg.specPath = p
    cfg.specText = t
    if (opt['no-template-check'] !== true) {
      const missing = []
      if (/判据/.test(t) === false) missing.push('判据')
      if (/边界/.test(t) === false) missing.push('边界')
      // 【AGENTS.md §十六】开发类派单默认带 Ponytail full 约束（2026-10-21 用户指令）：
      // 规格缺此行 ⇒ 拒绝；确实不适用时加 --no-template-check 并在派单说明里写裁剪理由。
      if ((cfg.kind === 'dev' || cfg.kind === 'ops') && /Ponytail\s*full/i.test(t) === false) {
        missing.push('开发模式：Ponytail full')
      }
      if (missing.length > 0) {
        refuse(P, cfg, '规格文件缺关键小节：' + missing.join(' / ') + '（' + p + '）',
          '补上再发；确实不需要就加 --no-template-check（并在派单说明里写明理由）。模板见 templates/dispatch-spec-template.md；Ponytail full 默认约束见 AGENTS.md §十六')
        return
      }
    }
  } else {
    cfg.specPath = '(内联正文)'
    cfg.specText = String(opt.text)
  }
  cfg.specSha = sha12(cfg.specText)
  cfg.specShaFull = shaFull(cfg.specText)
  cfg.specBytes = Buffer.byteLength(cfg.specText, 'utf8')

  const want = typeof opt.inline === 'string' ? opt.inline : (cfg.specBytes <= INLINE_LIMIT ? 'full' : 'summary')
  if (['full', 'summary', 'pointer'].includes(want) === false) { refuse(P, cfg, '--inline 只支持 full/summary/pointer', '去掉该参数用默认值'); return }
  cfg.inline = want
  cfg.file = fname
  cfg.message = composer(P, cfg)

  const plan = [
    '== 派单计划 ==',
    '派单号 : ' + cfg.id,
    '目标   : ' + cfg.slot + ' 「' + String(cfg.targetTitle) + '」',
    ...(cfg.slotGroup ? ['目标组 : ' + cfg.pickNote] : []),
    '会话 id: ' + target.id,
    '类型   : ' + cfg.kind + '（该槽位允许：' + SLOTS[cfg.slot].kinds.join('/') + '）',
    '文件名 : outbox/' + fname,
    '正文   : ' + cfg.inline + '（规格 ' + cfg.specBytes + ' 字节 → 消息 ' + Buffer.byteLength(cfg.message, 'utf8') + ' 字节）',
    '',
    '──── 将投递的消息（原样）────',
    cfg.message,
    '──── 消息结束 ────',
    '',
  ]

  if (cfg.confirm !== true) {
    line(plan.join('\n'))
    line('🟡 干跑结束：没有写任何文件。确认上面「目标 = ' + String(cfg.targetTitle) + '」就是你想要的那个会话后，原样加 --confirm 再跑一次。')
    settle(0)
    return
  }

  // 原子落盘：先写协议目录下的临时文件，再 rename 进 outbox（同一卷，避免半截文件被插件读到）
  const tmp = join(P.dir, '.staging-' + fname + '.' + process.pid)
  const dest = join(P.outboxDir, fname)
  try {
    writeFileSync(tmp, cfg.message, 'utf8')
    renameSync(tmp, dest)
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch (e2) { /* 忽略 */ }
    line('❌ 写入 outbox 失败：' + String(e && e.message))
    settle(2)
    return
  }
  line(plan.join('\n'))
  line('📮 已写入 outbox/' + fname + '（' + nowLocal() + '）—— 现在开始等收据（插件每 5 秒扫一次）')

  const waitSec = opt.wait === undefined ? 30 : Math.max(0, Number(opt.wait))
  let waited = 0
  let receipt
  let receiptHitKey // 等收据循环里**真正命中的那个 key**（文案必须照它写，别写死裸名 —— 见下方 ✅/❌ 两行）
  while (true) {
    // 收据 key 两级回落，口径与中继 lib/index.js:316 的判重**同源**（2026-10-08 修）：
    //   · 插件当前的真实写法是 `state/outbox-<fname>.done`（index.js:325）⇒ 必须**先找它**；
    //     旧代码只找裸键 `state/<fname>.done`，于是投递其实成功、这里却等满 --wait 报 TIMEOUT（退出码 4）
    //     并把 result:"TIMEOUT" 写进台账（实测例 H-R01-secfix-r1-note1：outbox 13:34:58 → 收据 13:35:02，+4 秒）。
    //   · 裸键作为第二级回落，兼容历史收据 / 旧版插件。
    //   · **不查 `inbox-<fname>.done`**：那是 inbox 文件的收据，认它等于把"没投出去"记成"已送达"。
    // readText 对不存在的文件返回 undefined ⇒ 这里只认 undefined 之外的返回值，
    // **绝不把"找不到"变成"默认成功"**（找不到仍走下面的 TIMEOUT 分支）。
    for (const k of receiptKeyOrder(fname)) {
      const t = readText(join(P.stateDir, k + '.done'))
      if (t !== undefined) { receipt = t; receiptHitKey = k; break }
    }
    if (receipt !== undefined) break
    if (waited >= waitSec * 1000) break
    sleepSync(2000)
    waited += 2000
  }

  const secs = (waited / 1000).toFixed(0)
  if (receipt === undefined) {
    line('⏳ 等了 ' + secs + ' 秒还没拿到收据：文件仍在 outbox/，插件下一 tick 可能就投出。')
    line('   现在要做的是：等 10 秒后跑 `relay-dispatch.mjs status` 复看。')
    line('   ⛔ 绝对不要重复写同名文件（同名会被静默跳过，还会让你误判）；也不要手改文件名。')
    appendLedger(P, { ts: new Date().toISOString(), id: cfg.id, slot: cfg.slot, kind: cfg.kind, file: fname, spec: cfg.specPath, specSha: cfg.specSha, bytes: cfg.specBytes, result: 'TIMEOUT', detail: 'no receipt in ' + secs + 's' })
    settle(4)
    return
  }

  const text = String(receipt).trim()
  const parked = existsSync(join(P.sentDir, fname))
  if (text.startsWith('SENT')) {
    line('✅ 已送达：收据 state/' + receiptHitKey + '.done = "' + text + '"' + (parked ? '，原件已挪进 sent/' : '（注意：原件不在 sent/，稍后复查）'))
    line('   下一步：把这条派单记进待办台账的「待回函」；对方回函会落到 inbox/reply-' + cfg.id + '.md 并唤醒 A。')
    appendLedger(P, { ts: new Date().toISOString(), id: cfg.id, slot: cfg.slot, kind: cfg.kind, file: fname, spec: cfg.specPath, specSha: cfg.specSha, bytes: cfg.specBytes, result: 'SENT', detail: text, waitedSec: Number(secs) })
    settle(0)
    return
  }
  line('❌ 投递失败：收据 state/' + receiptHitKey + '.done = "' + text + '"' + (existsSync(join(P.failedDir, fname)) ? '，原件已进 failed/' : ''))
  line('   怎么办：按收据里的原因修（离线/无 followup 接口/槽位没绑定），修好后**换派单号**（' + cfg.id + '-r2）重派。')
  appendLedger(P, { ts: new Date().toISOString(), id: cfg.id, slot: cfg.slot, kind: cfg.kind, file: fname, spec: cfg.specPath, specSha: cfg.specSha, bytes: cfg.specBytes, result: 'FAIL', detail: text })
  settle(3)
}

// ────────────────────────────── status ──────────────────────────────

function runStatus(opt) {
  const protocol = opt.protocol ? resolve(String(opt.protocol)) : DEFAULT_PROTOCOL
  const P = loadProtocol(protocol)
  const orphans = P.outbox.filter((f) => OUTBOX_RE.exec(f) === null)
  // 待投递判定与 send 的等收据口径**同源**（两级 key 回落）：只要 `outbox-<fname>` 或 `<fname>` 任一有收据，
  // 就算已经投出，不得再报成「待投递」（旧代码只查裸名 ⇒ 插件真实形态 `state/outbox-<fname>.done` 认不出来，
  // 把已投出的件误报成"还在等投递"）。**不认 `inbox-<fname>`**。
  const pending = P.outbox.filter((f) => findReceipt(P, f) === undefined && OUTBOX_RE.exec(f) !== null)
  const sentRecs = dispatchRecords(P)
  const awaiting = sentRecs.records.filter((r) => replyFor(P, r.id) === undefined)
  const replied = sentRecs.records.filter((r) => replyFor(P, r.id) !== undefined)
  const replyRegs = sentRecs.replyRecords
  const failReceipts = [...P.receipts.entries()].filter(([, v]) => v.startsWith('FAIL'))
  const recent = listFiles(P.stateDir)
    .filter((f) => f.endsWith('.done'))
    .map((f) => ({ key: f.slice(0, -'.done'.length), text: String(readText(join(P.stateDir, f)) || '').trim(), age: ageSec(join(P.stateDir, f)) }))
    .sort((a, b) => (a.age || 0) - (b.age || 0))
    .slice(0, 10)

  if (opt.json === true) {
    line(JSON.stringify({
      protocol,
      awaitingReply: awaiting.map((r) => ({ id: r.id, slot: r.slot, ts: r.ts, source: r.source })),
      replied: replied.map((r) => ({ id: r.id, slot: r.slot, receipt: replyFor(P, r.id).key })),
      replyRegistrations: replyRegs.map((r) => ({ id: r.id, slot: r.slot, ts: r.ts, source: r.source })),
      pendingInOutbox: pending,
      orphans,
      failed: P.failed,
      failReceipts: failReceipts.map(([k, v]) => ({ key: k, text: v })),
      recentReceipts: recent,
      slots: Object.keys(SLOTS).map((s) => slotView(P, s)),
    }, null, 1))
    settle(0)
    return
  }

  line('== 派单台账 ==')
  line('协议目录: ' + protocol + '   插件: ' + (P.relay ? P.relay.plugin + ' ticks=' + P.relay.ticks : '（状态文件缺失）'))
  line('')
  for (const s of Object.keys(SLOTS)) {
    const v = slotView(P, s)
    line('[ ' + s + ' ] ' + (v.title || '（不在线）') + '  在线=' + (v.live ? '✅' : '❌') + '  角色匹配=' + (v.titleOk ? '✅' : '❌'))
  }
  line('')
  line('待回函 ' + awaiting.length + ' 条：')
  for (const r of awaiting) line('  · ' + r.id + ' → ' + r.slot + '  派单于 ' + (r.ts || '（' + r.source + '）') + '  文件 ' + (r.file || '?'))
  if (awaiting.length === 0) line('  （无）')
  line('已回函 ' + replied.length + ' 条：')
  for (const r of replied) line('  · ' + r.id + ' ← 收据 ' + replyFor(P, r.id).key)
  if (replied.length === 0) line('  （无）')
  if (replyRegs.length > 0) {
    line('回函登记 ' + replyRegs.length + ' 条（本身的 id 以 reply- 开头 = 已投递给 A 的回函，不计入待回函）：')
    for (const r of replyRegs) line('  · ' + r.id + ' → ' + r.slot + '  投递于 ' + (r.ts || '（' + r.source + '）') + '  文件 ' + (r.file || '?'))
  }
  line('')
  line('outbox 待投递 ' + pending.length + ' 个: ' + (pending.length ? pending.join(', ') : '（无）'))
  line('孤儿文件 ' + orphans.length + ' 个' + (orphans.length ? ': ' + orphans.join(', ') + '  ← 命名不合规范，永远不会被投递，删掉重发' : ''))
  line('failed/ ' + P.failed.length + ' 个: ' + (P.failed.length ? P.failed.join(', ') : '（无）'))
  line('FAIL 收据 ' + failReceipts.length + ' 条' + (failReceipts.length ? ': ' + failReceipts.map(([k, v]) => k + ' ⇒ ' + v).join(' | ') + '  ← 同名会永久挡住重发，重派要换号' : ''))
  line('')
  line('最近收据：')
  for (const r of recent) line('  · ' + r.key + '  →  ' + r.text + '   （' + (r.age === undefined ? '?' : Math.round(r.age)) + ' 秒前）')
  if (recent.length === 0) line('  （无）')
  settle(0)
}

// ────────────────────────────── usage / main ──────────────────────────────

function usage() {
  line('relay-dispatch.mjs —— 派单唯一安全入口（技能 y-task-distribution-auto）')
  line('')
  line('  node relay-dispatch.mjs check [--json] [--protocol <目录>]')
  line('  node relay-dispatch.mjs send --to <槽位或组名> --kind <' + KINDS.join('|') + '> --id <派单号>')
  line('  槽位：' + Object.keys(SLOTS).join('/') + '；组名：' + (Object.keys(SLOT_GROUPS).join('/') || '（无）'))
  line('        (--file <规格.md> | --text "<正文>") [--inline full|summary|pointer]')
  line('        [--confirm] [--wait <秒>] [--force-title] [--no-template-check] [--selftest] [--protocol <目录>]')
  line('  node relay-dispatch.mjs status [--json] [--protocol <目录>]')
  line('')
  line('默认是干跑（不写盘）；只有加 --confirm 才真发。退出码 0/2/3/4 见 SKILL.md §六。')
}

function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') { usage(); return 0 }
  const opt = parseArgs(argv.slice(1))
  if (cmd === 'check') { runCheck(opt); return process.exitCode || 0 }
  if (cmd === 'send') { runSend(opt); return process.exitCode || 0 }
  if (cmd === 'status') { runStatus(opt); return process.exitCode || 0 }
  line('未知子命令: ' + cmd)
  usage()
  return 2
}

process.exitCode = main()

