# @dsh-external/dsh-ptc-task

向宿主注册 `ptc_task` 工具：把「步骤事先能说清、中途不需要看结果再决定」的多步任务，
交给一个**工具以 PTC（code）模式呈现**的子代理执行。子代理写一段 TypeScript 程序经
`run_code` 组合多步操作，中间输出留在程序里，只有结论回到上下文；主会话的工具面保持原生。

- 当前版本：`0.1.0`（`package.json`）
- 形态：**纯宿主插件**（`src/index.ts` + `lib/index.js`，没有客户端半，不需要 tsdown）
- 依赖注入（硬依赖）：`tools`、`agents`、`timer`（`src/index.ts:30`）

## 一、它解决什么问题

PTC 是**按作用域**生效的呈现方式（`ctx.tools.presentAs(mode)`，最近作用域优先）。
进程级开关 `DSH_TOOLS_MODE` 会把主 agent 一起切到 code 模式，而本插件用
`setup(agentCtx)` 只在**子代理作用域**里声明 code 模式，主会话不受影响
（`src/index.ts:8-10`、`:449-451`）。

适用：逐项跑脚本、批量扫描、对账、聚合汇总这类「步骤已确定」的活。
不适用：需要边看中间结果再判断下一步的探索型任务（工具描述里就写明了这一点，
`src/index.ts:141-143`）。

## 二、工具签名

工具名：`ptc_task`（`src/index.ts:305`）。注册在宿主侧，**对所有会话可见**。

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `prompt` | string | ✅ | — | 自包含的完整任务说明（产出什么、写到哪个路径、判据是什么） |
| `resultPath` | string | ✅ | — | 子代理必须把最终结果写入的路径（工作区绝对路径） |
| `cwd` | string | — | 调用方会话工作区 | 子代理工作目录 |
| `budgetMs` | number | — | `1200000`（20 分钟） | 墙钟上限（毫秒）；**小于 60000 视为无效**，回落到默认值（`:351-353`） |
| `model` | string | — | 继承调用方 | 模型覆写 |
| `reasoningEffort` | string | — | 继承调用方 | 推理档位覆写：`low` / `high` / `max` |

返回是 JSON（`output.schema: { type: 'json' }`），字段随结局不同：

| 字段 | 说明 |
| --- | --- |
| `ok` | 布尔。`timedOut` 或 `turnEnd` 以 `error:` 开头即为 `false` |
| `sessionId` | 子代理会话 id（`randomUUID()`），可用于事后定位 |
| `cwd` / `route` / `resultPath` | 实际使用的工作目录、路由（`provider/model @effort`）、产出路径 |
| `spent` | `idle`（正常收尾）或 `timeout` |
| `timedOut` | 是否因预算到点被收尾 |
| `turnEnd` | 子代理最后一次 `turn/end` 的原因；失败时为 `error: <message>` |
| `setupNote` | 递归护栏安装情况（例如 `presentAs(code) ok; deny=ptc_task`） |
| `attempts` | 该任务累计第几次尝试 |
| `parentDepth` | 调用方会话的委派深度 |
| `deduped` | 是否命中了并发去重（合并到上游结果） |
| `durationMs` | 墙钟耗时 |
| `hint` | 给下一步行动的建议（超时/失败/成功各不同，`:544-548`） |

## 三、三道护栏（都是实操踩坑后加的）

1. **递归兜底：调用方已是子代理 ⇒ 直接拒绝。**
   判据取框架自己的 recursion budget —— `SessionHeader.delegationDepth`（顶层字段），
   缺失但有 `origin: 'subagent'` 时按 1 算（`:213-219`）。深度 ≥ 1 一律拒绝，
   链长因此恒 ≤ 1，**与本插件的护栏是否装得上无关**（`:329-344`，测试 G1/G2）。
2. **fail-closed 的递归护栏：装不上就不派发。**
   子代理作用域内逐个名字调 `tools.restrict({ deny: [name] })` 拒绝全局工具
   （默认拒绝 `ptc_task` 自己）。工具名逐个应用而非整表一次调用 —— `restrict` 的过滤器是
   **原子**的，名单里有一个未知名字会整条抛错、导致护栏静默失效（`:455-458`，测试 G9）。
   护栏没装上时默认**拒绝执行**并返回 `guard-unavailable`（`:496-514`，测试 G10）——
   2026-09-17 的死循环缺陷就是"只写一行 setupNote 然后照常派发"造成的指数级重复执行。
3. **幂等 + 熔断。**
   幂等键 = `preset ␀ resultPath ␀ prompt ␀ cwd ␀ model ␀ effort`（`:221-231`）。
   同一任务在途中再被投递 ⇒ **合并等待**同一结果并标 `deduped: true`，不再起第二个子代理
   （`:372-385`，测试 G4/G5/G6）；同一任务连续失败达上限 ⇒ 熔断返回 `circuit-open`，
   明确告诉调用方不要再自动重派（`:387-400`，测试 G7/G8）。

## 四、失败码一览

| `reason` | 触发条件 |
| --- | --- |
| `bad-args` | `prompt` 或 `resultPath` 为空（`:322-324`） |
| `no-caller-agent` | 拿不到调用方 agent（非 agent 会话调用） |
| `nested-dispatch-refused` | 调用方已是子代理（`delegationDepth ≥ 1`） |
| `no-agents` | 宿主未装配 `agents` 服务 |
| `no-route` | 从调用方会话解析不出 model（`:358-360`） |
| `circuit-open` | 同一任务连续失败达 `maxConsecutiveFailures` |
| `create-failed` | `agents.create` 抛错 |
| `bad-handle` | 创建的句柄没有可用的 `agent.followup` |
| `guard-unavailable` | 递归护栏未装上且 `requireRecursionGuard` 为真 |
| `followup-failed` | 投递 prompt 或等待空闲时抛错 |

## 五、配置项

`Config` schema 见 `src/index.ts:63-70`，默认值如下：

| 配置 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `preset` | string | `'ptc-code'` | 子代理挂载的 agent preset，决定它的工具面与人格 |
| `defaultBudgetMs` | number | `1200000` | 调用方未传 `budgetMs` 时的墙钟上限（< 60000 视为无效） |
| `denyTools` | string[] | `['ptc_task']` | 子代理作用域内**拒绝**的全局工具名（禁递归派发） |
| `requireRecursionGuard` | boolean | `true` | 护栏装不上时是否拒绝派发（fail-closed）；配 `denyTools: []` 时本项不生效 |
| `maxConsecutiveFailures` | number | `3` | 同一任务连续失败达该次数熔断；`0` = 关闭 |
| `circuitWindowMs` | number | `600000` | 熔断窗口（10 分钟）：超出窗口的旧失败不计入连续失败 |

## 六、接入方式

`cordis.patch.yml` 把本包插进 profile 层栈：

```yaml
- insert:
    - id: dsh-ptc-task
      name: '@dsh-external/dsh-ptc-task'
```

**契约（写在 `cordis.patch.yml` 头部注释里，来自 2026-09-16 事故）**：凡是列进 profile
`dsh.profile.bundles` 的包，**必须**在 `package.json` 里声明 `dsh.bundle.patch` 指向这个
文件，且文件必须真实存在；否则宿主加载 profile 时直接抛
`profile bundle "<pkg>" declares no dsh.bundle in its package.json` 并退出 ——
**爆炸半径是整个 dsh-web（用户所有会话/面板），不是「这个插件不生效」**。

## 七、构建与测试

```powershell
pwsh -NoProfile -File scripts/build.ps1        # 等价于 npm run build
npm run typecheck                              # tsc -p tsconfig.json --noEmit
npm test                                       # node --test "test/*.test.mjs"
```

`scripts/build.ps1` 的行为与前置条件（`:14-76`）：

1. 前置检查：`-Checkout` 指向的 DSH 源码 checkout 必须存在（默认值是占位路径
   `C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1`，
   本机需按实际情况传参），且其中 `node_modules\.bin\tsc.cmd` 存在。
2. 在插件自己的 `node_modules` 下建**精确 junction**（cordis / schemastery / dsh-tools / @types/node），
   指向 checkout 里的真实包位置；**不会**整体 junction 到 checkout 的 `node_modules`（那样拿不到 cordis）。
3. 用 checkout 里的 tsc 编译 `tsconfig.json` → `lib/index.js`，然后 `node --check` 做语法自检。
4. 参数：`-SkipLink` 跳过建链接（依赖已就位时）。

测试集 `test/ptc-task-guard.test.mjs` 实测 **17 例全部通过**（`node --test`，G1–G17），覆盖递归拒绝、
并发去重、熔断与清零、护栏原子性陷阱、fail-closed、超时收尾、日志可观测性与边界输入。

## 八、典型用法

| 场景 | 怎么做 | 发生什么 |
| --- | --- | --- |
| 批量对账 | 顶层会话调 `ptc_task`，`prompt` 写明「逐项核对 A 与 B，把差异表写到 `<abs>/diff.json`」 | 子代理以 code 模式组合多步操作，只把结论路径回给你；你读 `resultPath` |
| 大范围扫描 | 同上，`resultPath` 指向汇总文件，`budgetMs` 调大 | 中间输出留在子代理的程序里，主上下文不被刷屏 |
| 需要隔离的脏活 | 传 `cwd` 指定子目录 | 子代理在指定工作目录跑，主会话工作区不受影响 |
| 换模型跑同一件事 | 传 `model` / `reasoningEffort` | 只覆盖子代理路由；未点名档位时会清掉父级档位，让新模型用自己的默认（`:171-173`） |
| 重复投递同一件事 | 原样再调一次 | 在途时合并等待同一结果并标 `deduped: true`；已结束后允许再跑，但 `attempts` 如实递增 |

## 九、注意事项与坑

1. **`prompt` 必须自包含**：子代理看不到你的对话上下文，判据、产出路径都要写在 `prompt` 里；
   `resultPath` 建议用工作区绝对路径。
2. **不要让子代理再派发**：调用方 `delegationDepth ≥ 1` 时本工具一律拒绝
   （`nested-dispatch-refused`），设计上就是链长 ≤ 1。
3. **`denyTools` 里写错名字会连带影响护栏**：`restrict` 过滤器是原子的，插件为此改成逐个名字
   应用；被拒的名字会写进 `setupNote` 的 `guard-refused=`。写 `denyTools: []` 等于
   主动声明不要护栏，`requireRecursionGuard` 随之失效。
4. **超时是"收尾"不是"杀掉"**：预算到点返回 `timedOut: true` 并释放句柄，子代理可能没写完产物 ——
   先读 `resultPath` 判断完整性再决定要不要重派（`:544-546`）。
5. **路由解析失败不派发**：拿不到 model 时返回 `no-route`，而不是发一个空 options 的子代理。
   这条是硬要求：空 options 会让子代理第一步就 `turn/end error` 且请求从未发出（0 token、0 工具调用），
   看起来像"跑完了没产物"，实际是"根本没开始"（`src/index.ts:12-19`）。
6. **三张表只存在进程内**（`inFlight` / `attempts` / `failures`，`:259-270`）：重启宿主后
   幂等与熔断计数清零；`attempts` 表超过 1024 条整体清空（`:404`）。
7. **日志走双通道**：宿主 logger + `process.stdout.write`（`[ptc-task] …`）。本部署里
   `console.log` 不进 `dsh-web.log`，只有 stdout 可在文件层面取证（`:287-301`）。
8. **构建依赖本机 DSH checkout**：不传 `-Checkout` 会按占位默认路径找不到依赖而直接报错
   （`checkout 不可用` / `tsc 缺失`）。`lib/` 已提交，日常只是加载插件的话不需要重新构建。

## 十、依赖与许可

- peerDependencies：来自宿主/checkout 的 `cordis`、`schemastery`、`@deepseek-ai/dsh-tools`（构建时以 junction 提供）。
- 运行时要求：Node.js ≥ 20（`engines`）；宿主需装配 `tools`、`agents`、`timer` 三个服务。
- 许可：`BSD-3-Clause`（`package.json`）。
