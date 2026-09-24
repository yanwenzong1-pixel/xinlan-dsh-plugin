#!/usr/bin/env node
/**
 * 「预存命令」按钮 / 上拉菜单 / 编辑弹窗 —— 真机验收（dev 3080，铁律 2/44）。
 *
 * 为什么必须有这一条：叶子单测与产物门禁只能证明"逻辑与产物里有"，证明不了
 *  ① dev 页面实际加载的是这份产物；② 面板真的挂在 body 上没被裁剪；
 *  ③ 点条目真的把正文写进了 composer 且光标落在末尾；④ 刷新后真的还在；
 *  ⑤ 遮罩/滚动/resize/Esc/互斥这些"浏览器里才存在"的时机。
 *
 * 数据纪律（铁律 49）：**不切工作区、不建会话、不碰宿主数据**。
 * 全程只在自己这个浏览器上下文里读写 localStorage（与用户的浏览器互不相干）。
 *
 * 用法：node scripts/e2e-preset-commands.mjs [devUrl]
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { statSync } from 'node:fs'
// 期望值直接取叶子的纯函数（与实现同一来源，避免脚本里再抄一份拼接规则）。
import { insertionText } from '../src/lib/command-store.ts'

const base = (process.argv[2] ?? 'http://127.0.0.1:3080').split('?')[0]
/** 面板截图落点：<workspace>/docs（本脚本在 <plugin>/scripts 下）。 */
const docsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs')
const repoRoot = 'C:/Users/<user>/Documents/Deepseek/<repo>'
const { applyDshWebAuth } = await import(pathToFileURL(resolve(repoRoot, 'scripts/lib/dsh-auth-cookie.mjs')).href)
const pwPath = process.env.PW_PATH ?? resolve('C:/Users/<user>/Documents/Deepseek/_upgrade/dsh-v0.1.5-rc.1/src/deepseek-harness-dsh-v0.1.5-rc.1/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js')
const pw = (await import(pathToFileURL(pwPath).href)).default

const COMMAND_KEY = 'dsh-quick-append.commands'
const PRESET_KEY = 'dsh-quick-append.presets'
const CMD_BTN = 'button[aria-label="预存命令"]'
const APPEND_BTN = 'button[title="点击追加 / 右键设置"]'
const MENU = '.dsh-qa-menu'
const DIALOG = '.dsh-qa-dialog'
const MASK = '.dsh-qa-mask'
const ERR = '.dsh-qa-err'
const T1 = 'E2E-指令甲'
const C1 = 'E2E-正文甲第一行\nE2E-正文甲第二行'
const T2 = 'E2E-指令乙'
const C2 = 'E2E-正文乙'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail === '' ? '' : `　— ${detail}`}`)
}
const round = (n) => Math.round(n)

/**
 * 颜色数值比对（容忍浮点残差）：过渡动画结束时浏览器仍可能给出 0.976 / 1.93855 这类中间值，
 * 用字符串全等比会把"同一个配方"误判成失败。判据仍是同一条配方，只是允许 ±1 通道 / ±0.01 alpha。
 */
const colorNear = (actual, r, g, b, a = 1) => {
  const matched = /rgba?\(([^)]+)\)/.exec(String(actual))
  if (matched === null) return false
  const parts = matched[1].split(',').map((value) => Number(value.trim()))
  if (parts.length < 3 || parts.some((value) => Number.isNaN(value))) return false
  const alpha = parts.length === 4 ? parts[3] : 1
  return Math.abs(parts[0] - r) <= 1 && Math.abs(parts[1] - g) <= 1 && Math.abs(parts[2] - b) <= 1 && Math.abs(alpha - a) <= 0.01
}

/**
 * 点击一律用 dispatchEvent：这台 dev 实例上常驻着其它插件的浮层（助手息屏遮罩等），
 * 真实指针点击会被它们拦截（Playwright 的可操作性检查会一直重试直到超时）；
 * 本仓既有的真机脚本（e2e-preset-workspace / e2e-history-news）出于同样原因也是派发点击。
 */
const clickIt = async (locator) => { await locator.first().dispatchEvent('click', { bubbles: true }) }

const readCommands = (page) => page.evaluate((key) => localStorage.getItem(key), COMMAND_KEY)

/** 种入/清空预存命令并刷新（只动本上下文）。 */
async function seedAndReload(page, raw) {
  await page.evaluate(({ key, value }) => {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    localStorage.removeItem('dsh-quick-append.presets')
  }, { key: COMMAND_KEY, value: raw })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(CMD_BTN, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1000)
}

/**
 * composer 输入区里的当前草稿文本（新输入面 contenteditable / 旧输入面 textarea 都认）。
 * 新输入面必须**按顶层块拼接**：Lexical 把正文里的每个换行渲染成一个独立的 <p>，
 * 所以 textContent 会丢掉分隔符、innerText 又会把段间距放大成空行 —— 两者都不是草稿真值。
 * 实测（2026-09-23 探针）：写入 "AAA第一行\nBBB第二行" 后 children = 2 个 <p>，
 * 逐块用 \n 拼接得到 13 字符，与写入值逐字一致。
 */
const draftOf = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-composer-card] [data-composer-input]') ?? document.querySelector('[data-composer-input]')
  if (el === null) return null
  if (typeof el.value === 'string') return el.value
  const blocks = [...el.children]
  if (blocks.length > 0) return blocks.map((b) => b.textContent ?? '').join('\n')
  return String(el.textContent ?? '')
})

/** 光标是否落在输入区内容的末尾（需求 3.3 的硬判据）。 */
const caretAtEnd = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-composer-card] [data-composer-input]') ?? document.querySelector('[data-composer-input]')
  if (el === null) return { ok: false, detail: 'no-input' }
  if (typeof el.value === 'string') {
    return { ok: el.selectionStart === el.value.length && el.value.length > 0, detail: `textarea caret=${String(el.selectionStart)}/${String(el.value.length)}` }
  }
  try {
    const selection = document.getSelection()
    if (selection === null || selection.rangeCount === 0) return { ok: false, detail: 'no-selection' }
    const full = String(el.textContent ?? '')
    const range = document.createRange()
    range.selectNodeContents(el)
    range.setEnd(selection.focusNode, selection.focusOffset)
    const before = range.toString()
    return { ok: before === full && full.length > 0, detail: `caret=${String(before.length)}/${String(full.length)}` }
  } catch (error) {
    return { ok: false, detail: String(error) }
  }
})

/** 面板祖先链上是否有会裁剪/改变 fixed 定位的样式（portal 到 body 的意义所在）。 */
const layerChainClean = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (el === null) return { ok: false, detail: 'no-panel' }
  const bad = []
  let node = el.parentElement
  while (node !== null && node !== document.body) {
    const style = getComputedStyle(node)
    if (!['visible', 'clip'].includes(style.overflow) || !['visible', 'clip'].includes(style.overflowX) || !['visible', 'clip'].includes(style.overflowY)) {
      bad.push(`${node.className || node.tagName}:overflow=${style.overflow}`)
    }
    if (style.transform !== 'none' || style.filter !== 'none' || style.backdropFilter !== 'none' || style.perspective !== 'none' || style.contain !== 'none') {
      bad.push(`${node.className || node.tagName}:containing-block`)
    }
    node = node.parentElement
  }
  return { ok: bad.length === 0, detail: bad.join(' | ') }
}, selector)

/** 打开空态/有数据两种左键菜单。 */
const openMenu = async (page) => { await clickIt(page.locator(CMD_BTN)); await page.waitForTimeout(250) }
const closeMenu = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(200) }

let browser = null
try {
  browser = await pw.chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const auth = await applyDshWebAuth(ctx, base)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  // ── 起点：清空预存命令，确保走"空态"分支 ──
  await page.goto(auth.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector(CMD_BTN, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1200)
  await seedAndReload(page, null)

  check('F1 首屏健康：无 "Failed to load plugins"，两个按钮都在 DOM',
    !(await page.evaluate(() => document.body.innerText.includes('Failed to load plugins'))) &&
    (await page.locator(CMD_BTN).count()) > 0 && (await page.locator(APPEND_BTN).count()) > 0)
  check('F1b portal 宿主节点挂在 body（且只有一个）',
    (await page.locator('body > .dsh-qa-portal').count()) === 1,
    String(await page.locator('.dsh-qa-portal').count()))

  // ── 位置 / 外观（需求 2.1/2.2/2.3）──
  const geo = await page.evaluate((sels) => {
    const cmd = document.querySelector(sels.cmd)
    const append = document.querySelector(sels.append)
    if (cmd === null || append === null) return null
    const a = cmd.getBoundingClientRect()
    const b = append.getBoundingClientRect()
    const sa = getComputedStyle(cmd)
    const sb = getComputedStyle(append)
    return {
      gap: Math.round(b.left - a.right),
      sameBox: a.width === b.width && a.height === b.height,
      size: `${String(a.width)}x${String(a.height)}`,
      style: {
        radius: [sa.borderRadius, sb.borderRadius],
        borderWidth: [sa.borderTopWidth, sb.borderTopWidth],
        borderColor: [sa.borderTopColor, sb.borderTopColor],
        padding: [sa.padding, sb.padding],
        bg: [sa.backgroundColor, sb.backgroundColor],
        color: [sa.color, sb.color],
        transition: [sa.transitionDuration, sb.transitionDuration],
        cursor: [sa.cursor, sb.cursor],
      },
      cmdText: (cmd.textContent ?? '').trim(),
      cmdTitle: cmd.getAttribute('title'),
      cmdAria: cmd.getAttribute('aria-label'),
      svgBox: (() => { const s = cmd.querySelector('svg'); if (s === null) return null; const r = s.getBoundingClientRect(); return `${String(r.width)}x${String(r.height)}` })(),
      strokeWidth: (() => { const s = cmd.querySelector('svg'); return s === null ? null : s.getAttribute('stroke-width') })(),
    }
  }, { cmd: CMD_BTN, append: APPEND_BTN })

  check('F2 仅扳手图标：按钮无可见文字，title/aria-label 均为「预存命令」',
    geo !== null && geo.cmdText === '' && geo.cmdTitle === '预存命令' && geo.cmdAria === '预存命令',
    JSON.stringify({ text: geo?.cmdText, title: geo?.cmdTitle, aria: geo?.cmdAria }))
  const appendSvgBox = await page.evaluate(() => {
    const s = document.querySelector('button[title="点击追加 / 右键设置"] svg')
    if (s === null) return null
    const r = s.getBoundingClientRect()
    return `${String(r.width)}x${String(r.height)}`
  })
  check('F2b 图标为 16x16 描边 2 的 svg（与「点击追加」同尺寸同线宽）',
    geo !== null && geo.svgBox === '16x16' && geo.strokeWidth === '2' && geo.svgBox === appendSvgBox,
    JSON.stringify({ box: geo?.svgBox, appendBox: appendSvgBox, stroke: geo?.strokeWidth }))
  check('F3 与「点击追加」水平间距恰好 5px，且在其左侧',
    geo !== null && geo.gap === 5, `gap=${String(geo?.gap)}`)
  const stylePairs = geo === null ? [] : Object.entries(geo.style).filter(([, v]) => v[0] !== v[1])
  check('F3b 尺寸/圆角/边框/内边距/底色/字色/过渡/光标逐项与「点击追加」一致',
    geo !== null && geo.sameBox && stylePairs.length === 0,
    JSON.stringify({ box: geo?.size, diff: stylePairs }))

  // ── 空态：不展示空菜单，改为引导 toast（需求 3.4）──
  await openMenu(page)
  const emptyToast = await page.evaluate(() => document.body.innerText)
  check('F4 无预存命令时左键不打开菜单（零个菜单面板）', (await page.locator(MENU).count()) === 0)
  check('F4b 无数据时弹出引导 toast（原文一致）',
    emptyToast.includes('暂无预存命令，右键『预存命令』可录入指令'), emptyToast.replace(/\s+/g, ' ').slice(-80))

  // ── 右键：阻止原生菜单 + 打开编辑弹窗（需求 4.1/4.2）──
  await page.locator(CMD_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(300)
  check('F5 右键打开编辑弹窗（面板 + 遮罩都在，且弹窗层级高于遮罩）',
    (await page.locator(DIALOG).count()) === 1 && (await page.locator(MASK).count()) === 1,
    JSON.stringify(await page.evaluate(() => {
      const d = document.querySelector('.dsh-qa-dialog')
      const m = document.querySelector('.dsh-qa-mask')
      const extra = document.querySelector('.dsh-qa-portal')?.parentElement
      return { dialogZ: d === null ? null : getComputedStyle(d).zIndex, maskZ: m === null ? null : getComputedStyle(m).zIndex, hostParent: extra === undefined ? null : extra.tagName }
    })))
  check('F5b 弹窗在视口内（居中定位生效，未被推到屏幕外）',
    await page.evaluate(() => {
      const d = document.querySelector('.dsh-qa-dialog')
      if (d === null) return false
      const r = d.getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
    }))

  // ── 校验：必填与超长（需求 4.4）──
  await clickIt(page.locator(`${DIALOG} .dsh-qa-btn-primary`))
  await page.waitForTimeout(200)
  const emptyErr = await page.locator(ERR).first().textContent().catch(() => null)
  check('F6 标题为空点「新增」→ 报错且不写入', emptyErr !== null && emptyErr.includes('标题') && (await readCommands(page)) === null, String(emptyErr))

  await page.locator(`${DIALOG} .dsh-qa-input`).fill(T1, { force: true })
  await page.locator(`${DIALOG} .dsh-qa-textarea`).fill('文'.repeat(2001), { force: true })
  await clickIt(page.locator(`${DIALOG} .dsh-qa-btn-primary`))
  await page.waitForTimeout(200)
  const longErr = await page.locator(ERR).first().textContent().catch(() => null)
  check('F6b 正文 2001 字（超上限 1 字）→ 报错且不写入',
    longErr !== null && longErr.includes('2000') && (await readCommands(page)) === null, String(longErr))

  // ── 新增（需求 4.2/4.5/6.1）──
  await page.locator(`${DIALOG} .dsh-qa-textarea`).fill(C1, { force: true })
  await clickIt(page.locator(`${DIALOG} .dsh-qa-btn-primary`))
  await page.waitForTimeout(500)
  const savedRaw = await readCommands(page)
  const saved = (() => { try { return JSON.parse(savedRaw ?? 'null') } catch { return null } })()
  check('F7 新增落盘：version=1、恰好 1 条、字段只有 id/title/content，正文逐字（含换行）',
    saved !== null && saved.version === 1 && Array.isArray(saved.commands) && saved.commands.length === 1 &&
    saved.commands[0].title === T1 && saved.commands[0].content === C1 &&
    JSON.stringify(Object.keys(saved.commands[0]).sort()) === JSON.stringify(['content', 'id', 'title']) &&
    typeof saved.commands[0].id === 'string' && saved.commands[0].id !== '',
    String(savedRaw).slice(0, 120))
  check('F7b 保存后出现成功提示', (await page.evaluate(() => document.body.innerText)).includes('预存命令已保存'))

  // ── 关闭弹窗 → 左键菜单立即拿到新数据（需求 4.5）──
  await clickIt(page.locator(`${DIALOG} button`, { hasText: '关闭' }))
  await page.waitForTimeout(250)
  check('F8 关闭弹窗后遮罩与面板都消失（无残留浮层）',
    (await page.locator(DIALOG).count()) === 0 && (await page.locator(MASK).count()) === 0)
  await openMenu(page)
  const menuText = (await page.locator(MENU).first().textContent().catch(() => '')) ?? ''
  check('F8b 保存后左键菜单立即出现该条（标题与会话数据同源）',
    (await page.locator(`${MENU} .dsh-qa-menu-item`).count()) === 1 && menuText.includes(T1), menuText.replace(/\s+/g, ' ').slice(0, 80))

  // ── 上拉定位（需求 3.1/3.6）──
  const placed = await page.evaluate((sels) => {
    const btn = document.querySelector(sels.cmd)
    const panel = document.querySelector(sels.menu)
    if (btn === null || panel === null) return null
    const b = btn.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    return {
      gapAbove: Math.round(b.top - p.bottom),
      rightAligned: Math.abs(b.right - p.right) <= 1,
      panelAbove: p.bottom <= b.top,
      insideViewport: p.left >= 0 && p.top >= 0 && p.right <= window.innerWidth && p.bottom <= window.innerHeight,
    }
  }, { cmd: CMD_BTN, menu: MENU })
  check('F9 菜单在按钮正上方：下边缘距按钮上边缘 5px、右缘对齐、整体在视口内',
    placed !== null && placed.gapAbove === 5 && placed.rightAligned && placed.panelAbove && placed.insideViewport,
    JSON.stringify(placed))
  const chain = await layerChainClean(page, MENU)
  check('F9b 菜单挂在 body 下：祖先链无 overflow 裁剪、无 transform/filter 改变 fixed 参照系',
    chain.ok, chain.detail)
  check('F9c 菜单项带完整 title（截断后仍可看全）',
    (await page.locator(`${MENU} .dsh-qa-menu-item`).first().getAttribute('title')) === T1)

  // ── 选中 → 正文插入输入区 + 焦点 + 光标到末尾（需求 3.3）──
  const beforeDraft = await draftOf(page)
  await clickIt(page.locator(`${MENU} .dsh-qa-menu-item`))
  await page.waitForTimeout(400)
  const afterDraft = await draftOf(page)
  check('F10 点条目后正文被写入输入区（拼接口径 = 叶子 insertionText，逐字含换行）',
    afterDraft === insertionText(beforeDraft ?? '', C1),
    JSON.stringify({ before: (beforeDraft ?? '').length, after: (afterDraft ?? '').length, expected: insertionText(beforeDraft ?? '', C1).length }))
  check('F10b 菜单随选择关闭（不留悬浮菜单）', (await page.locator(MENU).count()) === 0)
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    if (el === null) return { ok: false, detail: 'no-active' }
    const isInput = el.hasAttribute('data-composer-input') || el.tagName === 'TEXTAREA'
    return { ok: isInput, detail: `${el.tagName}${el.hasAttribute('data-composer-input') ? '[data-composer-input]' : ''}` }
  })
  check('F10c 插入后输入区保持聚焦（用户可直接发送）', focused.ok, focused.detail)
  const caret = await caretAtEnd(page)
  check('F10d 光标落在插入文本末尾', caret.ok, caret.detail)

  // ── 关闭时机：滚动 / resize / 再点按钮（需求 3.5）──
  await openMenu(page)
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(250)
  check('F11 resize 关闭菜单', (await page.locator(MENU).count()) === 0)
  await openMenu(page)
  await page.evaluate(() => window.dispatchEvent(new Event('scroll', { bubbles: false })))
  await page.waitForTimeout(250)
  check('F11b 滚动关闭菜单（捕获阶段监听）', (await page.locator(MENU).count()) === 0)
  await openMenu(page)
  await clickIt(page.locator(CMD_BTN))
  await page.waitForTimeout(250)
  check('F11c 再次点击按钮关闭菜单', (await page.locator(MENU).count()) === 0)
  await openMenu(page)
  await page.mouse.click(60, 200)
  await page.waitForTimeout(250)
  let outsideClosed = (await page.locator(MENU).count()) === 0
  let outsideHow = '真实指针点击'
  if (!outsideClosed) {
    // 真实指针被其它插件的浮层吞掉时，退化为直接派发 mousedown（测的仍是同一条监听）。
    await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await page.waitForTimeout(250)
    outsideClosed = (await page.locator(MENU).count()) === 0
    outsideHow = '派发 mousedown（真实指针被其它插件浮层吞掉）'
  }
  check('F11d 点击面板外部关闭菜单', outsideClosed, outsideHow)

  // ── Esc 关闭并回焦按钮（需求 7.3）──
  await openMenu(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const refocused = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), CMD_BTN)
  check('F12 Esc 关闭菜单并把焦点还给按钮', (await page.locator(MENU).count()) === 0 && refocused)
  await openMenu(page)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  const activeIdx = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .dsh-qa-menu-item`)].findIndex((el) => el.className.includes(' on')), MENU)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('F12b ↑↓ 导航 + Enter 选择（键盘全链路）', activeIdx >= 0 && (await page.locator(MENU).count()) === 0, `active=${String(activeIdx)}`)

  // ── 持久化跨刷新（需求 8.4）──
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(CMD_BTN, { state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(1000)
  await openMenu(page)
  check('F13 刷新后左键菜单仍有该条（本地持久化）',
    (await page.locator(`${MENU} .dsh-qa-menu-item`).count()) === 1)
  await closeMenu(page)

  // ── 修改（需求 4.2）──
  await page.locator(CMD_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(300)
  await clickIt(page.locator(`${DIALOG} .dsh-qa-cmd-row button`, { hasText: '编辑' }))
  await page.waitForTimeout(200)
  const filledTitle = await page.locator(`${DIALOG} .dsh-qa-input`).inputValue()
  const filledBody = await page.locator(`${DIALOG} .dsh-qa-textarea`).inputValue()
  check('F14 点「编辑」把该条回填进表单', filledTitle === T1 && filledBody === C1, JSON.stringify({ filledTitle, len: filledBody.length }))
  await page.locator(`${DIALOG} .dsh-qa-input`).fill(T2, { force: true })
  await clickIt(page.locator(`${DIALOG} .dsh-qa-btn-primary`))
  await page.waitForTimeout(400)
  const edited = JSON.parse((await readCommands(page)) ?? 'null')
  check('F15 修改落盘：标题变了、正文与 id 未变、条数仍为 1',
    edited !== null && edited.commands.length === 1 && edited.commands[0].title === T2 &&
    edited.commands[0].content === C1 && edited.commands[0].id === saved.commands[0].id,
    JSON.stringify(edited?.commands?.[0]?.title))

  // ── 未保存变更：关闭前先问（需求 4.5）──
  await clickIt(page.locator(`${DIALOG} .dsh-qa-cmd-row button`, { hasText: '编辑' }))
  await page.waitForTimeout(150)
  await page.locator(`${DIALOG} .dsh-qa-input`).fill('E2E-改了但不保存', { force: true })
  await clickIt(page.locator(`${DIALOG} button`, { hasText: '关闭' }))
  await page.waitForTimeout(250)
  const confirmText = (await page.locator(DIALOG).first().textContent().catch(() => '')) ?? ''
  check('F16 未保存就点「关闭」→ 先问（弹窗不关，出现放弃/继续编辑）',
    (await page.locator(DIALOG).count()) === 1 && confirmText.includes('确定放弃') && confirmText.includes('放弃') && confirmText.includes('继续编辑'))
  await clickIt(page.locator(`${DIALOG} button`, { hasText: '继续编辑' }))
  await page.waitForTimeout(200)
  const stillDirty = await page.locator(`${DIALOG} .dsh-qa-input`).inputValue()
  check('F16b 「继续编辑」保留未保存内容（不丢改动）', stillDirty === 'E2E-改了但不保存' && (await page.locator(DIALOG).count()) === 1, stillDirty)
  await clickIt(page.locator(`${DIALOG} button`, { hasText: '关闭' }))
  await page.waitForTimeout(200)
  await clickIt(page.locator(`${DIALOG} button`, { hasText: '放弃' }))
  await page.waitForTimeout(250)
  check('F16c 「放弃」关闭弹窗且不写入（磁盘仍是上一次保存的值）',
    (await page.locator(DIALOG).count()) === 0 &&
    JSON.parse((await readCommands(page)) ?? 'null').commands[0].title === T2)

  // ── 删除二次确认（需求 4.4）──
  await page.locator(CMD_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(300)
  await clickIt(page.locator(`${DIALOG} .dsh-qa-cmd-row button`, { hasText: '删除' }))
  await page.waitForTimeout(250)
  const armedText = (await page.locator(DIALOG).first().textContent().catch(() => '')) ?? ''
  const afterFirst = JSON.parse((await readCommands(page)) ?? 'null')
  check('F17 第一次点「删除」只进入待确认：按钮变「确认删除」、磁盘未变',
    armedText.includes('确认删除') && afterFirst.commands.length === 1, `rows=${String(afterFirst.commands.length)}`)
  await clickIt(page.locator(`${DIALOG} .dsh-qa-cmd-row button`, { hasText: '确认删除' }))
  await page.waitForTimeout(400)
  const afterDelete = JSON.parse((await readCommands(page)) ?? 'null')
  check('F17b 第二次点才真的删除并落盘', Array.isArray(afterDelete.commands) && afterDelete.commands.length === 0, JSON.stringify(afterDelete))
  check('F17c 删除有成功提示', (await page.evaluate(() => document.body.innerText)).includes('预存命令已删除'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // ── 互斥：与「点击追加」的右键弹窗不同时存在（需求 3.5/4.5）──
  await seedAndReload(page, JSON.stringify({ version: 1, commands: [{ id: 'e2e-1', title: T1, content: C1 }] }))
  await openMenu(page)
  await page.locator(APPEND_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(300)
  const bothOpen = await page.evaluate(() => ({
    menu: document.querySelectorAll('.dsh-qa-menu').length,
    preset: document.querySelectorAll('.dsh-qa-popover:not(.dsh-qa-menu):not(.dsh-qa-dialog)').length,
  }))
  check('F18 打开「点击追加」右键弹窗时预存命令菜单被关掉（同一时刻只有一个浮层）',
    bothOpen.menu === 0 && bothOpen.preset === 1, JSON.stringify(bothOpen))
  const presetText = (await page.locator('.dsh-qa-popover').first().textContent().catch(() => '')) ?? ''
  check('F18b 既有「快捷追加文案」弹窗功能未受影响（回归）', presetText.includes('快捷追加文案') && presetText.includes('填入默认文案'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await page.locator(CMD_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(300)
  check('F18c 反向：打开预存命令弹窗时「快捷追加文案」弹窗被关掉',
    (await page.locator('.dsh-qa-popover:not(.dsh-qa-dialog)').count()) === 0 && (await page.locator(DIALOG).count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)

  // ── 损坏数据降级（需求 6.1）──
  await seedAndReload(page, '{ 这不是 JSON')
  const damagedToast = await page.evaluate(() => document.body.innerText)
  check('F19 存储损坏时降级为空列表并给出提示（不抛、不白屏）',
    damagedToast.includes('预存命令数据') && damagedToast.includes('读取失败') && !damagedToast.includes('Failed to load plugins'),
    damagedToast.replace(/\s+/g, ' ').slice(-90))
  await openMenu(page)
  check('F19c 损坏降级后左键走空态引导（不出现空菜单、不报错）',
    (await page.locator(MENU).count()) === 0 && (await page.evaluate(() => document.body.innerText)).includes('暂无预存命令'))

  // ── 部分损坏：可读的留下、坏的丢弃并计数 ──
  await seedAndReload(page, JSON.stringify({ version: 1, commands: [{ id: 'ok', title: T1, content: C1 }, { id: 'bad', title: '', content: 'x' }, 'garbage'] }))
  const partialToast = await page.evaluate(() => document.body.innerText)
  await openMenu(page)
  check('F19b 部分损坏：能读的留下（1 条）、坏的丢弃并报出条数',
    (await page.locator(`${MENU} .dsh-qa-menu-item`).count()) === 1 && partialToast.includes('已忽略 2 条'),
    partialToast.replace(/\s+/g, ' ').slice(-90))
  await closeMenu(page)

  // ── 边界：长列表内部滚动 / 超长标题截断 / 快速连点 / 短视口限位（需求 3.2/3.6/7.2）──
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `m${String(i)}`, title: `E2E-批量指令-${String(i)}`, content: `正文-${String(i)}` }))
  await seedAndReload(page, JSON.stringify({ version: 1, commands: many }))
  await openMenu(page)
  const scrollInfo = await page.evaluate((sel) => {
    const list = document.querySelector(`${sel} .dsh-qa-menu-list`)
    const panel = document.querySelector(sel)
    if (list === null || panel === null) return null
    return {
      scrollable: list.scrollHeight > list.clientHeight,
      listH: Math.round(list.getBoundingClientRect().height),
      items: list.children.length,
      panelH: Math.round(panel.getBoundingClientRect().height),
    }
  }, MENU)
  check('F21 20 条时菜单内部滚动（列表有滚动余量、高度被 max-height 限住、20 项都在）',
    scrollInfo !== null && scrollInfo.scrollable && scrollInfo.items === 20 && scrollInfo.listH <= 240 && scrollInfo.panelH <= 320,
    JSON.stringify(scrollInfo))
  await closeMenu(page)

  const longTitle = 'E2E-超长标题'.repeat(20)
  await seedAndReload(page, JSON.stringify({ version: 1, commands: [{ id: 'long', title: longTitle, content: 'C' }] }))
  await openMenu(page)
  const ellipsisInfo = await page.evaluate((sel) => {
    const item = document.querySelector(`${sel} .dsh-qa-menu-item`)
    if (item === null) return null
    const style = getComputedStyle(item)
    return {
      clipped: item.scrollWidth > item.clientWidth,
      overflow: style.textOverflow,
      white: style.whiteSpace,
      titleLen: item.getAttribute('title') === null ? 0 : String(item.getAttribute('title')).length,
    }
  }, MENU)
  check('F22 超长标题省略号截断，且完整标题仍可从 title 属性取回',
    ellipsisInfo !== null && ellipsisInfo.clipped && ellipsisInfo.overflow === 'ellipsis' &&
    ellipsisInfo.white === 'nowrap' && ellipsisInfo.titleLen === longTitle.length,
    JSON.stringify(ellipsisInfo))
  await closeMenu(page)

  await clickIt(page.locator(CMD_BTN))
  await clickIt(page.locator(CMD_BTN))
  await clickIt(page.locator(CMD_BTN))
  await page.waitForTimeout(300)
  const rapidCount = await page.locator(MENU).count()
  check('F23 快速连点不叠加浮层（最多一个菜单）', rapidCount <= 1, String(rapidCount))

  await page.setViewportSize({ width: 900, height: 300 })
  await page.waitForTimeout(400)
  await openMenu(page)
  const smallVp = await page.evaluate((sel) => {
    const panel = document.querySelector(sel)
    if (panel === null) return null
    const r = panel.getBoundingClientRect()
    return { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right), vw: window.innerWidth, vh: window.innerHeight }
  }, MENU)
  check('F24 短视口（900x300）下限位生效：面板坐标非负且不越出视口',
    smallVp !== null && smallVp.top >= 0 && smallVp.left >= 0 && smallVp.right <= smallVp.vw && smallVp.bottom <= smallVp.vh,
    JSON.stringify(smallVp))
  await closeMenu(page)
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.waitForTimeout(400)

  // ── UI 精致化实测：规范配方必须真的落在浏览器算出来的样式上（需求 5.1/5.2）──
  await seedAndReload(page, JSON.stringify({ version: 1, commands: [{ id: 'ui-1', title: 'UI 基线指令', content: 'UI 基线正文' }] }))
  await page.locator(CMD_BTN).first().dispatchEvent('contextmenu', { bubbles: true })
  await page.waitForTimeout(350)
  const ui = await page.evaluate((sel) => {
    const dialog = document.querySelector(sel.dialog)
    if (dialog === null) return null
    const styleOf = (el) => (el === null ? null : getComputedStyle(el))
    const mask = document.querySelector(sel.mask)
    const head = dialog.querySelector('.dsh-qa-head')
    const foot = dialog.querySelector('.dsh-qa-footer')
    const input = dialog.querySelector('.dsh-qa-input')
    const primary = dialog.querySelector('.dsh-qa-btn-primary')
    const row = dialog.querySelector('.dsh-qa-cmd-row')
    const dialogStyle = styleOf(dialog)
    const headStyle = styleOf(head)
    const footStyle = styleOf(foot)
    const inputStyle = styleOf(input)
    return {
      maskBg: styleOf(mask) === null ? null : styleOf(mask).backgroundColor,
      maskBlur: styleOf(mask) === null ? null : styleOf(mask).backdropFilter,
      dialogH: Math.round(dialog.getBoundingClientRect().height),
      viewportH: window.innerHeight,
      headBorder: headStyle === null ? null : headStyle.borderBottomWidth + ' ' + headStyle.borderBottomColor,
      headPadBottom: headStyle === null ? null : headStyle.paddingBottom,
      headTitle: head === null ? null : (head.querySelector('.dsh-qa-head-title')?.textContent ?? ''),
      headCount: head === null ? null : (head.querySelector('.dsh-qa-head-count')?.textContent ?? ''),
      footBorderTop: footStyle === null ? null : footStyle.borderTopWidth,
      inputPad: inputStyle === null ? null : inputStyle.padding,
      inputFont: inputStyle === null ? null : inputStyle.fontSize,
      inputTransition: inputStyle === null ? null : inputStyle.transitionDuration,
      primaryBg: styleOf(primary) === null ? null : styleOf(primary).backgroundColor,
      primaryColor: styleOf(primary) === null ? null : styleOf(primary).color,
      rowBtnRadius: row === null ? null : styleOf(row.querySelector('.dsh-qa-btn')).borderRadius,
      scrollbarHidden: dialogStyle.scrollbarWidth,
      overscroll: dialogStyle.overscrollBehaviorY,
    }
  }, { dialog: DIALOG, mask: MASK })

  check('G1 遮罩 = 规范值（rgba(9,12,17,0.72) + blur(6px)）',
    ui !== null && ui.maskBg === 'rgba(9, 12, 17, 0.72)' && ui.maskBlur === 'blur(6px)',
    JSON.stringify({ bg: ui?.maskBg, blur: ui?.maskBlur }))
  check('G2 头部骨架：1px 分割线 + 10px 底距 + 标题/计数（数字 tabular-nums 由源码门禁钉住）',
    ui !== null && ui.headBorder === '1px rgba(120, 140, 170, 0.18)' && ui.headPadBottom === '10px' &&
    ui.headTitle === '预存命令' && ui.headCount === '1 条',
    JSON.stringify({ border: ui?.headBorder, pad: ui?.headPadBottom, title: ui?.headTitle, count: ui?.headCount }))
  check('G3 底部操作行与内容分离（1px 上分割线）', ui !== null && ui.footBorderTop === '1px', String(ui?.footBorderTop))
  check('G4 输入框 = ct-input（7px 10px / 13px / .15s 过渡）',
    ui !== null && ui.inputPad === '7px 10px' && ui.inputFont === '13px' && String(ui.inputTransition).includes('0.15s'),
    JSON.stringify({ pad: ui?.inputPad, font: ui?.inputFont, transition: ui?.inputTransition }))
  check('G5 主按钮 = ct-button-primary（accent 底 rgb(136,221,68) + 黑字 rgb(10,14,19)）',
    ui !== null && ui.primaryBg === 'rgb(136, 221, 68)' && ui.primaryColor === 'rgb(10, 14, 19)',
    JSON.stringify({ bg: ui?.primaryBg, color: ui?.primaryColor }))
  check('G6 行内操作按钮是胶囊（999px），与主按钮方角形成层级差',
    ui !== null && ui.rowBtnRadius === '999px', String(ui?.rowBtnRadius))
  check('G7 弹窗滚动区：隐藏滚动条 + overscroll 不外溢 + 高度不超 86vh',
    ui !== null && ui.scrollbarHidden === 'none' && ui.overscroll === 'contain' &&
    ui.dialogH <= Math.round(ui.viewportH * 0.86),
    JSON.stringify({ scrollbar: ui?.scrollbarHidden, overscroll: ui?.overscroll, h: ui?.dialogH, vh: ui?.viewportH }))

  await page.locator(`${DIALOG} .dsh-qa-input`).focus()
  await page.waitForTimeout(600) // 等 0.15s 过渡跑完再读数（过渡中读到的 0.976/1.94px 是中间值，不是另一个配方）
  const focusRing = await page.evaluate((sel) => {
    const input = document.querySelector(sel.dialog + ' .dsh-qa-input')
    const style = getComputedStyle(input)
    return { border: style.borderTopColor, shadow: style.boxShadow, active: document.activeElement === input }
  }, { dialog: DIALOG })
  const halo = /rgba?\(([^)]+)\)\s+0px\s+0px\s+0px\s+([\d.]+)px/.exec(focusRing.shadow)
  check('G8 聚焦态可见：info 边 rgb(100,181,246) + 2px 光环 0.25',
    focusRing.active && colorNear(focusRing.border, 100, 181, 246) &&
    halo !== null && Math.abs(Number(halo[2]) - 2) <= 0.1 && colorNear('rgba(' + halo[1] + ')', 100, 181, 246, 0.25),
    JSON.stringify(focusRing))

  await clickIt(page.locator(`${DIALOG} .dsh-qa-cmd-row button`, { hasText: '编辑' }))
  await page.waitForTimeout(600) // 同上：选中底/边也走 0.15s 过渡
  const rowSelected = await page.evaluate((sel) => {
    const row = document.querySelector(sel.dialog + ' .dsh-qa-cmd-row.on')
    if (row === null) return null
    const style = getComputedStyle(row)
    return { bg: style.backgroundColor, border: style.borderTopColor }
  }, { dialog: DIALOG })
  check('G9 "正在编辑"的行用淡紫选中底 + 紫边（与菜单高亮同一语义，一眼可辨）',
    rowSelected !== null && colorNear(rowSelected.bg, 147, 136, 255, 0.14) && colorNear(rowSelected.border, 147, 136, 255, 0.36),
    JSON.stringify(rowSelected))

  // 只截**面板自身**（元素截图）：不把宿主页面里的会话/研报等内容带进仓库。
  const shotDialog = resolve(docsDir, '169-quick-append-编辑弹窗.png')
  await page.locator(DIALOG).screenshot({ path: shotDialog })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await openMenu(page)
  const menuLook = await page.evaluate((sel) => {
    const item = document.querySelector(sel.menu + ' .dsh-qa-menu-item.on')
    const head = document.querySelector(sel.menu + ' .dsh-qa-menu-head')
    const styleOf = (el) => (el === null ? null : getComputedStyle(el))
    return {
      itemBg: styleOf(item) === null ? null : styleOf(item).backgroundColor,
      itemColor: styleOf(item) === null ? null : styleOf(item).color,
      itemPad: styleOf(item) === null ? null : styleOf(item).padding,
      itemRadius: styleOf(item) === null ? null : styleOf(item).borderRadius,
      itemWeight: styleOf(item) === null ? null : styleOf(item).fontWeight,
      headBorder: styleOf(head) === null ? null : styleOf(head).borderBottomWidth,
    }
  }, { menu: MENU })
  check('G10 菜单项 = ct-menu-item（7px 12px / 圆角 7 / 600 字重），高亮项淡紫底 + 亮字',
    menuLook.itemBg === 'rgba(147, 136, 255, 0.14)' && menuLook.itemPad === '7px 12px' &&
    menuLook.itemRadius === '7px' && menuLook.itemWeight === '600' &&
    menuLook.itemColor === 'rgb(230, 233, 239)' && menuLook.headBorder === '1px',
    JSON.stringify(menuLook))
  const shotMenu = resolve(docsDir, '169-quick-append-上拉菜单.png')
  await page.locator(MENU).screenshot({ path: shotMenu })
  const shotSizes = [shotDialog, shotMenu].map((p) => { try { return statSync(p).size } catch { return 0 } })
  check('G11 面板截图已落盘（供人工目视；仅截面板本身，不含宿主页面内容）',
    shotSizes.every((size) => size > 2000), JSON.stringify(shotSizes))
  await closeMenu(page)

  const mine = errors.filter((x) => /quick-append|dsh-qa|Failed to load plugins/i.test(x))
  check('F20 无本组件相关控制台错误', mine.length === 0, mine.slice(0, 2).join(' | ').slice(0, 200))
} finally {
  if (browser !== null) { try { await browser.close() } catch { /* 已关 */ } }
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅' : '❌'} 「预存命令」真机验收：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
