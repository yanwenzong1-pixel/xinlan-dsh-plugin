/**
 * @dsh-external/dsh-anime-desktop-pet — client half.
 *
 * Material-driven live-room scene is the default UI. It is rendered entirely
 * from assets/slices + layout.json by scene.mjs. The previous overlay (running
 * row animations / fixed character / live banner) remains available as an
 * explicit fallback when the scene fails to load or scene mode is disabled.
 */

import { mountOverlay } from './overlay.mjs'
import { mountScene } from './scene.mjs'
import { contextUsagePercent } from './core.mjs'

/** Required client service: the session list/projections store. */
export const inject = ['sessions']

/** Defaults; runtime override: window.__DSH_ANIME_PET_OPTIONS__ = { sizePx, gapPx, edgePx }. */
const OVERLAY_OPTIONS = { sizePx: 64, gapPx: 6, edgePx: 4, zIndex: 2147483045 }

/** Extract sessionId -> running summary + bounded context percent from one SessionListState. */
function runningMap(snapshot) {
  const running = new Map()
  if (snapshot === null || typeof snapshot !== 'object') return running
  const byId = snapshot.byId
  if (byId === null || typeof byId !== 'object') return running
  const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(byId)
  for (const id of ids) {
    const row = byId[id]
    if (!row || row.running !== true) continue
    const pressure = snapshot.projectionsBySession?.[id]?.values?.contextPressure
    running.set(String(id), { ...row, contextPercent: contextUsagePercent(pressure) })
  }
  return running
}

function mountLegacy(ctx, overlayOptions) {
  const overlay = mountOverlay(overlayOptions)
  const list = ctx?.get?.('sessions')?.list
  if (overlayOptions.runningAnimations === false
    || typeof list?.subscribe !== 'function'
    || typeof list.getSnapshot !== 'function') {
    return { dispose: () => overlay.dispose() }
  }
  const sync = () => { overlay.update(runningMap(list.getSnapshot())) }
  sync()
  const stop = list.subscribe(sync)
  return {
    dispose() {
      try {
        stop?.()
      } finally {
        overlay.dispose()
      }
    },
  }
}

/** Legacy overlay is restored above the scene for the banner, fixed entry and row animations. */
const RESTORE_OPTIONS = {
  zIndex: 2147483052,
}

/**
 * Mount the live-room scene (default) or the legacy overlay.
 * @param {object} ctx Cordis client context with the `sessions` service.
 */
export function apply(ctx) {
  const globalOptions = globalThis.__DSH_ANIME_PET_OPTIONS__ ?? {}
  const sceneOptions = {
    ...(globalThis.__DSH_ANIME_PET_SCENE_OPTIONS__ ?? {}),
    ...(globalOptions.sceneOptions ?? {}),
  }
  const sceneEnabled = sceneOptions.enabled !== false && globalOptions.scene !== false
  let scene = null
  let legacy = null
  let disposed = false

  if (sceneEnabled && typeof globalThis.document?.createElement === 'function' && globalThis.window) {
    try {
      scene = mountScene({
        document: globalThis.document,
        window: globalThis.window,
        options: sceneOptions,
      })
    } catch {
      scene = null
    }
    if (scene === null) {
      legacy = mountLegacy(ctx, { ...OVERLAY_OPTIONS, ...globalOptions })
    } else {
      // Scene replaces the old row animations but keeps the user's own movable
      // banner and fixed desktop entry alive above it.
      legacy = mountLegacy(ctx, { ...OVERLAY_OPTIONS, ...globalOptions, ...RESTORE_OPTIONS })
      scene.ready.catch((error) => {
        if (disposed) return
        // Invalid/missing scene assets must never leave the user without a pet.
        // Warn once per mount and fall back to the full legacy overlay.
        try {
          globalThis.console?.warn?.('[dsh-anime-desktop-pet] live scene unavailable; using legacy overlay:', error?.message ?? error)
        } catch { /* noop */ }
        try { scene?.dispose() } catch { /* noop */ }
        try { legacy?.dispose() } catch { /* noop */ }
        scene = null
        legacy = mountLegacy(ctx, { ...OVERLAY_OPTIONS, ...globalOptions })
      })
    }
  } else {
    legacy = mountLegacy(ctx, { ...OVERLAY_OPTIONS, ...globalOptions })
  }

  const cleanup = () => {
    if (disposed) return
    disposed = true
    try {
      legacy?.dispose()
    } finally {
      try { scene?.dispose() } catch { /* noop */ }
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => cleanup, 'dsh-anime-desktop-pet: scene or overlay')
  else return cleanup
}
