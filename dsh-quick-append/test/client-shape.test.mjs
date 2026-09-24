/**
 * 客户端/宿主产物装配形状门禁（`PLUGIN-LOADER-SPEC.md` R/H/P/T 系列）。
 *
 * 背景：client bundle 缺少 `exports.inject` 时，Cordis loader 不会等待兄弟服务
 * 就绪即激活插件，`apply` 访问兄弟服务直接抛
 * `cannot get property "..." without inject`，阻塞整页 boot。
 *
 * 本测试断言**构建产物与源码**（事故真正发生的载体），不依赖浏览器和运行时：
 *   - R1/R5 产物级导出形状
 *   - R2     `inject` 覆盖 apply 真实访问的兄弟服务
 *   - R3     命名空间不写入 inject
 *   - U2-a   `conversation` 声明为必需但访问式可选（现状锁定，两处必须同步改）
 *   - 冻结   零新增 z 值 / 零绕过 close-plugin-panels / 零画布钩子 / preset 目前只发不读
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
// 层级登记表：CSS 里的 z-index 字面量必须与它逐个对上（"新加一层"必须同时改登记表）。
import { COMMAND_LAYER } from '../src/lib/command-store.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib', 'client.js')
const pkgPath = join(root, 'package.json')
const clientSrcPath = join(root, 'src', 'client', 'index.ts')
const hostSrcPath = join(root, 'src', 'index.ts')

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

/** 源码中所有 `z-index: <n>` 声明。 */
function zIndexValues(source) {
  return [...source.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1]))
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
  assert.match(source, /"@dsh-external\/dsh-quick-append"/, 'factory must declare this plugin id')
})

test('R2/R3: client inject is exactly the services apply touches, no namespaces', () => {
  const declared = injectArrayOf(readClient(), 'client bundle')
  assert.deepEqual(
    declared,
    ['slots', 'conversation'],
    'inject changed — re-audit which sibling services apply() actually reads (R2) before editing',
  )
  assert.ok(
    !declared.some((name) => name.startsWith('remote.')),
    'remote.* namespaces must never be injected — they only exist after $mount, so declaring one deadlocks the loader (R3)',
  )

  const source = readFileSync(clientSrcPath, 'utf8')
  assert.match(source, /ctx\.slots\./, 'apply must read the "slots" service it declares (R2)')
})

test('U2-a: "conversation" stays declared-required but accessed as optional', () => {
  // 现状锁定：apply 用 `ctx.get?.('conversation') ?? undefined` 按可选处理，
  // 同时把 'conversation' 写进 inject。两处必须同步修改，否则会从
  // 「取不到就降级」变成「loader 永久等待」或「拿不到 draftImages 而静默丢图」。
  const source = readFileSync(clientSrcPath, 'utf8')
  assert.match(
    source,
    /ctx\.get\?\.\('conversation'\)/,
    'the optional conversation access changed — update inject in the same commit (U2-a)',
  )
  assert.match(
    source,
    /conversationService !== undefined/,
    'the undefined-guard around conversationService was removed — images path would throw',
  )
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

test('H1: host inject is exactly webServer/llm/attachments', () => {
  const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  assert.deepEqual(
    injectArrayOf(source, 'host bundle'),
    ['webServer', 'llm', 'attachments'],
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

// --- 冻结断言（负面） -------------------------------------------------------

test('freeze: z 值集合与叶子登记的层级一致（新增层级必须先登记）', () => {
  // 项目 z 寄存器基线为 2147483000（L1..L8）；本插件自带一套局部队列（远低于分级线，
  // 只承诺"高于输入区与自己的既有弹层"，跨插件层级另有 ALIGN 评估项）：
  //   100 = 既有「点击追加」弹层（v0.4.x 起登记为 ALIGN-10）
  //   110 = v0.5.0「预存命令」上拉菜单 / 编辑弹窗遮罩（登记为 ALIGN-11）
  //   111 = v0.5.0 编辑弹窗面板（必须高于自己的遮罩，否则第一下点在遮罩上）
  // 判据：CSS 模板里的字面量必须与叶子 command-store.ts 的 COMMAND_LAYER 逐个对上 ——
  // 只改 CSS 不改登记表、或只改常量的写法都会在这里红。
  const values = zIndexValues(readFileSync(clientSrcPath, 'utf8'))
  assert.deepEqual(
    values,
    [100, COMMAND_LAYER.mask, COMMAND_LAYER.menu, COMMAND_LAYER.dialog],
    '出现未登记的 z 值（或与叶子 COMMAND_LAYER 不一致）—— 先在叶子登记层级与理由，再改这里',
  )
})

test('freeze: the close-plugin-panels contract is neither consumed nor bypassed', () => {
  const sources = [readFileSync(clientSrcPath, 'utf8'), readFileSync(hostSrcPath, 'utf8')]
  for (const source of sources) {
    assert.ok(
      !source.includes('close-plugin-panels'),
      'close-plugin-panels appeared — this plugin must either honour the contract properly or stay out of it (ALIGN-09)',
    )
    assert.ok(
      !source.includes('xllh:open-plugin-panel'),
      'this plugin must not dispatch the panel-open protocol it does not implement',
    )
  }
})

test('freeze: no canvas snap hook was added', () => {
  const source = readFileSync(clientSrcPath, 'utf8')
  for (const token of ['data-snap', 'snap-layout:', 'CustomEvent', 'dispatchEvent']) {
    assert.ok(!source.includes(token), `canvas hook "${token}" appeared — this plugin must not touch the snap/collapse engine`)
  }
})

test('freeze: "preset" is still sent by the client but never read by the host', () => {
  // 现状锁定（Q11：登记为待核实，本次不夹带修改）。宿主一旦开始读取 preset，
  // 语义就变了（预设会被叠加两次），必须与客户端同一提交内改。
  const clientSource = readFileSync(clientSrcPath, 'utf8')
  assert.ok(clientSource.includes('preset,'), 'the client stopped sending "preset" in the request body')

  // 宿主从解析后的 payload 取字段（不是原始 body 对象）。
  const hostSource = readFileSync(hostSrcPath, 'utf8')
  const payloadReads = [...hostSource.matchAll(/payload\.([A-Za-z]+)/g)].map((m) => m[1])
  assert.ok(payloadReads.length > 0, 'host no longer reads any request payload field — request shape changed')
  assert.deepEqual(
    [...new Set(payloadReads)].sort(),
    ['context', 'cwd', 'draft', 'images'],
    'the host request-field set changed — re-audit the client/host contract (模型/思考强度已改为宿主默认，客户端不再发送)',
  )
  assert.ok(
    !payloadReads.includes('preset'),
    'the host started reading payload.preset — the client already appends the preset, so this would double it',
  )
  assert.ok(
    !payloadReads.includes('model') && !payloadReads.includes('reasoningEffort'),
    '模型与思考强度由宿主默认决定，宿主不得再从请求体读取',
  )
})

test('freeze: 弹窗不再暴露模型/思考强度控件（需求：改为宿主策略）', () => {
  // 2026-09-23 修正判据：原先扫**原文**，而"控件已移除"的说明注释里必然出现这两个词
  // ⇒ 门禁被自己的说明文字绊倒（本插件自 v0.3.1 起一直红，并连带让 npm run build:client 的
  //   postbuild 失败）。改为**先剥注释再扫代码**，与 xllh-ai-assistant 的同类负面断言同一口径：
  //   真正要防的是"代码里又冒出控件"（className / label 字符串仍在代码里，照样会被抓到），
  //   注释里的历史说明不算 —— 注释渲染不出控件。
  const source = readFileSync(clientSrcPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  for (const token of ['优化模型', '思考强度', 'modelSetting', 'reasoningSetting', 'dsh-quick-append.model', 'dsh-quick-append.reasoning']) {
    assert.ok(
      !source.includes(token),
      `client 源码（已剥注释）仍含「${token}」——控件应已移除（弹窗不显示）`,
    )
  }
})

test('freeze: 弹窗 footer 不得再承载定宽设置行（窗口按钮溢出的根因）', () => {
  // 回归背景：.dsh-qa-setrow 是 width:56px + flex:1 的定宽行，被塞进
  // .dsh-qa-footer（display:flex 且不换行）后，三个子项合计约 600px 被压进
  // 320px 弹窗 → 内容横向溢出，「取消/保存」按钮被推出窗口之外。
  // 现在设置行已移除；此断言防止再次把设置行放回 footer。
  const source = readFileSync(clientSrcPath, 'utf8')
  const footerBlock = source.match(/dsh-qa-footer[\s\S]{0,80}/)
  assert.ok(footerBlock, '.dsh-qa-footer 必须存在')
  assert.ok(
    !/dsh-qa-setrow[\s\S]{0,2000}?dsh-qa-actions/.test(source),
    '设置行（dsh-qa-setrow）不得再出现在 footer 与 actions 之间',
  )
})
