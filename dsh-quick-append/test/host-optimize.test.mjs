/**
 * Host 产物接线门禁：断言构建产物 lib/index.js 已接线
 * ① 默认模型 deepseek-flash + 思考强度 max（宿主策略，客户端不再传）；② 图片准入（attachments）；
 * ③ 超时（AbortSignal.timeout）；④ extractJSON 多路解析；⑤ 降级标记 imagesDropped。
 * 运行前需 bash scripts/build.sh。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = join(root, 'lib', 'index.js')
const optimizeLibPath = join(root, 'lib', 'lib', 'optimize.js')

function readIndex() {
  assert.ok(existsSync(indexPath), `missing ${indexPath} — run bash scripts/build.sh first`)
  return readFileSync(indexPath, 'utf8')
}

function readOptimizeLib() {
  assert.ok(existsSync(optimizeLibPath), `missing ${optimizeLibPath} — run bash scripts/build.sh first`)
  return readFileSync(optimizeLibPath, 'utf8')
}

/** 剥离注释：冻结类断言针对真实代码，避免「说明旧值已废弃」的注释被误判为残留。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('host：默认模型 deepseek-flash + 思考强度 max 为唯一策略来源', () => {
  const lib = stripComments(readOptimizeLib())
  assert.match(lib, /DEFAULT_OPTIMIZE_MODEL\s*=\s*['"]deepseek-flash['"]/, '默认模型必须是 deepseek-flash（optimize 纯函数库）')
  assert.doesNotMatch(
    lib,
    /['"]deepseek-v4-flash-vision-exp['"]/,
    '旧默认模型不再作为代码中的字面量出现（注释里提及历史沿革不算）',
  )
  assert.match(lib, /DEFAULT_REASONING_EFFORT\s*=\s*['"]max['"]/, '默认思考强度必须是 max')
  const index = readIndex()
  assert.match(index, /reasoningEffort/, '请求必须携带思考模式参数')
  assert.match(
    index,
    /DEFAULT_OPTIMIZE_MODEL|DEFAULT_REASONING_EFFORT/,
    '宿主必须使用 optimize 库的默认常量 —— 客户端已不再发送模型/思考强度',
  )
})

test('host：图片按 harness 多模态协议接入（attachments.saveImage(s) + image block）', () => {
  const s = readIndex()
  assert.match(s, /saveImage/, '必须经 attachments 服务保存图片并生成引用')
  assert.match(s, /type: ['"]image['"]/, '必须组装 image 内容块（多模态消息协议）')
})

test('host：1M 上下文档位与超时上调（resolveModelInfo 上下文核查 + AbortSignal.timeout）', () => {
  const s = readIndex()
  assert.match(s, /resolveModelInfo/, '必须读取模型上下文窗口元数据（1M 档位证据）')
  assert.match(s, /AbortSignal\.timeout/, '必须设置单次尝试超时（1M+思考上调）')
})

test('host：extractJSON 多路兜底 + 失败重试 2 次 + 降级标记', () => {
  const lib = readOptimizeLib()
  assert.match(lib, /extractJSON/, '解析必须走 extractJSON 多路兜底')
  assert.match(lib, /OPTIMIZE_MAX_ATTEMPTS/, '重试上限常量（1+2 次）')
  const s = readIndex()
  assert.match(s, /imagesDropped/, '图片全部处理失败 → 响应必须携带降级标记')
})

test('host：inject 声明 attachments 服务（访问 ctx.attachments 前的装配声明）', () => {
  assert.match(readIndex(), /inject\s*=\s*\[[^\]]*attachments/, 'inject 必须声明 attachments（铁律3：访问前注入）')
})
