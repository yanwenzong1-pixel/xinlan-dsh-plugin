/**
 * ptc_task 的死循环/重复执行回归护栏（TDD：先红后绿）。
 *
 * 【被修的缺陷（全部来自源码与本机运行期取证，见交付报告的根因一节）】
 *  ① **递归派发 fail-open**：唯一护栏是子代理作用域里的 `tools.restrict({deny:[...]})`，
 *     失败时只写一行 `setupNote` 就照常派发 ⇒ 护栏没装上时子代理仍可再派 `ptc_task`
 *     （或经由预设注册的 scoped 派发工具），形成指数级重复执行。
 *  ② **无幂等键**：每次调用都 `randomUUID()` 新建子代理，没有 in-flight 去重表
 *     ⇒ 重复投递（模型重复发同一调用 / 传输重试 / 用户重复点击）会把同一件事跑 N 遍。
 *  ③ **无失败上限**：失败路径的提示本身就在邀请调用方"重派"，插件侧没有次数上限/熔断
 *     ⇒ create→fail→create 可以无限循环。
 *  ④ **`restrict` 的原子性陷阱**：名单里只要有一个**非全局**名字（例如预设注册的 scoped 工具），
 *     `restrict` 会**整条抛错**，于是连 `ptc_task` 也没被拦住（宿主实现：
 *     `packages/core/tools/src/index.ts#restrict()` 对未知名字抛错、过滤器是原子的）。
 *  ⑤ **可观测性**：插件完全不写日志，任务生命周期（派发/去重/失败次数/耗时/终局）无法追踪。
 *
 * 【本次不修的（如实登记为假设/遗留）】预设注册的 scoped 工具（subagent 等）本就
 * **不在 `restrict` 的管辖范围**（它只作用于全局工具）—— 这一层由"调用方深度兜底"覆盖：
 * 子代理（delegationDepth ≥ 1）再调 ptc_task 一律拒绝，因此递归在**本插件**这一侧必然终止。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { apply } = await import('../lib/index.js')

const PARENT_ID = 'parent-session'
const RESULT_A = 'C:/ws/out-a.json'
const RESULT_B = 'C:/ws/out-b.json'

/** 假 cordis ctx：只实现本插件用到的面（effect / get('agents') / timeout / logger）。 */
function makeCtx() {
  const state = {
    definition: null,
    created: [],
    logs: [],
    timers: [],
    restricted: [],
    restrictThrows: new Set(),
    presentAsCalls: 0,
  }
  const tools = {
    presentAs(mode) { state.presentAsCalls += 1; return () => {} },
    restrict(filter) {
      for (const name of filter?.deny ?? []) {
        if (state.restrictThrows.has(name)) throw new Error(`tools.restrict() names unknown global tool "${name}"`)
      }
      state.restricted.push(filter)
      return () => {}
    },
  }
  const ctx = {
    effect(fn) { const disposer = fn(); return () => { try { disposer?.() } catch { /* noop */ } } },
    get(name) { return name === 'agents' ? agents : undefined },
    timeout(fn, ms) { state.timers.push({ fn, ms }); return () => {} },
    logger: {
      info(message) { state.logs.push(message) },
      warn(message) { state.logs.push(message) },
    },
    tools: { register(definition) { state.definition = definition; return () => {} } },
  }
  const agents = {
    async create(options) {
      const child = makeChild(state, options)
      state.created.push({ options, child })
      try { options.setup?.(makeAgentCtx(tools)) } catch { /* 插件自身对 setup 也做了 try */ }
      return { agent: child, dispose: async () => { child.disposed += 1 } }
    },
  }
  return { ctx, state, tools }
}

function makeAgentCtx(tools) {
  return { get(name) { return name === 'tools' ? tools : undefined } }
}

/** 假子代理：whenIdle 由用例控制（默认立刻空闲），turn/end 由用例指定。 */
function makeChild(state, options) {
  const child = {
    options: options.agentOptions,
    disposed: 0,
    followups: [],
    idle: null,
    turnEndKind: 'completed',
    session: {
      header: { id: options.sessionId, cwd: options.meta?.cwd ?? '' },
      requestHeader: () => ({ config: {} }),
      snapshotEvents: () => [{ type: 'turn/end', data: { reason: { kind: child.turnEndKind } } }],
    },
    followup(message) { child.followups.push(message) },
    whenIdle() { return child.idle ?? Promise.resolve() },
  }
  return child
}

/** 假调用方 agent（主会话默认 delegationDepth 缺省 = 0）。 */
function makeParent(header = {}) {
  return {
    options: { provider: 'prov', model: 'mod', reasoningEffort: 'max', maxTokens: 100 },
    session: {
      header: { id: PARENT_ID, cwd: 'C:/ws', ...header },
      requestHeader: () => ({ config: {} }),
    },
  }
}

/** 装好插件并取出工具定义。 */
function mount(configOver = {}) {
  const h = makeCtx()
  apply(h.ctx, {
    preset: 'ptc-code',
    defaultBudgetMs: 1_200_000,
    denyTools: ['ptc_task'],
    ...configOver,
  })
  assert.ok(h.state.definition !== null, '插件必须在 effect 里注册 ptc_task 工具')
  return h
}

const exec = (parent) => ({ agent: parent })
const args = (over = {}) => ({ prompt: 'P:do the thing', resultPath: RESULT_A, ...over })

// ── ① 递归兜底：调用方本身已是子代理 ⇒ 一律拒绝派发（fail-closed，与护栏是否装上无关）──

test('G1 调用方是子代理（origin=subagent）⇒ 拒绝派发，且不创建任何子代理', async () => {
  const h = mount()
  const out = await h.state.definition.execute(args(), exec(makeParent({ origin: 'subagent' })))
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'nested-dispatch-refused')
  assert.equal(h.state.created.length, 0, '拒绝时必须连 agents.create 都不调用（否则仍会起一个子代理）')
})

test('G2 调用方 delegationDepth≥1 ⇒ 同样拒绝（框架把该字段定义为 recursion budget）', async () => {
  const h = mount()
  const out = await h.state.definition.execute(args(), exec(makeParent({ delegationDepth: 1 })))
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'nested-dispatch-refused')
  assert.equal(h.state.created.length, 0)
})

test('G3 主会话（无 origin / depth 缺省）不受影响：正常派发', async () => {
  const h = mount()
  const out = await h.state.definition.execute(args(), exec(makeParent()))
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(h.state.created.length, 1)
  assert.equal(out.timedOut, false)
})

// ── ② 幂等：同一任务并发/重复投递只执行一次 ────────────────────────────────

test('G4 同一任务并发投递 ⇒ 只创建一个子代理，两个调用方拿到同一 sessionId', async () => {
  const h = mount()
  const parent = makeParent()
  const [a, b] = await Promise.all([
    h.state.definition.execute(args(), exec(parent)),
    h.state.definition.execute(args(), exec(parent)),
  ])
  assert.equal(h.state.created.length, 1, '重复投递必须被幂等键拦住（否则同一件事被跑两遍）')
  assert.equal(a.sessionId, b.sessionId)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.equal(b.deduped, true, '被合并的那次必须如实标注 deduped')
})

test('G5 不同任务（同 prompt 不同 resultPath）不得被误合并', async () => {
  const h = mount()
  const parent = makeParent()
  await Promise.all([
    h.state.definition.execute(args({ resultPath: RESULT_A }), exec(parent)),
    h.state.definition.execute(args({ resultPath: RESULT_B }), exec(parent)),
  ])
  assert.equal(h.state.created.length, 2, '幂等键必须包含产出路径：不同产出是不同任务')
})

test('G6 串行重复投递（第一次已结束）⇒ 允许再次执行，但如实标注次数', async () => {
  const h = mount()
  const parent = makeParent()
  const first = await h.state.definition.execute(args(), exec(parent))
  const second = await h.state.definition.execute(args(), exec(parent))
  assert.equal(h.state.created.length, 2, '已结束的任务允许重跑（否则无法重试真正失败的任务）')
  assert.equal(second.attempts, 2, '必须如实报出这是同一任务的第几次尝试')
  assert.equal(first.attempts, 1)
})

// ── ③ 失败上限/熔断：把 create→fail→create 的无限回路截断 ────────────────

test('G7 同一任务连续失败达上限 ⇒ 熔断拒绝，不再创建子代理', async () => {
  const h = mount({ maxConsecutiveFailures: 2 })
  const parent = makeParent()
  // 让子代理每次都失败（turn/end = error）
  const origCreate = h.state.created
  const fail = async () => {
    const out = await h.state.definition.execute(args(), exec(parent))
    // 第一次/第二次都让它失败：把子代理的 turnEnd 设成 error
    return out
  }
  // 通过 create 后注入失败原因
  const patch = () => { const last = h.state.created[h.state.created.length - 1]; if (last) last.child.turnEndKind = 'error' }
  const r1p = fail(); patch(); const r1 = await r1p
  const r2p = fail(); patch(); const r2 = await r2p
  const r3 = await h.state.definition.execute(args(), exec(parent))
  assert.equal(r1.ok, false, '第一次失败')
  assert.equal(r2.ok, false, '第二次失败')
  assert.equal(r3.ok, false)
  assert.equal(r3.reason, 'circuit-open', '达上限后必须熔断（否则调用方会无限重派）')
  assert.equal(h.state.created.length, 2, '熔断后不得再创建子代理')
  assert.equal(origCreate.length, 2)
})

test('G8 成功后失败计数清零（熔断不得误伤正常重试）', async () => {
  const h = mount({ maxConsecutiveFailures: 1 })
  const parent = makeParent()
  const ok1 = await h.state.definition.execute(args(), exec(parent))
  assert.equal(ok1.ok, true)
  const ok2 = await h.state.definition.execute(args(), exec(parent))
  assert.equal(ok2.ok, true, '成功过就不该被熔断拦住')
  assert.equal(h.state.created.length, 2)
})

// ── ④ 护栏：逐个应用（原子性陷阱）+ 装不上就 fail-closed ──────────────────

test('G9 denyTools 里有非全局名字时，`ptc_task` 的拒绝仍必须生效（过滤器原子性陷阱）', async () => {
  const h = mount({ denyTools: ['ptc_task', 'not_a_global_tool'] })
  h.state.restrictThrows.add('not_a_global_tool')
  const out = await h.state.definition.execute(args(), exec(makeParent()))
  const denied = h.state.restricted.flatMap((f) => f.deny ?? [])
  assert.equal(denied.includes('ptc_task'), true, '一个坏名字不得让整条 filter 失效（宿主 restrict 对未知名字整条抛错）')
  assert.equal(out.ok, true)
  assert.match(String(out.setupNote), /ptc_task/, '护栏结果必须写进 setupNote')
  assert.match(String(out.setupNote), /not_a_global_tool/, '失败的那个名字也必须如实记下')
})

test('G10 递归护栏完全装不上 ⇒ 拒绝派发（fail-closed），不留悬空子代理', async () => {
  const h = mount()
  h.state.restrictThrows.add('ptc_task')
  const out = await h.state.definition.execute(args(), exec(makeParent()))
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'guard-unavailable')
  assert.equal(h.state.created.length, 1, '子代理已创建，但必须被释放')
  assert.equal(h.state.created[0].child.disposed >= 1, true, '拒绝时必须 dispose，不能留下无人管的子代理')
})

test('G11 显式声明"不要护栏"（denyTools 为空）⇒ 不因护栏缺席拒绝（保持兼容）', async () => {
  const h = mount({ denyTools: [] })
  const out = await h.state.definition.execute(args(), exec(makeParent()))
  assert.equal(out.ok, true, '没要求护栏就不该被护栏拦住')
})

// ── ⑤ 终止性与可观测性 ──────────────────────────────────────────────

test('G12 子代理永不空闲 ⇒ 预算到点必须收尾：超时返回 + 释放句柄', async () => {
  const h = mount()
  const pending = h.state.definition.execute(args(), exec(makeParent()))
  // 让子代理永远不空闲：把 idle 换成一个永挂的 promise
  h.state.created[0].child.idle = new Promise(() => {})
  await Promise.resolve()
  // 触发假 timer（插件的墙钟守卫）
  const timer = h.state.timers[h.state.timers.length - 1]
  assert.ok(timer !== undefined, '必须注册墙钟守卫（否则 whenIdle 永挂 = 工具调用永久阻塞）')
  timer.fn()
  const out = await pending
  assert.equal(out.timedOut, true)
  assert.equal(out.ok, false)
  assert.equal(out.spent, 'timeout')
  assert.equal(h.state.created[0].child.disposed >= 1, true, '超时也必须释放子代理')
})

test('G13 生命周期日志必须可追踪（派发/终局各一行，含 sessionId 与耗时）', async () => {
  const h = mount()
  const out = await h.state.definition.execute(args(), exec(makeParent()))
  assert.equal(out.ok, true)
  const joined = h.state.logs.join('\n')
  assert.match(joined, /ptc_task/, `日志必须含工具名；实际：${joined}`)
  assert.match(joined, new RegExp(String(out.sessionId)), '日志必须含 sessionId，否则无法从日志追到子代理会话')
  assert.match(joined, /out-a\.json/, '日志必须能看出是哪个任务（产出路径），否则多任务并行时无法对账')
  assert.equal(typeof out.durationMs, 'number', '结果必须带耗时，便于对账')
})

test('G16 宿主未装配 logger 时，日志必须走 stdout 兜底（否则可观测性静默消失）', async () => {
  // 本机实测：`ctx.logger` 的输出去向在 dsh-web.log / dsh-web.err.log / dsh-watchdog.log / 看板 ops.log
  // 里**一处都查不到** ⇒ 很可能该部署没有装配 logger 服务。此时若不兜底，"生命周期可追踪"就是空调用。
  const h = mount()
  delete h.ctx.logger
  const printed = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => { printed.push(String(chunk)) ; return true }
  try {
    const out = await h.state.definition.execute(args(), exec(makeParent()))
    assert.equal(out.ok, true)
  } finally {
    process.stdout.write = original
  }
  const joined = printed.join('\n')
  assert.match(joined, /ptc_task/, `stdout 兜底必须打出生命周期日志；实际：${joined}`)
  assert.match(joined, new RegExp(String(h.state.created[0].options.sessionId)), 'stdout 日志同样要能追到 sessionId')
})

test('G17 即使宿主装配了 logger，也必须同时写 stdout（否则文件级取证不可验证）', async () => {
  // 本机实测：宿主**有** `ctx.logger`（所以 G16 的兜底不会触发），但它的落点不在
  // dsh-web.log / dsh-web.err.log / dsh-watchdog.log / 看板 ops.log 任何一个里 ——
  // 而这些文件里**有**另一个插件的 stdout 行（`[aml] …`）⇒ stdout 才是可验证的取证通道。
  // 故两条通道都要写：logger 供面板，stdout 供文件级取证。
  const h = mount()
  const printed = []
  const original = process.stdout.write
  process.stdout.write = (chunk) => { printed.push(String(chunk)) ; return true }
  try {
    const out = await h.state.definition.execute(args(), exec(makeParent()))
    assert.equal(out.ok, true)
  } finally {
    process.stdout.write = original
  }
  assert.equal(h.state.logs.length > 0, true, 'logger 通道仍须有日志')
  assert.match(printed.join('\n'), /ptc_task/, 'stdout 通道也必须有（文件级取证）')
})

test('G14 参数缺失/无调用方 ⇒ 明确拒绝且不建子代理（边界输入）', async () => {
  const h = mount()
  const bad1 = await h.state.definition.execute({ prompt: '', resultPath: RESULT_A }, exec(makeParent()))
  const bad2 = await h.state.definition.execute(args(), {})
  assert.equal(bad1.ok, false)
  assert.equal(bad1.reason, 'bad-args')
  assert.equal(bad2.ok, false)
  assert.equal(bad2.reason, 'no-caller-agent')
  assert.equal(h.state.created.length, 0)
})

test('G15 拿不到路由（无 model）⇒ 拒绝派发，不建子代理', async () => {
  const h = mount()
  const parent = makeParent()
  parent.options = {}
  parent.session.requestHeader = () => ({ config: {} })
  const out = await h.state.definition.execute(args(), exec(parent))
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'no-route')
  assert.equal(h.state.created.length, 0)
})
