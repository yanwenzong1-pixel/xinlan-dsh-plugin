# @dsh-external/dsh-dialogue-alert-message

Monitor DSH dialogue execution states and play completion/error sounds. Since
**v0.1.0** also tracks DeepSeek account usage (dialogue count / today cost /
balance) and shows it in the sidebar status bar. Since **v0.2.0** also alerts
on forced interruptions (tool errors / session eviction / host restart).

## 强制中断报警（v0.2.0）

对话被**非用户主动**原因强制终止时，立即报警一次（重要级：工具执行异常/外部强制取消/
上下文内存移除；高危级：宿主强制重启恢复）。语义：

- **归一化**：中断原因统一枚举 `tool-error | forced-cancel | session-evicted | host-restart`
  （`src/lib/interruption.ts`，注册式扩展 `registerInterruptionKind`，无散落硬编码分支）；
- **幂等**：`kind:sessionId:turn` 去重（持久化 `recentAlertKeys`，cap `alarmDedupeCap` 默认 1024），
  同一中断事件重复广播只报警一次；新中断（新 turn）可再次触发；
- **唯一出口**：报警经本插件**自包含通知服务**（v0.2.1 起）——宿主内部队列 `/api/alarm` →
  本插件客户端 WebAudio 统一发声（音色/音量/时长按等级：重要=double、高危=triple；`sounds` 可配，
  音量 0..1 / 时长 100..5000 clamp），播放后 ack 消除；**不与其他任何插件交互**（无 alert-hub 对接）；
- **门控（宿主侧，可配置+持久化+即时生效）**：总开关 `alarmEnabled`、全静音 `muteAll`、
  等级过滤 `mutedLevels`、免打扰时段 `dndWindows`（HH:mm，支持跨天）；
  静音命中 → 不发声但日志留痕；
- **声音区分严重度**：音色/音量/时长按等级映射（重要=double、高危=triple）；
- **防无限循环（v0.2.2）**：①ack 独立 exact 路由 `POST /api/alarm/ack`（历史上 ack 与 /api/alarm
  共路由被 exact 404 → 每秒重播循环的根因）；②同一报警（id）客户端**最多连续播放 3 次**
  （`src/lib/alarm-replay.ts` 纯函数 `replayDecision`），超限静默但仍尽力 ack 清队——
  任意 ack 失败/多标签极端场景下也不会无限循环；
- **可观测**：每次判定输出 JSONL 一行至 `~/.dsh/dsh-dialogue-alert-message/alarm.log`
  （UTC ISO8601 时间戳 + 会话 ID + 中断原因 + 触发等级 + 是否已报警 + 静音过滤原因）；
- **不误报**：用户主动结束/主动取消（aborted-user）/max-tokens/blocked 均静默（客户端错误音已移除）；
- 配置读写：`GET/POST /@dsh-external/dsh-dialogue-alert-message/api/alarm-settings`
  （POST 全字段 clamp 收敛 + 写入 `alarm-settings.json` + 即时生效）。

## 展示文案（v0.1.0 起）

宽侧边栏状态栏文本为精确格式（`font-variant-numeric: tabular-nums`，金额两位小数）：

```
对话: {dialogueCount}，当日: {todayCost}元，余额: {balance}元
```

缺失态占位：首次加载未完成 → 全部 `--`；余额未知/刷新失败 → 仅余额 `--`；
禁止出现 `undefined` / `NaN` / `null` / 原始错误信息。折叠态图标按钮与交互语义不变。

## 数据来源与口径

| 字段 | 来源 | 口径 |
|---|---|---|
| dialogueCount | 顶层用户 session 的 `turn/end(reason.kind=completed)` | 每次完成轮 +1；同轮（sessionId:turn）重复回调幂等；子代理/后台 session 不计 |
| todayCost | 插件侧累计：`assistant/message.usage` × 单价表 × 高峰/空闲因子 | 含 error/aborted/max-tokens 轮中已消耗 token（真实扣费口径）；不区分 session，天然覆盖后台插件 LLM 调用 |
| balance | `GET {baseURL}/user/balance`（官方接口无当日消耗字段，故消耗为插件侧累计口径） | 优先 CNY；查询失败保留上次成功缓存值并仅记录日志 |

- 跨日：当日消耗按 `Asia/Shanghai`（UTC+8，与平台账单时区一致；`tzOffsetMin` 可配）清零后重新累计，累计对话次数不回退。
- 高峰/空闲：官方价目表高峰 = 北京时间工作日 9:00-12:00 / 14:00-18:00，其余 ×`offPeakFactor`（默认 0.5）。缺省单价见 `config.prices`（与 DeepSeek 官方价目表一致：v4-flash / v4-flash-vision-exp 高峰 1.5/0.05/4.5 元每百万 token，v4-pro 4.5/0.15/13.5）。

## 配置（cordis.patch.yml → `config:`）

```yaml
- id: dsh-dialogue-alert-message
  config:
    apiKeyEnv: DEEPSEEK_API_KEY       # 凭据引用（凭据 seam 解析；同 llm-deepseek 默认）
    baseURL: https://api.deepseek.com # 可被 $DEEPSEEK_BASE_URL 覆盖
    balanceTimeoutMs: 5000
    balanceMinIntervalMs: 30000       # 余额接口最小间隔（节流）
    balanceTimerMs: 300000            # 低频定时刷新
    tzOffsetMin: 480                  # 日切时区（北京 = 480）
    offPeakFactor: 0.5
    peakWindows: [[9, 12], [14, 18]]
    peakWeekdays: [1, 2, 3, 4, 5]
    prices:                           # 单价（元/百万 tokens）校准入口：模型 id → {input, cacheHit, output}
      deepseek-v4-flash: { input: 1.5, cacheHit: 0.05, output: 4.5 }
      deepseek-v4-flash-vision-exp: { input: 1.5, cacheHit: 0.05, output: 4.5 }
      deepseek-v4-pro: { input: 4.5, cacheHit: 0.15, output: 13.5 }
    defaultPrice: { input: 1.5, cacheHit: 0.05, output: 4.5 }
    statsFile: ""                     # 默认 $DSH_HOME|~/.dsh/dsh-dialogue-alert-message/stats.json
```

**单价校准**：缺省映射为 DeepSeek 官方公开价目表（2026-08-28 版，[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）；
DeepSeek 保留调价权，若账单与显示不一致，以官方最新价为校准依据修改 `prices` 后 `dev_reload_package` 即时生效。
未知模型回退 `defaultPrice`。

## 刷新策略

1. 页面加载 / 侧边栏初始化完成 → 客户端首个 `/api/usage` 请求触发一次余额刷新；
2. 每轮对话完成（completed turn）→ 异步触发一次（`balanceMinIntervalMs` 节流）；
3. 低频定时（`balanceTimerMs`，默认 5 分钟）；
4. 全部异步、非阻塞、互斥（并发只会有一个在途请求）；失败写 `ctx.logger`，界面显示 `--` 或上次成功缓存值。

## RPC

- `GET /@dsh-external/dsh-dialogue-alert-message/api/usage` → `{ ok, data: { dialogueCount, todayCost, balance, updatedAt } }`（统一查询接口，一次返回全部字段）
- `GET /@dsh-external/dsh-dialogue-alert-message/api/status` → 原有运行状态（未变更）

## 持久化

`<statsFile>`（默认 `$DSH_HOME|~/.dsh/dsh-dialogue-alert-message/stats.json`，`{version:1, day, dialogueCount, todayCost, recentKeys, updatedAt, balance, balanceAt}`）：
原子写（tmp+rename）、写防抖 500ms、卸载前落盘；文件损坏或字段缺失自动回退默认值并重建，不会导致插件启动失败。

## 安全

- API Key 不硬编码、不落盘：经平台凭据 seam（`ctx.credentials.resolve(apiKeyEnv)`）解析，无 seam 时回退环境变量（与 `llm-deepseek` 同策）。
- 原始错误信息不上屏：仅写插件日志。

## 构建与注入

```bash
bash scripts/build.sh && npm run build:client
DSH_CHECKOUT=<checkout> bash scripts/build.sh # 或上面命令
# 注入器环境内：dev_reload_package dsh-dialogue-alert-message（Host 改动）；客户端改动后浏览器 Ctrl+F5
```

## 测试

```bash
node --test            # 21 例纯函数单测：计价/高峰因子/跨日/幂等/持久化回退/格式化/余额解析/节流
node integration-check.mjs  # 宿主 apply 全链路驱动（mock cordis ctx + 桩 fetch）：
                          # 事件管线计价/幂等计次/顶层过滤 → 余额查询(seam/env 回退) → 失败降级 → /api/usage → 持久化落盘
```
