/**
 * dsh-anime-desktop-pet — host half.
 *
 * Serves the packaged animation GIF plus per-character three-view reference
 * images from the built package directory, so the client overlay references
 * real same-origin routes instead of inline data URLs.
 */

import { readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin id shared by the client bundle, the profile row and the asset route. */
export const name = 'dsh-anime-desktop-pet'

/** Host service needed to claim the asset routes. */
export const inject = ['webServer']

/** Public route the client overlay loads the GIF from (keep in sync with core.mjs). */
export const GIF_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/blue-fat-fish-working.gif'

/** Prefix route for per-character three-view reference images (core.mjs threeView paths). */
export const THREE_VIEW_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/three-view/'

/** Prefix route for additional packaged animation GIFs (fixed desktop character). */
export const ANIMATED_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/animated/'

/** Prefix route for the transparent desktop live banner. */
export const BANNER_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/banner/'

/** Prefix route for the live-room scene (manifest/layout + @1x/@2x slices). */
export const SCENE_ROUTE = '/@dsh-external/dsh-anime-desktop-pet/assets/scene/'

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const SCENE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

const GIF_FILE = fileURLToPath(new URL('../assets/blue-fat-fish-working.gif', import.meta.url))
const THREE_VIEW_DIR = fileURLToPath(new URL('../assets/three-view/', import.meta.url))
const ANIMATED_DIR = fileURLToPath(new URL('../assets/animated/', import.meta.url))
const BANNER_DIR = fileURLToPath(new URL('../assets/banner/', import.meta.url))
const SCENE_DIR = fileURLToPath(new URL('../assets/slices/', import.meta.url))

/**
 * Resolve one safe flat image request under a route prefix. Traversal, nested
 * paths and non-image extensions return null; the resolved file must stay inside
 * the configured directory.
 */
export function resolveImageAsset(
  directory: string,
  urlPath: unknown,
  routePrefix: string,
): { file: string; contentType: string } | null {
  if (typeof directory !== 'string' || directory === '' || typeof urlPath !== 'string') return null
  if (typeof routePrefix !== 'string' || routePrefix === '') return null
  if (!urlPath.startsWith(routePrefix)) return null
  const relative = urlPath.slice(routePrefix.length)
  if (relative === '' || relative.includes('/') || relative.includes('\\') || relative.includes('..')) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(relative)) return null
  const contentType = IMAGE_CONTENT_TYPES[extname(relative).toLowerCase()]
  if (contentType === undefined) return null
  const base = resolve(directory)
  const file = resolve(base, relative)
  if (!file.startsWith(base + sep)) return null
  return { file, contentType }
}

/** Resolve a three-view image request. */
export function resolveThreeViewAsset(directory: string, urlPath: unknown) {
  return resolveImageAsset(directory, urlPath, THREE_VIEW_ROUTE)
}

/** Resolve an additional animation image request (fixed character GIF). */
export function resolveAnimatedAsset(directory: string, urlPath: unknown) {
  return resolveImageAsset(directory, urlPath, ANIMATED_ROUTE)
}

/** Resolve the desktop live banner image request (transparent PNG now, animated asset later). */
export function resolveBannerAsset(directory: string, urlPath: unknown) {
  return resolveImageAsset(directory, urlPath, BANNER_ROUTE)
}

/**
 * Resolve scene data: either manifest/layout JSON or one nested @1x/@2x PNG.
 * Traversal, arbitrary nested paths and other extensions are rejected.
 */
export function resolveSceneAsset(
  directory: string,
  urlPath: unknown,
): { file: string; contentType: string } | null {
  if (typeof directory !== 'string' || directory === '' || typeof urlPath !== 'string') return null
  if (!urlPath.startsWith(SCENE_ROUTE)) return null
  const relative = urlPath.slice(SCENE_ROUTE.length)
  if (relative === '' || relative.includes('\\') || relative.includes('..') || relative.startsWith('/')) return null
  const allowed = /^(manifest|layout)\.json$/.test(relative) || /^@(1|2)x\/[A-Za-z0-9][A-Za-z0-9._@-]*\.png$/.test(relative)
  if (!allowed) return null
  const contentType = SCENE_CONTENT_TYPES[extname(relative).toLowerCase()]
  if (contentType === undefined) return null
  const base = resolve(directory)
  const file = resolve(base, relative)
  if (!file.startsWith(base + sep)) return null
  return { file, contentType }
}

/** Handler for the scene prefix route. */
export function createSceneHandler(directory: string) {
  return (req: any, res: any): void => {
    const method = req?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      return
    }
    const urlPath = String(req?.url ?? '').split('?')[0]
    const asset = resolveSceneAsset(directory, urlPath)
    if (asset === null) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    let body: Buffer
    try {
      body = readFileSync(asset.file)
    } catch {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    res.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': String(body.length),
      'cache-control': 'public, max-age=300',
    })
    res.end(method === 'HEAD' ? undefined : body)
  }
}

/** Handler for one image prefix route; missing files read as 404, not as crashes. */
export function createImageHandler(directory: string, routePrefix: string) {
  return (req: any, res: any): void => {
    const method = req?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
      return
    }
    const urlPath = String(req?.url ?? '').split('?')[0]
    const asset = resolveImageAsset(directory, urlPath, routePrefix)
    if (asset === null) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    let body: Buffer
    try {
      body = readFileSync(asset.file)
    } catch {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
      return
    }
    res.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': String(body.length),
      'cache-control': 'public, max-age=300',
    })
    res.end(method === 'HEAD' ? undefined : body)
  }
}

/** Handler for the three-view prefix route. */
export function createThreeViewHandler(directory: string) {
  return createImageHandler(directory, THREE_VIEW_ROUTE)
}

/** Handler for the additional-animation prefix route. */
export function createAnimatedHandler(directory: string) {
  return createImageHandler(directory, ANIMATED_ROUTE)
}

/** Handler for the desktop live banner prefix route. */
export function createBannerHandler(directory: string) {
  return createImageHandler(directory, BANNER_ROUTE)
}

/**
 * Register the asset routes; a missing asset or webServer degrades to no route.
 * @param ctx Cordis host context (typed loosely: external plugin, no DSH dependency).
 */
export function apply(ctx: any): void {
  const webServer = ctx?.get?.('webServer') ?? ctx?.webServer
  if (typeof webServer?.register !== 'function') return
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: GIF_ROUTE,
    handler: (req: any, res: any) => {
      const method = req?.method ?? 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      // Read per request: retuning the GIF does not need a host restart, and the
      // file is served once per browser cache lifetime (immutable + version query).
      let body: Buffer
      try {
        body = readFileSync(GIF_FILE)
      } catch (error) {
        ctx?.logger?.warn?.('dsh-anime-desktop-pet: animation asset missing', error)
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'animation asset missing' }))
        return
      }
      res.writeHead(200, {
        'content-type': 'image/gif',
        'content-length': String(body.length),
        'cache-control': 'public, max-age=31536000, immutable',
      })
      res.end(method === 'HEAD' ? undefined : body)
    },
  }), 'dsh-anime-desktop-pet: gif asset')
  ctx.effect(
    () => webServer.register({
      kind: 'prefix',
      path: THREE_VIEW_ROUTE.slice(0, -1),
      handler: createThreeViewHandler(THREE_VIEW_DIR),
    }),
    'dsh-anime-desktop-pet: three-view assets',
  )
  ctx.effect(
    () => webServer.register({
      kind: 'prefix',
      path: ANIMATED_ROUTE.slice(0, -1),
      handler: createAnimatedHandler(ANIMATED_DIR),
    }),
    'dsh-anime-desktop-pet: additional animations',
  )
  ctx.effect(
    () => webServer.register({
      kind: 'prefix',
      path: BANNER_ROUTE.slice(0, -1),
      handler: createBannerHandler(BANNER_DIR),
    }),
    'dsh-anime-desktop-pet: desktop banner',
  )
  ctx.effect(
    () => webServer.register({
      kind: 'prefix',
      path: SCENE_ROUTE.slice(0, -1),
      handler: createSceneHandler(SCENE_DIR),
    }),
    'dsh-anime-desktop-pet: live scene assets',
  )
}
