---
name: y-auto-workflow-install
description: 把「全自动开发工作流」（用户决策 U → 待办维护 A → 生产/发布/崩溃/GitHub 执行槽位，派单闭环靠收据证明送达）安装到**当前** DSH 环境。覆盖：技能落位与发现（`.agents/skills` 联接）→ 填配置与占位符 → 建 7 个默认槽位 → 装中继与守护 → 发布链门禁 → 冒烟派单 → 把回合纪律写进本仓 AGENTS.md → 验收与回滚。当用户说「安装全自动工作流」「把派单链路装到这台机器」「接入 y-automation-portable」「配置槽位/派单」时触发；也可由另一个 DSH 的 LLM 直接阅读本文件自装。
---

# 安装全自动派发工作流（y-auto-workflow-install）

> **你是谁**：正在读这份文件的 DSH LLM。本文件告诉你**怎样把这套工作流装到你自己（或你所在）的环境**，而不是解释它是什么。
> 工作流本身的用法在另外两个技能里：`y-automation-portable`（装/搬）与 `y-task-distribution-auto`（日常派单）。
> 路径约定：本文用 `<bundle>` 表示本规格包根目录，用 `<repo>` 表示你要接入的业务仓根目录。

---

## 〇、触发与边界

**要装这套东西时用本技能**：新机器、新服务器、新 DSH 实例、要把派单链路接入现有仓库。

**不适用**：
- 只改某个插件业务逻辑（去插件的开发流程）；
- 单次发布上线（去发布技能）；
- 只想"看看"这套工作流长什么样（读 `README.md` 即可）。

**动手前必须先确认三件事**（缺一件就停在原地问用户，不要猜）：
1. 目标仓库在哪（绝对路径）？
2. DSH 数据目录（`DSH_HOME`）在哪？
3. 这台机器是否允许注册计划任务（需要管理员）？

---

## 一、前置检查（逐项过，不满足就别往下走）

| 项 | 要求 | 检查命令 | 不满足时 |
|---|---|---|---|
| 操作系统 | **Windows**（计划任务 / wscript 隐藏壳 / PowerShell） | `$PSVersionTable.PSVersion` | 停下，告知本工作流不承诺 Linux/macOS |
| Node | 22+ | `node -v` | 先装 Node 22+ |
| pnpm | 可用 | `pnpm -v` | 先装 pnpm |
| 业务仓 | 已克隆、`local/protocol/` 可写 | `Test-Path <repo>\local\protocol` | 先克隆仓库 |
| DSH | 能启动 Web 且会话可在花名册出现 | `node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs check` | 先按 DSH 部署文档拉起宿主 |
| 管理员 | 注册计划任务时需要 | 一次性提权 | 没权限就只做前三步，把跑批交给用户手工起 |

---

## 二、技能落位：先让 DSH **发现**这两个技能

DSH 发现技能的路径是 `<repo>\.agents\skills\<技能名>`（该目录通常被 `.gitignore`）。两种做法任选：

**做法 A（推荐，源文件仍归仓库管）**：建联接目录

```powershell
$repo = '<repo>'
foreach ($name in @('y-automation-portable','y-task-distribution-auto')) {
  $link = Join-Path $repo ".agents\skills\$name"
  if (-not (Test-Path (Split-Path $link -Parent))) { New-Item -ItemType Directory (Split-Path $link -Parent) -Force | Out-Null }
  New-Item -ItemType Junction -Path $link -Target (Join-Path $repo "skills\$name") -Force | Out-Null
}
```

**做法 B（包内直接复制）**：把 `<bundle>\skills\*` 整个复制到 `<repo>\skills\`，再按做法 A 建联接。

> 判据：两个技能目录下都有 `SKILL.md`，且 front matter 的 `name:` **与目录名逐字一致**（不一致时 DSH 不认）。
> 安装本安装技能自身：把 `<bundle>\install-skill\y-auto-workflow-install` 复制到 `<repo>\skills\`，同样建联接。

---

## 三、六步安装（每步都有判据，不合格不进入下一步）

### ⓪ 先把支撑脚本落到 `<repo>\scripts\`

```powershell
# 本包 support/ 下的四份：init-slots.mjs / automation-backup.ps1 / check-dsh-version.mjs / automation.config.example.json
Copy-Item '<bundle>\support\*' '<repo>\scripts\' -Force
Copy-Item '<repo>\scripts\automation.config.example.json' '<repo>\automation.config.json' -Force
```

判据：`Test-Path <repo>\scripts\init-slots.mjs`、`Test-Path <repo>\automation.config.json` 都为真；
`node --check <repo>\scripts\init-slots.mjs` exit 0；`automation-backup.ps1` 前三字节为 `EF BB BF`（UTF-8 BOM，PowerShell 5.1 必需）。

### ① 填配置与占位符

1. 按 `<bundle>\docs\placeholder-map.md` 把包内出现的 `{{…}}` 全部替换成真实值。
2. 在 `<repo>` 下准备 `automation.config.json`，最小必需字段：
   `paths.repoRoot` / `paths.dshHome` / `paths.protocolDir` / `paths.backupDir` / `ports.dev` / `ports.release` / `domains.public` / `dsh.checkout` / `dsh.version` / `slots`。
3. `slots` 先按 **7 个默认对话**填（见 §四）。

判据：
```powershell
node -e "JSON.parse(require('fs').readFileSync('<repo>/automation.config.json','utf8'))"   # exit 0
```

### ② 建 7 个默认槽位（先干跑）

```powershell
node <repo>\scripts\init-slots.mjs --dry-run
node <repo>\scripts\init-slots.mjs
node <repo>\scripts\init-slots.mjs --dry-run        # 再干跑应全 skip
```

判据：第一次干跑每行给出 `skip/create`；真跑后 `local/protocol/session-map.json` 的 `slots` 全部写入；第三次干跑**全 skip**。

### ③ 装中继（这步不做，派单永远没有收据）

- 安装并启用 `@dsh-external/dsh-relay-watch`（bundle，随宿主启动；源码路径取自 `automation.config.json` 的 `paths.relayWatchSource`）。
- 它每 5 秒扫 `outbox/` 与 `inbox/`，投递成功写 `state/<原名>.done`。

判据：`local/protocol/state/relay-status.json` 每 25 秒刷新；`node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs check` 的"状态文件"一项不是过期。

> ⚠️ 改 `dsh.profile.bundles`（宿主启动路径）前必须先做离线自检与干跑 —— 一个不合格的 bundle 会让**整个宿主起不来**，不是"那个插件不生效"。

### ④ 守护（可选但强烈建议）

- 注册计划任务：broker / dispatch / 端口保活 / host-kill-audit（命名以 `DSH*` 开头便于清理）。
- 隐藏控制台壳用 `wscript`；**壳内命令文本只用 `-Command`，不要用 `-File`**（部分组合下 `-File` 不报错也不执行）。

判据：`Get-ScheduledTask -TaskName 'DSH*' | Format-Table TaskName,State` 全 Ready；采样两个周期无可见控制台。

### ⑤ 发布链门禁（有新环境时才需要）

```powershell
bash scripts/build.sh
npm run build:client
node scripts/check-client-bundles.mjs
node release\scripts\verify-release.mjs
```

判据：构建与产物门禁 **exit 0**；`verify-release` 的 OK 数不低于基线，FAIL 逐条列给用户。

### ⑥ 冒烟派单（唯一能证明"装通了"的判据）

```powershell
node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs check
node skills\y-task-distribution-auto\scripts\relay-dispatch.mjs send --to A --kind coord --id smoke-<时间戳> --text "只读冒烟：回一句『收到』即可" --confirm
```

判据（缺一不可）：
1. `check` 里目标槽位 `live=true`；
2. 收据文件 `local/protocol/state/outbox-to-A-smoke-<时间戳>.md.done` 内容为 `SENT -> A`，原件已进 `sent/`；
3. **60 秒内**收到回函 `local/protocol/inbox/reply-smoke-<时间戳>.md`（或 `state/inbox-reply-*.done`）。

> 三条都满足才算"装通"。只有第 2 条、没有第 3 条 ⇒ 对面会话没在处理，回去看它是否在线、是否被回合卡住。

---

## 四、默认 7 个对话（安装时按这张表填 `slots`）

| 槽位 | 角色 | 允许的 `--kind` | 明确禁止 |
|---|---|---|---|
| `U` | 用户决策（唯一入口，只与用户对接） | `user` | 向执行槽位派单、改代码、查库、重启 |
| `A` | 待办维护（调度点，唯一派发方） | `coord` | 自己当执行者接重活 |
| `B` | 插件生产 ①（开发） | `dev`、`ops` | 在该会话里做发布 |
| `F` | 插件生产 ②（开发，与 B 并行） | `dev`、`ops` | 与 B 抢同一件活 |
| `C` | 发布 Release | 只允许 `release` | 产品需求、文案、界面、dev 行为改动 |
| `E` | 崩溃报告（崩溃简报与宿主故障取证） | `crash`、`ops` | 产品需求、发布操作 |
| `G` | GitHub 入库（投研仓） | `git` | 别的仓、业务代码改动 |

扩展槽位（**默认不建**，业务需要时按 `{{…}}` 与花名册追加，并在 `automation.config.json` 的 `_docs.slots` 写明"为什么加"）：

| 槽位 | 典型用途 | `--kind` |
|---|---|---|
| `I` | 第三生产（并发开发） | `dev`、`ops` |
| `D` | 行情/采集服务端（cwd 在另一个仓） | `data` |
| `H` | 第二个 GitHub 仓（行情仓） | `git` |
| `J` | 用户中心 / 运维工具箱工作区 | `dev`、`ops` |
| `T` | 诊断位（只跑通道自检） | `selftest` |

> 纪律：**同一件活只派一个生产槽位**；任务与其追加件（`-adN`）回同一槽位；三个生产并行改同一批文件要先分区（谁改源码、谁改测试文档、谁改脚本），并在回函里写清"改了哪些文件 + 指纹"。

---

## 五、把回合纪律写进本仓 AGENTS.md（最容易漏、也最关键）

照 `<bundle>\docs\workflow-rules.md` 精简后写进 `<repo>\AGENTS.md`，**至少这五条**：

1. **禁止回合内 sleep 等待**：等数据/回函/部署结果 ⇒ 子代理 + 后台 job 或 `schedule_create`；派发后立即结束回合。
2. **新任务默认入待办**：未写「立即/现在/马上」⇒ 只登记待办，不派单、不追问。
3. **收据才算送达**：`SENT -> <槽位>` 收据 + 原件进 `sent/`，两者齐了才可说"已派单"。
4. **重启前后**：重启前看谁在跑；重启后逐个通知被中断的会话（旧 PID → 新 PID、不可用秒数、从断点继续）；不得自己 kill 进程。
5. **待办清单变更**：归拢 → 归档 → 重写 → 台账 → `ste-check` exit 0；有 HTML 门禁一并跑；每条必带 `【标签】`；派单即登记「进行中」。

判据：`AGENTS.md` 里能搜到这五条的关键词（"sleep"/"默认入待办"/"收据"/"PID"/"ste-check"），且每条都写了"违反怎么处理"。

---

## 六、验收清单（安装完成后逐条给用户看证据）

| # | 判据 | 期望 |
|---|---|---|
| 1 | 两个技能可被 DSH 发现 | `.agents\skills\` 下两个目录可读，`SKILL.md` 的 `name` 与目录名一致 |
| 2 | 配置合法 | `JSON.parse(automation.config.json)` exit 0 |
| 3 | 槽位已建 | `init-slots --dry-run` 全 skip；`session-map.json` 的 `slots` 有 7 条 |
| 4 | 中继在岗 | `relay-status.json` 25 秒内刷新 |
| 5 | 花名册可见 | `check` 打印 7 个槽位，`live=true` |
| 6 | 冒烟往返 | 收据 `SENT -> A` + 60 秒内回函 |
| 7 | 规则已落盘 | `AGENTS.md` 含五条纪律 |
| 8 | 门禁未破坏 | 构建 / 客户端产物 / 发布校验均 exit 0（若该仓有这些门禁） |

把 1–8 的**原始输出**贴进回函或报告，不要只写"已完成"。

---

## 七、常见安装失败（按现象查）

| 现象 | 真实原因 | 处置 |
|---|---|---|
| 技能不出现 | `.agents\skills` 联接没建、或 `name` 与目录名不一致 | 重建联接；改 front matter |
| 派单永远没收据 | 中继没装 / 没随宿主启动 | 看 `relay-status.json` 与 `relay.log` 有没有 `START` |
| 收据有 `FAIL` | 目标会话不在线（重试 6 次后放弃） | 打开该会话 → `check` → 换新号重派 |
| 派单被拒「缺判据/边界」 | 规格没写这两节 | 用 `templates/dispatch-spec-template.md` 重写；确不需要时加 `--no-template-check` 并说明理由 |
| 派单被拒「角色/类型不匹配」 | `--kind` 与槽位不配 | 换槽位或换 kind，不要绕过 |
| `check` 报"标题与预期角色不符" | 槽位绑定指错会话 | 核对 `session-map.json` 与真实会话标题；有把握才 `--force-title` |
| 宿主起不来（改过 bundles） | bundle 契约不满足 | 回滚 `dsh.profile.bundles`；改之前必须先干跑 dump-config |

更细的对照表在 `y-task-distribution-auto` 的 SKILL.md §五（失败与异常）与 §六（脚本参数）。

---

## 八、边界（不要顺手做）

- 不代做数据迁移（业务库、会话数据由人决定）；
- 不代做 git 推送（提交/推送由人执行）；
- 不改业务代码；
- 不在工具调用里 kill 宿主进程；重启走标准通道并带回调；
- 不在回合内 sleep 等安装结果（本技能自己也得守这条：跑完就结束回合，结果由用户或定时任务触发下轮）。

## 九、回滚

按安装顺序倒着撤：
1. 删除 `.agents\skills\<两个技能名>` 联接（只删链接，不删源目录）；
2. 卸载计划任务里以 `DSH*` 命名、本次新增的项；
3. 停用中继插件（从 `dsh.profile.bundles` 移除并干跑验证）；
4. 需要时恢复 `session-map.json` 备份（安装时应先备份为 `session-map.json.bak-before-install-<日期>`）；
5. 保留 `local/protocol/` 与台账，便于事后追溯。

## 十、交接：装完给用户什么

回函/报告固定给四段：
1. **执行结论**（装通/未装通 + 卡在哪一步）；
2. **关键产物**（两个技能路径、`automation.config.json`、`session-map.json`、冒烟收据与回函路径）；
3. **异常与降级**（哪一步没做、为什么、影响面）；
4. **后续建议**（要不要加扩展槽位、要不要开守护计划任务、运行第一周该盯什么）。
