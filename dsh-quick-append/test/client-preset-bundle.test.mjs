/**
 * 「追加文案」按工作区隔离 —— **产物层门禁**（TDD 第三层，红→绿）。
 *
 * 存在理由：源码接线全绿也只证明"源码写了"，证明不了"浏览器加载的那份产物里真有"。
 * 本文件读 `lib/client.js`（dev 3080 实际服务的那份），断言新结构、新文案、旧键迁移都在产物里。
 *
 * 前置：先 `npm run build:client`（产物唯一来源），否则本文件红。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib', 'client.js')

function readClient() {
  assert.ok(existsSync(clientPath), `缺少 ${clientPath} —— 先跑 npm run build:client（产物唯一来源）`)
  return readFileSync(clientPath, 'utf8')
}

test('B1 产物里带新存储结构键与旧键（迁移读得到）', () => {
  const source = readClient()
  assert.ok(source.includes('dsh-quick-append.presets'), '产物缺少新的按工作区存储键')
  assert.ok(source.includes('dsh-quick-append.text'), '产物缺少旧键字面量 —— 老用户的配置将无法迁移')
  assert.ok(source.includes('__no-workspace__'), '产物缺少无工作区占位键')
})

test('B2 产物里带「填入默认文案」按钮与默认文案本体（新版措辞，防陈旧产物）', () => {
  const source = readClient()
  assert.ok(source.includes('填入默认文案'), '产物缺少「填入默认文案」按钮文案')
  assert.ok(source.includes('最高优先级规则'), '产物里默认文案本体丢失（按钮点下去会是空的）')
  assert.ok(source.includes('使用Ponytail 的 full模式开发'), '产物里还是旧默认文案 —— 未重新 build:client')
  assert.ok(!source.includes('插件窗口UI规范参考根目录'), '产物里仍有旧的三条规范文件引用 —— 未重新 build:client')
})

test('B3 产物里带失败反馈文案（禁止静默失败）', () => {
  const source = readClient()
  assert.ok(source.includes('追加文案'), '产物缺少追加文案相关文案')
  assert.ok(/保存失败|读取失败/.test(source), '产物缺少保存失败提示文案')
})

test('B4 产物仍是既有的 ModuleLoader 工厂格式（不得被改动破坏）', () => {
  const source = readClient()
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.ok(source.includes('@dsh-external/dsh-quick-append'))
})

test('B5 产物里不得残留旧的单键读写路径（旧的整段覆盖写法）', () => {
  const source = readClient()
  assert.ok(
    !/localStorage\.setItem\("dsh-quick-append\.text"/.test(source),
    '产物仍在写旧键 —— 会把"某个工作区的文案"写成全局值，破坏隔离',
  )
})
