/**
 * 客户端/宿主产物装配形状门禁（`PLUGIN-LOADER-SPEC.md` R/H/P/T 系列）。
 *
 * 背景：client bundle 缺少 `exports.inject` 时，Cordis loader 不会等待兄弟服务
 * 就绪即激活插件，`apply` 访问兄弟服务直接抛
 * `cannot get property "..." without inject`，阻塞整页 boot。
 *
 * 本测试断言**构建产物与源码**（事故真正发生的载体），不依赖浏览器和运行时：
 *   - R1/R5 产物级导出形状
 *   - R2/R3 `inject` 与真实访问的服务一致、命名空间不写入 inject
 *   - U2-a  声明与访问一致（本插件的 `conversation` 为声明式必需 + 访问式可选）
 *   - 冻结   本插件不产生任何跨插件副作用（无对外发射 API）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib', 'client.js')
const pkgPath = join(root, 'package.json')
const hostSrc = join(root, 'src', 'index.ts')

/** 宿主编译产物：lib/*.js，排除 client bundle 与 sourcemap。 */
function hostLibFiles() {
  return readdirSync(join(root, 'lib'))
    .filter((f) => f.endsWith('.js') && !f.endsWith('.map') && f !== 'client.js')
    .map((f) => join(root, 'lib', f))
}

function readClient() {
  assert.ok(
    existsSync(clientPath),
    `missing ${clientPath} — run \`npm run build:client\` first`,
  )
  return readFileSync(clientPath, 'utf8')
}

function injectArrayOf(source, label) {
  const match = source.match(/inject\s*=\s*(\[[^\]]*\])/)
  assert.ok(match, `${label} must declare a module-level \`inject = [...]\` (R1)`)
  return JSON.parse(match[1].replace(/'/g, '"'))
}

// --- 产物形状 ---------------------------------------------------------------

test('R1/R5: lib/client.js exports both apply and inject', () => {
  const source = readClient()
  assert.match(source, /exports\.apply\s*=/, 'missing exports.apply — loader cannot activate the plugin')
  assert.match(
    source,
    /exports\.inject\s*=/,
    'missing exports.inject — apply touching a sibling service throws "cannot get property ... without inject" and blocks the whole boot',
  )
})

test('R4: bundle keeps the lazy-CJS factory registration format', () => {
  const source = readClient()
  assert.match(source, /window\.__ModuleLoader__\.load\(/, 'must register through window.__ModuleLoader__.load')
  assert.match(
    source,
    /"@dsh-external\/dsh-dialogue-alert-message"/,
    'factory must declare this plugin id',
  )
})

test('R2/R3/U2: client inject is exactly the services apply touches, no namespaces', () => {
  const declared = injectArrayOf(readClient(), 'client bundle')

  // apply 只消费 slots（sidebar.footer.action 槽注册）；conversation 不参与。
  assert.deepEqual(
    declared,
    ['slots'],
    'inject changed — re-audit which sibling services apply() actually reads (R2) before editing',
  )
  assert.ok(
    !declared.some((name) => name.startsWith('remote.')),
    'remote.* namespaces must never be injected — they only exist after $mount, so declaring one deadlocks the loader (R3)',
  )

  const source = readFileSync(join(root, 'src', 'client', 'index.ts'), 'utf8')
  assert.match(source, /ctx\.slots\./, 'apply must read the "slots" service it declares (R2)')
  assert.doesNotMatch(source, /\$mount\(/, 'this plugin has no typert contribution to mount')
})

// --- 宿主形状 ---------------------------------------------------------------

test('H1: host entry never declares client-only services', () => {
  const arrayPattern = /(?:static\s+)?inject\s*=\s*(\[[^\]]*\])/g
  let checked = 0
  for (const file of hostLibFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(arrayPattern)) {
      checked += 1
      assert.ok(
        !/["']slots["']/.test(match[1]) && !/["']conversation["']/.test(match[1]),
        `${file} declares a client-only service in inject: ${match[1]} (H1)`,
      )
    }
  }
  assert.ok(checked > 0, 'no host inject declaration found in lib/*.js')
})

test('H1: host inject is exactly webServer/sessions/llm', () => {
  const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  assert.deepEqual(
    injectArrayOf(source, 'host bundle'),
    ['webServer', 'sessions', 'llm'],
    'host inject changed — every declared service must be genuinely read by apply (R2)',
  )
})

test('P1: package declares web client platform and ./client export', () => {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  assert.ok(pkg.exports?.['./client'], 'exports["./client"] must point at the browser bundle')
  assert.equal(pkg.dsh?.client?.platform, 'web', 'dsh.client.platform must be "web"')
  if (pkg.dsh?.bundle?.patch !== undefined) {
    assert.ok(
      existsSync(join(root, pkg.dsh.bundle.patch)),
      `dsh.bundle.patch missing: ${pkg.dsh.bundle.patch}`,
    )
  }
})

test('P1: dsh.client.inject is present and free of namespace entries', () => {
  // `dsh.client.inject` lists the *packages* whose services the bundle consumes,
  // so its entries are not 1:1 with the bundle's service names — assert the
  // property that actually matters (declared, and no namespace deadlock).
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const declared = pkg.dsh?.client?.inject
  assert.ok(Array.isArray(declared) && declared.length > 0, 'dsh.client.inject must be a non-empty array')
  assert.ok(
    !declared.some((entry) => entry.includes('remote.')),
    'dsh.client.inject must not name a remote.* namespace (R3)',
  )
  assert.ok(
    declared.some((entry) => entry.includes('ui-slots')),
    'the bundle consumes the slots service, so its providing package must be declared',
  )
})

// --- 冻结断言（负面） -------------------------------------------------------

test('freeze: host never emits outside the plugin boundary', () => {
  // 本插件的投递路径必须只有内部队列 + 自建 HTTP 路由（自包含通知）。
  // 一旦接入事件总线/告警出口，就会产生真实的跨插件副作用，违反冻结要求。
  const forbidden = [
    'ctx.emit',
    'ctx.broadcast',
    'alertHub',
    'alert/ingest',
    'eventbus',
    'eventBus',
  ]
  for (const file of hostLibFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const token of forbidden) {
      assert.ok(
        !source.includes(token),
        `${file} contains "${token}" — the plugin boundary is no longer self-contained`,
      )
    }
  }
})

test('freeze: host context surface stays logger/effect/on only', () => {
  const source = readFileSync(hostSrc, 'utf8')
  const touched = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  assert.deepEqual(
    [...touched].sort(),
    ['effect', 'logger', 'on'],
    'the host started using a new ctx capability — re-audit inject and the frozen no-side-effect requirement',
  )
})
