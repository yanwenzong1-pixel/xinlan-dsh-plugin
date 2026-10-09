# DSH 扩展坞

**给 DeepSeek Harness（DSH）插上更多接口 —— 3 个开箱即用的插件，clone 完不用构建就能装。**

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-4f46e5.svg)](#环境要求)
[![无需构建](https://img.shields.io/badge/install-no%20build%20required-brightgreen.svg)](#快速上手约-1-分钟)
[English](README.en.md) · 中文

`DSH 插件` · `DeepSeek Harness` · `DeepSeek 外部插件` · `cordis patch bundle` · `AI Agent 提效` · `子代理任务派发`

---

## 30 秒看懂它能干什么

| 你每天的麻烦 | 插件 | 装上之后 |
| --- | --- | --- |
| 反复贴同一段提示词、同一串命令 | ⚡ **闪电追加** | 一键追加预存文案/命令，**按工作区各存各的**；配 **LLM 优化**：自动读项目说明文档＋最近 3 轮对话，把草稿补成精准需求 |
| 想把一整件事丢给子代理，又受不了中间输出刷屏 | 🧩 **一键派活** | 子代理用 PTC（code）模式写一段程序跑完，中间输出留在程序里，**只把结论路径回给你** |
| 长任务跑着跑着断了、花超了，事后才发现 | 🔔 **报警铃铛** | 被非主动原因中断立刻**分级响铃**；侧栏顺带显示 DeepSeek 对话数 / 当日花费 / 余额 |

三个插件都只在 DSH 侧加载，不改 DSH 源码、不碰你的会话数据。

## 快速上手（约 1 分钟）

```bash
git clone https://github.com/yanwenzong1-pixel/xinlan-dsh-plugin.git
cd xinlan-dsh-plugin

dsh plugin --profile web add ./dsh-quick-append
dsh plugin --profile web add ./dsh-ptc-task
dsh plugin --profile web add ./dsh-dialogue-alert-message
```

重启 dsh web（或刷新页面）即可。装上「闪电追加」后，输入框右侧会多出 ⚡ 和 🔧 两个按钮。

- `--profile web` 换成你自己的 profile 名（`web` / `headless` / 自定义）即可。
- `dsh plugin … add` 会把插件装进 profile，并**自动把声明了 `dsh.bundle.patch` 的包登记进 `dsh.profile.bundles`**，不需要手改 JSON。
- 卸载：`dsh plugin --profile web remove @dsh-external/dsh-quick-append`。
- **不需要构建**：三个插件的 `lib/` 都已随仓库提交（`main` 直接指向 `lib/index.js`），clone 下来即可加载。

<details>
<summary>不想用 CLI？手改 profile（等价做法）</summary>

编辑 `<DSH_HOME>/profiles/<name>/package.json`，把插件加进依赖与 bundles 层栈：

```jsonc
{
  "dependencies": {
    "@dsh-external/dsh-quick-append": "link:C:/绝对路径/dsh-quick-append"
  },
  "dsh": {
    "profile": {
      "bundles": [/* 内置 bundle… */, "@dsh-external/dsh-quick-append"]
    }
  }
}
```

然后在该 profile 目录跑一次 `pnpm install`，再重启 dsh web。
</details>

## 界面

| 预存命令菜单（7 条全可见） | 编辑弹窗（视口 460px，20 条可滚动） |
| --- | --- |
| ![预存命令菜单](docs/172-quick-append-菜单-7条全可见.png) | ![编辑弹窗](docs/173-quick-append-弹窗-短视口460-20条.png) |

> 0.5.2 起，菜单与弹窗都按内容自适应高度、超长列表只有**一个**滚动区，并且装得下就不滚、装不下给滚动提示——不会再出现"列表被裁掉、最后几条点不到"。

## 插件清单

| 别名 | 目录 | 包名 | 版本 | 一句话 |
| --- | --- | --- | --- | --- |
| ⚡ 闪电追加 | [`dsh-quick-append/`](dsh-quick-append/README.md) | `@dsh-external/dsh-quick-append` | 0.5.2 | 输入框「快速追加」按钮 + 预存命令菜单与编辑弹窗 |
| 🧩 一键派活 | [`dsh-ptc-task/`](dsh-ptc-task/README.md) | `@dsh-external/dsh-ptc-task` | 0.1.0 | 向宿主注册 `ptc_task` 工具，把整件事交给 PTC 作用域子代理 |
| 🔔 报警铃铛 | [`dsh-dialogue-alert-message/`](dsh-dialogue-alert-message/README.md) | `@dsh-external/dsh-dialogue-alert-message` | 0.2.1 | 对话中断分级报警 + 侧栏 DeepSeek 用量显示 |

### ⚡ 闪电追加 · [详细说明](dsh-quick-append/README.md)

**🔥 重点能力：LLM 优化 —— 把一句草稿补成能直接开工的精准需求**

开启「LLM 优化」后再点闪电，**不是"多接几个字"**：宿主侧 LLM 会先读你的**项目说明文档**与**最近 3 轮对话**，再对提示词做扩充和细节补充。作者自测口径：**大幅降低开发难度；提示词优化后精确度提升数倍，有效减少描述歧义**。

优化上下文由三部分组成（都有代码落点，不是黑盒）：

| 上下文 | 内容 | 依据 |
| --- | --- | --- |
| 你的草稿 | 输入框现有内容（可带图片，多模态一起交给模型） | 请求字段固定 `['draft','context','cwd','images']`，`src/lib/optimize.ts` |
| **项目说明文档** | 项目根 5 份规范（`README.md` + 4 份 SPEC）、`docs/` 全部文档、各插件 `SPEC/README/DESIGN`；按标题剔除「更新日志／变更记录／验收清单／路线图」等非约束章节；带增量缓存，源文件变了才重建，**不写你的仓库** | `src/index.ts:145` → `loadSpecContext(cwd)`；`src/lib/spec-context.ts:19-41` |
| **最近 3 轮对话** | 取最近 6 条 user/assistant 消息拼成上下文，改到一半的活儿也能被正确理解 | `src/client/index.ts:915-927` |

![快速追加文案弹窗：LLM 优化 / goal 模式 开关](docs/176-quick-append-快速追加文案弹窗-LLM优化.png)

- 输入框右侧两个按钮：**闪电** = 一键追加当前工作区的预存文案；**扳手** = 上拉菜单插入预存命令（左键插入，右键管理）。
- 预存文案**按工作区隔离**并持久化：换项目自动换文案，不会互相污染。
- 右键闪电打开**编辑弹窗**（上图）：写预存文案、勾「LLM 优化」「goal 模式」、点「插入默认文案」。
- **goal 模式**（默认开）：追加时在草稿最前面插入 `/goal`，让这段内容直接作为目标交给 DSH；关掉就是普通提示词。
- 快捷键：输入区聚焦时 `Shift+Alt+F` 等价于点闪电；两个按钮都可 Tab 聚焦，`Shift+F10` 打开右键菜单。

### 🧩 一键派活 · [详细说明](dsh-ptc-task/README.md)

- 注册 `ptc_task` 工具：给 `prompt`（自包含任务说明）和 `resultPath`（产出路径），子代理跑完把结果写进文件。
- 子代理的**工具面以 PTC（code）模式呈现**，一段程序跑完多步操作，中间输出不进你的上下文；主会话工具面保持原生。
- 三道护栏：链长恒 ≤ 1（子代理不能再派发）、递归护栏装不上就**拒发**（fail-closed）、并发去重 + 连续失败熔断。
- 适合「步骤已确定」的批量活（逐项跑脚本、扫描、对账、汇总）；不适合需要边看中间结果再判断的探索型任务。

### 🔔 报警铃铛 · [详细说明](dsh-dialogue-alert-message/README.md)

- 对话正常完成播「叮咚」；被**非用户主动**原因中断时按等级播报警音（工具报错 / 强制取消 / 会话驱逐 / 宿主重启）。
- 只对非主动中断报警：你按的取消不会响。
- 侧栏状态栏显示 DeepSeek 账号用量：对话数 / 当日花费 / 余额。
- 报警走本插件自包含通道（宿主队列 `/api/alarm` → 客户端 WebAudio + ack），不依赖任何第三方插件。

## 先看这条坑（否则可能整个 dsh-web 起不来）

**契约**：凡是列进 profile `dsh.profile.bundles` 的包，`package.json` **必须**声明 `dsh.bundle.patch` 指向真实存在的 `cordis.patch.yml`。缺一个，宿主加载 profile 时会直接报
`profile bundle "<pkg>" declares no dsh.bundle in its package.json` 并退出 —— **爆炸半径是整个 dsh-web（你的所有会话与面板），不是「这个插件不生效」**。

用 `dsh plugin … add` 安装时这一条会自动满足；手改 JSON 时请特别小心。

## 仓库结构

```
dsh-quick-append/            宿主半 src/index.ts + 客户端半 src/client/ + 构建产物 lib/ + 测试 test/
dsh-dialogue-alert-message/  同上（另含 SPEC.md、integration-check.mjs）
dsh-ptc-task/                纯宿主插件：src/index.ts + lib/index.js，无客户端半
docs/                        设计与迭代记录（含界面截图与踩坑过程）
```

每个插件目录内的固定文件：

- `cordis.patch.yml` —— 把该插件插入 profile 层栈的 bundle patch（宿主接入凭据）
- `scripts/build.ps1` —— 构建入口（Windows PowerShell）
- `lib/` —— 已提交的构建产物（含 `lib/types/*.d.ts` 与 sourcemap）

## 环境要求

- DSH ≥ `0.1.5-rc.1`（本仓库在该版本上开发与验证；`web` profile）
- Node.js ≥ 20；加载插件**不需要**构建，改源码才需要
- 构建脚本是 Windows PowerShell（`scripts/build.ps1`，依赖 `$env:DSH_CHECKOUT` 或 `-Checkout` 参数）
- 仓库不提交 `node_modules/`；`lib/` 构建产物**有意**随仓库提交

## 开发与测试

```powershell
cd dsh-quick-append
$env:DSH_CHECKOUT = "C:\...\deepseek-harness-dsh-v0.1.5-rc.1"   # 或给 build.ps1 传 -Checkout
npm run build     # build.ps1：建 junction → tsc 编译宿主半 → tsdown 打包客户端半
npm test          # node --test

# typecheck：仓库不在本地装 tsc，直接用 checkout 里的那个
& "$env:DSH_CHECKOUT\node_modules\.bin\tsc.cmd" -p tsconfig.json --noEmit
```

> `npm run typecheck` 需要 PATH 上有 `tsc`（仓库不随包安装），没有就走上面那条命令。

## 搜索关键词 / Keywords

`DSH` · `DSH 插件` · `DeepSeek Harness` · `DeepSeek Harness 插件` · `DeepSeek 外部插件` · `cordis` · `cordis bundle` · `profile bundle` · `预存命令` · `提示词快捷追加` · `prompt preset` · `子代理任务派发` · `subagent dispatch` · `PTC` · `中断报警` · `用量监控` · `AI Agent 提效`

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。三个插件的 `package.json` 同样声明 `license: BSD-3-Clause`。
