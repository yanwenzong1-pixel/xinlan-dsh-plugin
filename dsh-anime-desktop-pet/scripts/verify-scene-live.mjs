#!/usr/bin/env node
/**
 * Live acceptance for the live-room scene + restored legacy banner/fixed entry.
 * Preconditions: DSH_CHECKOUT, DSH_HOME (staging-url.txt in its parent).
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const checkout = process.env.DSH_CHECKOUT
const home = process.env.DSH_HOME
if (!checkout || !home) {
  console.error('need DSH_CHECKOUT and DSH_HOME env vars')
  process.exit(2)
}
const authUrlFile = resolve(home, '..', 'staging-url.txt')
if (!existsSync(authUrlFile)) {
  console.error(`missing authenticated URL: ${authUrlFile}`)
  process.exit(2)
}
const authUrl = readFileSync(authUrlFile, 'utf8').trim()
const require = createRequire(join(checkout, 'apps', 'web', 'package.json'))
const { chromium } = require('playwright')
const shot = process.env.DSH_VERIFY_PNG ?? join(process.env.TEMP ?? '.', 'anime-pet-scene-live.png')
mkdirSync(dirname(shot), { recursive: true })

const failures = []
const report = {}
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.addInitScript(() => {
  window.__DSH_ANIME_PET_OPTIONS__ = { ...(window.__DSH_ANIME_PET_OPTIONS__ ?? {}), scene: true }
  window.__DSH_ANIME_PET_SCENE_OPTIONS__ = { ...(window.__DSH_ANIME_PET_SCENE_OPTIONS__ ?? {}), enabled: true, seed: 20261026 }
  localStorage.setItem('dsh-anime-desktop-pet/fixed-position', JSON.stringify({ x: 40, y: 740 }))
  localStorage.setItem('dsh-anime-desktop-pet/banner-visible', 'true')
  localStorage.setItem('dsh-anime-desktop-pet/overlay-visible-v2', 'true')
})

async function sceneState() {
  return page.evaluate(() => {
    const host = document.querySelector('[data-xllh-scene-host]')
    const shadow = host?.shadowRoot
    const stage = shadow?.querySelector('.scene-stage')
    const elements = [...(shadow?.querySelectorAll('.scene-element') ?? [])]
    const images = [...(shadow?.querySelectorAll('.scene-element img') ?? [])]
    const overlayHost = document.querySelector('[data-xllh-pet-host]')
    const overlayShadow = overlayHost?.shadowRoot
    const oldBanner = overlayShadow?.querySelector('[data-xllh-banner]')
    const oldFixed = overlayShadow?.querySelector('[data-xllh-pet-fixed]')
    const rect = (node) => {
      const bounds = node.getBoundingClientRect()
      return [Math.round(bounds.x), Math.round(bounds.y), Math.round(bounds.width), Math.round(bounds.height)]
    }
    const imageLoaded = (image) => Boolean(image && image.complete && image.naturalWidth > 0)
    return {
      hasHost: Boolean(host),
      hidden: host?.style.display === 'none',
      ready: stage?.dataset.ready === 'true',
      paused: stage?.dataset.paused === 'true',
      oldOverlay: Boolean(overlayHost),
      oldOverlayHidden: overlayHost?.style.display === 'none',
      oldBanner: oldBanner ? { rect: rect(oldBanner), loaded: imageLoaded(oldBanner.querySelector('img')), resize: Boolean(oldBanner.querySelector('[data-xllh-banner-resize]')) } : null,
      oldFixed: oldFixed ? { rect: rect(oldFixed), loaded: imageLoaded(oldFixed) } : null,
      elementCount: elements.length,
      imageCount: images.length,
      loadedImages: images.filter(imageLoaded).length,
      interactive: elements.filter((element) => element.dataset.interactive === 'true').length,
      draggable: elements.filter((element) => element.dataset.draggable === 'true').length,
      ongoing: document.querySelectorAll('[data-state="ongoing"]').length,
      rowAnimationNodes: overlayShadow?.querySelectorAll('[data-xllh-pet]').length ?? 0,
      girlImages: images.filter((image) => image.src.includes('pet-girl-main')).length,
      sceneBanner: images.filter((image) => image.src.includes('ui-banner-main')).length,
      liveBadge: (() => {
        const badge = shadow?.querySelector('[data-element-id="badge-live"]')
        return badge ? { rect: rect(badge), display: getComputedStyle(badge).display } : null
      })(),
      bottomStrip: (() => {
        const strip = shadow?.querySelector('[data-element-id="bottom-strip"]')
        const image = strip?.querySelector('img')
        if (!strip) return null
        const bounds = strip.getBoundingClientRect()
        return { rect: rect(strip), loaded: imageLoaded(image), bottom: Math.round(bounds.bottom), right: Math.round(bounds.right), width: Math.round(bounds.width) }
      })(),
      emitterParticles: shadow?.querySelectorAll('.scene-particle').length ?? 0,
      bottomEmitterParticles: (() => {
        const list = [...(shadow?.querySelectorAll('.scene-particle') ?? [])]
        return list.filter((particle) => {
          const bounds = particle.getBoundingClientRect()
          return bounds.x > window.innerWidth * 0.55 && bounds.y > window.innerHeight * 0.45
        }).length
      })(),
      bubbleAssets: [...(shadow?.querySelectorAll('.scene-bubble img') ?? [])].map((image) => String(image.src)),
      emitterAssets: [...(shadow?.querySelectorAll('.scene-particle img') ?? [])].map((image) => String(image.src)),
      scenePositions: localStorage.getItem('dsh-anime-desktop-pet/scene-positions'),
      viewport: [window.innerWidth, window.innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
}

try {
  await page.goto(authUrl, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(5500)
  const initial = await sceneState()
  report.initial = initial
  if (!initial.hasHost) failures.push('scene host missing')
  if (initial.hidden) failures.push('scene starts hidden unexpectedly')
  if (!initial.ready) failures.push('scene stage never became ready')
  if (!initial.oldOverlay) failures.push('legacy overlay host missing; banner/fixed entry not restored')
  if (!initial.oldBanner || !initial.oldBanner.loaded || !initial.oldBanner.resize) failures.push('original movable banner is not restored')
  if (!initial.oldFixed || !initial.oldFixed.loaded) failures.push('original fixed GIF entry is not restored')
  if (initial.oldFixed && Math.abs(initial.oldFixed.rect[2] - 220) > 1) failures.push(`fixed entry must stay 220px, got ${initial.oldFixed.rect[2]}`)
  if (initial.oldFixed && (initial.oldFixed.rect[0] > 120)) failures.push(`persisted fixed entry position not honored: x=${initial.oldFixed.rect[0]}`)
  if (initial.elementCount < 18) failures.push(`scene rendered too few elements: ${initial.elementCount}`)
  if (initial.loadedImages !== initial.imageCount) failures.push(`scene images failed to load: ${initial.loadedImages}/${initial.imageCount}`)
  if (initial.interactive !== 0) failures.push(`girl interactions must be removed, got ${initial.interactive}`)
  if (initial.draggable !== 10) failures.push(`expected 10 movable labels/fish, got ${initial.draggable}`)
  if (initial.girlImages !== 0) failures.push('scene must not render the two girl pets')
  if (initial.sceneBanner !== 0) failures.push('fixed scene banner must be removed now that the draggable banner is back')
  if (!initial.bottomStrip || !initial.bottomStrip.loaded) failures.push('bottom book/ribbon strip is missing or not loaded')
  if (initial.bottomStrip && Math.abs(initial.bottomStrip.bottom - initial.viewport[1]) > 2) failures.push(`bottom strip is not anchored to the bottom: ${initial.bottomStrip.bottom}/${initial.viewport[1]}`)
  if (initial.bottomStrip && Math.abs(initial.bottomStrip.right - initial.viewport[0]) > 2) failures.push(`bottom strip is not anchored to the right: ${initial.bottomStrip.right}/${initial.viewport[0]}`)
  if (initial.bottomStrip && (initial.bottomStrip.width < 400 || initial.bottomStrip.width > 700)) failures.push(`bottom strip lost its original size: ${initial.bottomStrip.width}px`)
  if (initial.bottomStrip && initial.bottomStrip.width >= initial.viewport[0]) failures.push('bottom strip is stretched to the full viewport width')
  if (initial.emitterParticles < 1) failures.push('left plaque rising star/bubble particles are not running')
  if (initial.bottomEmitterParticles < 1) failures.push('bottom-right book/ribbon stars/ribbons/bubbles are not animated')
  if (initial.bubbleAssets.length < 1) failures.push('center rising bubbles are not running')
  if (initial.bubbleAssets.some((src) => !src.includes('fx-bubble-large@2x.png'))) failures.push(`rising bubbles must use the large @2x bubble asset: ${JSON.stringify(initial.bubbleAssets.slice(0, 3))}`)
  if (initial.emitterAssets.some((src) => src.includes('fx-sprinkle-005'))) failures.push('left particles still use the old tiny bubble assets')
  if (initial.ongoing > 0 && initial.rowAnimationNodes === 0) failures.push('running-row animations were not restored in scene mode')
  if (initial.scrollWidth > initial.viewport[0]) failures.push('scene introduced horizontal page overflow')

  // Restored settings must expose exactly the two animation switches.
  const fixedCenter = initial.oldFixed ? [initial.oldFixed.rect[0] + initial.oldFixed.rect[2] / 2, initial.oldFixed.rect[1] + initial.oldFixed.rect[3] / 2] : null
  let settingsPanel = null
  if (fixedCenter) {
    await page.mouse.click(fixedCenter[0], fixedCenter[1], { button: 'right' })
    await page.waitForTimeout(150)
    const settingsButton = await page.evaluate(() => {
      const shadow = document.querySelector('[data-xllh-pet-host]')?.shadowRoot
      const button = [...(shadow?.querySelectorAll('[data-xllh-pet-menu] button') ?? [])].find((item) => item.textContent.includes('设置'))
      if (!button) return null
      const rect = button.getBoundingClientRect()
      return [rect.x + rect.width / 2, rect.y + rect.height / 2]
    })
    if (settingsButton) {
      await page.mouse.click(settingsButton[0], settingsButton[1])
      await page.waitForTimeout(150)
      settingsPanel = await page.evaluate(() => {
        const shadow = document.querySelector('[data-xllh-pet-host]')?.shadowRoot
        const dialog = shadow?.querySelector('[data-xllh-pet-settings]')
        const boxes = [...(dialog?.querySelectorAll('.role-row input[type="checkbox"]') ?? [])]
        return {
          open: dialog ? !dialog.hidden : false,
          switches: boxes.length,
          labels: [...(dialog?.querySelectorAll('.role-row') ?? [])].map((row) => row.textContent.trim().slice(0, 40)),
          bannerToggle: Boolean(dialog?.querySelector('[data-xllh-banner-toggle]')),
        }
      })
      await page.keyboard.press('Escape')
    }
    report.settings = settingsPanel
    if (!settingsPanel || !settingsPanel.open || settingsPanel.switches !== 2) failures.push('two animation switches are not available in settings')
    if (!settingsPanel || !settingsPanel.bannerToggle) failures.push('banner visibility switch is missing')
  }
  await page.evaluate(() => { for (const el of document.querySelectorAll('.aia-mask, .aia-root, [data-shell-overlay]')) el.style.display = 'none' })
  const firstShot = await page.screenshot({ path: shot })
  await page.waitForTimeout(420)
  const secondShot = await page.screenshot()
  report.animated = !firstShot.equals(secondShot)
  if (!report.animated) failures.push('scene did not animate between two screenshots')

  // Original banner can still be dragged in scene mode.
  const bannerBefore = await page.evaluate(() => {
    const banner = document.querySelector('[data-xllh-pet-host]')?.shadowRoot?.querySelector('[data-xllh-banner]')
    const r = banner.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + Math.min(60, r.height / 2), left: r.x, top: r.y }
  })
  await page.mouse.move(bannerBefore.x, bannerBefore.y)
  await page.mouse.down()
  await page.mouse.move(bannerBefore.x + 36, bannerBefore.y + 18, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const bannerAfter = await page.evaluate(() => {
    const banner = document.querySelector('[data-xllh-pet-host]')?.shadowRoot?.querySelector('[data-xllh-banner]')
    const r = banner.getBoundingClientRect()
    return { left: r.x, top: r.y }
  })
  report.oldBannerDrag = { before: bannerBefore, after: bannerAfter }
  if (Math.abs(bannerAfter.left - bannerBefore.left) < 12) failures.push('original banner did not move with the mouse')

  // The bottom-right handle must still resize the restored banner proportionally.
  const resizeBefore = await page.evaluate(() => {
    const banner = document.querySelector('[data-xllh-pet-host]')?.shadowRoot?.querySelector('[data-xllh-banner]')
    const handle = banner.querySelector('[data-xllh-banner-resize]')
    const bannerRect = banner.getBoundingClientRect()
    const handleRect = handle.getBoundingClientRect()
    return { width: bannerRect.width, height: bannerRect.height, x: handleRect.x + handleRect.width / 2, y: handleRect.y + handleRect.height / 2 }
  })
  await page.mouse.move(resizeBefore.x, resizeBefore.y)
  await page.mouse.down()
  await page.mouse.move(resizeBefore.x + 80, resizeBefore.y + 30, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const resizeAfter = await page.evaluate(() => {
    const banner = document.querySelector('[data-xllh-pet-host]')?.shadowRoot?.querySelector('[data-xllh-banner]')
    const rect = banner.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  report.oldBannerResize = { before: resizeBefore, after: resizeAfter }
  if (resizeAfter.width < resizeBefore.width + 20) failures.push('original banner resize handle no longer changes its width')
  if (Math.abs(resizeAfter.height / resizeAfter.width - resizeBefore.height / resizeBefore.width) > 0.02) failures.push('original banner resize is no longer proportional')

  // Drag a text label; its normalized position must survive reload.
  const dragResult = await page.evaluate(async () => {
    const shadow = document.querySelector('[data-xllh-scene-host]')?.shadowRoot
    const badge = shadow.querySelector('[data-element-id="badge-live"]')
    const rect = badge.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    const fire = (type, clientX, clientY) => badge.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, pointerId: 1 }))
    fire('pointerdown', x, y)
    fire('pointermove', x + 70, y + 40)
    fire('pointerup', x + 70, y + 40)
    await new Promise((resolve) => setTimeout(resolve, 100))
    return {
      stored: JSON.parse(localStorage.getItem('dsh-anime-desktop-pet/scene-positions') ?? '{}'),
      style: { x: badge.style.getPropertyValue('--x'), y: badge.style.getPropertyValue('--y') },
    }
  })
  report.dragLabel = dragResult
  if (!dragResult.stored['badge-live']) failures.push('LIVE label position was not persisted')

  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(5000)
  const afterReload = await sceneState()
  report.afterReload = afterReload
  if (!afterReload.hasHost || !afterReload.ready) failures.push('scene failed to remount after reload')
  if (!afterReload.oldBanner || !afterReload.oldFixed) failures.push('banner/fixed entry lost after reload')
  if (afterReload.draggable !== 10) failures.push(`movable elements lost after reload: ${afterReload.draggable}`)
  if (!afterReload.scenePositions || !JSON.parse(afterReload.scenePositions)['badge-live']) failures.push('dragged label position did not survive F5')

  // Coarse frame pacing evidence; headless timing is not a hardware benchmark.
  report.performance = await page.evaluate(() => new Promise((resolve) => {
    const frames = []
    let last = performance.now()
    const step = (now) => {
      frames.push(now - last)
      last = now
      if (frames.length < 90) requestAnimationFrame(step)
      else {
        const sorted = [...frames].sort((a, b) => a - b)
        const avg = frames.reduce((sum, value) => sum + value, 0) / frames.length
        resolve({ fps: Math.round(1000 / avg * 10) / 10, p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(sorted[sorted.length - 1] * 10) / 10 })
      }
    }
    requestAnimationFrame(step)
  }))

  // Responsive scene at 1280/1024/768/375 (banner/fixed entry remain usable).
  report.responsive = {}
  for (const width of [1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await page.waitForTimeout(260)
    const state = await sceneState()
    report.responsive[width] = state
    if (state.scrollWidth > state.viewport[0]) failures.push(`horizontal overflow at ${width}px`)
    if (!state.ready) failures.push(`scene not ready at ${width}px`)
    if (!state.liveBadge || state.liveBadge.display === 'none') failures.push(`LIVE label missing at ${width}px`)
    if (width < 768 && state.elementCount < 10) failures.push(`scene lost core elements at ${width}px`)
  }
  await page.setViewportSize({ width: 1680, height: 1000 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot.replace(/\.png$/, '-wide.png') })

  // Persisted hide must cover both scene and restored legacy hosts.
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })
  const hiddenState = await page.evaluate(() => ({
    storage: localStorage.getItem('dsh-anime-desktop-pet/overlay-visible-v2'),
    sceneHidden: document.querySelector('[data-xllh-scene-host]')?.style.display === 'none',
    overlayHidden: document.querySelector('[data-xllh-pet-host]')?.style.display === 'none',
  }))
  report.hiddenState = hiddenState
  if (hiddenState.storage !== 'false' || !hiddenState.sceneHidden || !hiddenState.overlayHidden) failures.push('hide shortcut did not cover both scene and restored hosts')
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(4800)
  const afterHiddenReload = await page.evaluate(() => ({
    sceneHidden: document.querySelector('[data-xllh-scene-host]')?.style.display === 'none',
    overlayHidden: document.querySelector('[data-xllh-pet-host]')?.style.display === 'none',
  }))
  report.afterHiddenReload = afterHiddenReload
  if (!afterHiddenReload.sceneHidden || !afterHiddenReload.overlayHidden) failures.push('F5 did not keep both restored layers hidden')
  await page.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })

  // Reduced motion is a fresh context.
  const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'zh-CN' })
  const reducedPage = await reducedContext.newPage()
  await reducedPage.goto(authUrl, { waitUntil: 'load', timeout: 30000 })
  await reducedPage.waitForTimeout(4200)
  report.reduced = await reducedPage.evaluate(() => {
    const stage = document.querySelector('[data-xllh-scene-host]')?.shadowRoot?.querySelector('.scene-stage')
    return { paused: stage?.dataset.paused === 'true' }
  })
  if (!report.reduced.paused) failures.push('reduced-motion must pause scene loops')
  await reducedContext.close()

  report.pageErrors = pageErrors.slice(0, 5)
  if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`)
} finally {
  await browser.close()
}

report.failures = failures
console.log(JSON.stringify(report, null, 1))
if (failures.length > 0) process.exit(1)
