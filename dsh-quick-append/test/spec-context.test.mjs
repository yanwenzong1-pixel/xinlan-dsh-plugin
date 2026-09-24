import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, rm, utimes } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { loadSpecContext, formatSpecContext, cleanDoc, defaultCacheDir, resolveDshHome, ROOT_SPECS } from '../lib/lib/spec-context.js'

const README = `# 项目
规则正文 R-01 必须遵守。
## 变更记录
- 2026-09-01 改了 X
## 更新日志
- v1 日志
`

const LOADER = `# 装配规范
## R 规则
R-01 插件必须装配。
B-01 白名单项：alpha, beta。
z-index：2147483000；
色值 #88DD44；
事件 snap-layout:settle。
`

const CANVAS = `# 画布互动
常量 SNAP_DOCK=40，Z_TOP=2147483065。
## 验收清单
- [ ] 未完成项
`

const DOC1 = `# docs 文档
## 操作日志
- 跑了任务
## 约束节
契约要点 f12/f13/f14。
`

const SPEC = `# demo SPEC
## 职责
demo 插件职责。
## RPC 方法清单
getQuote / getKline。
`

async function setupProject() {
  const root = await mkdtemp(join(tmpdir(), 'spec-ctx-test-'))
  await writeFile(join(root, 'README.md'), README)
  await writeFile(join(root, 'PLUGIN-LOADER-SPEC.md'), LOADER)
  await writeFile(join(root, 'CANVAS-INTERACTION-SPEC.md'), CANVAS)
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', '01-doc.md'), DOC1)
  await mkdir(join(root, 'plugins', 'demo'), { recursive: true })
  await writeFile(join(root, 'plugins', 'demo', 'SPEC.md'), SPEC)
  await mkdir(join(root, 'plugins', 'empty'), { recursive: true })
  const cacheDir = join(root, '.cache') // test-only cache root (tmp)
  return { root, cacheDir }
}

test('discover: 根规格 + docs + 插件文档被纳入，空目录忽略', async () => {
  const { root } = await setupProject()
  const r = await loadSpecContext(root, { cacheDir: join(await mkdtemp(join(tmpdir(), 'c-')), 'c') })
  const rels = r.files.map(f => f.rel)
  assert.ok(rels.includes('README.md'))
  assert.ok(rels.includes('PLUGIN-LOADER-SPEC.md'))
  assert.ok(rels.includes('CANVAS-INTERACTION-SPEC.md'))
  assert.ok(rels.includes('docs/01-doc.md'))
  assert.ok(rels.includes('plugins/demo/SPEC.md'))
  assert.ok(!rels.some(x => x.startsWith('plugins/empty/')))
  await rm(root, { recursive: true, force: true })
})

test('clean: 剔除变更记录/更新日志/操作日志/验收清单，保留规则ID/令牌/事件/z-index', () => {
  const out = cleanDoc(README)
  assert.ok(!out.includes('变更记录'))
  assert.ok(!out.includes('更新日志'))
  assert.ok(out.includes('R-01'))
  const out2 = cleanDoc(LOADER)
  assert.ok(out2.includes('R-01'))
  assert.ok(out2.includes('alpha, beta'))
  assert.ok(out2.includes('2147483000'))
  assert.ok(out2.includes('#88DD44'))
  assert.ok(out2.includes('snap-layout:settle'))
  const out3 = cleanDoc(CANVAS)
  assert.ok(!out3.includes('验收清单'))
  assert.ok(out3.includes('2147483065'))
  const out4 = cleanDoc(DOC1)
  assert.ok(!out4.includes('操作日志'))
  assert.ok(out4.includes('f12/f13/f14'))
})

test('clean: 空文本/纯日志文本边界', () => {
  assert.equal(cleanDoc(''), '')
  assert.equal(cleanDoc('# 仅变更记录\n- x\n'), '')
})

test('load: 首次全量构建，写缓存与 manifest', async () => {
  const { root, cacheDir } = await setupProject()
  const r = await loadSpecContext(root, { cacheDir })
  assert.equal(r.cacheHit, false)
  assert.equal(r.files.length, 5)
  assert.ok(r.content.includes('R-01'))
  assert.ok(r.content.includes('getQuote / getKline'))
  const { stat } = await import('node:fs/promises')
  assert.ok((await stat(join(cacheDir, 'spec-context.cache'))).size > 0)
  assert.ok((await stat(join(cacheDir, 'manifest.json'))).size > 0)
  await rm(root, { recursive: true, force: true })
})

test('load: 未变化 → 缓存命中且内容一致', async () => {
  const { root, cacheDir } = await setupProject()
  const a = await loadSpecContext(root, { cacheDir })
  const b = await loadSpecContext(root, { cacheDir })
  assert.equal(a.cacheHit, false)
  assert.equal(b.cacheHit, true)
  assert.equal(b.content, a.content)
  await rm(root, { recursive: true, force: true })
})

test('load: 任一源 mtime 变化 → 重建', async () => {
  const { root, cacheDir } = await setupProject()
  await loadSpecContext(root, { cacheDir })
  const future = new Date(Date.now() + 5000)
  await utimes(join(root, 'README.md'), future, future)
  const r = await loadSpecContext(root, { cacheDir })
  assert.equal(r.cacheHit, false)
  await rm(root, { recursive: true, force: true })
})

test('load: 缓存文件损坏 → 重建', async () => {
  const { root, cacheDir } = await setupProject()
  await loadSpecContext(root, { cacheDir })
  await writeFile(join(cacheDir, 'spec-context.cache'), 'not-a-gzip-stream')
  const r = await loadSpecContext(root, { cacheDir })
  assert.equal(r.cacheHit, false)
  assert.ok(r.content.includes('R-01'))
  await rm(root, { recursive: true, force: true })
})

test('load: 合法 gzip 但内容错写 → 重建（哈希校验）', async () => {
  const { root, cacheDir } = await setupProject()
  await loadSpecContext(root, { cacheDir })
  await writeFile(join(cacheDir, 'spec-context.cache'), gzipSync(Buffer.from('偷换的内容')))
  const r = await loadSpecContext(root, { cacheDir })
  assert.equal(r.cacheHit, false)
  assert.ok(r.content.includes('R-01'))
  await rm(root, { recursive: true, force: true })
})

test('load: manifest 损坏 → 重建', async () => {
  const { root, cacheDir } = await setupProject()
  await loadSpecContext(root, { cacheDir })
  await writeFile(join(cacheDir, 'manifest.json'), '{broken')
  const r = await loadSpecContext(root, { cacheDir })
  assert.equal(r.cacheHit, false)
  await rm(root, { recursive: true, force: true })
})

test('load: 无规范源 → ok=false 不抛错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-ctx-empty-'))
  const r = await loadSpecContext(root, { cacheDir: join(root, '.c') })
  assert.equal(r.ok, false)
  await rm(root, { recursive: true, force: true })
})

test('预算控制：超限文件被省略并标注，未越界文件完整保留', async () => {
  const { root, cacheDir } = await setupProject()
  const r = await loadSpecContext(root, { cacheDir, budgetChars: 120 })
  assert.equal(r.cacheHit, false)
  assert.ok(r.omitted.length > 0)
  assert.ok(r.content.includes('R-01')) // 高优先级文件保留
  assert.ok(r.content.includes('省略')) // 省略说明标注
  assert.ok(!r.content.includes('getQuote / getKline') || r.omitted.length === 0)
  await rm(root, { recursive: true, force: true })
})

test('预算一致时缓存命中，预算变化触发重建', async () => {
  const { root, cacheDir } = await setupProject()
  const a = await loadSpecContext(root, { cacheDir, budgetChars: 120 })
  const b = await loadSpecContext(root, { cacheDir, budgetChars: 120 })
  assert.equal(a.cacheHit, false)
  assert.equal(b.cacheHit, true)
  const c = await loadSpecContext(root, { cacheDir, budgetChars: 1200 })
  assert.equal(c.cacheHit, false)
  await rm(root, { recursive: true, force: true })
})

test('format: 头含文件清单+mtime+缓存标记，失效时说明全量加载', async () => {
  const { root, cacheDir } = await setupProject()
  const full = await loadSpecContext(root, { cacheDir })
  const hit = await loadSpecContext(root, { cacheDir })
  const txt1 = formatSpecContext(full)
  const txt2 = formatSpecContext(hit)
  assert.ok(txt1.startsWith('本次载入规范清单'))
  assert.ok(txt1.includes('README.md'))
  assert.ok(txt1.includes('全量加载'))
  assert.ok(txt1.includes('PLUGIN-LOADER-SPEC.md'))
  assert.ok(!txt1.includes('缓存命中') || txt1.includes('全量加载'))
  assert.ok(txt2.includes('缓存命中'))
  await rm(root, { recursive: true, force: true })
})

test('format: 无规范源输出占位且不抛错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spec-ctx-ef-'))
  const r = await loadSpecContext(root, { cacheDir: join(root, '.c') })
  const txt = formatSpecContext(r)
  assert.ok(txt.includes('未发现'))
  await rm(root, { recursive: true, force: true })
})

test('ROOT_SPECS 固定为 5 项且含 JSON-CSS-SPEC', () => {
  assert.equal(ROOT_SPECS.length, 5)
  assert.ok(ROOT_SPECS.includes('JSON-CSS-SPEC.md'))
})

test('默认缓存目录在源仓库之外', () => {
  const { root } = { root: 'C:\\proj\\x' }
  const dir = defaultCacheDir(root)
  assert.ok(!dir.startsWith(root))
  // 与运行环境无关：用**当前进程真实环境**解析家目录，再断言前缀。
  // 不能硬编码 `/.dsh` 字面量（Windows 上是反斜杠），也不能假定 $DSH_HOME 未设。
  assert.ok(dir.startsWith(resolveDshHome()))
})

test('resolveDshHome：$DSH_HOME 优先于 ~/.dsh（隔离验证前提）', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'C:\\iso\\home' }), 'C:\\iso\\home')
})

test('resolveDshHome：空白 $DSH_HOME 视为未设（与 harness 约定一致）', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
  assert.equal(resolveDshHome({ DSH_HOME: '' }), join(homedir(), '.dsh'))
})

test('resolveDshHome：未设 $DSH_HOME → ~/.dsh', () => {
  assert.equal(resolveDshHome({}), join(homedir(), '.dsh'))
})

test('默认缓存目录跟随 $DSH_HOME（隔离下不写真实 ~/.dsh）', () => {
  const root = 'C:\\proj\\x'
  const iso = resolveDshHome({ DSH_HOME: 'C:\\iso\\home' })
  const dir = join(iso, 'dsh-quick-append', 'spec-cache', createHash('sha256').update(root).digest('hex').slice(0, 12))
  const real = join(homedir(), '.dsh')
  assert.ok(dir.startsWith('C:\\iso\\home'))
  assert.ok(!dir.startsWith(real))
})
