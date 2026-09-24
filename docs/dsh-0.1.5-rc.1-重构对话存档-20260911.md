# DSH 0.1.5-rc.1 升级重构 —— 对话存档

> 存档日期：2026-09-11
> 主题：更新 DeepSeek Harness 系统后，重构 test 下的三个项目
> 参与：用户 / AI 编码代理（DSH Web GUI，会话 `session-b631e46f-9d47-49a5-82e6-59a5b71d0741`）
> 说明：本文按对话顺序整理，保留了全部实测数据、结论、纠正过程与未决事项。
> 相关产物：`_upgrade\dsh-v0.1.5-rc.1\evidence\refactor-report-2026-09-11.md`

---

## 目录

1. [第 1 轮：需求确认与现场勘察](#第-1-轮需求确认与现场勘察)
2. [第 2 轮：动手前的关键事实澄清](#第-2-轮动手前的关键事实澄清)
3. [第 3 轮：执行过程与结果](#第-3-轮执行过程与结果)
4. [第 4 轮：针对 Zcode 看门狗迁移的提示词](#第-4-轮针对-zcode-看门狗迁移的提示词)
5. [附录：全部实测数据与证据索引](#附录全部实测数据与证据索引)

---

## 第 1 轮：需求确认与现场勘察

### 用户

> 我更新了DeepSeek harness的系统，帮我重构项目

（会话起始为"审批策略由 ask 变更为 never"）

### 勘察：先摸清现场，不假设

工作目录 `C:\Users\<user>\Documents\Deepseek\test`，含三个候选项目与多个第三方克隆。
关键环境变量：

```
DSH_HOME          = C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\iso-dsh
DSH_SESSION_ID    = session-b631e46f-9d47-49a5-82e6-59a5b71d0741
DSH_WEB_URL       = http://127.0.0.1:3080
```

发现 `_upgrade\dsh-v0.1.5-rc.1\deliverables\` 下已有一整套升级交付文档
（00 索引 / 01 版本规则 / 02 原子步骤 / 03 破坏性变更 / 04 升级方案 / 05 三插件适配 / 06 命令 / 07 风险）。

### 向用户确认了两个问题

**问题一：真实重构对象是哪一处？** 提供四个候选。
**问题二：范围如何界定？**

### 用户回答

- 目标：`test 下的 dsh-quick-append` + `test 下的 dsh-dialogue-alert-message`
  + `test 下的 Python 量化项目（src/quant_analysis）`
- 范围：**按 _upgrade 交付文档执行其中已就绪的阶段**

### 勘察中发现的第一个重大不一致

交付文档 `deliverables/00` 声称：

> 🔴 本轮重大发现：官方分发渠道是 npm —— 装 `@deepseek-ai/dsh@0.1.5-rc.1`
> （tarball 16,622 B）即可，**阶段 2 不需要编译源码**。

但现场证据显示升级**并未成功**：

`evidence/phase2-result.json`：

```json
{ "installed": false, "version": null, "ready": false,
  "steps": [ { "step": "P2", "status": "FAIL",
               "detail": "exit=1 elapsed=4.2min node_modules=False" } ] }
```

`evidence/phase2-run.log`：

```
[03:15:09] [ERR_PNPM_BROKEN_METADATA_JSON] The operation was aborted due to timeout
[03:15:10] P2 : FAIL - exit=1 elapsed=4.2min node_modules=False
```

### 勘察到的其它事实

| 项 | 值 |
|---|---|
| `dsh.cmd` 指向 | `C:\Users\<user>\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js`，版本 **0.1.1-rc.2** |
| harness checkout | `Documents\Software\DeepSeekHarness`，`git describe` = **dsh-v0.1.1-rc.2** |
| live 3080 进程 | PID 34932，`ds-node.exe ... \ds-h\run\apps\cli\lib\main.mjs web` |
| live boot 图谱 | **42 条，全部为官方 `@deepseek-ai/*`，两个插件一条都没有** |
| 插件装配位置 | `~\.dsh\profiles\web\node_modules\@dsh-external\` 下为 junction，指向 test 目录 |

### 向用户说明并请示

> 实测结论：当前运行的就是 0.1.1-rc.2，**0.1.5-rc.1 根本没装上**，而且当前 GUI(3080)
> 的 boot 图谱只有 42 条官方条目，你的两个插件**一个都没加载**。你想怎么走？

### 用户回答

- 先重试安装 0.1.5-rc.1，装不上再退而求其次
- **允许重启 3080 验证**

---

## 第 2 轮：动手前的关键事实澄清

建立了长期目标（goal）与任务清单，随后并行推进。

### 用户追加确认的两个方向性问题

**问题一：Python 量化项目的重构要做到哪一步？**
**问题二：`dsh-quick-append` 目前只用 `homedir()` 定位缓存，忽略 `DSH_HOME`，改吗？**

### 用户回答

- Python：**清理 + 小幅能力提升**（旧式注解、信号生成抽函数、指标扩展；不新增依赖、不改目录结构）
- 插件：**改为尊重 `DSH_HOME`**

### 里程碑 1：0.1.5-rc.1 安装 —— npm 渠道被证伪

第一次重试（镜像 `registry.npmmirror.com`）时网络已恢复，481 个包下载完成，
`@deepseek-ai/dsh@0.1.5-rc.1` 落地。但随后暴露一连串缺口：

**缺口一：`@deepseek-ai/cordis-plugin-group` 未声明**

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/cordis-plugin-group'
imported from .../@deepseek-ai/dsh-app-boot/lib/index.js
```

该包**在 npm 上已发布**（最新 1.0.2），只是聚合包漏了 `dependencies` 条目。

**缺口二：规模化缺口（写脚本迭代扫描取证）**

新增 `iso-install\close-deps.mjs`，反复扫描 node_modules 中所有 `@deepseek-ai/*`
的 `lib/*.js`，收集"被引用但缺失"的包：

| 项 | 实测值 |
|---|---|
| `@deepseek-ai/dsh` 声明的依赖数 | 72 |
| 静态 import 但**未声明**的内部包 | **30 个** |
| 其中**在 npm 上根本没发布**的 | `@deepseek-ai/dsh-timeout-guard`（404） |

补齐可补的之后，loader 启动仍成片报错（节选）：

```
Cannot find package '@deepseek-ai/dsh-fs'
Cannot find package '@deepseek-ai/dsh-sandbox'
Cannot find package '@deepseek-ai/dsh-shell'
Cannot find package '@deepseek-ai/dsh-session-persistence'
Cannot find package '@deepseek-ai/dsh-compaction'
Cannot find package '@deepseek-ai/dsh-code-runtime'
Cannot find package '@deepseek-ai/dsh-anonymous-user-id'
...
```

**这些都是核心服务**（sandbox / fs / shell / 会话持久化 / agent-loop 全在其中）。

### 阶段结论（对交付文档的纠正）

> npm 渠道的 0.1.5-rc.1 **连 boot 都过不去**。它不是"需要打补丁"，而是发布物不完整
> —— 其 216 个已装包中，自身代码引用的内部包有 30 个从未被声明。
> 「安装 rc 到隔离 profile」这条路线在当前发布形态下**不可用**。

### 里程碑 2：改走源码归档，成功构建 0.1.5-rc.1

源码树位于 `_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1`，
确认为**完整**的 0.1.5 树：

| 0.1.5 标志 | 存在 |
|---|---|
| `package.json` version = `0.1.5-rc.1` | ✔ |
| `benchmarks/` | ✔ |
| `native/system`（而非 `native/landlock-run`） | ✔ |
| `examples/`（0.1.2 起已移除） | ✘ 正确 |
| `SAFETY.md` / `snapshots/` / `vitest.expected.config.ts` | ✔ |

构建步骤与实测耗时：

```powershell
pnpm install --frozen-lockfile --registry https://registry.npmmirror.com   # 29.3s
pnpm run build:lib                     # host + client，约 3 分钟
pnpm run build:web                     # ★ 交付文档未列，必需
node apps/cli/lib/bin.js --version     # -> 0.1.5-rc.1
```

> **新增必知项**：`build:lib` **不构建** `apps/web` 的 vite 产物。
> 缺少它时 `dsh web` 的 `/` 返回 **404**（不是 401、不是白屏，是 404）——
> 这一点在排查时极易误判为服务损坏。

### 里程碑 3：两个插件的静态核对（交付物 05 的 U1–U18）

| 检查项 | ALERT | QA |
|---|---|---|
| 产物含 `exports.apply` / `exports.inject` | ✔ / ✔ | ✔ / ✔ |
| `inject` 数组内容 | `["slots"]` | `["slots","conversation"]` |
| `__ModuleLoader__.load` factory 形态 | ✔ | ✔ |
| `inject` 含 `remote.` 命名空间 | ✘（正确） | ✘（正确） |
| 宿主 `inject` | `['webServer','sessions','llm']` | `['webServer','llm','attachments']` |
| peer 范围 | `>=0.0.1-rc <2` | 同 |
| 零参 RPC | N/A（无 remote） | N/A（无 remote） |

---

## 第 3 轮：执行过程与结果

### 3.1 发现交付文档的一处事实错误

`deliverables/05` §A7 原文：

> `buildAlertPayload` 返回 `{schema_version:'alert.v1', …}` 但
> **在 `index.ts:46` 被 import 却未被调用**

实测 grep：

```
L46 : buildAlertPayload,          ← import
L260: const payload = buildAlertPayload({   ← ★ 明确调用了
```

**但 §A7 的冻结结论（不产生 `alert.v1` 外部副作用）是正确的**，只是理由不同。
补取证后的真实机制：

| 取证 | 结果 |
|---|---|
| `ctx.emit` / `ctx.broadcast` / `alertHub` / `alert/ingest` / `eventbus` | **全部 0 命中** |
| 宿主实际使用的 ctx 能力 | 仅 `ctx.logger`(9) / `ctx.effect`(6) / `ctx.on`(3) |
| payload 去向 | 进内部数组 → 插件自建 HTTP 路由 `/api/alarm` → 自己的客户端消费 |

⇒ 冻结的**真实机制是「结构性不可达」**，而非「函数没被调用」。

### 3.2 插件的四处真实缺陷与修复

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| **D1** | `files` 只有 `"lib"`，**未打包 `cordis.patch.yml`** | 用 `dsh plugin add` 走真实装配时报 `failed to read overlay ...: ENOENT`，**整个 boot 失败** | `files: ["lib","cordis.patch.yml"]` |
| **D2** | `tsconfig.json` 未排除 `src/client` | 实测 `lib\client\index.js` 确为 tsc 产物 | `"exclude": ["src/client"]` |
| **D3** | QA 缓存目录只用 `homedir()`，忽略 `$DSH_HOME` | 交付文档 X1/R-B4 已登记 | 新增 `resolveDshHome()` |
| **D4** | 两个插件**都没有** `check:client-shape` 门禁 | 交付文档 T2/AC-5 要求存在 | 新增门禁测试 + `postbuild:client` |

> **D1 是唯一会直接导致启动失败的缺陷**，且只在真实装配路径下暴露 ——
> 旧环境用 junction 指向源码目录，`cordis.patch.yml` 恰好存在，所以从未被发现。

### 3.3 D3 的 TDD 过程（红 → 绿）

**红**：先写测试

```js
test('resolveDshHome：$DSH_HOME 优先于 ~/.dsh（隔离验证前提）', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'C:\\iso\\home' }), 'C:\\iso\\home')
})
test('resolveDshHome：空白 $DSH_HOME 视为未设（与 harness 约定一致）', () => {
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }), join(homedir(), '.dsh'))
})
```

运行结果：`ℹ pass 0 / ℹ fail 1`（模块未导出 `resolveDshHome`）——红态确认。

**绿**：实现，优先级与 harness 的 `packages/util/home-paths` 对齐：

```ts
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh')
}
```

**过程中修掉一个本就失效的旧断言**：原测试断言 `dir.includes('.dsh')`，
在 Windows 上 `join()` 产出反斜杠，该断言必然失败（存量隐患）。
最终改为与运行环境无关的写法：

```js
assert.ok(dir.startsWith(resolveDshHome()))
```

### 3.4 0.1.5 的 boot 契约发生了三处变化（重要）

| 项 | 0.1.1-rc.2 | 0.1.5-rc.1（实测） |
|---|---|---|
| `/` 未带 token | 200 | **401**；启动时打印 `?token=<TOKEN>` |
| `entries[].rev` | `sha1(lib/client.js)` 前 12 位 | **`<batch-hash>-<index>`**，如 `fa953b91102ba225-44` |
| boot payload 结构 | `{rev, entries}` | **`{rev, entries, batches}`** |
| `rev` 不变量 | `rev == sha1(JSON.stringify({entries,batches}))[0:12]` | **仍然成立**（实测 `f2fe879326f2`，MATCH=true） |

⇒ 交付文档 AC-2/AC-13 的「`row.rev` == 磁盘 bundle sha1 前 12 位」判据
**在 0.1.5 上已失效**，必须改用 batch 结构判据。
而 `window.__ModuleLoader__.load({id, factory})` 契约**未变**
（application batch 内 54 个 factory 全为此形态）。

### 3.5 真实 0.1.5 运行时的装配验证

隔离实例：源码构建的 0.1.5，`DSH_HOME=…\iso-src-verify`，端口 13090。

| 步骤 | 判据 | 实测 |
|---|---|---|
| 装配两个插件 | `dsh plugin --profile web add <pkg>` | 均成功，自动写入 `dsh.profile.bundles` |
| 组合配置 | `--dump-config` 含两个 entry | ✔，exit 0 |
| boot 图谱 | 两个 id 出现 | ✔，`entries=55` |
| `rev` 不变量 | sha1 复算 | MATCH |
| 客户端包可取到 | application batch URL | **11,112,562 B**，200 |
| bundle 真在里面 | batch 内含我们的 id | ✔，`__ModuleLoader__.load` 计数 = 54 |
| 隔离性 | 真实 `~/.dsh` 未被写入 | ✔ |

### 3.6 过程中两次自伤（诚实记录）

**自伤一：PowerShell 只读变量**

```powershell
$home='C:\...\iso-src-verify'   # ← $HOME 是只读常量，赋值失败
$env:DSH_HOME=$home             # ← 结果为空，实例用了默认 ~/.dsh
```

后果核查：该实例误用默认家目录启动。**核查后确认影响干净** ——
`~/.dsh/profiles` 未改动、未新建 profile、未迁移会话，
窗口期内只有实时 GUI 自己的插件日志在写。随后改用 `$verifyHome` 重启。

**自伤二：路径少爬一层**

```powershell
$srcRoot = Split-Path (Split-Path (Split-Path $DshCli -Parent) -Parent) -Parent
# 得到 ...\src\deepseek-harness-dsh-v0.1.5-rc.1\apps  → 拼出 apps\apps\web\dist\...
```

被脚本自己的前置校验拦下（`web frontend artifact missing: ...\apps\apps\web\dist\index.html`），
修正为爬四层。

**自伤三：测试期望值手算错误（3 次）**

`stochastic` 测试中，我连续三次手算 `rolling(min_periods=2).min()` 出错。
最终改为从滚动窗口直接推导期望值，不再手算：

```python
highest = high.rolling(window=2, min_periods=2).max()
lowest  = low.rolling(window=2, min_periods=2).min()
expected = 100.0 * (close - lowest) / (highest - lowest)
pd.testing.assert_series_equal(percent_k[valid], expected[valid])
```

**自伤四：中文 .ps1 被解析坏**

Windows PowerShell 5.1 对**无 BOM** 的 `.ps1` 按 ANSI 解析，中文字符串破坏语法：

```
Unexpected token 'DSH_HOME' in expression or statement.
The string is missing the terminator: ".
```

修复：重启脚本**刻意只用 ASCII 写**。

### 3.7 三个项目的最终实测结果

#### ① `dsh-quick-append`

| 项 | 结果 |
|---|---|
| `bash scripts/build.sh`（针对 0.1.5 checkout） | exit 0 |
| `npm run build:client` + 自动 `postbuild:client` 门禁 | exit 0 |
| `npm run check:client-shape` | **11/11 pass** |
| `npm run typecheck` | exit 0 |
| `npm test` | **80/80 pass**（重构前 65） |
| 端到端冒烟 | 缓存落在 `$DSH_HOME` 内、不在真实 `~/.dsh`；首次 `full` → 二次 `cacheHit=true` |

#### ② `dsh-dialogue-alert-message`

| 项 | 结果 |
|---|---|
| `bash scripts/build.sh` | exit 0 |
| `npm run build:client` + 自动门禁 | exit 0 |
| `npm run check:client-shape` | **9/9 pass** |
| `npm run typecheck` | exit 0 |
| `npm test` | **56/56 pass + ALL INTEGRATION SCENARIOS PASS** |

#### ③ Python 量化项目

| 项 | 结果 |
|---|---|
| `pytest` | **57 passed**（重构前 14） |
| 新增模块 | `src/quant_analysis/metrics.py` |
| 重构 | `backtest.py` 拆出 `moving_average_signal()`；新增风控指标；`typing.Dict/List` → 内建泛型；指标加参数校验 |
| 新增指标 | `stochastic()`（%K/%D） |
| 兼容性 | 原 14 个用例**一行未改**且全绿 ⇒ 行为等价重构 |

### 3.8 发现 live GUI 的真实状态（把插件装进了 live profile）

**进程链实测**：

```
powershell.exe PID 3168   (start-server.ps1 看门狗)
  └─ ds-node.exe PID 34932  (live GUI :3080)
       └─ pwsh.exe          (本会话执行的工具进程)
```

⇒ **本会话是 live GUI 的子进程。** 杀掉 PID 34932 会连带终止本会话，
因此"重启 3080 并验证"这一步**在会话内不可完成** —— 这是环境限制，不是没做。

**live profile 的真实状态**：`iso-dsh\profiles\web` 原本只有 2 个官方 bundle、
连 `node_modules` 都没有 ⇒ 这解释了「插件为什么一条都没加载」。

已把两个插件装进该 profile（含 `schemastery`），并用 `--dump-config` 验证组合成功；
`iso-dsh` 的会话（3 文件）与存储（2 文件）**计数未变**，
profile 的 `package.json` 已备份为 `package.json.bak-20260911-035150`。

**live DSH_HOME 的确证**：本会话的会话文件在 `iso-dsh\sessions\` 下持续增长。

### 3.9 重启脚本（已实测）

新增 `scripts\restart-gui-015.ps1`，在备用端口 13092 完整跑通：

```
starting: DSH_HOME=…\iso-dsh port=13092
=== self-check ===
  boot rev   : eadcf875572b
  entries    : 55
  batches    : 2
  our plugins:
    OK @dsh-external/dsh-dialogue-alert-message  rev=eb9cd2eef6dfc83d-44
    OK @dsh-external/dsh-quick-append            rev=eb9cd2eef6dfc83d-49
```

脚本含三道前置校验（CLI 存在 / `DSH_HOME` 存在 / web 前端产物存在）。

### 3.10 一处未决的版本归属疑问（如实记录，不下断言）

`3080` 当前进程的版本归属存在**互相冲突的证据**：

| 可能性 | 支持证据 | 反对证据 |
|---|---|---|
| live = 0.1.1-rc.2 | `main.mjs` mtime 2026-09-01；boot payload 无 `batches` | 它在写 V3 会话文件 |
| live = 0.1.5 | 在写 V3 会话文件 | boot payload 是 pre-0.1.5 形态 |

本会话的会话目录里**同时**存在两份文件，且**只有 V3 那份在增长**：

```
session.jsonl.zstd       1,917,961 B   最后写入 03:58:17   ← 冻结
session.v3.jsonl.zstd      639,428 B   最后写入 03:59:01   ← 活跃写入
```

V3 迁移能力只存在于 0.1.2+，0.1.1-rc.2 既不产出也不读取 V3。
⇒ 两个结论至少有一个是错的。**未下断言。**

但这对结论**没有影响**：重启脚本显式指定 0.1.5 CLI 与 `DSH_HOME=iso-dsh`，
两种情况都收敛到同一个正确状态。

---

## 第 4 轮：针对 Zcode 看门狗迁移的提示词

### 用户

> 我是使用 zcode 来维护看门狗的，你给我一段详细的提示词，让我给 zcode，迁移到 3080 端口上

### 为写提示词而补做的核实

| 核实项 | 结果 |
|---|---|
| `DSH_HOME` 用户级持久化 | **未设置** |
| `DSH_HOME` 机器级持久化 | **未设置** |
| ⇒ 结论 | 它只活在进程环境里，**看门狗重启就会丢失**，必须写进脚本 |
| 看门狗 PID 3168 | **仍存活** |
| Zcode 进程 | `C:\Program Files\ZCode\ZCode.exe` PID 30520（独立桌面应用，不在 3080 树下） |
| `DSH-helper\scripts\` 现有脚本 | 含 `fix-dsh-service-env.ps1`（疑似已有环境变量修复机制，建议 Zcode 先看） |

### 交付给用户的提示词（全文）

<!-- ===== 提示词正文开始（可直接整段复制给 Zcode）===== -->

# 任务：把 3080 端口的 DSH 服务迁移到 dsh 0.1.5-rc.1

## 背景

`C:\Users\<user>\Documents\Zcode\DSH-helper\scripts\start-server.ps1` 是 3080 的常驻看门狗，
当前启动的是 **0.1.1-rc.2** 的构建产物。我已经在隔离环境把目标版本 **0.1.5-rc.1**
从源码构建并验证通过，现在需要你把这条服务链路切过去。

注意：**这个脚本由你（Zcode）维护**，本次改动限定在它本身。

## 一、当前事实（已实测，可直接采信，不必重复验证）

### 1.1 服务现状

| 项 | 值 |
|---|---|
| 端口 | 3080 |
| 看门狗进程 | `powershell.exe` PID 3168，命令行 `-File ...\DSH-helper\scripts\start-server.ps1` |
| 实际服务进程 | `C:\Users\<user>\AppData\Local\ds-h\ds-node.exe` PID 34932 |
| 当前启动命令 | `ds-node.exe --max-old-space-size=12288 C:\Users\<user>\AppData\Local\ds-h\run\apps\cli\lib\main.mjs web` |

### 1.2 为什么当前跑的是旧版本

`C:\Users\<user>\AppData\Local\ds-h\run` 是指向
`C:\Users\<user>\Documents\Software\DeepSeekHarness` 的 **junction**，该 checkout：

- `git describe --tags` = `dsh-v0.1.1-rc.2`
- `apps\cli\lib\main.mjs` 修改时间 = **2026-09-01**（早于本次升级）

⇒ `start-server.ps1` 启动的 `main.mjs` 是旧构建。

### 1.3 目标版本（0.1.5-rc.1）构建产物 —— 已就绪

源码树：`C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1`

| 用途 | 路径 | 状态 |
|---|---|---|
| CLI 入口 | `apps\cli\lib\bin.js` | 已构建，`node bin.js --version` 输出 `0.1.5-rc.1` |
| web 前端产物 | `apps\web\dist\index.html` | 已构建（**必需**） |

目标启动形态（已实测，端口换成 3080 即可）：

```
ds-node.exe --max-old-space-size=12288 <0.1.5 源码树>\apps\cli\lib\bin.js web --port 3080 --no-open
```

### 1.4 🔴 必须显式设置 `DSH_HOME`（本次迁移最容易踩的坑）

实测 `DSH_HOME` **在用户级与机器级都没有持久化**：

```
[Environment]::GetEnvironmentVariable('DSH_HOME','User')     -> 未设置
[Environment]::GetEnvironmentVariable('DSH_HOME','Machine')  -> 未设置
```

它只存在于当前进程环境里，值为：

```
C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\iso-dsh
```

而 `start-server.ps1` **不设置它**。当前之所以能对上，是因为该看门狗进程是从带着
这个环境变量的父进程启动的。**一旦在没有该变量的环境里重启看门狗，服务会落到默认
`~/.dsh`**，而那里是 0.1.1 时代的旧数据、与 `iso-dsh` 不是同一套，表现就是"会话看起来丢了"。

⇒ **必须把 `DSH_HOME` 写进启动脚本**，不能依赖环境继承。

### 1.5 不要动端口

3080 **保持不变**。本次是版本迁移，不是换端口。

## 二、改动要求

### 2.1 只改 `start-server.ps1` 的 `Start-Dsh` 函数

需要改两处：

1. 启动前显式设置家目录：
   ```powershell
   $env:DSH_HOME = 'C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\iso-dsh'
   ```

2. 把启动目标从 `ds-h\run\apps\cli\lib\main.mjs` 改为
   `...\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1\apps\cli\lib\bin.js`，
   并把 `web` 之后的参数改为 `web --port 3080 --no-open`。

### 2.2 增加启动前置校验（建议）

启动前检查以下三项，缺任一项就**明确报错退出**，不要带着坏状态起来：

| 检查 | 路径 | 缺失后果 |
|---|---|---|
| CLI 入口存在 | `<0.1.5 树>\apps\cli\lib\bin.js` | 服务起不来 |
| web 前端产物存在 | `<0.1.5 树>\apps\web\dist\index.html` | **`/` 返回 404**（不是白屏、不是 401，极易误判为服务坏了） |

> 说明：`pnpm run build:lib` **不产出** `apps/web/dist`，必须额外跑 `pnpm run build:web`。
> 当前磁盘上已构建好，但把这条校验写进脚本能防住"以后重新构建忘了 web 那步"。

### 2.3 看门狗逻辑一律不动

以下现有行为**必须逐字保留**（它们都是历史故障的产物）：

- 健康检查：`$hcTimeoutSec = 8`、`$hcMaxFails = 3`、30 秒轮询间隔
- 启动后 90 秒宽限期（node 启动需 30~50 秒才监听）
- 端口残留进程先清理再启动
- `--max-old-space-size=12288` 必须放在**脚本路径之前**（放在后面会被当应用参数，V8 收不到）
- 日志：`dsh-web.log` / `dsh-web.err.log` / `dsh-watchdog.log` / `dsh-watchdog.pid`
- 崩溃/假死区分诊断（`diag:` 那两行）

### 2.4 明确不要碰的东西

| 不要动 | 原因 |
|---|---|
| `~/.dsh` 下的任何数据 | 旧版本的家目录，里面有历史会话与插件数据 |
| `ds-h\run` 这个 junction | 其它 helper 脚本可能依赖它 |
| `~/.dsh\profiles\*` | 与本次无关 |
| 端口号 3080 | 见 §1.5 |
| 其它 helper 脚本 | 本次范围仅限 `start-server.ps1` |

## 三、验收判据（逐条给证据，不要只说"已完成"）

1. **进程命令行**：新 `ds-node.exe` 的命令行指向 `<0.1.5 树>\apps\cli\lib\bin.js`，
   且**不再是** `ds-h\run\apps\cli\lib\main.mjs`。
2. **`DSH_HOME` 生效**：新进程的会话写入落在
   `...\dsh-v0.1.5-rc.1\iso-dsh\sessions\` 下（看文件修改时间在增长），
   `~/.dsh\sessions\` **没有**新的写入。
3. **HTTP 200**：`http://127.0.0.1:3080/` 返回 200。若返回 **404**，就是 §2.2 的 web 产物问题。
4. **`__DSH_BOOT__` 形态判据**（判断是否真的切到 0.1.5 的决定性证据）：
   从首页 HTML 中提取 `__DSH_BOOT__` 的 JSON，**必须包含顶层键 `batches`**。
   - 0.1.5 形态：`{ rev, entries, batches }`，`entries[].rev` 形如 `a002fe26c9e86dea-49`
   - 旧形态：`{ rev, entries }`，**无 `batches`**，`entries[].rev` 形如 `2f5b20a45fbd`
5. **插件已加载**：该 `entries` 数组中包含以下两个 id：
   ```
   @dsh-external/dsh-quick-append
   @dsh-external/dsh-dialogue-alert-message
   ```
   （它们已装进 `iso-dsh\profiles\web\package.json` 的 `dsh.profile.bundles`，
   重启后应当自动出现在图谱里。若缺失，检查该 profile 的 `bundles` 与
   `profiles\web\node_modules\@dsh-external\` 下是否存在这两个目录。）
6. **端口不冲突**：迁移后只有 3080 一个实例，没有残留在 1308x/1309x 的验证实例。

## 四、执行方式与风险提示

⚠️ **重启 3080 会中断正在使用该服务的会话，包括你自己当前所在的会话。**
请这样安排：

1. **先改脚本、再重启**（不要先重启再改）；
2. 重启的动作建议由我（用户）在 Zcode 之外确认执行，或者你确保重启后不需要当前会话继续；
3. 重启后 30~50 秒内端口才会监听，别急着判定失败。

### 失败时的回滚

```powershell
# 1) 恢复脚本
Copy-Item "...\start-server.ps1.bak" "...\start-server.ps1" -Force
# 2) 重新拉起旧版本
powershell -NoProfile -ExecutionPolicy Bypass -File "...\DSH-helper\scripts\start-server.ps1"
```

请注意回滚的边界：**代码与装配可以回滚，但会话数据不能。**
`iso-dsh\sessions\` 下的会话已经是 V3 格式（存在 `session.v3.jsonl.zstd`），
0.1.1-rc.2 **不支持降级读取**。所以回滚脚本不等于回滚数据 ——
如果只是脚本改错，建议原地修脚本，而不是退回 0.1.1。

## 五、可选方案（不推荐，需先跟我确认）

若你倾向于让所有 DSH 工具都能找到当前的 home，可以持久化环境变量：

```powershell
[Environment]::SetEnvironmentVariable('DSH_HOME', 'C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\iso-dsh', 'User')
```

**但我不推荐**，因为这会改变机器上**所有** DSH 相关工具的家目录，影响面超出本次任务，
且会掩盖掉"脚本没设置变量"这个真实缺陷。默认请采用 §2.1 的脚本内显式设置。

## 六、如果你只有时间做一件事

先看 §1.4：**在 `Start-Dsh` 里加上 `$env:DSH_HOME = '...\iso-dsh'`**。
这是本次迁移唯一"不做就一定出问题、而且症状会伪装成数据丢失"的点。

<!-- ===== 提示词正文结束 ===== -->

### 附带的两点提醒

1. **Zcode 重启 3080 时可能把自己也断掉** —— 若 Zcode 也通过这套 harness 驱动，
   它与本会话同为 3080 的子进程；重启瞬间连接会断，30~50 秒后恢复。
2. **回滚有硬边界** —— V2→V3 迁移**已经实际发生**，代码/装配可回滚，**数据不能**。
   若只是脚本改错，建议原地修脚本，不要退回 0.1.1。

---

## 附录：全部实测数据与证据索引

### A. 本轮新增/修改的文件

| 文件 | 性质 |
|---|---|
| `test\src\quant_analysis\metrics.py` | 新增：收益率/波动率/Sharpe/回撤 |
| `test\tests\test_metrics.py` | 新增：metrics 边界与异常用例 |
| `test\src\quant_analysis\indicators.py` | 重构：参数校验 + `stochastic()` |
| `test\src\quant_analysis\backtest.py` | 重构：拆出 `moving_average_signal()` |
| `test\src\quant_analysis\demo.py` | 更新：输出新指标 |
| `test\src\quant_analysis\__init__.py` | 更新：公开导出 |
| `test\tests\test_indicators.py` | 扩展：校验/EMA/随机指标 |
| `test\tests\test_backtest.py` | 扩展：信号函数/风控指标 |
| `test\README.md` | 更新：结构、设计说明、用法 |
| `test\dsh-quick-append\test\client-shape.test.mjs` | 新增：11 例形状/冻结门禁 |
| `test\dsh-dialogue-alert-message\test\client-shape.test.mjs` | 新增：9 例形状/冻结门禁 |
| `test\dsh-quick-append\package.json` | 改：`files` + `check:client-shape` + `postbuild:client` |
| `test\dsh-dialogue-alert-message\package.json` | 改：同上 |
| `test\dsh-quick-append\tsconfig.json` | 改：`exclude: ["src/client"]` |
| `test\dsh-dialogue-alert-message\tsconfig.json` | 改：同上 |
| `test\dsh-quick-append\src\lib\spec-context.ts` | 改：`resolveDshHome()` |
| `test\dsh-quick-append\test\spec-context.test.mjs` | 改：新增用例 + 修失效断言 |
| `_upgrade\...\scripts\restart-gui-015.ps1` | 新增：重启脚本（实测通过） |
| `_upgrade\...\iso-install\close-deps.mjs` | 新增：依赖闭包扫描取证工具 |
| `_upgrade\...\evidence\refactor-report-2026-09-11.md` | 新增：完整实测报告 |
| `_upgrade\...\evidence\phase3-boot-graph-0.1.5.json` | 新增：0.1.5 boot 图谱快照 |

### B. 对交付文档的纠正清单

| # | 文档原结论 | 实测 |
|---|---|---|
| 1 | 官方渠道是 npm，无需编译源码 | ❌ npm 发布包缺 30 个未声明依赖，含 1 个未发布包，**连 boot 都过不去** |
| 2 | `row.rev` == 磁盘 `lib/client.js` sha1 前 12 位（AC-2/AC-13） | ❌ 0.1.5 已变为 `<batch-hash>-<index>`；新判据为 `sha1(JSON.stringify({entries,batches}))[0:12]` |
| 3 | `buildAlertPayload` 被 import 却未被调用（05 §A7） | ❌ 在 `index.ts:260` 被调用；但冻结结论仍正确，真实机制是**结构性不可达** |
| 4 | 两个插件已有 `check:client-shape` 门禁（T2/AC-5） | ❌ 实测两者皆无（AE 插件才有） |
| 5 | 阶段 2 成本可大幅下调 | ❌ 必须补 `pnpm run build:web`，否则 `/` 返回 404 |

### C. 未解决的存量项（按"不夹带"原则未动）

| 项 | 内容 | 处置 |
|---|---|---|
| Q11 | QA 的 `preset` 只发不读 | 门禁锁定现状 |
| Q12/U2-a | QA `conversation` 声明为必需却按可选访问 | 门禁锁定现状 |
| ALIGN-09 | QA 未接 `close-plugin-panels` | 门禁断言 0 命中 |
| ALIGN-10 | QA 弹层 `z-index:100` 未纳入 z 寄存器 | 门禁断言 z 值集合 == `{100}` |
| A10 | ALERT 的 `dsh.client.inject` 声明了 ui-slots 但源码只有 type-only import | 登记待核实 |
| ALIGN-01/02 | 版本号与 SPEC 不一致 | 不在本轮范围 |

### D. 关键路径速查

```
0.1.5 源码树      C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\src\deepseek-harness-dsh-v0.1.5-rc.1
0.1.5 CLI 入口    <上述>\apps\cli\lib\bin.js
0.1.5 web 产物    <上述>\apps\web\dist\index.html
live DSH_HOME     C:\Users\<user>\Documents\Deepseek\_upgrade\dsh-v0.1.5-rc.1\iso-dsh
live profile      <DSH_HOME>\profiles\web\package.json
重启脚本          ...\_upgrade\dsh-v0.1.5-rc.1\scripts\restart-gui-015.ps1
完整报告          ...\_upgrade\dsh-v0.1.5-rc.1\evidence\refactor-report-2026-09-11.md
看门狗脚本        C:\Users\<user>\Documents\Zcode\DSH-helper\scripts\start-server.ps1
```

### E. 未完成/待用户执行

| # | 事项 | 原因 |
|---|---|---|
| 1 | 把重启脚本作用到 3080 | **本会话是 live GUI 的子进程**，杀掉会终止会话 —— 环境硬限制 |
| 2 | 3080 进程版本归属查清 | 存在互相冲突的证据，未下断言；重启后看 boot payload 是否含 `batches` 即可确定 |
| 3 | `test` 仓库提交 | 改动未提交，`metrics.py` / `test_metrics.py` 为新增未跟踪文件 |
| 4 | 阶段 4/5/6 的闭环、画布、回滚演练 | 交付文档中标为未执行，需 live 环境配合 |
