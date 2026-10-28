#!/usr/bin/env node
/**
 * Post-install live acceptance for dsh-anime-desktop-pet.
 *
 * Preconditions (env):
 *   DSH_CHECKOUT  - DSH checkout root (resolves playwright from apps/web)
 *   DSH_HOME      - running profile home (staging-url.txt is read from its parent)
 * Optional:
 *   DSH_VERIFY_SHOT=1        - hide known third-party full-screen masks in THIS headless
 *                              page only, so the conversation rows are visible for the
 *                              pointer/animation checks (the user's browser is untouched)
 *   DSH_VERIFY_PNG=<path>    - screenshot output path
 *
 * Checks: plugin row in boot payload -> GIF route byte-equal -> overlay host ->
 * per-running-session nodes aligned beside their row (DSH's own ongoing spinner as the
 * oracle) -> GIF actually animates -> left-click pass-through -> right-click menu ->
 * settings panel (single animation checked+disabled) -> Escape closes.
 * Prints a JSON report; exits 1 with a `failures` list when any check fails.
 */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = '@dsh-external/dsh-anime-desktop-pet'
const GIF = readFileSync(join(PLUGIN, 'assets', 'blue-fat-fish-working.gif'))
const GIF_SHA256 = createHash('sha256').update(GIF).digest('hex')
const GIF_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/blue-fat-fish-working.gif'
const THREE_VIEW_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/three-view/'
const ANIMATED_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/animated/'
const BANNER_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/banner/'
const HIDE_MASKS = process.env.DSH_VERIFY_SHOT === '1' || process.env.DSH_VERIFY_HIDE_MASKS === '1'

const checkout = process.env.DSH_CHECKOUT
const home = process.env.DSH_HOME
if (!checkout || !home) {
  console.error('need DSH_CHECKOUT and DSH_HOME env vars')
  process.exit(2)
}
const urlFile = resolve(home, '..', 'staging-url.txt')
if (!existsSync(urlFile)) {
  console.error(`missing authenticated URL file: ${urlFile}`)
  process.exit(2)
}
const authUrl = readFileSync(urlFile, 'utf8').trim()
const require = createRequire(join(checkout, 'apps', 'web', 'package.json'))
const { chromium } = require('playwright')
const shot = process.env.DSH_VERIFY_PNG ?? join(tmpdir(), 'anime-pet-live.png')
mkdirSync(dirname(shot), { recursive: true })

const failures = []
const report = {}
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
try {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(authUrl).origin })
} catch {
  // Clipboard permissions are best effort; copy checks degrade to failure hints.
}
const page = await context.newPage()
// This script verifies the legacy overlay acceptance path; the live scene has its own verifier.
await page.addInitScript(() => {
  window.__DSH_ANIME_PET_OPTIONS__ = { ...(window.__DSH_ANIME_PET_OPTIONS__ ?? {}), scene: false }
})
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
try {
  await page.goto(authUrl, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(5000)
  if (HIDE_MASKS) {
    report.masksHidden = await page.evaluate(() => {
      const names = ['.aia-mask', '.aia-root', '.ywz-mini', '[data-shell-overlay]']
      let hidden = 0
      for (const el of document.querySelectorAll(names.join(','))) {
        if (el.classList.contains('aia-mask') || el.matches('[data-shell-overlay]')) {
          el.style.display = 'none'
          hidden += 1
        }
      }
      return hidden
    })
  }
  // Expand every workspace group so all session rows are laid out.
  for (let pass = 0; pass < 2; pass += 1) {
    const clicked = await page.evaluate(() => {
      let count = 0
      for (const item of document.querySelectorAll('[role="treeitem"][aria-expanded="false"]')) {
        item.click()
        count += 1
      }
      return count
    })
    if (clicked === 0) break
    await page.waitForTimeout(800)
  }
  await page.waitForTimeout(1500)

  // 1) boot manifest carries the plugin row and its client bundle loaded
  const boot = await page.evaluate(() => ({
    entries: (window.__DSH_BOOT__?.entries ?? []).map((entry) => entry.id),
    loaded: [...document.querySelectorAll('script,link')].map((el) => el.src || el.href)
      .filter((url) => typeof url === 'string' && url.includes('dsh-anime-desktop-pet')).length,
  }))
  report.bootEntries = boot.entries.length
  report.clientBundleLinks = boot.loaded
  if (!boot.entries.includes(PLUGIN_ID)) failures.push(`boot payload misses ${PLUGIN_ID}`)

  // 2) host route serves the packaged GIF byte-for-byte (hash catches same-length retunes)
  const asset = await page.evaluate(async (route) => {
    const response = await fetch(route, { credentials: 'include' })
    const bytes = new Uint8Array(await response.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return { status: response.status, type: response.headers.get('content-type'), length: bytes.length, sha256 }
  }, GIF_ROUTE)
  report.asset = asset
  if (asset.status !== 200) failures.push(`GIF route status ${asset.status}`)
  if (asset.type !== 'image/gif') failures.push(`GIF route content-type ${asset.type}`)
  if (asset.length !== GIF.length) failures.push(`GIF route length ${asset.length} != ${GIF.length}`)
  if (asset.sha256 !== GIF_SHA256) failures.push('GIF route is serving stale bytes (host asset cache not reloaded)')

  // 3) running sessions (DSH's own ongoing spinner is the oracle) vs per-session pets
  const mapping = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-row-key^="session:"]')]
    const runningIds = rows
      .filter((row) => row.querySelector('[data-state="ongoing"]') !== null)
      .map((row) => row.getAttribute('data-row-key').slice('session:'.length))
    const host = document.querySelector('[data-xllh-pet-host]')
    const shadow = host?.shadowRoot ?? null
    const pets = shadow ? [...shadow.querySelectorAll('[data-xllh-pet]')].map((el) => {
      const img = el.querySelector('img')
      const rect = el.getBoundingClientRect()
      const row = document.querySelector(`[data-row-key="session:${el.getAttribute('data-session-id')}"]`)
      const rowRect = row?.getBoundingClientRect() ?? null
      return {
        sessionId: el.getAttribute('data-session-id'),
        hidden: el.hidden,
        ariaHidden: el.getAttribute('aria-hidden'),
        hasTabindex: el.hasAttribute('tabindex'),
        pointerEvents: el.style.pointerEvents,
        computedPointerEvents: getComputedStyle(el).pointerEvents,
        borderRadius: getComputedStyle(el).borderRadius,
        imageLoaded: img.naturalWidth > 0,
        transform: el.style.transform,
        rect: [rect.x, rect.y, rect.width, rect.height],
        rowRect: rowRect === null ? null : [rowRect.x, rowRect.y, rowRect.width, rowRect.height],
        standardSize: rowRect === null ? null : Math.round(rowRect.height * 2.5),
        centerOffset: rowRect === null ? null : Math.abs((rect.y + rect.height / 2) - (rowRect.y + rowRect.height / 2)),
      }
    }) : []
    const workspacePets = shadow ? [...shadow.querySelectorAll('[data-xllh-workspace-animation]')].map((el) => {
      const rect = el.getBoundingClientRect()
      return { id: el.getAttribute('data-workspace-id'), ariaHidden: el.getAttribute('aria-hidden'), rect: [rect.x, rect.y, rect.width, rect.height] }
    }) : []
    return {
      runningIds,
      runningRowIds: rows.map((row) => row.getAttribute('data-row-key').slice('session:'.length)),
      mounted: host !== null,
      hostPointerEvents: host?.style.pointerEvents ?? null,
      pets,
      workspacePets,
    }
  })
  report.runningSessions = mapping.runningIds.length
  report.pets = mapping.pets
  report.workspacePets = mapping.workspacePets
  if (!mapping.mounted) failures.push('overlay host not mounted (client plugin inactive?)')
  if (mapping.hostPointerEvents !== 'none') failures.push('overlay host must be pointer-events:none')
  for (const pet of mapping.pets) {
    const label = pet.sessionId ?? 'unknown'
    if (!pet.imageLoaded) failures.push(`animation ${label} GIF did not load`)
    if (pet.ariaHidden !== 'true') failures.push(`animation ${label} must be aria-hidden`)
    if (pet.hasTabindex) failures.push(`animation ${label} must not be tabbable`)
    if (pet.pointerEvents !== 'none' || (pet.computedPointerEvents !== 'none' && pet.computedPointerEvents !== '')) {
      failures.push(`animation ${label} must be pointer-events:none`)
    }
    if (pet.transform !== '') failures.push(`animation ${label} still has a hover/thumbnail transform`)
    if (!String(pet.borderRadius).startsWith('15px')) failures.push(`animation ${label} must use the 15px rounded-corner radius, got ${pet.borderRadius}`)
    if (pet.standardSize !== null && (Math.abs(pet.rect[2] - pet.standardSize) > 1 || Math.abs(pet.rect[3] - pet.standardSize) > 1)) {
      failures.push(`animation ${label} must render at STANDARD size ${pet.standardSize}px, got ${pet.rect[2]}`)
    }
    if (pet.centerOffset !== null && pet.centerOffset > 1) failures.push(`animation ${label} is not vertically centered on its row (offset ${pet.centerOffset})`)
  }
  const visiblePets = mapping.pets.filter((pet) => !pet.hidden).sort((a, b) => a.rect[1] - b.rect[1])
  for (let index = 1; index < visiblePets.length; index += 1) {
    const previous = visiblePets[index - 1]
    const current = visiblePets[index]
    if (previous.rect[1] + previous.rect[3] > current.rect[1] + 0.5) {
      failures.push(`arbitrated animations of ${previous.sessionId} and ${current.sessionId} overlap vertically`)
    }
  }
  report.visiblePets = visiblePets.length
  if (mapping.runningIds.length > 0 && report.visiblePets === 0 && mapping.workspacePets.length === 0) {
    failures.push('running sessions exist but no arbitrated animation is mounted')
  }

  // 4) GIF really animates: two clipped screenshots of a visible pet must differ.
  const visible = mapping.pets.find((pet) => !pet.hidden)
  if (visible !== undefined) {
    const clip = { x: Math.max(0, visible.rect[0]), y: Math.max(0, visible.rect[1]), width: visible.rect[2], height: visible.rect[3] }
    const first = await page.screenshot({ clip })
    await page.waitForTimeout(400)
    const second = await page.screenshot({ clip })
    report.animated = !first.equals(second)
    if (!report.animated) failures.push('GIF frame did not change between two screenshots (animation not playing)')
  }

  // 5) left-click pass-through: elementFromPoint at the pet centre must reach the page below.
  const passThrough = await page.evaluate(() => {
    const host = document.querySelector('[data-xllh-pet-host]')
    const shadow = host?.shadowRoot
    const pet = shadow ? [...shadow.querySelectorAll('[data-xllh-pet]')].find((el) => !el.hidden) : null
    if (!pet) return { skipped: 'no visible pet' }
    const rect = pet.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return { hit: hit === null ? null : hit.tagName + '.' + String(hit.className).slice(0, 40), insideHost: host.contains(hit) }
  })
  report.passThrough = passThrough
  if (!passThrough.skipped && passThrough.insideHost) failures.push('left-click at pet centre hits the overlay instead of the page below')

  // 6) Fixed desktop character: sidebar icons keep DSH's native right-click only;
  //    the fixed character's right-click menu opens settings (centered, no backdrop).
  const fixedPet = await page.evaluate(() => {
    const host = document.querySelector('[data-xllh-pet-host]')
    const shadow = host?.shadowRoot
    if (!shadow) return { skipped: 'no overlay' }
    const fixed = shadow.querySelector('[data-xllh-pet-fixed]')
    if (!fixed) return { skipped: 'fixed character missing' }
    const fixedRect = fixed.getBoundingClientRect()
    const pet = [...shadow.querySelectorAll('[data-xllh-pet]')].find((el) => !el.hidden)
    let sidebarEvent = null
    if (pet !== undefined) {
      const rect = pet.getBoundingClientRect()
      sidebarEvent = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true,
        clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
      })
      document.body.dispatchEvent(sidebarEvent)
    }
    const menu = shadow.querySelector('[data-xllh-pet-menu]')
    const sidebarMenuOpened = menu.hidden === false
    if (!menu.hidden) menu.hidden = true
    const fixedEvent = new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, composed: true,
      clientX: fixedRect.x + fixedRect.width / 2, clientY: fixedRect.y + fixedRect.height / 2,
    })
    fixed.dispatchEvent(fixedEvent)
    const fixedMenuVisible = menu.hidden === false
    menu.querySelector('button')?.click()
    const settings = shadow.querySelector('[data-xllh-pet-settings]')
    const checkboxes = settings ? [...settings.querySelectorAll('.role-row input[type="checkbox"]')] : []
    const bannerToggle = settings?.querySelector('[data-xllh-banner-toggle]')
    const banner = shadow.querySelector('[data-xllh-banner]')
    const bannerRect = banner?.getBoundingClientRect() ?? null
    const bannerVisibleBefore = banner ? banner.hidden === false : null
    let bannerHiddenAfterToggle = null
    let bannerRestored = null
    if (bannerToggle !== null && bannerToggle !== undefined) {
      bannerToggle.click()
      bannerHiddenAfterToggle = banner?.hidden === true
      bannerToggle.click()
      bannerRestored = banner?.hidden === false
    }
    const settingsRect = settings?.getBoundingClientRect() ?? null
    return {
      visible: fixedRect.width > 0 && fixedRect.height > 0,
      src: fixed.getAttribute('src'),
      imageLoaded: fixed.naturalWidth > 0,
      rect: [fixedRect.x, fixedRect.y, fixedRect.width, fixedRect.height],
      sidebarPrevented: sidebarEvent === null ? null : sidebarEvent.defaultPrevented,
      sidebarMenuOpened,
      fixedPrevented: fixedEvent.defaultPrevented,
      fixedMenuVisible,
      menuText: menu?.textContent ?? '',
      settingsText: (settings?.textContent ?? '').slice(0, 120),
      settingsVisible: settings?.hidden === false,
      checkboxCount: checkboxes.length,
      checkboxStates: checkboxes.map((box) => ({ checked: box.checked, disabled: box.disabled })),
      animationNames: settings ? [...settings.querySelectorAll('.role-row label span')].map((node) => node.textContent) : [],
      bannerToggleChecked: bannerToggle?.checked ?? null,
      banner: banner === null ? null : {
        visibleBefore: bannerVisibleBefore,
        src: banner.querySelector('img')?.getAttribute('src') ?? null,
        imageLoaded: (banner.querySelector('img')?.naturalWidth ?? 0) > 0,
        rect: [bannerRect.x, bannerRect.y, bannerRect.width, bannerRect.height],
        hiddenAfterToggle: bannerHiddenAfterToggle,
        restoredAfterToggle: bannerRestored,
      },
      centerOffset: settingsRect === null ? null : [
        Math.abs(settingsRect.x + settingsRect.width / 2 - innerWidth / 2),
        Math.abs(settingsRect.y + settingsRect.height / 2 - innerHeight / 2),
      ],
      backdrop: shadow.querySelector('[data-xllh-pet-backdrop], .backdrop, .mask') !== null,
    }
  })
  report.fixedPet = fixedPet
  if (fixedPet.skipped === undefined) {
    if (!fixedPet.visible) failures.push('fixed desktop character is not visible')
    if (Math.abs(fixedPet.rect[2] - 220) > 1 || Math.abs(fixedPet.rect[3] - 220) > 1) {
      failures.push(`fixed character must render at 220x220, got ${fixedPet.rect[2]}x${fixedPet.rect[3]}`)
    }
    if (!fixedPet.imageLoaded) failures.push('fixed character 25-frame GIF did not load')
    if (!String(fixedPet.src).includes('/assets/animated/blue-fat-fish-eating.gif')) failures.push(`fixed character src unexpected: ${fixedPet.src}`)
    if (fixedPet.sidebarPrevented !== false) failures.push('sidebar icon right-click must no longer be intercepted')
    if (fixedPet.sidebarMenuOpened !== false) failures.push('sidebar icon right-click must no longer open the plugin menu')
    if (!fixedPet.fixedPrevented) failures.push('fixed character right-click was not intercepted')
    if (!fixedPet.fixedMenuVisible) failures.push('fixed character right-click menu did not open')
    if (!fixedPet.menuText.includes('设置')) failures.push('fixed character menu misses 设置')
    if (!fixedPet.settingsVisible) failures.push('settings panel did not open from the fixed character menu')
    if (fixedPet.checkboxCount !== 2) failures.push(`settings must expose two selectable animations, got ${fixedPet.checkboxCount}`)
    if (fixedPet.checkboxStates?.[0]?.checked !== true || fixedPet.checkboxStates?.[0]?.disabled !== false) {
      failures.push('working animation must be checked and not locked')
    }
    if (fixedPet.checkboxStates?.[1]?.checked !== false || fixedPet.checkboxStates?.[1]?.disabled !== false) {
      failures.push('tired animation must be selectable and unchecked by default')
    }
    if (!fixedPet.animationNames?.includes('蓝色大肥鱼正在工作')) failures.push('settings misses the working animation name')
    if (!fixedPet.animationNames?.includes('蓝色大肥鱼很累')) failures.push('settings misses the tired animation name')
    if (fixedPet.bannerToggleChecked !== true) failures.push('banner visibility must default to on in settings')
    if (!fixedPet.banner) failures.push('desktop banner element is missing')
    else {
      if (fixedPet.banner.visibleBefore !== true) failures.push('desktop banner must be visible by default')
      if (!String(fixedPet.banner.src).includes('/assets/banner/blue-fat-fish-live-banner.gif')) failures.push(`banner src unexpected: ${fixedPet.banner.src}`)
      if (!fixedPet.banner.imageLoaded) failures.push('desktop banner GIF did not load')
      if (Math.abs(fixedPet.banner.rect[2] - 720) > 2 || Math.abs(fixedPet.banner.rect[3] - 240) > 2) {
        failures.push(`desktop banner default size unexpected: ${fixedPet.banner.rect[2]}x${fixedPet.banner.rect[3]}`)
      }
      if (!fixedPet.banner.hiddenAfterToggle) failures.push('banner toggle did not hide the banner')
      if (!fixedPet.banner.restoredAfterToggle) failures.push('banner toggle did not restore the banner')
    }
    if (fixedPet.centerOffset === null || fixedPet.centerOffset[0] > 1 || fixedPet.centerOffset[1] > 1) {
      failures.push(`settings panel is not centered on the desktop (offset ${fixedPet.centerOffset})`)
    }
    if (fixedPet.backdrop) failures.push('settings panel must not add a backdrop/mask')
    await page.screenshot({ path: shot.replace(/\.png$/, '-settings.png') })
    const closed = await page.evaluate(() => {
      const settings = document.querySelector('[data-xllh-pet-host]')?.shadowRoot?.querySelector('[data-xllh-pet-settings]')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return settings?.hidden === true
    })
    report.settingsClosedByEscape = closed
    if (!closed) failures.push('Escape did not close settings')
  }

  // 6c-b) Banner GIF really animates: two clipped screenshots must differ.
  if (fixedPet.skipped === undefined && fixedPet.banner !== null) {
    const [bx, by, bw, bh] = fixedPet.banner.rect
    const clip = { x: Math.max(0, bx), y: Math.max(0, by), width: Math.max(1, bw), height: Math.max(1, bh) }
    const firstBanner = await page.screenshot({ clip })
    await page.waitForTimeout(320)
    const secondBanner = await page.screenshot({ clip })
    report.bannerAnimated = !firstBanner.equals(secondBanner)
    if (!report.bannerAnimated) failures.push('banner GIF did not change between two screenshots')
  }

  // 6b) No thumbnail/hover two-state: the standard-size node must not scale on pointermove.
  const noHover = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const shadow = document.querySelector('[data-xllh-pet-host]')?.shadowRoot
    const pet = shadow ? [...shadow.querySelectorAll('[data-xllh-pet]')].find((el) => !el.hidden) : null
    if (!pet) return { skipped: 'no visible pet (arbitration/workspace collapsed)' }
    const before = { transform: pet.style.transform, rect: (() => { const r = pet.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })() }
    const r = pet.getBoundingClientRect()
    const event = new MouseEvent('pointermove', { bubbles: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })
    document.body.dispatchEvent(event)
    await sleep(300)
    const after = { transform: pet.style.transform, rect: (() => { const r2 = pet.getBoundingClientRect(); return [r2.x, r2.y, r2.width, r2.height] })() }
    return { before, after, sameNode: pet.isConnected }
  })
  report.noHover = noHover
  if (noHover.skipped === undefined) {
    if (noHover.after.transform !== '') failures.push('pointermove must not add a hover transform to the standard-size animation')
    if (JSON.stringify(noHover.before.rect) !== JSON.stringify(noHover.after.rect)) failures.push('pointermove changed the standard animation geometry')
    if (!noHover.sameNode) failures.push('standard animation node was re-created during pointermove')
  }

  // 6c) three-view preview: centered modal / real image / scroll lock / Escape.
  const preview = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const shadow = document.querySelector('[data-xllh-pet-host]')?.shadowRoot
    if (!shadow) return { skipped: 'no overlay' }
    const fixed = shadow.querySelector('[data-xllh-pet-fixed]')
    if (!fixed) return { skipped: 'fixed character missing' }
    const fixedRect = fixed.getBoundingClientRect()
    fixed.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, composed: true,
      clientX: fixedRect.x + fixedRect.width / 2, clientY: fixedRect.y + fixedRect.height / 2,
    }))
    shadow.querySelector('[data-xllh-pet-menu] button')?.click()
    const settings = shadow.querySelector('[data-xllh-pet-settings]')
    const openButton = settings?.querySelector('[data-xllh-pet-preview-open="blue-fat-fish-working"]')
    if (!openButton) return { skipped: 'three-view entry button missing' }
    const ariaLabel = openButton.getAttribute('aria-label')
    openButton.click()
    await sleep(1000)
    const root = shadow.querySelector('[data-xllh-pet-preview]')
    const dialog = root?.querySelector('[data-xllh-pet-preview-dialog]')
    const dialogRect = dialog?.getBoundingClientRect() ?? null
    const img = root?.querySelector('img')
    const missing = root?.querySelector('[data-xllh-pet-preview-missing]')
    const result = {
      ariaLabel,
      visible: root?.hidden === false,
      role: dialog?.getAttribute('role') ?? null,
      ariaModal: dialog?.getAttribute('aria-modal') ?? null,
      title: dialog?.querySelector('[data-xllh-pet-preview-title]')?.textContent ?? '',
      centered: dialogRect === null ? null : [
        Math.abs(dialogRect.x + dialogRect.width / 2 - innerWidth / 2),
        Math.abs(dialogRect.y + dialogRect.height / 2 - innerHeight / 2),
      ],
      imageVisible: img !== null && img.hidden === false && img.naturalWidth > 0,
      missingVisible: missing !== null && missing.hidden === false,
      missingText: missing?.textContent ?? '',
      scrollLocked: document.documentElement.style.overflow === 'hidden',
      settingsNoBackdrop: shadow.querySelectorAll('.mask, [data-xllh-pet-backdrop]').length === 0,
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    result.closedByEscape = root?.hidden === true
    result.scrollReleased = document.documentElement.style.overflow === ''
    return result
  })
  report.preview = preview
  if (preview.skipped === undefined) {
    if (!preview.visible) failures.push('three-view preview did not open')
    if (preview.role !== 'dialog' || preview.ariaModal !== 'true') failures.push('preview dialog semantics missing')
    if (!preview.title.includes('三视图')) failures.push('preview title misses 三视图')
    if (preview.centered === null || preview.centered[0] > 1 || preview.centered[1] > 1) {
      failures.push(`preview modal is not centered (offset ${preview.centered})`)
    }
    if (!preview.imageVisible && !preview.missingVisible) failures.push('preview shows neither image nor placeholder')
    if (preview.imageVisible && preview.missingVisible) failures.push('preview shows both image and placeholder')
    if (!preview.scrollLocked) failures.push('preview did not lock background scroll')
    if (!preview.settingsNoBackdrop) failures.push('settings panel must stay backdrop-free while preview exists')
    if (!preview.closedByEscape) failures.push('Escape did not close the preview')
    if (!preview.scrollReleased) failures.push('preview did not release the scroll lock')
  }

  // 6c-2) copy image (only exercisable when a real three-view asset is present).
  if (preview.skipped === undefined && preview.imageVisible === true) {
    const copy = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const shadow = document.querySelector('[data-xllh-pet-host]').shadowRoot
      let settings = shadow.querySelector('[data-xllh-pet-settings]')
      let openButton = settings?.querySelector('[data-xllh-pet-preview-open="blue-fat-fish-working"]')
      // Reopen through the fixed character menu when the settings panel was closed
      // by the previous gesture.
      if (openButton === undefined || settings?.hidden !== false) {
        const fixed = shadow.querySelector('[data-xllh-pet-fixed]')
        if (!fixed) return { error: 'fixed character missing to reopen the preview' }
        const fixedRect = fixed.getBoundingClientRect()
        fixed.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, composed: true,
          clientX: fixedRect.x + fixedRect.width / 2, clientY: fixedRect.y + fixedRect.height / 2,
        }))
        shadow.querySelector('[data-xllh-pet-menu] button')?.click()
        settings = shadow.querySelector('[data-xllh-pet-settings]')
        openButton = settings?.querySelector('[data-xllh-pet-preview-open="blue-fat-fish-working"]')
      }
      if (openButton === undefined) return { error: 'three-view entry button missing' }
      openButton.click()
      await sleep(1200)
      const root = shadow.querySelector('[data-xllh-pet-preview]')
      const img = root?.querySelector('img')
      const imgRect = img?.getBoundingClientRect() ?? null
      if (imgRect === null) return { error: 'preview image missing' }
      img.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, composed: true,
        clientX: imgRect.x + 10, clientY: imgRect.y + 10,
      }))
      const menu = shadow.querySelector('[data-xllh-pet-preview-menu]')
      const menuVisible = menu?.hidden === false
      menu?.querySelector('[data-xllh-pet-preview-copy]')?.click()
      await sleep(1200)
      const status = root.querySelector('[role="status"]')?.textContent ?? ''
      let clipboardTypes = null
      let clipboardSize = null
      try {
        const items = await navigator.clipboard.read()
        clipboardTypes = [...new Set(items.flatMap((item) => item.types))]
        const pngItem = items.find((item) => item.types.includes('image/png'))
        if (pngItem !== undefined) clipboardSize = (await pngItem.getType('image/png')).size
      } catch (error) {
        clipboardTypes = [`error:${String(error?.name ?? error)}`]
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return { menuVisible, status, clipboardTypes, clipboardSize, closed: root.hidden === true }
    })
    report.copy = copy
    if (copy.error !== undefined) failures.push(`copy check failed: ${copy.error}`)
    else {
      if (!copy.menuVisible) failures.push('preview image right-click menu did not open')
      if (!copy.status.includes('已复制')) failures.push(`copy did not report success: ${copy.status}`)
      if (!Array.isArray(copy.clipboardTypes) || !copy.clipboardTypes.includes('image/png')) {
        failures.push(`clipboard does not contain image/png: ${JSON.stringify(copy.clipboardTypes)}`)
      }
      if (!(copy.clipboardSize > 0)) failures.push('clipboard PNG blob is empty')
      if (!copy.closed) failures.push('preview did not close after the copy check')
    }
    await page.waitForTimeout(200)
  }

  // 6d) asset routes: real three-view image + fixed character 25-frame GIF.
  const routes = await page.evaluate(async ({ threeView, animated, banner }) => {
    const load = async (url) => {
      const response = await fetch(url, { credentials: 'include' })
      return { status: response.status, type: response.headers.get('content-type') ?? '' }
    }
    return {
      threeView: await load(threeView + 'blue-fat-fish-working.png'),
      animated: await load(animated + 'blue-fat-fish-eating.gif'),
      banner: await load(banner + 'blue-fat-fish-live-banner.gif'),
    }
  }, { threeView: THREE_VIEW_ROUTE, animated: ANIMATED_ROUTE, banner: BANNER_ROUTE })
  report.routes = routes
  if (routes.threeView.status !== 200 || !routes.threeView.type.startsWith('image/')) {
    failures.push(`three-view route unexpected response: ${JSON.stringify(routes.threeView)}`)
  }
  if (routes.animated.status !== 200 || routes.animated.type !== 'image/gif') {
    failures.push(`fixed character GIF route unexpected response: ${JSON.stringify(routes.animated)} (host restart needed?)`)
  }
  if (routes.banner.status !== 200 || routes.banner.type !== 'image/gif') {
    failures.push(`banner route unexpected response: ${JSON.stringify(routes.banner)} (host restart needed?)`)
  }

  // 6e) Ctrl+Shift+F12 toggles the whole overlay and persists the preference.
  const shortcut = await page.evaluate(() => {
    const host = document.querySelector('[data-xllh-pet-host]')
    const storageKey = 'dsh-anime-desktop-pet/overlay-visible'
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
      })
      document.body.dispatchEvent(event)
      return { prevented: event.defaultPrevented, display: host.style.display, stored: localStorage.getItem(storageKey) }
    }
    const hidden = press()
    const shown = press()
    return { hidden, shown }
  })
  report.shortcut = shortcut
  if (!shortcut.hidden.prevented || shortcut.hidden.display !== 'none') failures.push('Ctrl+Shift+F12 did not hide the overlay')
  if (shortcut.hidden.stored !== 'false') failures.push(`hidden state was not persisted: ${shortcut.hidden.stored}`)
  if (!shortcut.shown.prevented || shortcut.shown.display !== '') failures.push('Ctrl+Shift+F12 did not restore the overlay')
  if (shortcut.shown.stored !== 'true') failures.push(`visible state was not persisted: ${shortcut.shown.stored}`)

  await page.screenshot({ path: shot })
  report.pageErrors = pageErrors
  if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.slice(0, 2).join(' | ')}`)
} finally {
  await browser.close()
}

report.screenshot = shot
report.failures = failures
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exit(1)
