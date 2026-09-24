/**
 * 「预存命令」—— **产物层门禁**（TDD 第三层，红→绿）。
 *
 * 存在理由：源码接线全绿也只证明"源码写了"，证明不了"浏览器加载的那份产物里真有"。
 * 本文件读 `lib/client.js`（dev 3080 实际服务的那份），断言新按钮/新面板/新文案/新层级都在产物里。
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

test('BB1 产物里两个存储键都在（新键不得把既有追加文案键挤掉）', () => {
  const source = readClient()
  assert.ok(source.includes('dsh-quick-append.commands'), '产物缺少预存命令存储键 —— 未重新 build:client')
  assert.ok(source.includes('dsh-quick-append.presets'), '产物少了既有的追加文案键 —— 存储方案被改坏了')
  assert.ok(source.includes('dsh-quick-append.text'), '产物少了旧键字面量 —— 老用户迁移会失效')
})

test('BB2 产物里带按钮标识与全部关键文案（空态引导 / 删除确认 / 放弃确认 / 成功提示）', () => {
  const source = readClient()
  for (const text of [
    '预存命令',
    '暂无预存命令，右键『预存命令』可录入指令',
    '确认删除',
    '放弃',
    '继续编辑',
    '预存命令已保存',
    '预存命令已删除',
  ]) {
    assert.ok(source.includes(text), `产物缺少文案「${text}」—— 未重新 build:client`)
  }
})

test('BB3 产物里带扳手图标、5px 间距容器与新层级三层样式', () => {
  const source = readClient()
  assert.ok(source.includes('M14.7 6.3a1 1 0 0 0 0 1.4l1.6'), '产物缺扳手图标路径（按钮会变成空方块）')
  assert.ok(source.includes('dsh-qa-tools'), '产物缺按钮容器类（间距 5px 靠它）')
  assert.ok(/\.dsh-qa-tools \{[^}]*gap: 5px/.test(source), '产物里容器间距不是 5px')
  for (const cls of ['.dsh-qa-mask {', '.dsh-qa-menu {', '.dsh-qa-dialog {', '.dsh-qa-menu-list {', '.dsh-qa-menu-item {']) {
    assert.ok(source.includes(cls), `产物缺样式类 ${cls} —— 未重新 build:client`)
  }
  assert.ok(source.includes('z-index: 110') && source.includes('z-index: 111'), '产物缺新的浮层层级（面板会被输入区或既有菜单盖住）')
  assert.ok(source.includes('z-index: 100'), '产物里既有的 100 层级被改动了 —— 回归风险')
})

test('BB4 产物里弹窗复用既有卡面类（样式统一不是靠另起一套）', () => {
  const source = readClient()
  assert.ok(source.includes('dsh-qa-popover'), '产物缺既有卡面类')
  assert.ok(source.includes('dsh-qa-popover dsh-qa-menu'), '左键菜单没有复用既有卡面类（样式会割裂）')
  assert.ok(source.includes('dsh-qa-popover dsh-qa-dialog'), '编辑弹窗没有复用既有卡面类（样式会割裂）')
  assert.ok(source.includes('dsh-qa-btn'), '产物缺既有按钮类（弹窗按钮样式会与既有弹窗不一致）')
})

test('BB5 portal 依赖真的被解析成平台模块（否则整包在浏览器里加载即失败）', () => {
  const source = readClient()
  assert.match(source, /require\("react-dom"\)/, '产物没有对 react-dom 的 require —— portal 无法工作（或被打进了私有副本，多实例风险）')
  assert.ok(!/require\("node:/.test(source), '产物不得 require node 内置模块（铁律 25）')
})

test('BB6 产物仍是既有的 ModuleLoader 工厂格式与插件 id（不得被改动破坏）', () => {
  const source = readClient()
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.ok(source.includes('@dsh-external/dsh-quick-append'))
})
