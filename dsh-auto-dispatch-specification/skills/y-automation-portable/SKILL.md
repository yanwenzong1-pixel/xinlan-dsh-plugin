---
name: y-automation-portable
description: 把已跑通的「待办 → 派单 → 生产 → 发布 → 迁移」自动化链路复刻到新的 Windows DSH 环境。覆盖：前置检查 → 六步流程（填 automation.config.json / 备份 / 建槽位 / 中继与守护 / 发布链 / 冒烟派单）→ 槽位自定义（**默认 7 个对话**：用户决策 + 待办维护 + 2 生产 + 1 发布 + 1 崩溃报告 + 1 GitHub；扩展槽位按需追加）→ 凭据注入 → 版本跟随 → 故障排查 → 工作流纪律（禁止回合内 sleep、新任务默认入待办、收据才算送达、重启前后体检与通知、待办清单门禁）。当用户说「换机器复刻链路」「备份这套自动化」「新增/删除槽位」「跟 DSH 版本」时触发。
---
# 自动化链路移植（y-automation-portable）

把一个已经跑通的「待办 → 派单 → 生产 → 发布 → 迁移」自动化链路，复刻到一台新的 Windows 机器。

## 〇、何时用（触发条件）

命中任一条就用本技能：

- 要**换机器 / 新服务器**复刻这套派单与发布链路。
- 要**备份**当前链路（协议目录、槽位表、计划任务、profile、版本记录）。
- 要**新增或删除槽位**（会话角色），并让脚本以配置为准。
- 要判断「现在这套东西跟 DSH 哪个版本绑定、能不能跟版」。
- 要确认**最新工作流纪律**（禁止回合内 sleep、新任务默认入待办、收据才算送达、重启前后体检与通知）有没有一起搬过去（见 §七）。

不适用：只改某个插件的业务逻辑（去插件的开发流程）；发布单次改动上 8091（去发布技能）。

## 一、前置条件

| 项 | 要求 | 检查命令 |
|---|---|---|
| 操作系统 | **Windows**（计划任务 + wscript 隐藏壳 + PowerShell 5.1/7 都在 Windows 平面） | `$PSVersionTable.PSVersion` |
| DSH | 与配置里 `dsh.version` 一致的 checkout | `node scripts/check-dsh-version.mjs` |
| Node | 22+（自带 `node:sqlite`） | `node -v` |
| pnpm | 仓库用 pnpm 安装依赖 | `pnpm -v` |
| 权限 | 注册计划任务需要**管理员**（每台机器一次） | `Get-ScheduledTask -TaskName 'DSH*'` |
| 仓库 | 已克隆业务仓；`local/protocol/` 可写 | `Test-Path local/protocol` |

## 二、六步流程

### ① 填 `automation.config.json`

最小必需字段：`paths.repoRoot` / `paths.dshHome` / `paths.protocolDir` / `paths.backupDir` / `ports.dev` / `ports.release` / `domains.public` / `dsh.checkout` / `dsh.version` / `slots`。

判据：`node -e "JSON.parse(require('fs').readFileSync('automation.config.json','utf8'))"` 无报错。

### ② 备份（先冻住现状）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\automation-backup.ps1
```

判据：输出 `packaged files=<N> totalBytes=<B>`，`local/backups/` 出现 `backup-<时间戳>.zip` + 同名 `MANIFEST.json`；解压后用 MANIFEST 逐文件校验 `mismatches=0`。

### ③ 建槽位（先干跑）

```powershell
node scripts\init-slots.mjs --dry-run
node scripts\init-slots.mjs
```

判据：干跑输出 `slots=config: …` 且每行给出 `skip / create`；真跑后 `local/protocol/session-map.json` 的 `slots` 全部写入；再干跑应**全 skip**。

> **默认口径**：新环境按 **7 个对话**建槽（U/A/B/F/C/E/G，见 §3.1）；本机扩展的 I/D/H/J 只在需要时追加。

### ④ 中继与守护

- 装中继插件（`dsh-relay-watch`）并确认 `local/protocol/state/relay-status.json` 每 25 秒刷新。
- 注册计划任务（10 个 `DSH*`：broker / dispatch / ensure-3090 / ensure-8091-monitor / ensure-broker / ensure-dispatch / ensure-frpc / host-kill-audit + 2 个 Disabled 的历史任务）。
- 隐藏控制台壳用 `wscript`；**壳里命令文本只用 `-Command`，不要用 `-File`**（见故障排查 2）。

判据：`Get-ScheduledTask -TaskName 'DSH*' | Format-Table TaskName,State` 全 Ready；`ensure-*.log` 有正常行；采样两个周期无可见控制台。

### ⑤ 发布链

```powershell
# 在 Git Bash 里执行（路径按你机器的安装位置）
bash scripts/build.sh
npm run build:client
node scripts/check-client-bundles.mjs
node release\scripts\verify-release.mjs
```

判据：构建与产物门禁 **exit 0**；`verify-release` 的 OK 数 ≥ 10/13，FAIL 逐条列出并确认与改前一致。

### ⑥ 冒烟验收（派单往返）

首次部署建议先 check，再发一发只读冒烟。

```powershell
node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs check
# 可选（确认槽位在线后再执行）：真发一发派单
node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs --to B --kind dev --id smoke-<ts> --spec <规格 md>
```

判据：`check` 里目标槽位 `live=true`；`local/protocol/state/outbox-to-<槽>-<id>.md.done` 出现 `SENT -> X`；**60 秒内**收到回函（`sent/reply-<id>.md`）。

## 三、槽位自定义

槽位表在 `automation.config.json` 的 `slots` 数组（`id/title/cwd/role`），`init-slots` **以它为准**；`_docs.slots` 里那段说明就是权威口径。`cwd` 支持占位符：`{{repoRoot}}` / `{{dshHome}}` / `{{dshCheckout}}` / `{{userHome}}`。

### 3.1 标准默认：**7 个对话**（2026-10-28 用户确认口径）

新环境复刻**默认就按这 7 个建**：用户入口 + 调度点 + 2 个生产 + 1 个发布 + 1 个崩溃报告 + 1 个 GitHub。

```json
"slots": [
  { "id": "U", "title": "用户决策",   "cwd": "{{repoRoot}}", "role": "用户入口（唯一入口，只与用户对接；不派单给执行槽位）" },
  { "id": "A", "title": "待办维护",   "cwd": "{{repoRoot}}", "role": "调度点（默认发起方）" },
  { "id": "B", "title": "插件生产",   "cwd": "{{repoRoot}}", "role": "开发（第一生产槽位）" },
  { "id": "F", "title": "插件生产",   "cwd": "{{repoRoot}}", "role": "开发（第二生产槽位，与 B 并行）" },
  { "id": "C", "title": "发布 Release", "cwd": "{{repoRoot}}", "role": "发布（只做发布与发布面救火）" },
  { "id": "E", "title": "崩溃报告",   "cwd": "{{repoRoot}}", "role": "崩溃简报处理与宿主故障取证" },
  { "id": "G", "title": "Github-投研仓", "cwd": "{{repoRoot}}", "role": "GitHub 上传（投研仓）" }
]
```

> **计数怎么来的**：U + A + 2 生产 + 1 发布 + 1 崩溃 + 1 GitHub = **7 个对话**。
> 这是「最小可用链路」：需求从 U 进 → A 派 → 生产/发布/崩溃/GitHub 各司其职，覆盖"开发 → 发布 → 出事 → 入库"。
> **同一件活只派一个生产槽位**；一件任务与它的追加件（`-adN`）必须回同一个槽位。

### 3.2 本机（源机器）比默认多出来的扩展槽位（复刻时**不必照搬**）

| 槽位 | 作用 | 为什么源机器有 |
|---|---|---|
| `I` | 第三生产槽位（与 B/F 并行） | 2026-10-22 业务并发上来后加的 |
| `D` | 行情服务端（crawler 生产，cwd 在另一个仓） | 行情服务需要独立会话，且禁止在开发会话代改 |
| `H` | GitHub 上传（行情仓） | 两个仓分别入库，避免一次提交混两个仓 |
| `J` | 用户中心（{{DSH_HELPER_DIR}} 工作区） | 2026-10-26 用户裁决：用户中心相关任务默认派 J |
| `T` | 诊断位（只跑 `selftest`） | 通道自检用，不接真实派单 |

> 扩展槽位**不影响默认口径**：技能默认描述 7 个；本机实际 11 个可派单槽位（U/A/B/F/I/C/D/E/G/H/J）+ 诊断位 T。
> 复刻时若确实需要某个扩展，按 §3.3 的片段追加，并在 `automation.config.json` 的 `_docs.slots` 写明"为什么加"。

### 3.3 追加/缩减片段

**片段 1：只要 A/B/C 三个槽（最小可用，不含 U/E/G）**

```json
"slots": [
  { "id": "A", "title": "待办维护", "cwd": "{{repoRoot}}", "role": "调度点" },
  { "id": "B", "title": "插件生产", "cwd": "{{repoRoot}}", "role": "开发" },
  { "id": "C", "title": "发布 Release", "cwd": "{{repoRoot}}", "role": "发布" }
]
```

**片段 2：在 A/B/C 基础上增加 G/H（GitHub 两个仓）**

```json
"slots": [
  { "id": "A", "title": "待办维护", "cwd": "{{repoRoot}}", "role": "调度点" },
  { "id": "B", "title": "插件生产", "cwd": "{{repoRoot}}", "role": "开发" },
  { "id": "C", "title": "发布 Release", "cwd": "{{repoRoot}}", "role": "发布" },
  { "id": "G", "title": "Github-投研仓", "cwd": "{{repoRoot}}", "role": "GitHub 投研" },
  { "id": "H", "title": "Github-行情仓", "cwd": "{{userHome}}\Documents\<quote-repo>", "role": "GitHub 行情" }
]
```

判据：改完先 `--dry-run`，确认 `slots=config` 且新增槽位是 `create`、既有槽位是 `skip`。

## 四、凭据注入（模板 + 首次注入）

- `~/.dsh/.credentials.yaml`（模型 key）与重启回调 token 都**不进备份、不进 git**；备份脚本已把它们列入排除项。
- 新机器：从模板复制 → 手工填值 → 跑一次 `node scripts/check-dsh-version.mjs` 与一条最小模型调用验证。
- 判据：`Test-Path ~/.dsh/.credentials.yaml` 为真、长度非 0；**不要**把内容打印到日志或回函。

## 五、版本跟随与数据迁移

- 版本跟随：按 `local/docs/dsh-upgrade-runbook.md` 的七步走（备份 → 记录旧版本 → 升级 → 构建 → 重启 → 全量门禁 → 回滚点）；每次窗口在 `local/docs/dsh-upgrade-log.md` 追加一行，并把备份**钉住**到 `automation-backups\pinned-<日期>\`。
- 数据迁移：见 `local/docs/data-migration-spec.md`（**本技能不代做数据迁移**，见边界）。

## 六、故障排查（五条）

1. **`.ps1` 中文注释乱码 / 5.1 解析失败** → 文件缺 **UTF-8 BOM**。自查前三字节是否 `EF BB BF`；注意 `release/**` 下的脚本受 `eol-and-bom` 门禁管，**不得加 BOM**（两类文件规则相反）。
2. **wscript 隐藏壳里 `-File` 静默不执行** → 壳内命令文本改用 `-Command`；`-File` 在部分 wscript 组合下不报错也不执行。
3. **`0x800700E8`（stdio 无效 / 管道已关闭）** → 调用方重定向了不存在或已关闭的句柄；改用 `Start-Process` 显式给 `-RedirectStandardOutput/-RedirectStandardError`，或先确认管道接收端存在。
4. **`/relay/sessions` 返回 404** → 中继不在岗或路由没挂：直接读 `local/protocol/state/sessions.json` 做降级判断（`live` 字段），别把 404 当"没有槽位"。
5. **门禁红但看不出原因** → 先跑 `node scripts/check-hardcoded-paths.mjs` 与 `node scripts/check-dsh-version.mjs`，再看 `release\scripts\verify-release.mjs` 的具体 FAIL 项；硬编码门禁有基线白名单，只对**新增**命中报红。

## 七、工作流纪律（**复刻时必须一起搬**，2026-10-27/28 用户指令）

槽位和脚本搬过去只是"壳"；下面五条是"魂"。缺任何一条，新机器上的链路都会退化成人肉轮询。

### 7.1 禁止回合内 sleep 等待；等待监控交子代理或定时任务

- **禁止**在任何工具调用里用 `Start-Sleep`（或等价睡等）等待数据刷新、回函、部署结果、下一次自然刷新。
  源机器实测过代价：一个会话回合内 `Start-Sleep -Seconds 240/300` 轮询回函 198 次，回合被长期占住、积压 12 条消息。
- 需要「等待后复查」⇒ **二选一**：
  - **子代理 + 后台 job**：`subagent` / `subagent_fork` / `pwsh run_in_background`；
  - **定时任务**：`schedule_create`（**推荐**，适合定时窗口与自然刷新）。
- **派发/启动监控后主会话立即结束回合**；结果由 relay 注入或定时提醒开新回合处理。
- 派单规格里**不得**写"等 N 分钟后继续/回合内等待"，只写"回函后由 A 在新回合处理"。
- 判据：`node skills/y-task-distribution-auto/scripts/relay-dispatch.mjs status` 里不应出现"同一派单已回函但 A 回合仍占着"的形态；日志里搜 `Start-Sleep` 应为 0。

### 7.2 新任务默认入待办；未写「立即」不即时派发

- 用户新任务未出现「立即 / 现在 / 马上 / 立刻就修复」等**即时指令** ⇒ **只写入待办清单**（`local/todo-list-simple.md` §二 / §三），
  **不派单、不追问"要不要现在派发"**。
- 只有明确即时指令才立即派发；派发后按 7.1 结束回合。
- 汇报里写清本单是「即时派发」还是「已入待办」。

### 7.3 送达的唯一凭据是收据

- 写进 `outbox/` ≠ 发出；必须看到 `state/<原名>.done` 内容为 `SENT -> <槽位>`，且原件进了 `sent/`，才能说"已派单"。
- 同名文件**只投一次**（收据含 `FAIL` 也会永久挡同名重发）⇒ 重发必须换号（`-r2`）。
- 回函判据看 `inbox/reply-<派单号>.md` 或 `state/inbox-*.done`，**不要**把台账里的"回函登记"当成还在等。

### 7.4 重启：先看谁在跑，重启后逐个通知

- 重启**前**：`relay-dispatch check` 看在线表 + 看 `state/` 最近收据，判断有没有不可中断的链；有就等回函或在通知里写清"N 分钟内收尾"。
- 重启**后**：**立刻**给当时在跑的槽位逐个发通知，写清四件事：旧 PID → 新 PID + 不可用秒数、你那一轮被中断了、工作区文件不受影响、从断点继续。
- **绝不**在工具调用里自己 kill 进程；重启一律走 broker 标准通道并带回调。

### 7.5 待办清单与「进行中」

- 每次改 `local/todo-list-simple.md`：先归拢 → 归档旧版 → 按 STE 重写 → 记台账 → `node local/tools/ste-check.mjs` exit 0；
  若仓库有 HTML 门禁（`todo-html-build.mjs` / `todo-html-check.mjs`），必须一起跑且 exit 0。
- §一/§二/§三 每条必须有 `【…】` 标注（重要/不急/不用看/立刻处理/工作量大/被阻塞/缺资源）；矛盾组合不许同现。
- **派单即登记**到 §四「进行中」，收到回函同一轮内改状态，验收完**移出**；收工前对照 `check` 的在跑列表核一遍。

## 八、边界（不做的事）

- **不做数据自动迁移**（业务库、会话数据由人决定）。
- **不代做 git 推送**（钩子只把备份写到 `paths.privateRepo`，`add/commit/push` 由人执行）。
- **不承诺 Linux**（计划任务 / wscript / PowerShell 三层都在 Windows 平面）。
- 不改插件业务逻辑；不重启 8091 除非走发布窗口。

## 九、变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-10-28 | ① 新增 §3.1 **标准默认 7 个对话**（U/A + 2 生产 + 1 发布 + 1 崩溃 + 1 GitHub），并把 I/D/H/J/T 明确标为**源机器扩展**；② 新增 §七 **工作流纪律**五条（禁止回合内 sleep / 默认入待办 / 收据才算送达 / 重启前后体检与通知 / 待办清单与进行中）；③ 步骤③ 判据补默认口径指向 | 用户 2026-10-28 指令；`local/protocol/AGENTS.md` §十四/§十五/§十六；根 `AGENTS.md` §二十 |