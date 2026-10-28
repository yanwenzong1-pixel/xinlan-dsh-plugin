# 脱敏清单（PRIVACY-SCRUB）

> 结论：本包**已脱敏**。身份类信息 8 类全部替换为占位符，泄漏复核 **0 命中**。
> 抽查方式（在包根目录执行）——**本文件刻意不保存原值**，避免"脱敏清单本身成为二次泄露源"：
> ```powershell
> # 把你打包前记录的真实值逐个填进数组（读源仓时临时取，不要写回本文件）
> $patterns = @('<远端IP>', '<会话id>', '<私有仓slug或域名>', '<用户名>', '<用户主目录片段>', '<业务仓名>', '<采集仓名>', '<本机工具箱目录名>')
> Get-ChildItem -Recurse -File | Select-String -Pattern $patterns
> ```
> 期望：**无输出**。

---

## 一、替换了什么（按类别，不复述原值）

| # | 类别 | 替换为 | 命中位置（文件） |
|---|---|---|---|
| 1 | 远端行情服务的 **IPv4 地址 + 端口** | `{{QUOTE_SERVICE_HOST}}` / `{{QUOTE_SERVICE_PORT}}` | `skills/y-task-distribution-auto/SKILL.md` |
| 2 | **会话 id**（崩溃槽位，完整 uuid） | `{{CRASH_SESSION_ID}}` | `skills/y-task-distribution-auto/SKILL.md` |
| 3 | **会话 id**（历史换手注释，3 处缩写） | `{{SESSION_ID_1/2/3}}…` | `skills/y-task-distribution-auto/scripts/relay-dispatch.mjs` |
| 4 | **私有仓名称**（GitHub 上传槽位描述） | `{{REPO_NAME}}` | 两个 SKILL.md + 派单脚本的 `note` |
| 5 | **行情/采集仓名** | `{{QUOTE_REPO}}` | `skills/y-task-distribution-auto/SKILL.md`、派单脚本 `note` |
| 6 | **行情仓本机路径**（含个人目录结构） | `{{QUOTE_REPO_PATH}}` | `skills/y-task-distribution-auto/SKILL.md` |
| 7 | **本机辅助工具箱目录名** | `{{DSH_HELPER_DIR}}` | `skills/y-task-distribution-auto/SKILL.md`、派单脚本注释与 `note` |
| 8 | **用户名 / 用户目录 / 私有仓 slug / 公网域名** | 打包前源文件里**本来就没有**（已在前几轮文档更新中改为占位符），本次复核确认 0 命中 | — |

## 二、故意保留的内容（不是隐私，别删）

| 保留项 | 为什么保留 |
|---|---|
| 端口示例（`3080`、`8091`、`8095` 等） | 通用默认端口，不是身份信息；安装时按 `automation.config.json` 改 |
| 目录名 `local/protocol/`、`state/`、`outbox/`、`inbox/` | 协议约定的一部分，换环境也长这样 |
| 技能名 `y-automation-portable` / `y-task-distribution-auto` | 技能标识，安装依赖它（front matter 的 `name` 必须与目录名一致） |
| 脚本里的槽位表 `SLOTS`（U/A/B/F/I/C/D/E/T/G/H/J） | 这是**结构示例**，安装时必须按你的花名册改标题与 `titleKey`；含扩展槽位是刻意的，便于对照 |
| 备份脚本内部归档条目名 `meta/dsh-helper/…`（4 处） | **通用结构名**，不含路径、用户名或主机名；真实绝对路径已替换为 `{{DSH_HELPER_DIR}}`。改名会改变备份包内部布局，故保留 |
| 时间与版本历史（如 2026-10-22 新增某槽位） | 决策沿革，不含身份信息 |

## 三、源仓有没有被改？

- **没有**。打包流程是：复制 → 只改副本 → 复核。
- 源仓的两个技能（`skills/y-automation-portable/SKILL.md`、`skills/y-task-distribution-auto/SKILL.md` 等）保持原样，
  其中的真实地址/会话 id 仍服务于你本机运行；**如果源仓将来要对外分发，请单独走一次同样的替换**（本文件可作为替换清单）。

## 四、公开仓库状态（2026-10-28 补充）

本包已按用户授权同步到公开 GitHub 仓库，并额外加入四张演示截图：

| 文件 | 内容 | 处理 |
|---|---|---|
| `docs/images/slots-session-list.png` | DSH 槽位会话列表演示 | 只含槽位名称、相对时间和演示任务标记；无用户名、绝对路径或 token |
| `docs/images/monitor-dashboard-example.png` | 作者自建监控 dashboard 示例 | **dashboard 代码/数据源/部署均不在本包**；截图仅用于说明槽位关系与状态观感，**会话 id 列已打码**，会话命名与任务 ID 为演示口径 |
| `docs/images/cache-hit-99.6.png` | DSH 输入框状态栏，缓存命中 99.6% | 作者环境用量证据；无账号 id、邮箱、token 或绝对路径 |
| `docs/images/usage-cost-100m-tokens.png` | 作者 DSH 用量页（余额、累计消费、近 30 天 tokens 与消费曲线） | **经用户明确授权公开**，用于说明 5–6 元/亿 token 口径；画面含作者账号余额/消费金额，无账号 id、邮箱或 token；不属于可复用代码或安装包内容 |

复核口径：已逐项检查截图与新增 README，无用户名、用户目录、私有仓 slug、远端服务地址、真实会话 id 或 token；第二张 dashboard 仅作效果示意，不构成可直接复用的代码或配置。若后续继续追加真实环境截图，仍需重新执行本文件第二节的正则扫描。
