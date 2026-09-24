# SPEC — @dsh-external/dsh-dialogue-alert-message

> 依据根目录 `plugin-design-spec-template.md` 填充；本插件为**被动状态栏工具形态**（无主循环、无窗口/画布交互），
> 模板中不适用章节（主循环 §5、模型调用 §6、外部采集 §9、窗口吸附 §10.8、右键菜单 §10.9）标记为「不适用」。

| 项 | 值 |
|---|---|
| 插件名 | `dsh-dialogue-alert-message`（对话状态提醒 + DeepSeek 用量统计） |
| 形态 | hybrid（Host 事件监听 + Client 状态栏；无 timer 主循环，仅低频余额刷新计时器） |
| 依赖运行面 | Host：`webServer`/`sessions`/`llm`（`llm/stream` 钩子记录模型）；Client：`slots`（`sidebar.footer.action`） |
| 默认模型 | 不调用 LLM（纯被动监听；模型仅作计价 key，来源为 `llm/stream` 钩子捕获） |
| 缓存目录 | `~/.dsh/dsh-dialogue-alert-message/`（stats.json） |
| 装配方式 | profile bundle（`cordis.patch.yml` 自装配） |

## 1. 概述

监听 DSH session 事件流：完成/失败轮次播放提示音（原有能力），并按 DeepSeek 官方价目
折算当日消耗、累计对话轮次、查询账户余额，统一经 `/api/usage` 供侧边栏状态栏展示。

## 2. 数据模型

- 用量事件：`assistant/message.usage`（`TokenUsage`：inputTokens 未命中输入 / cacheReadTokens 命中 /
  outputTokens 输出；DeepSeek 无 cacheWrite，未命中即写入价）。
- 持久化 `stats.json`：`{version:1, day, dialogueCount, todayCost, recentKeys[≤1024], updatedAt, balance, balanceAt}`；
  损坏/缺字段 → `loadState`/`loadBalance` 回退默认并重建（不抛错）。
- 统一接口数据：`{dialogueCount, todayCost, balance|null, updatedAt}`（`sanitizeOverview` 杜绝非有限数上屏）。

## 3. RPC 协议

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/@dsh-external/dsh-dialogue-alert-message/api/usage` | `{ok, data:{dialogueCount, todayCost, balance, updatedAt}}`（getUsageOverview 一次性返回） |
| GET | `/@dsh-external/dsh-dialogue-alert-message/api/status` | `{ok, counts, lastEvent}`（兼容，未变更） |

## 4. Client UI

- 挂载：`sidebar.footer.action`（order 10）；折叠态图标按钮（原语义：点击展开侧边栏）。
- 宽态文本精确格式：`对话: {N}，当日: {X.XX}元，余额: {Y.YY}元`；
  `font-variant-numeric: tabular-nums`；缺失态 `--` 占位；禁止 `undefined/NaN/null/原始错误`。
- 轮询：1s（status + usage 并行，任一失败互不影响）；不新增窗口/菜单/按钮（交互语义零变更）。

## 5. 容错

- 余额查询全程异步非阻塞；超时（`balanceTimeoutMs`）/网络失败/401/限流 → 保留上次成功缓存值 +
  `ctx.logger.warn`；并发在途互斥 + 最小间隔节流。
- `apply` 内 try-catch，异常不冒泡；事件回调整体 try-catch；持久化失败仅日志。
- 生命周期：计时器/事件监听全部经 `ctx.effect` / `ctx.on`（global）注册，卸载自动清理；释放前落盘。

## 6. 验收标准

- [ ] `node --test test/` 全绿（21 例：计价/高峰因子/跨日/幂等/持久化回退/格式化/余额解析/节流）
- [ ] `dev_reload_package` 后 fiber active，`/api/usage` 返回 `{ok:true,data:{...}}`
- [ ] `/api/status` 行为不变
- [ ] 浏览器硬刷新（Ctrl+F5）后状态栏显示精确文案、数字 tabular-nums、余额失败时 `--`
- [ ] 跨日/重启：当日消耗清零、累计次数与缓存余额恢复（人工确认项）

## 7. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-05 | v0.2.1 | **自包含化（用户指令）**：移除全部 alert-hub 对接——发声仅经本插件内部队列 `/api/alarm` → 客户端 WebAudio（音色/音量/时长按等级），本插件不与任何其他插件交互；alarm.log/门控/去重/结构化日志不变；同步回滚 xllh-alert-hub（恢复仅高危发声，见其 v0.3.13） |
| 2026-09-05 | v0.2.0 | 强制中断报警：中断原因枚举（tool-error/forced-cancel/session-evicted/host-restart，注册式扩展）+ 归一化分类（turn/end、恢复种子、销毁开放轮）+ 幂等去重（持久化）+ 门控（总开关/全静音/等级过滤/免打扰，clamp+持久化+即时生效 + `/api/alarm-settings`）+ 内部通知 `/api/alarm` + 客户端音色播放/ack + 结构化报警日志（alarm.log JSONL）；客户端错误音移除（用户主动取消静默）；映射纯函数单测 + 集成场景 4/5 |
| 2026-09-03 | v0.1.1 | 状态栏文案缩写：`对话: {N}，当日: {X.XX}元，余额: {Y.YY}元`（半角冒号+空格；数据源/占位态/样式不变） |
| 2026-09-05 | v0.1.0 | 新增 DeepSeek 用量统计：余额查询（凭据 seam + 官方余额接口）、当日消耗插件侧累计（官方价目表 + 高峰/空闲因子 + 模型归属 llm/stream 钩子）、顶层会话完成轮幂等计数、stats.json 持久化 + 损坏回退、`/api/usage` 统一查询、状态栏精确文案改造（tabular-nums + 缺失态占位） |
