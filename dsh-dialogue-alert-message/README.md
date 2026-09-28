# @dsh-external/dsh-dialogue-alert-message

监控 DSH 对话执行状态：侧栏状态栏显示 DeepSeek 账号用量（对话数 / 当日花费 / 余额）；
对话**正常完成**播「叮咚」；对话被**非用户主动**原因强制中断时，按等级播报警音。
报警走本插件**自包含**通道（宿主内部队列 `/api/alarm` → 本插件客户端 WebAudio 发声 + ack），
**不与其他任何插件交互**。

- 当前版本：`0.2.1`（`package.json`；本轮把原先落后的 `0.1.1` 校正为与源码一致）
- 形态：宿主半 `src/index.ts` + 客户端半 `src/client/index.ts`（插槽 `sidebar.footer.action`，`order: 10`）
- 配套文件：`SPEC.md`（设计说明）、`integration-check.mjs`（宿主全链路检查）
- 客户端注入：`['slots']`（`src/client/index.ts:21`）

## 一、两块能力

### 1. 状态栏与用量

状态栏在侧栏「设置」按钮**上方**（`src/client/index.ts:107-111`），宽态文本为固定格式：

```
对话: N，当日: X.XX元，余额: Y.YY元
```

- `tabular-nums`、金额两位小数；折叠态只显示一个运行状态图标按钮（点击展开侧边栏，`:200-222`）。
- 缺失态：首次加载未完成 → 三项全 `--`；余额从无成功记录 → 仅余额 `--`；
  不出现 `undefined` / `NaN` / `null` / 原始错误信息（`:224-227`、`:202-211`）。
- 客户端每 **1 秒**轮询 `/api/status` 与 `/api/usage`（`setInterval(..., 1000)`，`:193`）。

数据口径：

| 字段 | 来源 | 口径 |
| --- | --- | --- |
| `dialogueCount` | 顶层用户 session 的 `turn/end(reason.kind=completed)` | 每次完成轮 +1；同轮（`sessionId:turn`）重复回调幂等；子代理/后台 session 不计 |
| `todayCost` | 插件侧累计：`assistant/message.usage` × 单价表 × 高峰/闲时因子 | 含 error/aborted/max-tokens 轮已消耗 token（真实扣费口径）；不区分 session，天然覆盖后台插件的 LLM 调用 |
| `balance` | `GET {baseURL}/user/balance`（官方接口无「当日消耗」字段） | 优先取 CNY，缺失取首项；负数/非法视为 `null`；查询失败保留上次成功缓存并只记日志 |

跨日：按 `tzOffsetMin`（默认 UTC+8，与平台账单时区一致）清零当日消耗后重新累计，累计对话数不回退。

### 2. 声音

| 触发 | 声音 | 依据 |
| --- | --- | --- |
| 对话正常完成 | 叮咚：880 → 1320 Hz，700ms | `src/client/index.ts:97-99` |
| 强制中断 | 按 `soundType`：`single`=[660] / `double`=[880,660] / `triple`=[880,660,880] | `:68-72`、`:101-104` |
| 用户主动取消 | **静默** | `src/lib/interruption.ts:95` |

发声用浏览器 WebAudio（`AudioContext` / `webkitAudioContext`），不可用时静默失败，不影响页面。

## 二、报警语义

### 中断类型 → 等级与音色

| `kind` | 含义 | 默认等级 | 默认音色 | 判定 |
| --- | --- | --- | --- | --- |
| `tool-error` | 工具/LLM 链路中止（`turn/end.reason.kind === 'error'`） | 重要 | double | `interruption.ts:79-85` |
| `forced-cancel` | 外部强制取消（`aborted` 且原因非 `user`，含 `legacy`） | 重要 | double | `:92-100` |
| `session-evicted` | 会话失效销毁 | 重要 | double | `:35` |
| `host-restart` | 宿主强制重启（崩溃孤儿轮由持久化后端收尾，`reason.kind === 'interrupted'`） | 高危 | triple | `:86-91` |

等级枚举：`提示` / `普通` / `重要` / `高危`（`:15-16`）。默认出口**只对「重要」「高危」发声**（`src/index.ts:8-10`）。
不误报：`completed` / `max-tokens` / `blocked` / `aborted`+`user` 一律静默。

等级默认音参数（`:250-255`）：

| 等级 | 音色 | 音量 | 时长 |
| --- | --- | --- | --- |
| 提示 | single | 0.12 | 400ms |
| 普通 | single | 0.16 | 600ms |
| 重要 | double | 0.20 | 800ms |
| 高危 | triple | 0.28 | 1200ms |

### 幂等与防无限重播

- **宿主侧去重**：键 `${kind}:${sessionId}:${turn}`（`src/index.ts:241`），同一中断事件重复广播只报警一次，
  新轮次可再次触发；已报警键持久化在 `alarm-settings.json` 的 `recentAlertKeys`，上限 `alarmDedupeCap`（默认 1024）。
- **客户端封顶**：同一报警 `id` 最多连续播放 **3** 次（`src/client/index.ts:136-137` + `src/lib/alarm-replay.ts` 纯函数
  `replayDecision`），超限静默但仍尽力 ack 清队列。
- **ack 独立路由**：`POST .../api/alarm/ack` 单独注册为 exact 路由 —— 历史上它与 `/api/alarm` 共路由被
  exact 匹配吃掉返回 404，导致「ack 永不成功 → 每秒重播 → 无限循环」（`src/index.ts:537-538` 注释）。

### 门控（宿主侧；可配置 + 持久化 + 即时生效）

`AlarmGateConfig`（`interruption.ts:194-200`）：

| 字段 | 作用 |
| --- | --- |
| `alarmEnabled` | 总开关 |
| `muteAll` | 全静音 |
| `mutedLevels` | 等级过滤（数组，命中即静音但**日志留痕**） |
| `dndWindows` | 免打扰时段（`HH:mm`，支持跨天） |
| `severityMapping` | 按 `kind` 覆写等级（未知值被丢弃） |
| `sounds` | 按等级覆写 `{soundType, volume, durationMs}`（音量 0..1、时长 100..5000 clamp） |

所有输入经 `clampAlarmConfig` 收敛，非法值回落默认；POST 更新即时生效并原子写盘
（先写 `.tmp` 再 rename，`src/index.ts:193-196`）。

## 三、配置项（`Config`，`src/index.ts:96-119`）

```yaml
- id: dsh-dialogue-alert-message
  config:
    apiKeyEnv: DEEPSEEK_API_KEY        # 凭据引用（credentials seam 解析；无 seam 回退同名环境变量）
    baseURL: https://api.deepseek.com  # 余额查询基址
    balanceTimeoutMs: 5000
    balanceMinIntervalMs: 30000        # 余额接口最小间隔（节流）
    balanceTimerMs: 300000             # 低频定时刷新
    tzOffsetMin: 480                   # 日切时区（北京 = 480）
    offPeakFactor: 0.5
    peakWindows: [[9, 12], [14, 18]]
    peakWeekdays: [1, 2, 3, 4, 5]
    prices:                            # 单价（元/百万 tokens）
      deepseek-v4-flash: { input: 1.5, cacheHit: 0.05, output: 4.5 }
      deepseek-v4-flash-vision-exp: { input: 1.5, cacheHit: 0.05, output: 4.5 }
      deepseek-v4-pro: { input: 4.5, cacheHit: 0.15, output: 13.5 }
    defaultPrice: { input: 1.5, cacheHit: 0.05, output: 4.5 }
    statsFile: ""                      # 默认 <DSH_HOME>/dsh-dialogue-alert-message/stats.json
    alarmSettingsFile: ""              # 默认 <DSH_HOME>/dsh-dialogue-alert-message/alarm-settings.json
    alarmDedupeCap: 1024               # 去重键容量，8–8192
```

| 配置 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `apiKeyEnv` | string | `DEEPSEEK_API_KEY` | 须匹配 `^[A-Za-z_][A-Za-z0-9_]*$` |
| `baseURL` | string | `https://api.deepseek.com` | — |
| `balanceTimeoutMs` | number | `5000` | 500–60000 |
| `balanceMinIntervalMs` | number | `30000` | ≥ 1000 |
| `balanceTimerMs` | number | `300000` | ≥ 60000 |
| `tzOffsetMin` | number | `480` | — |
| `offPeakFactor` | number | `0.5` | 0.1–1 |
| `peakWindows` | [number,number][] | `[[9,12],[14,18]]` | — |
| `peakWeekdays` | number[] | `[1,2,3,4,5]` | — |
| `prices` / `defaultPrice` | 对象 | 见上 | 元/百万 tokens |
| `statsFile` / `alarmSettingsFile` | string | `''`（回落 `DSH_HOME`） | — |
| `alarmDedupeCap` | number | `1024` | 8–8192 |

`DSH_HOME` 缺省 `~/.dsh`（`src/index.ts:145-148`）；报警判定日志另写同级 `alarm.log`。
单价缺省与 DeepSeek 官方价目表一致；官方保留调价权，账单与显示不符时改 `prices` 后重载即生效，未知模型回退 `defaultPrice`。

## 四、Web API（本插件自身的 exact 路由）

| 方法 | 路径（前缀 `/@dsh-external/dsh-dialogue-alert-message/`） | 作用 |
| --- | --- | --- |
| GET | `api/status` | `{ok, counts:{running,error,completed}, lastEvent}`（`src/index.ts:482-500`） |
| GET | `api/usage` | 用量总览；该请求顺带触发一次余额刷新（节流，`:503-520`） |
| GET | `api/alarm` | 拉取待播报警队列（`:523-535`） |
| POST | `api/alarm/ack` | 按 `{ids}` 清除已播条目（`:539-562`） |
| GET/POST | `api/alarm-settings` | 读取/更新门控；POST 体积上限 64KB（`:565-589`） |

非允许方法一律 405。

## 五、刷新策略

1. 页面加载 / 侧边栏初始化 → 客户端首个 `/api/usage` 触发一次余额刷新；
2. 每轮对话完成（completed turn）→ 异步触发一次，受 `balanceMinIntervalMs` 节流；
3. 低频定时 `balanceTimerMs`（默认 5 分钟）；
4. 全异步、非阻塞、互斥（并发只会有一个在途请求）；失败只写 `ctx.logger`，界面显示上次成功值或 `--`。

## 六、接入方式

```yaml
- insert:
    - id: dsh-dialogue-alert-message
      name: '@dsh-external/dsh-dialogue-alert-message'
```

契约同仓库内其余插件：包名进 profile 的 `dsh.profile.bundles` 时，`package.json` 必须声明
`dsh.bundle.patch` 指向真实存在的 `cordis.patch.yml`，否则宿主加载 profile 直接报错退出（影响整个 dsh-web）。

宿主侧需要 `webServer`（注册路由）与 `sessions`（会话状态）；客户端需要
`@deepseek-ai/dsh-client-ui-sidebar` 的插槽。环境变量/凭据 seam 里有可用的 DeepSeek API key 才能刷新余额，
缺 key 或请求失败时余额显示 `--`/上次缓存，其余功能不受影响。

## 七、构建与测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1   # npm run build
npm run typecheck                                                       # tsc -p tsconfig.json --noEmit
npm test                                                                # node --test && node integration-check.mjs
```

`scripts/build.ps1` 与 `dsh-quick-append` 同构：精确 junction 链接构建依赖（cordis / schemastery /
dsh-tools / dsh-llm / react / react-dom / dsh-client-ui-slots / dsh-client-ui-sidebar / tsdown / @types/node）
→ `tsc` 编译宿主半 → `tsdown` 打包客户端半 → 校验产物（`window.__ModuleLoader__.load` 工厂头、插件 id、
factory 签名、工厂尾）。前置条件：`-Checkout` 指向的 DSH 源码 checkout（含 `node_modules\.bin\tsc.cmd`
与 `node_modules\tsdown`）。参数：`-SkipLinks`、`-SkipClient`。

测试集共 **62** 例：`usage-stats` 21、`interruption` 27、`client-shape` 9、`host-integration` 3、`alarm-replay` 2；
另有 `integration-check.mjs` 驱动宿主全链路（事件管线计价 / 幂等计次 / 顶层过滤 → 余额查询（seam/env 回退）
→ 失败降级 → `/api/usage` → 持久化落盘）。

## 八、持久化与安全

- `<statsFile>` 默认 `<DSH_HOME>/dsh-dialogue-alert-message/stats.json`：
  `{version:1, day, dialogueCount, todayCost, recentKeys, updatedAt, balance, balanceAt}`；
  原子写（tmp + rename）、**写防抖 500ms**（`src/index.ts:286-312`）、卸载前落盘；
  文件损坏或字段缺失自动回退默认值并重建，不会导致插件启动失败。
- `<alarmSettingsFile>` 默认同级 `alarm-settings.json`：门控字段 + `recentAlertKeys`。
- **API Key 不硬编码、不落盘**：经凭据 seam `credentials.resolve(apiKeyEnv)` 解析，无 seam 时回退
  同名环境变量，两者都没有则抛 `no DeepSeek API key for ref "…"`（`:317-327`）；原始错误信息不上屏，只写插件日志。

## 九、注意事项与坑

1. **只对「非用户主动」中断报警**：`aborted` 且原因 `user` ⇒ 静默（`interruption.ts:95`）。
2. **默认出口只播「重要/高危」**：把某类事件等级降到「普通/提示」等于静音。SPEC 记录的原始需求
   「工具报错=普通」照做会无声，因此实现改判为「重要」（`interruption.ts:8-10`）。
3. **报警出口是本插件自己的通道**，不依赖任何第三方插件；宿主只过门控，客户端只播与 ack。
4. **双保险防重播**：宿主按 `kind:sessionId:turn` 去重；客户端同一 `id` 最多播 3 次且超限仍 ack。
5. **`apiKeyEnv` 只接受合法环境变量名**：换 key 是换环境变量/凭据引用，不是把 key 写进配置。
6. **时间相关都看 `tzOffsetMin`**：当日花费与闲时折扣以该偏移计算，与机器时区不一致时跨天/闲时判定会偏。
7. **`apply` 内部整体兜底**：初始化异常只记 `apply failed; plugin disabled for this load`，
   不允许异常冒泡导致 dsh web 启动失败（`src/index.ts:121-128`）。
8. **客户端需刷新页面**：客户端半改动要重新 `tsdown` 后刷新浏览器（Ctrl+F5）才生效。

## 十、依赖与许可

- peerDependencies：`cordis`、`schemastery`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、
  `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-sidebar`、`react`、`react-dom`。
- 许可：`BSD-3-Clause`（`package.json`）。
