#!/usr/bin/env node
/**
 * 「追加文案·按工作区隔离 + 本地持久化」真机验收（dev 3080，铁律 2/44）。
 *
 * 为什么必须有这一条：单测与产物门禁只能证明"逻辑与产物里有"，证明不了
 *  ① dev 页面实际加载的是这份产物；② 弹窗真的能开出新按钮；③ 刷新后真的还在；
 *  ④ 读取真的按"当前工作区 ID"绑定（不是读了别人的）。
 *
 * 数据纪律（铁律 49）：**不切工作区、不建会话、不碰宿主数据**。
 * 全程只在自己这个浏览器上下文里读写 localStorage（与用户的浏览器互不相干）：
 *  - 隔离与迁移两项用"向存储里种入第二个工作区 / 只写旧键再刷新"来验证，不改宿主的任何状态。
 *
 * 用法：node scripts/e2e-preset-workspace.mjs [devUrl]
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = (process.argv[2] ?? 'http://127.0.0.1:3080').split('?')[0]
const repoRoot = 'C:/Users/<user>/Documents/Deepseek/<repo>'
const { applyDshWebAuth } = await import(pathToFileURL(resolve(repoRoot, 'scripts/lib/dsh-auth-cookie.mjs')).href)
const pwPath = process.env.PW_PATH ?? resolve('C:/Users/<user>/Documents/Deepseek/_upgrade/dsh-v0.1.5-rc.1/src/deepseek-harness-dsh-v0.1.5-rc.1/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js')
const pw = (await import(pathToFileURL(pwPath).href)).default

const STORE_KEY = 'dsh-quick-append.presets'
const LEGACY_KEY = 'dsh-quick-append.text'
const TRIGGER = 'button[title="点击追加 / 右键设置"]'
const POPOVER = '.dsh-qa-popover'
const OTHER_WS = 'e2e-other-workspace'
const OTHER_TEXT = 'E2E-别的工作区的文案'
const LEGACY_TEXT = 'E2E-旧版全局文案-迁移探针'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === '' ? '' : `　— ${detail}`}`)
}

/** 打开编辑弹窗（右键 = 打开设置）。 */
async function openEditor(page) {
  await page.locator(TRIGGER).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForSelector(POPOVER, { state: 'attached', timeout: 5000 })
}

/** 关闭弹窗（ESC），避免影响后续断言。 */
async function closeEditor(page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

const readStorage = (page) => page.evaluate(({ storeKey, legacyKey }) => ({
  presets: localStorage.getItem(storeKey),
  legacy: localStorage.getItem(legacyKey),
}), { storeKey: STORE_KEY, legacyKey: LEGACY_KEY })

/** 种入存储并刷新（只动本上下文）。 */
async function seedAndReload(page, seed) {
  await page.evaluate(({ storeKey, legacyKey, seed }) => {
    localStorage.removeItem(storeKey)
    localStorage.removeItem(legacyKey)
    if (seed.presets !== undefined) localStorage.setItem(storeKey, seed.presets)
    if (seed.legacy !== undefined) localStorage.setItem(legacyKey, seed.legacy)
  }, { storeKey: STORE_KEY, legacyKey: LEGACY_KEY, seed })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(TRIGGER, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)
}

const textareaValue = (page) => page.locator(`${POPOVER} .dsh-qa-textarea`).inputValue()

let browser = null
try {
  browser = await pw.chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const auth = await applyDshWebAuth(ctx, base)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(auth.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector(TRIGGER, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)

  check('E1 首屏健康：无 "Failed to load plugins"，快捷追加按钮在 DOM',
    !(await page.evaluate(() => document.body.innerText.includes('Failed to load plugins'))) &&
    (await page.locator(TRIGGER).count()) > 0)

  await openEditor(page)
  const popoverText = ((await page.locator(POPOVER).first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
  check('E2 右键弹出编辑弹窗（标题「快捷追加文案」）', popoverText.includes('快捷追加文案'), popoverText.slice(0, 60))
  check('E3 弹窗显示本条配置的写入目标工作区（隔离可见）', /写入：/.test(popoverText), popoverText.slice(0, 90))
  const targetShown = ((await page.locator(`${POPOVER} .dsh-qa-meta-text`).first().textContent()) ?? '').replace('写入：', '').trim()
  check('E3b 工作区解析成功（不是"未归属工作区"占位）', targetShown !== '' && targetShown !== '未归属工作区', `写入：${targetShown}`)

  // ── 默认文案按钮（用户 2026-09-23 选定：新工作区空白 + 一键填回）──
  // 点击一律用 dispatchEvent：这台 dev 实例上常驻着其它插件的浮层（助手息屏遮罩等），
  // 真实指针点击会被它们拦截（Playwright 的可操作性检查会一直重试直到超时）；
  // 本仓既有的真机脚本（e2e-history-news 等）出于同样原因也是派发点击。
  const btn = page.locator(`${POPOVER} button`, { hasText: '填入默认文案' }).first()
  check('E4 存在「填入默认文案」按钮', (await btn.count()) > 0)
  await btn.dispatchEvent('click', { bubbles: true })
  await page.waitForTimeout(200)
  const filled = await textareaValue(page)
  check('E4b 点击后文本框填入新版默认文案',
    filled.includes('最高优先级规则') && filled.includes('输出顺序') &&
    filled.includes('使用Ponytail 的 full模式开发') && filled.includes('严格遵守根目录配置文件：*.md') &&
    !filled.includes('插件窗口UI规范参考根目录'), `长度 ${filled.length}`)

  // ── 保存 → 新结构落盘 ──
  await page.locator(`${POPOVER} .dsh-qa-btn-primary`).first().dispatchEvent('click', { bubbles: true })
  await page.waitForTimeout(700)
  const toastText = await page.evaluate(() => document.body.innerText)
  check('E5 保存后出现「已保存」提示（提示来自真实落盘结果）', toastText.includes('已保存'))
  const after = await readStorage(page)
  let parsed = null
  try { parsed = JSON.parse(after.presets ?? 'null') } catch { parsed = null }
  const keys = parsed !== null && parsed.workspaces !== undefined ? Object.keys(parsed.workspaces) : []
  check('E6 落盘结构正确：version=1、恰好 1 个工作区条目、键是工作区 ID（非占位键）',
    parsed !== null && parsed.version === 1 && keys.length === 1 && keys[0] !== '__no-workspace__' && keys[0] !== '',
    JSON.stringify({ version: parsed?.version, keys }))
  check('E6b 落盘内容 = 默认文案（逐字，未截断）',
    parsed !== null && typeof parsed.workspaces[keys[0]]?.appendText === 'string' &&
    parsed.workspaces[keys[0]].appendText.includes('最高优先级规则') && parsed.workspaces[keys[0]].appendText.length === filled.length,
    `落盘长度 ${parsed === null ? 'n/a' : String(parsed.workspaces[keys[0]]?.appendText?.length)}`)
  const savedKey = keys[0] ?? ''
  await closeEditor(page)

  // ── 刷新后仍在（持久化跨刷新）──
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(TRIGGER, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)
  await openEditor(page)
  const afterReload = await textareaValue(page)
  check('E7 刷新页面后仍是同一份文案（持久化跨刷新）', afterReload === filled, `长度 ${afterReload.length}`)
  await closeEditor(page)

  // ── 隔离：存储里还有另一个工作区时，本工作区读自己的 ──
  const seededStore = JSON.stringify({
    version: 1,
    workspaces: { [savedKey]: { appendText: filled }, [OTHER_WS]: { appendText: OTHER_TEXT } },
  })
  await seedAndReload(page, { presets: seededStore })
  await openEditor(page)
  const isolated = await textareaValue(page)
  check('E8 读按当前工作区 ID 绑定：别的工作区的文案不会串进来', isolated === filled && !isolated.includes(OTHER_TEXT), `长度 ${isolated.length}`)
  const stillBoth = await readStorage(page)
  check('E8b 读取不破坏别的工作区的条目（不误删、不整包覆盖）',
    (stillBoth.presets ?? '').includes(OTHER_WS) && (stillBoth.presets ?? '').includes(OTHER_TEXT))
  await closeEditor(page)

  // ── 旧版全局配置迁移（只迁当前工作区，迁完删旧键）──
  await seedAndReload(page, { legacy: LEGACY_TEXT })
  await openEditor(page)
  const migrated = await textareaValue(page)
  check('E9 旧版全局配置迁移到当前工作区（真机）', migrated === LEGACY_TEXT, JSON.stringify(migrated.slice(0, 40)))
  const afterMigrate = await readStorage(page)
  check('E9b 迁移后旧键被删除（否则每个新工作区都会被它污染）', afterMigrate.legacy === null, JSON.stringify(afterMigrate.legacy))
  const migratedStore = JSON.parse(afterMigrate.presets ?? 'null')
  const migratedKeys = migratedStore === null ? [] : Object.keys(migratedStore.workspaces ?? {})
  check('E9c 迁移只写当前工作区一个条目（不复制给其它工作区）',
    migratedKeys.length === 1 && migratedKeys[0] === savedKey && migratedStore.workspaces[savedKey].appendText === LEGACY_TEXT,
    JSON.stringify(migratedKeys))
  await closeEditor(page)

  // ── 新建工作区默认空白（不继承任何其它工作区的文案）──
  await seedAndReload(page, { presets: JSON.stringify({ version: 1, workspaces: { [OTHER_WS]: { appendText: OTHER_TEXT } } }) })
  await openEditor(page)
  const brandNew = await textareaValue(page)
  check('E10 当前工作区没有条目时读到空（新建工作区默认空白，验收 3）', brandNew === '', JSON.stringify(brandNew.slice(0, 40)))
  await closeEditor(page)

  // ── 写盘失败：可见提示 + 本页内存态仍可用（验收 5；需求：降级时保持内存态可用 + 明确提示）──
  await seedAndReload(page, { presets: JSON.stringify({ version: 1, workspaces: { [savedKey]: { appendText: 'E2E-旧值-保持' } } }) })
  await page.evaluate(() => {
    window.__qaRealSetItem = localStorage.setItem.bind(localStorage)
    localStorage.setItem = () => { throw new Error('QuotaExceededError') }
  })
  await openEditor(page)
  await page.locator(`${POPOVER} .dsh-qa-textarea`).fill('E2E-失败探针文案', { force: true })
  await page.locator(`${POPOVER} .dsh-qa-btn-primary`).first().dispatchEvent('click', { bubbles: true })
  await page.waitForTimeout(900)
  const failText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ')
  check('E12 写盘失败时给出可见提示（不静默）',
    failText.includes('追加文案保存失败') && failText.includes('QuotaExceededError'), failText.slice(0, 140))
  const frozen = await readStorage(page)
  check('E12b 失败时不假装写成功：磁盘上仍是旧值',
    (frozen.presets ?? '').includes('E2E-旧值-保持') && !(frozen.presets ?? '').includes('失败探针'),
    (frozen.presets ?? '').slice(0, 100))
  await page.evaluate(() => { localStorage.setItem = window.__qaRealSetItem })
  await openEditor(page)
  const inMemory = await textareaValue(page)
  check('E12c 降级：本页内存态仍是刚编辑的值（刷新前仍可用）', inMemory === 'E2E-失败探针文案', JSON.stringify(inMemory.slice(0, 40)))
  await closeEditor(page)

  const mine = errors.filter((x) => /quick-append|dsh-qa|Failed to load plugins/i.test(x))
  check('E11 无本组件相关控制台错误', mine.length === 0, mine.slice(0, 2).join(' | ').slice(0, 200))
} finally {
  if (browser !== null) { try { await browser.close() } catch { /* 已关 */ } }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅' : '❌'} 「追加文案·工作区隔离」真机验收：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
