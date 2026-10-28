/**
 * 产物形状门禁：bundle 是自包含的 ModuleLoader 工厂，inject 只声明 sessions，
 * 宿主半带 GIF 路由，manifest 声明 bundle/client 面（加载顺序由 DSH 组合保证）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const clientPath = join(root, 'lib', 'client.js')
const hostPath = join(root, 'lib', 'index.js')

test('manifest：bundle patch 存在，client 面为 web 且声明 sessions 包顺序依赖', () => {
  assert.equal(pkg.name, '@dsh-external/dsh-anime-desktop-pet')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(root, 'cordis.patch.yml')))
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh?.client?.inject))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-session-controller'))
  assert.ok(existsSync(join(root, 'assets', 'blue-fat-fish-working.gif')))
})

test('client 产物：自包含 ModuleLoader 工厂，导出 inject=["sessions"]，无跨包 require', () => {
  assert.ok(existsSync(clientPath), 'run `npm run build` first')
  const source = readFileSync(clientPath, 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(source, /"@dsh-external\/dsh-anime-desktop-pet"/)
  assert.match(source, /exports\.inject\s*=\s*(?:inject|\[)/)
  assert.match(source, /"sessions"/)
  assert.doesNotMatch(source, /require\("@deepseek-ai\//, 'client bundle must stay self-contained')
  assert.doesNotMatch(source, /require\("react/, 'overlay is dependency-free (no react)')
})

test('宿主产物：GIF 静态路由与打包路径一致', () => {
  assert.ok(existsSync(hostPath), 'run `npm run build` first')
  const source = readFileSync(hostPath, 'utf8')
  assert.match(source, /\/@dsh-external\/dsh-anime-desktop-pet\/assets\/blue-fat-fish-working\.gif/)
  assert.match(source, /image\/gif/)
  assert.match(source, /kind:\s*'exact'/)
})
