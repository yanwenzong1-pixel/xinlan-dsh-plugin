/**
 * 提示词优化链路纯函数测试（TDD）：模型/思考强度归一化、extractJSON 多路兜底、
 * 结果解析、重试判定、提示词构建、图片 payload 校验。运行：node --test
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OPTIMIZE_MODEL,
  DEFAULT_REASONING_EFFORT,
  OPTIMIZE_MAX_ATTEMPTS,
  OPTIMIZE_REQUEST_FIELDS,
  OPTIMIZE_TIMEOUT_MS,
  normalizeModel,
  normalizeReasoningEffort,
  extractJSON,
  parseOptimizeResult,
  plainTextFallback,
  retryDecision,
  buildOptimizeSystemPrompt,
  buildOptimizeUserText,
  validateImagePayloads,
} from '../src/lib/optimize.ts'

// ── 默认模型与归一化 ──
test('默认模型标识 = deepseek-flash（需求锁定，弹窗不再暴露模型选择）', () => {
  assert.equal(DEFAULT_OPTIMIZE_MODEL, 'deepseek-flash')
})

test('normalizeModel：缺失/空/空白/非法 → 默认；合法标识通过并去首尾空白', () => {
  assert.equal(normalizeModel(undefined), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel(null), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel(''), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel('   '), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel(' deepseek-v4-pro '), 'deepseek-v4-pro')
  assert.equal(normalizeModel('a.b-c_d/e1'), 'a.b-c_d/e1')
  // 非法字符/超长/含空格 → 回退默认
  assert.equal(normalizeModel('bad model'), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel('中文模型'), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel('a"b'), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel('x'.repeat(81)), DEFAULT_OPTIMIZE_MODEL)
  assert.equal(normalizeModel('x'.repeat(80)), 'x'.repeat(80), '80 字符边界合法')
})

// ── 思考强度归一化 ──
test('normalizeReasoningEffort：默认 max；off/low/high/max 通过；大小写/非法 → 默认', () => {
  assert.equal(normalizeReasoningEffort(undefined), 'max')
  assert.equal(DEFAULT_REASONING_EFFORT, 'max')
  assert.equal(normalizeReasoningEffort('off'), 'off')
  assert.equal(normalizeReasoningEffort('low'), 'low')
  assert.equal(normalizeReasoningEffort('high'), 'high')
  assert.equal(normalizeReasoningEffort('max'), 'max')
  assert.equal(normalizeReasoningEffort('HIGH'), 'max', '大写不属于枚举 → 回退默认（max）')
  assert.equal(normalizeReasoningEffort(''), 'max')
  assert.equal(normalizeReasoningEffort(123), 'max')
})

// ── 客户端请求字段契约（弹窗已移除模型/思考强度控件）──
test('OPTIMIZE_REQUEST_FIELDS：客户端不再发送 model / reasoningEffort（由宿主策略统一决定）', () => {
  assert.deepEqual(
    [...OPTIMIZE_REQUEST_FIELDS].sort(),
    ['context', 'cwd', 'draft', 'images'],
    '客户端请求体字段集合发生变化 —— 同步更新 client 的 fetch body 与 test/client-shape.test.mjs',
  )
  assert.ok(!OPTIMIZE_REQUEST_FIELDS.includes('model'), '模型由宿主默认决定，客户端不得再传')
  assert.ok(!OPTIMIZE_REQUEST_FIELDS.includes('reasoningEffort'), '思考强度由宿主默认决定，客户端不得再传')
})

// ── extractJSON 多路兜底 ──
test('extractJSON：裸 JSON 对象直接解析', () => {
  assert.deepEqual(extractJSON('{"optimized":"好提示","imageNote":""}'), { optimized: '好提示', imageNote: '' })
})

test('extractJSON：markdown 代码围栏（含 json 标注）内 JSON 可解析', () => {
  assert.deepEqual(extractJSON('```json\n{"optimized":"a"}\n```'), { optimized: 'a' })
  assert.deepEqual(extractJSON('```\n{"optimized":"b"}\n```'), { optimized: 'b' })
})

test('extractJSON：前后夹杂说明文字 → 取首 { 到尾 } 子串解析', () => {
  const out = extractJSON('好的，以下是结果：\n{"optimized":"c"}\n请查收。')
  assert.deepEqual(out, { optimized: 'c' })
})

test('extractJSON：字符串内嵌套花括号/引号转义 → 平衡扫描不误截断', () => {
  const out = extractJSON('{"optimized":"用 {大括号} 与 \\"引号\\" 写提示词","imageNote":"x"}')
  assert.deepEqual(out, { optimized: '用 {大括号} 与 "引号" 写提示词', imageNote: 'x' })
})

test('extractJSON：多对象前后缀 → 取第一个平衡对象；无 JSON/非字符串/空 → null', () => {
  const out = extractJSON('前缀 {"a":1} 中缀 {"b":2} 后缀')
  assert.deepEqual(out, { a: 1 })
  assert.equal(extractJSON('没有 json 的纯文本'), null)
  assert.equal(extractJSON('{未闭合'), null)
  assert.equal(extractJSON(''), null)
  assert.equal(extractJSON(null), null)
  assert.equal(extractJSON(123), null)
})

// ── 结果解析 ──
test('parseOptimizeResult：合法信封 → optimized 去空白 + imageNote；缺 imageNote → null 备注', () => {
  assert.deepEqual(parseOptimizeResult('{"optimized":"  好提示  ","imageNote":"图片含K线"}'), { optimized: '好提示', imageNote: '图片含K线' })
  assert.deepEqual(parseOptimizeResult('{"optimized":"a"}'), { optimized: 'a', imageNote: null })
  assert.deepEqual(parseOptimizeResult('{"optimized":"a","imageNote":""}'), { optimized: 'a', imageNote: null }, '空 imageNote → null')
})

test('parseOptimizeResult：optimized 缺失/非字符串/纯空白 → null（触发重试或兜底）', () => {
  assert.equal(parseOptimizeResult('{"imageNote":"x"}'), null)
  assert.equal(parseOptimizeResult('{"optimized":123}'), null)
  assert.equal(parseOptimizeResult('{"optimized":"   "}'), null)
  assert.equal(parseOptimizeResult('纯文本'), null)
  assert.equal(parseOptimizeResult(null), null)
})

test('plainTextFallback：非空文本兜底为优化结果；空白/非法 → null', () => {
  assert.deepEqual(plainTextFallback('  一段普通文本  '), { optimized: '一段普通文本', imageNote: null })
  assert.equal(plainTextFallback(''), null)
  assert.equal(plainTextFallback('   '), null)
  assert.equal(plainTextFallback(null), null)
  assert.equal(plainTextFallback(123), null)
})

// ── 重试判定（失败重试 2 次 = 共 3 次尝试）──
test('retryDecision：瞬态失败在 attempt 0/1 重试，attempt 2 终止（共 3 次）', () => {
  assert.equal(OPTIMIZE_MAX_ATTEMPTS, 3)
  assert.equal(retryDecision({ kind: 'transient' }, 0), true)
  assert.equal(retryDecision({ kind: 'transient' }, 1), true)
  assert.equal(retryDecision({ kind: 'transient' }, 2), false)
})

test('retryDecision：客户端取消永不重试；无失败不重试；越界 attempt 不重试', () => {
  assert.equal(retryDecision({ kind: 'client-aborted' }, 0), false)
  assert.equal(retryDecision({ kind: 'client-aborted' }, 1), false)
  assert.equal(retryDecision(null, 0), false)
  assert.equal(retryDecision({ kind: 'transient' }, -1), false)
  assert.equal(retryDecision({ kind: 'transient' }, 3), false)
})

// ── 超时阈值（1M 上下文 + 思考模式上调）──
test('OPTIMIZE_TIMEOUT_MS：按 1M 上下文与思考模式上调（≥10 分钟/次）', () => {
  assert.ok(OPTIMIZE_TIMEOUT_MS >= 600_000, '每次尝试超时 ≥ 600s')
})

// ── 提示词构建 ──
test('buildOptimizeSystemPrompt：含图片语义规则（视觉信息/不得编造/标注未采纳）与 JSON 输出契约', () => {
  const p = buildOptimizeSystemPrompt()
  assert.match(p, /图片/)
  assert.match(p, /视觉信息/)
  assert.match(p, /不得编造/)
  assert.match(p, /未采纳图片信息/)
  assert.match(p, /"optimized"/)
  assert.match(p, /"imageNote"/)
  assert.match(p, /JSON/)
  assert.match(p, /markdown 代码块/, '必须明确禁止 markdown 代码块输出')
})

test('buildOptimizeUserText：完整承载 正文/规范上下文/最近对话上下文（不截断）', () => {
  const draft = '帮我把 A 改造成 B'
  const spec = '# 规范上下文内容'
  const context = 'User: 你好\nAssistant: 你好'
  const t = buildOptimizeUserText(draft, spec, context)
  assert.ok(t.includes(draft), '正文完整保留')
  assert.ok(t.includes(spec), '规范上下文完整保留')
  assert.ok(t.includes(context), '对话上下文完整保留')
  const empty = buildOptimizeUserText(draft, spec, '')
  assert.ok(empty.includes('（无）'), '空上下文占位')
})

// ── 图片 payload 校验 ──
test('validateImagePayloads：合法图片保留；非法条目剔除并标记 dropped', () => {
  const images = [
    { mediaType: 'image/png', data: 'aGVsbG8=', name: 'a.png' },
    { mediaType: 'image/jpeg', data: 'aGVsbG8=' },
  ]
  const ok = validateImagePayloads(images)
  assert.equal(ok.images.length, 2)
  assert.equal(ok.dropped, false)
})

test('validateImagePayloads：非法 mediaType/空 data/非对象条目被剔除；全部剔除 → dropped=true', () => {
  const out = validateImagePayloads([
    { mediaType: 'image/bmp', data: 'aGVsbG8=' }, // 不支持格式
    { mediaType: 'image/png', data: '' }, // 空数据
    '不是对象',
    { mediaType: 'image/webp', data: 'aGVsbG8=' },
  ])
  assert.equal(out.images.length, 1)
  assert.equal(out.images[0].mediaType, 'image/webp')
  assert.equal(out.dropped, true, '存在被剔除条目 → dropped=true')
  const allDropped = validateImagePayloads([{ mediaType: 'image/bmp', data: 'x' }])
  assert.equal(allDropped.images.length, 0)
  assert.equal(allDropped.dropped, true)
})

test('validateImagePayloads：未提供 images 字段/非数组 → 空列表且 dropped=false（无图片请求，非降级）', () => {
  assert.deepEqual(validateImagePayloads(undefined), { images: [], dropped: false })
  assert.deepEqual(validateImagePayloads('x'), { images: [], dropped: false })
  assert.deepEqual(validateImagePayloads([]), { images: [], dropped: false })
})
