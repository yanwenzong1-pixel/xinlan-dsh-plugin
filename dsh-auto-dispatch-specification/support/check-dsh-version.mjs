#!/usr/bin/env node
/**
 * check-dsh-version.mjs — 「记录的 DSH 版本」与「checkout 实际版本」一致性检查。
 *
 * 用法:
 *   node scripts/check-dsh-version.mjs            # 打印 recorded / actual / match
 *   node scripts/check-dsh-version.mjs --json
 *   node scripts/check-dsh-version.mjs --update    # 把 actual 写回 automation.config.json 的 dsh.version
 *
 * 退出码: 0=一致 / 1=不一致（只提示，不阻断任何流程）/ 2=读不到（配置或 checkout 缺失）
 * 说明: 本脚本只读 checkout 的 package.json，不升级、不构建、不重启。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const CFG_FILE = join(REPO_ROOT, 'automation.config.json')

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

const argv = process.argv.slice(2)
const wantJson = argv.includes('--json')
const wantUpdate = argv.includes('--update')

const cfg = existsSync(CFG_FILE) ? readJson(CFG_FILE) : null
if (!cfg) {
  console.error(`[dsh-version] 读不到配置: ${CFG_FILE}`)
  process.exit(2)
}
const recorded = String((cfg.dsh && cfg.dsh.version) || '')
const checkout = String((cfg.dsh && cfg.dsh.checkout) || '')
if (!checkout) {
  console.error('[dsh-version] 配置里没有 dsh.checkout，无法比对')
  process.exit(2)
}
const pkgFile = join(checkout, 'package.json')
const pkg = existsSync(pkgFile) ? readJson(pkgFile) : null
if (!pkg || !pkg.version) {
  console.error(`[dsh-version] 读不到 checkout 版本: ${pkgFile}`)
  process.exit(2)
}
const actual = String(pkg.version)
const match = recorded === actual

if (wantUpdate) {
  cfg.dsh.version = actual
  writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  console.log(`[dsh-version] updated dsh.version: ${recorded || '(空)'} -> ${actual}`)
}

if (wantJson) {
  console.log(JSON.stringify({ recorded, actual, match, checkout }, null, 2))
} else {
  console.log(`[dsh-version] checkout   = ${checkout}`)
  console.log(`[dsh-version] recorded   = ${recorded || '(空)'}`)
  console.log(`[dsh-version] actual     = ${actual}`)
  console.log(`[dsh-version] match      = ${match ? 'yes' : 'NO'}`)
  if (!match) {
    console.log('[dsh-version] 提示：记录值与实际不一致（不阻断）。升级后跑 --update 同步，或按 local/docs/dsh-upgrade-runbook.md 走升级窗口。')
  }
}
process.exit(match || wantUpdate ? 0 : 1)
