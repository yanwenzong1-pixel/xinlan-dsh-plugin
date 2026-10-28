# DSH 全自动派发工作流 · 规格包（dsh-auto-dispatch-specification）

> 用途：把一套已经在生产里跑通的「**用户决策 → 待办维护 → 执行槽位**」自动化链路，连同它的**两个技能**与**安装说明**，打包给其它 DSH 环境复刻。
> 版本：2026-10-28（v1）｜ 适用：DeepSeek Harness（DSH）Windows 本机部署
> **平台**：作者在 **DSH Web 端**开发/验证；**Desktop 桌面端需要自行做兼容化改造**，本规格包不保证 Desktop 开箱即用。
> **本包已脱敏**：不含用户名、私有仓名、远端服务地址、会话 id 等身份信息（见 `PRIVACY-SCRUB.md`）。

---

## 实测收益（作者环境，非通用承诺）

**Token 缓存命中率 99.6%**

![缓存命中率 99.6%](docs/images/cache-hit-99.6.png)

**近 30 天用量：49,320,381,740 tokens / ¥2,698.76**

![近 30 天用量](docs/images/usage-cost-100m-tokens.png)

- **缓存命中率 99.6%**：作者本机 DSH 状态栏实测（参考图 1 红框/高亮行）。
- **每 1 亿 token 成本约 ¥5.47**：作者环境近 30 天累计 **49,320,381,740 tokens**、消费 **¥2,698.76**；`2698.76 ÷ 493.2038174 ≈ 5.47 元/亿 token`，因此口径为 **5–6 元/亿 token**（参考图 2）。
- **达成前提**（缺一条结果都会变差）：
  1. **严格使用自动派发任务**，让上下文稳定、可缓存，而不是反复新开会话/重复喂长上下文；
  2. 作者使用了开源项目 [Ponytail](https://github.com/DietrichGebert/ponytail) 辅助节省 token；
  3. 作者全程使用 **DeepSeek V4.1-Flash**；
  4. 以上是作者单一环境的实测，不是对任何仓库、模型或使用方式的保证；缓存命中率与单价会随上下文结构、模型价格与调度纪律变化。

> 这两张图是作者环境的用量截图；第二张图里的余额/累计消费属于作者账号数据，仅用于说明口径。它们不是安装包的一部分。

---

## 界面与运行示意

| DSH 槽位会话（U/A/B/F/C/E/G…） | 自建监控面板（**不包含在本仓库代码中**） |
| --- | --- |
| ![槽位会话示例](docs/images/slots-session-list.png) | ![监控 dashboard 示例](docs/images/monitor-dashboard-example.png) |

> ⚠️ **关于第二张监控 dashboard**：它是作者在自己的环境里另外搭建的监控面板，仅用于展示“槽位关系 / 在线状态 / 当前任务 / 回函”的观感。**本开源仓库只包含自动化开发流程本身（技能、规则、派单脚本、槽位初始化、备份与版本检查），不包含该 dashboard 的前端、后端、数据源或部署代码。** 使用本规格包的人需要自己为自动化流程配一个监控面板（或直接使用 DSH 会话列表、`relay-dispatch.mjs check/status` 的文本输出）。
>
> 截图里的会话命名、任务标题与槽位 ID 均为演示口径；监控截图的**会话 id 列已打码**，不要把截图当作可直接照抄的地址或配置。

---

## 一、这套工作流是什么

一句话：**用户只跟一个入口说话，入口把需求交给调度点，调度点把活派给 5 类专业会话，靠"收据"证明送达、靠"回函"收回结果。**

默认拓扑 **7 个对话**：

```
用户
 └─ U 用户决策（唯一入口，只与用户对接）
     └─ A 待办维护（调度点，唯一派发方）
         ├─ B 插件生产 ①   dev/ops
         ├─ F 插件生产 ②   dev/ops（与 B 并行）
         ├─ C 发布 Release  release（只做发布）
         ├─ E 崩溃报告      crash/ops（同时收崩溃简报）
         └─ G GitHub 投研仓 git
```

- **为什么是 7**：U + A + 2 生产 + 1 发布 + 1 崩溃 + 1 GitHub，刚好覆盖「开发 → 发布 → 出事 → 入库」全环，不多不少。
- **可扩展**：源环境另加了第三生产、行情服务端、第二 GitHub、用户中心等槽位；扩展不属于默认口径，新环境按需追加（见 `skills/y-automation-portable/SKILL.md` §3.2）。

## 二、包里有什么

```
dsh-auto-dispatch-specification/
├─ README.md                        ← 本文件
├─ PRIVACY-SCRUB.md                 ← 脱敏清单（改了哪些、为什么、源仓是否被动过）
├─ docs/
│  ├─ workflow-rules.md             ← 工作流规则摘要（脱敏版，可直接抄进你的 AGENTS.md）
│  └─ placeholder-map.md            ← 全部占位符的含义与取值方式（安装时按表替换）
├─ install-skill/
│  └─ y-auto-workflow-install/
│     └─ SKILL.md                   ← 「给自己的 DSH 安装这套工作流」的技能（交给对方的 LLM 执行）
├─ support/                         ← 链路需要的支撑脚本（已脱敏；复制到你仓库的 scripts/ 下）
│  ├─ init-slots.mjs                ← 按 automation.config.json 建/校验槽位（干跑 + 真跑）
│  ├─ automation-backup.ps1         ← 打包备份（协议目录、槽位表、计划任务、profile）
│  ├─ check-dsh-version.mjs         ← 跟版检查（配置里的 dsh.version vs 实际 checkout）
│  └─ automation.config.example.json← 配置示例骨架（默认 7 个槽位，占位符待填）
└─ skills/
   ├─ y-automation-portable/
   │  └─ SKILL.md                   ← 技能①：链路移植（换机器/新服务器复刻、备份、槽位自定义、版本跟随）
   └─ y-task-distribution-auto/
      ├─ SKILL.md                   ← 技能②：派单唯一安全入口（体检 → 干跑 → 确认 → 收据 → 台账/回函）
      ├─ templates/dispatch-spec-template.md   ← 派单规格模板（六节，含「回合纪律」）
      └─ scripts/relay-dispatch.mjs            ← 派单脚本（唯一入口；槽位表在文件顶部 SLOTS）
```

## 三、三步上手（给对方环境的人 / 对方的 LLM）

1. **读安装技能**：`install-skill/y-auto-workflow-install/SKILL.md` —— 它写清了"另一个 DSH 的 LLM 该按什么顺序把技能装到自己身上"。
2. **落位技能与脚本**：复制 `skills/*` 到你仓库的 `skills/` 下，并建 `.agents/skills/<技能名>` 联接目录（Windows `mklink /J` 或 `New-Item -ItemType Junction`），技能才会被发现；再把 `support/*` 复制到你仓库的 `scripts/` 下，并把 `support/automation.config.example.json` 复制成 `<repo>/automation.config.json`。
3. **填占位符 + 建槽位**：按 `docs/placeholder-map.md` 全局替换 `{{…}}`，再跑 `node scripts/init-slots.mjs --dry-run` 建 7 个默认槽位。

验收：`node skills/y-task-distribution-auto/scripts/relay-dispatch.mjs check` 能看到你的 7 个槽位在线；发一发只读冒烟派单，60 秒内收到回函。

## 四、两个技能的分工（别混）

| 技能 | 解决的问题 | 什么时候用 |
|---|---|---|
| `y-automation-portable` | **把链路搬过去**：配置、备份、槽位、中继、计划任务、发布链、冒烟、工作流纪律 | 换机器 / 新服务器 / 重建环境 |
| `y-task-distribution-auto` | **把活派出去**：体检、干跑、确认、收据、台账、回函、异常对照 | 日常派单（A 调度点专用） |

> 一句话记法：前者是「**装**」，后者是「**用**」。

## 五、五条回合纪律（不搬这五条，链路会退化成人肉轮询）

1. **禁止回合内 sleep 等待**：等数据/回函/部署结果一律交给**子代理 + 后台 job** 或**定时任务**，启动后立即结束回合。
2. **新任务默认入待办**：用户没说「立即/现在/马上」⇒ 只写待办清单，不派单、不追问。
3. **收据才算送达**：写进 `outbox/` 不算；看到 `state/<原名>.done` = `SENT -> <槽位>` 才算。
4. **重启前后要体检与通知**：重启前看谁在跑；重启后逐个通知被中断的会话（旧 PID → 新 PID、不可用秒数、从断点继续）。
5. **待办清单每次变更都要归拢**：合并同类项、已完成移出、`【标签】` 必标、`ste-check` exit 0；有 HTML 门禁的一起跑。

完整版见 `docs/workflow-rules.md`。

## 六、边界（这套包不做什么）

- **不包含监控 dashboard**：第二张截图里的 dashboard 是作者环境自建的可视化，不是本包代码；本包只有流程/技能/脚本/规则。你需要自己接监控面板。
- **不代做数据迁移**（业务库、会话数据由人决定）。
- **不代做 git 推送**（提交/推送由人执行）。
- **不承诺 Linux / macOS**（计划任务、wscript 隐藏壳、PowerShell 都在 Windows 平面）。
- **不改你仓库的业务代码**：安装只新增技能目录、配置与协议目录。

## 七、来源与版本

| 项 | 值 |
|---|---|
| 打包日期 | 2026-10-28 |
| 技能版本 | `y-automation-portable`（含 §七 工作流纪律）、`y-task-distribution-auto`（含十二条铁律） |
| 脱敏 | 已移除 8 类身份信息，泄漏复核 0 命中（`PRIVACY-SCRUB.md`） |
| 兼容性 | 派单脚本 `relay-dispatch.mjs` 已通过 `node --check`；用法里的槽位清单由脚本动态打印 |
