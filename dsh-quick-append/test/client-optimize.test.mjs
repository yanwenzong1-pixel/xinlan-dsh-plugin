/**
 * Client 产物接线门禁：断言构建产物 lib/client.js 已接线
 * ① 常驻 toast 固定文案「正在优化提示词中…」+「优化完成」；
 * ② 图片采集（imageIds）与 canvas 预处理（createImageBitmap）；③ 请求取消清理（AbortController）；
 * ④ 弹窗不再暴露模型/思考强度控件（由宿主策略统一决定）。
 * 运行前需 npm run build:client。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib', 'client.js')

/**
 * 剥离注释后的产物文本。
 *
 * 冻结类断言必须针对**真实代码**：tsdown 会保留源码里的块注释，
 * 而「说明某控件已移除」的注释本身含有该控件的名字，
 * 不剥离就会把文档注释误判成残留实现（本门禁首版即踩此坑）。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('client：常驻优化 toast 固定文案与完成态接线', () => {
  assert.ok(existsSync(clientPath), `missing ${clientPath} — run npm run build:client first`)
  const s = readFileSync(clientPath, 'utf8')
  assert.match(s, /正在优化提示词中…/, '任务态常驻 toast 固定文案必须存在（不得自动消失）')
  assert.match(s, /优化完成/, '成功路径短暂切换「优化完成」态')
})

test('client：图片预处理接线', () => {
  const s = readFileSync(clientPath, 'utf8')
  assert.match(s, /imageIds/, '必须采集输入区图片附件')
  assert.match(s, /createImageBitmap/, '必须按受限尺寸/JPEG 预处理图片')
  assert.match(s, /toBlob/, '重编码路径必须输出 JPEG blob')
})

test('client：弹窗不得再暴露模型/思考强度控件', () => {
  const code = stripComments(readFileSync(clientPath, 'utf8'))
  for (const token of ['优化模型', '思考强度', 'dsh-quick-append.model', 'dsh-quick-append.reasoning']) {
    assert.ok(
      !code.includes(token),
      `client bundle 代码仍含「${token}」——模型与思考强度已改为宿主策略，控件必须移除`,
    )
  }
  assert.ok(!/\breasoningEffort\s*:/.test(code), 'client 不得再发送 reasoningEffort（宿主默认 max）')
})

test('client：优化请求可取消（AbortController 清理，unmount/路由切换不留孤儿任务）', () => {
  const s = readFileSync(clientPath, 'utf8')
  assert.match(s, /AbortController/, '请求必须持有 AbortController（卸载/取消时终止，防任务残留）')
})
