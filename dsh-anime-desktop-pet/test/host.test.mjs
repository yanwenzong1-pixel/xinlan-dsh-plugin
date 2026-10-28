/**
 * Host half: exact HTTP route serving the packaged GIF for the client overlay.
 * The route resolves the asset from the built package directory (lib/../assets).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const built = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
const GIF = readFileSync(join(root, 'assets', 'blue-fat-fish-working.gif'))
const BANNER = readFileSync(join(root, 'assets', 'banner', 'blue-fat-fish-live-banner.gif'))

function bench() {
  const routes = []
  const effects = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect: (callback) => { effects.push(callback()) },
    get: (name) => (name === 'webServer' ? ctx.webServer : ctx.credentials),
    webServer: {
      register: (route) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    },
    credentials: undefined,
  }
  built.apply(ctx)
  return { ctx, routes, effects }
}

function callRoute(route, method = 'GET', url = route.path) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers = {}) { this.status = status; this.headers = headers },
      end(body) { resolve({ status: this.status, headers: this.headers, body: body === undefined ? 'HEAD' : body }) },
    }
    route.handler({ method, url }, res)
  })
}

function callHandler(handler, { method = 'GET', url }) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers = {}) { this.status = status; this.headers = headers },
      end(body) { resolve({ status: this.status, headers: this.headers, body: body === undefined ? 'HEAD' : body }) },
    }
    handler({ method, url }, res)
  })
}

test('host: 注册 GIF 静态路由并原样返回打包资源（GET/HEAD/405）', async () => {
  const { routes } = bench()
  const route = routes.find((candidate) => candidate.path.endsWith('/assets/blue-fat-fish-working.gif'))
  assert.ok(route, 'GIF asset route must be registered: ' + JSON.stringify(routes.map((r) => r.path)))
  assert.equal(route.kind, 'exact')

  const got = await callRoute(route)
  assert.equal(got.status, 200)
  assert.equal(got.headers['content-type'], 'image/gif')
  assert.ok(Buffer.isBuffer(got.body) || got.body instanceof Uint8Array)
  assert.equal(Buffer.from(got.body).length, GIF.length)
  assert.ok(Buffer.from(got.body).equals(GIF), 'served bytes must equal the packaged GIF')

  const head = await callRoute(route, 'HEAD')
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-length'], String(GIF.length))

  const post = await callRoute(route, 'POST')
  assert.equal(post.status, 405)
})

test('host: 注册三视图 prefix 路由并安全服务图片（GET/HEAD/404/405/穿越拒绝）', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { routes } = bench()
  const prefix = routes.find((candidate) => candidate.kind === 'prefix' && candidate.path.endsWith('/assets/three-view'))
  assert.ok(prefix, 'three-view prefix route must be registered: ' + JSON.stringify(routes.map((r) => r.path)))
  assert.equal(prefix.path, built.THREE_VIEW_ROUTE.slice(0, -1), 'webServer prefix matching expects no trailing slash')

  const directory = mkdtempSync(join(tmpdir(), 'dsh-three-view-'))
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03])
  writeFileSync(join(directory, 'demo.png'), bytes)
  const handler = built.createThreeViewHandler(directory)
  try {
    const ok = await callHandler(handler, { url: built.THREE_VIEW_ROUTE + 'demo.png' })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['content-type'], 'image/png')
    assert.deepEqual(Buffer.from(ok.body), bytes)

    const head = await callHandler(handler, { method: 'HEAD', url: built.THREE_VIEW_ROUTE + 'demo.png' })
    assert.equal(head.status, 200)
    assert.equal(head.headers['content-length'], String(bytes.length))

    const missing = await callHandler(handler, { url: built.THREE_VIEW_ROUTE + 'nope.png' })
    assert.equal(missing.status, 404)

    for (const bad of [
      '../blue-fat-fish-working.gif',
      '%2e%2e/demo.png',
      'sub/demo.png',
      'demo.exe',
      '.env',
      '',
    ]) {
      const got = await callHandler(handler, { url: built.THREE_VIEW_ROUTE + bad })
      assert.equal(got.status, 404, `unsafe path must 404: ${bad}`)
    }
    const withQuery = await callHandler(handler, { url: built.THREE_VIEW_ROUTE + 'demo.png?v=1' })
    assert.equal(withQuery.status, 200, 'cache-busting query is accepted')

    const post = await callHandler(handler, { method: 'POST', url: built.THREE_VIEW_ROUTE + 'demo.png' })
    assert.equal(post.status, 405)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('host: 三视图图片扩展名白名单与目录穿越单元校验', () => {
  const dir = join(root, 'assets', 'three-view')
  const slash = built.THREE_VIEW_ROUTE
  assert.equal(built.resolveThreeViewAsset(dir, slash + 'a.png')?.contentType, 'image/png')
  assert.equal(built.resolveThreeViewAsset(dir, slash + 'a.JPG')?.contentType, 'image/jpeg')
  assert.equal(built.resolveThreeViewAsset(dir, slash + 'a.webp')?.contentType, 'image/webp')
  assert.equal(built.resolveThreeViewAsset(dir, slash + 'a.svg'), null)
  assert.equal(built.resolveThreeViewAsset(dir, slash + 'a.html'), null)
  assert.equal(built.resolveThreeViewAsset(dir, slash + '../a.png'), null)
  assert.equal(built.resolveThreeViewAsset(dir, '/@dsh-external/xllh-dsh-anime-desktop-pet/assets/three-view/a.png'), null)
  assert.equal(built.resolveThreeViewAsset(dir, ''), null)
  assert.equal(built.resolveThreeViewAsset(dir, undefined), null)
})

test('host: 注册固定形象 animated prefix 路由并服务 25 帧 GIF（GET/HEAD/404/405）', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { routes } = bench()
  const prefix = routes.find((candidate) => candidate.kind === 'prefix' && candidate.path.endsWith('/assets/animated'))
  assert.ok(prefix, 'animated prefix route must be registered: ' + JSON.stringify(routes.map((r) => r.path)))
  assert.equal(prefix.path, built.ANIMATED_ROUTE.slice(0, -1))

  const directory = mkdtempSync(join(tmpdir(), 'dsh-animated-'))
  const bytes = readFileSync(join(root, 'assets', 'animated', 'blue-fat-fish-eating.gif'))
  writeFileSync(join(directory, 'demo.gif'), bytes)
  const handler = built.createAnimatedHandler(directory)
  try {
    const ok = await callHandler(handler, { url: built.ANIMATED_ROUTE + 'demo.gif' })
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['content-type'], 'image/gif')
    assert.deepEqual(Buffer.from(ok.body), bytes)
    const head = await callHandler(handler, { method: 'HEAD', url: built.ANIMATED_ROUTE + 'demo.gif' })
    assert.equal(head.status, 200)
    assert.equal(head.headers['content-length'], String(bytes.length))
    const missing = await callHandler(handler, { url: built.ANIMATED_ROUTE + 'nope.gif' })
    assert.equal(missing.status, 404)
    const post = await callHandler(handler, { method: 'POST', url: built.ANIMATED_ROUTE + 'demo.gif' })
    assert.equal(post.status, 405)
    const traversal = await callHandler(handler, { url: built.ANIMATED_ROUTE + '../three-view/a.png' })
    assert.equal(traversal.status, 404)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('host: 注册桌面横幅 prefix 路由并服务动画 GIF，缺失/穿越安全 404', async () => {
  const { routes } = bench()
  const prefix = routes.find((route) => route.kind === 'prefix' && route.path === built.BANNER_ROUTE.slice(0, -1))
  assert.ok(prefix, 'banner prefix route must be registered: ' + JSON.stringify(routes.map((route) => route.path)))
  const ok = await callRoute(prefix, 'GET', built.BANNER_ROUTE + 'blue-fat-fish-live-banner.gif')
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'image/gif')
  assert.deepEqual(Buffer.from(ok.body), BANNER)
  assert.equal((await callRoute(prefix, 'HEAD', built.BANNER_ROUTE + 'blue-fat-fish-live-banner.gif')).body, 'HEAD')
  assert.equal((await callRoute(prefix, 'POST', built.BANNER_ROUTE + 'blue-fat-fish-live-banner.gif')).status, 405)
  assert.equal((await callRoute(prefix, 'GET', built.BANNER_ROUTE + 'missing.gif')).status, 404)
  assert.equal((await callRoute(prefix, 'GET', built.BANNER_ROUTE + '../three-view/a.png')).status, 404)
})

test('host: 注册直播间场景 prefix 路由，服务 manifest/layout 与 @1x/@2x 图片', async () => {
  const { routes } = bench()
  const prefix = routes.find((route) => route.kind === 'prefix' && route.path === built.SCENE_ROUTE.slice(0, -1))
  assert.ok(prefix, 'scene prefix route must be registered')
  const manifestResponse = await callRoute(prefix, 'GET', built.SCENE_ROUTE + 'manifest.json')
  assert.equal(manifestResponse.status, 200)
  assert.equal(manifestResponse.headers['content-type'], 'application/json; charset=utf-8')
  const manifest = JSON.parse(manifestResponse.body)
  assert.ok(manifest.slices.length >= 20)
  const layoutResponse = await callRoute(prefix, 'GET', built.SCENE_ROUTE + 'layout.json')
  assert.equal(layoutResponse.status, 200)
  assert.ok(JSON.parse(layoutResponse.body).elements.length >= 18)
  const png = readFileSync(join(root, 'assets', 'slices', '@1x', 'ui-banner-main@1x.png'))
  const image = await callRoute(prefix, 'GET', built.SCENE_ROUTE + '@1x/ui-banner-main@1x.png')
  assert.equal(image.status, 200)
  assert.equal(image.headers['content-type'], 'image/png')
  assert.deepEqual(Buffer.from(image.body), png)
  assert.equal((await callRoute(prefix, 'HEAD', built.SCENE_ROUTE + '@2x/ui-banner-main@2x.png')).body, 'HEAD')
  assert.equal((await callRoute(prefix, 'POST', built.SCENE_ROUTE + 'manifest.json')).status, 405)
  assert.equal((await callRoute(prefix, 'GET', built.SCENE_ROUTE + '../manifest.json')).status, 404)
  assert.equal((await callRoute(prefix, 'GET', built.SCENE_ROUTE + 'nested/evil.png')).status, 404)
  assert.equal((await callRoute(prefix, 'GET', built.SCENE_ROUTE + 'unknown.json')).status, 404)
})

test('host: effect 卸载后路由被移除，缺失 webServer 时安静降级', () => {
  const { routes, effects } = bench()
  assert.equal(routes.length, 5, 'GIF exact route + three-view prefix + animated prefix + banner prefix + scene prefix')
  effects.forEach((dispose) => dispose?.())
  assert.equal(routes.length, 0)
  assert.doesNotThrow(() => built.apply({ logger: { warn() {}, error() {} }, effect() {}, get: () => undefined }))
})
