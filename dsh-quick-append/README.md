# @dsh-external/dsh-quick-append

DSH 输入区（composer）右侧的两个工具按钮：

- **「点击追加」**（闪电图标）：一键把该工作区的**追加文案**接到草稿后面；右键编辑文案。
- **「预存命令」**（扳手图标，位于「点击追加」左侧 5px）：左键上拉菜单一键插入常用指令；右键管理指令。

「LLM优化」打开时，左键会先把草稿交给宿主侧的 LLM 优化（可带图片），再把追加文案接在优化结果之后。

- 当前版本：`0.5.1`（`package.json`）
- 形态：宿主半 `src/index.ts`（提供 `/@dsh-external/dsh-quick-append/api` 与 `/api/optimize`）+
  客户端半 `src/client/index.ts`（插槽 `conversation.input.right`，`order: 10`）
- 宿主注入：`['webServer', 'llm', 'attachments']`（`src/index.ts:37`）；客户端注入 `['slots']`，
  `conversation` 服务为**可选**依赖（未装配时纯文本优化，图片静默不纳入并提示，`src/client/index.ts:1883-1884`）

## 一、按钮与交互

| 操作 | 「点击追加」 | 「预存命令」 |
| --- | --- | --- |
| 左键 | LLM优化 off：`草稿 + '\n\n' + 追加文案`（空草稿只放文案）；on：先优化再追加 | 按钮**正上方 5px** 拉起菜单；上方放不下自动翻转到下方（四向限位） |
| 右键 | 打开编辑弹层（编辑/保存本工作区追加文案） | 打开编辑弹窗（列表 + 表单，增/改/删） |
| 键盘 | 输入区聚焦时 `Shift+Alt+F` = 左键（`src/client/index.ts:1483`） | 原生 button 可 Tab；Enter/Space = 左键；`Shift+F10` / 菜单键 = 右键（`:1561`） |
| 阻断 | 解析中拦截并提示 `提示词正在生成，请稍后再试！` | 同样拦截（不绕过既有互斥，`:1145`） |

- 正文字面量：按钮 title 为 `点击追加 / 右键设置`（`:1573`），扳手按钮 `aria-label` = `预存命令`（`:146`）。
- 两按钮同在一个 flex 容器（`gap: 5px`，非绝对定位），共用样式常量 `ICON_BUTTON_STYLE` 与
  图标属性 `ICON_SVG_PROPS` —— 尺寸/圆角/边框/颜色一致由结构保证。
- 浮层用 `react-dom` 的 `createPortal` 挂到 `document.body`（绕开 composer 的 `overflow`/`backdrop-filter` 裁剪），
  卸载时收回宿主节点与全部全局监听；同一时刻只允许一个浮层展开（两个弹层互斥）。
- 图层：既有「点击追加」弹层 = 100；预存命令 `COMMAND_LAYER = { menu: 110, mask: 110, dialog: 111 }`（`src/lib/command-store.ts:49`）。

## 二、三条链路

### 1. LLM 优化（宿主策略单点，v0.3.1 起）

模型与思考强度**由宿主决定**，客户端不再发送、弹窗也不再暴露控件（旧客户端仍可传 `model` /
`reasoningEffort`，会被归一化兜底）：

| 项 | 值 | 依据 |
| --- | --- | --- |
| provider | `deepseek-official` | `src/lib/optimize.ts:17` |
| 默认模型 | `deepseek-flash`（DeepSeek-V41-Flash，1M 上下文档、支持图片输入） | `:15`、`src/index.ts:5-7` |
| 思考强度 | 默认 `max`（可选 `off` / `low` / `high` / `max`） | `:19`、`:22` |
| 采样 | `temperature: 0` | 旧 README v0.3.0 节 |
| 单次超时 | `600000` ms | `:26` |
| 重试 | 共 `3` 次尝试（瞬态失败：调用错误/超时/空输出/解析失败）；末次仍有非空正文 → 纯文本兜底 | `:24`、`src/index.ts:12-14` |
| 输出 | JSON 信封 `{"optimized","imageNote"}`，解析走 `extractJSON` 多路兜底 | 同上 |
| 请求体上限 | 64MB（`MAX_BODY_BYTES = 64 << 20`，含图片 base64） | `src/index.ts:40` |
| 客户端断开 | 立即中止上游流（不继续烧 token） | `src/index.ts:14` |

请求字段固定为 `['draft','context','cwd','images']`（`optimize.ts:34`），只接受这四个。

### 2. 图片（多模态）

- 输入区当前图片（顺序）与正文合并进**同一条 user 消息**；客户端传 base64，宿主经
  `ctx.attachments.saveImage` 准入生成引用。
- 发送前预处理（`src/lib/images.ts` 决策 + canvas 执行）：png/jpeg/webp ≤4MB 原样；>4MB → 最长边 ≤2048 + JPEG(0.85)；
  gif → 静态首帧 JPEG；不支持格式/空文件剔除。
- **全部准入失败 → 降级纯文本**并在结果中标注「未采纳图片信息」（响应 `imagesDropped=true`），
  不允许编造图片内容。

### 3. 规范上下文（spec-context）

点击「追加」时，宿主把项目约束性规范合并成上下文（`src/lib/spec-context.ts`）：

- 范围：项目根 5 份规范（README / plugin-design-spec-template / PLUGIN-LOADER-SPEC /
  CANVAS-INTERACTION-SPEC / JSON-CSS-SPEC，`:19`）+ `docs/` 全部文档 + 各插件目录 SPEC/README/DESIGN；
- 缓存：`<$DSH_HOME|~/.dsh>/dsh-quick-append/spec-cache/<cwd-hash12>/`（`manifest.json` +
  `spec-context.cache` gzip，原子写），**不写入源仓库**（`:5`、`:82`、`:207-209`）；
- 增量：源文件 mtime/size 与 manifest 比对，全未变且内容哈希一致 → 直接读缓存；任一变化/损坏 → 原子重建；
- 净化：标题级剔除「更新日志/变更记录/操作日志/运行摘要/验收清单/路线图」等非约束章节；
- 预算：`DEFAULT_BUDGET_CHARS = 240000`（≈60k token），超限按「整文件优先保留」（根规范 > docs > 插件目录）裁剪并标注省略清单（`:65`）。

## 三、持久化（全部在浏览器 localStorage）

| 键 | 结构 | 说明 |
| --- | --- | --- |
| `dsh-quick-append.presets` | `{version:1, workspaces:{[workspaceId]:{appendText}}}` | 追加文案，**按工作区隔离**（`preset-store.ts:17`、`:57-60`） |
| `dsh-quick-append.commands` | `{version:1, commands:[{id,title,content}]}` | 预存命令，数组顺序即展示顺序（`command-store.ts:26-27`） |
| `dsh-quick-append.llm` | `'1'` / `'0'` | 「LLM优化」开关，缺省视为开（`client/index.ts:137`、`:837`） |
| `dsh-quick-append.goal` | `'1'` / `'0'` | goal 模式开关，缺省视为开（`:138`、`:845`） |
| `dsh-quick-append.text` | 旧版单键文案 | **迁移源**：首次读到就迁给当前工作区，随后删除旧键（`preset-store.ts:18`、`client/index.ts:737-750`） |

- 「当前工作区」解析：工作区列表里 `sessionIds` 含当前会话的那条的 `workspaceId`；解析不出 →
  占位桶 `__no-workspace__`（`preset-store.ts:21`）。
- 写入：打开弹窗时**捕获**工作区键，保存带键提交（编辑期间切换工作区只写回原工作区）；
  合并写入窗口 `PRESET_WRITE_COALESCE_MS = 250`；`pagehide` / `visibilitychange` / 切工作区 / 卸载四处 flush。
- 失败处理：**先内存后落盘**，失败弹可见提示（追加文案 `追加文案保存失败：…（当前页面内仍可继续使用，刷新后会丢失）`、
  预存命令 `预存命令保存失败：…`），不假装写成功。
- 多标签页：监听 `storage` 事件失效缓存并重算（先失效再 flush，避免用旧缓存整包覆盖别的标签页刚写的内容）。
- 脏数据宽容：整包损坏 → 空列表 + 「读取失败」提示；部分损坏 → 保留可读条目 + 「已忽略 N 条」。

## 四、预存命令的校验与交互细节

- 上限：标题 `COMMAND_TITLE_MAX = 50` 字、正文 `COMMAND_CONTENT_MAX = 2000` 字，trim 后必填
  （`command-store.ts:30-31`、`:251-252`）。
- 插入口径与「点击追加」一致：`草稿 + '\n\n' + 正文`，空草稿只放正文，**永不覆盖**用户已写内容；
  插入后焦点与光标落到插入文本末尾（新输入面是 Lexical contenteditable，落位要等一帧）。
- 删除为**内联两步确认**：第一下只变「确认删除」并起 `DELETE_CONFIRM_MS = 4000` 计时；
  关闭前对未保存变更先问「确定放弃？」，提供「继续编辑」。
- 空数据不展示空菜单，改弹引导 toast：`暂无预存命令，右键『预存命令』可录入指令`（`:60`）。
- 其它固定文案：`预存命令已保存` / `预存命令已删除`（`:61-62`）。
- 尺寸常量：菜单 `320×260`、弹窗 `380×460`、屏幕边缘留白 `5px`、菜单与按钮间距 `5px`（`:52-56`、`:37`、`:40`）。

## 五、Toast 文案（锁定，勿改）

| 时机 | 文案 | 时长 |
| --- | --- | --- |
| 解析中拦截（左/右键、快捷键） | `提示词正在生成，请稍后再试！`（`interaction.ts:22`） | 2500ms（`:25`） |
| 优化任务运行中（常驻） | `正在优化提示词中…`（`:66`） | 不自动消失 |
| 优化成功 | `优化完成`（`:68`） | 2000ms（`:70`） |
| 追加保存成功 | `已保存`（`preset-store.ts:24`） | — |

## 六、安装与接入

```yaml
- insert:
    - id: dsh-quick-append
      name: '@dsh-external/dsh-quick-append'
```

- **宿主侧无配置项**：`apply(ctx)` 不声明 Config，行为由源码常量决定（换模型/思考强度要改
  `src/lib/optimize.ts` 后重新构建）。
- 契约（与仓库内其余插件一致）：包名进 profile 的 `dsh.profile.bundles` 时，`package.json` 必须声明
  `dsh.bundle.patch` 指向真实存在的 `cordis.patch.yml`，否则宿主加载 profile 直接报错退出（影响整个 dsh-web）。
- 宿主需装配 `webServer`、`llm`、`attachments`；客户端需 `conversation.input.right` 插槽。

## 七、构建与测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1   # npm run build
            -Checkout "C:\...\deepseek-harness-dsh-v0.1.5-rc.1"          # 必须传真实 checkout（见下）
npm run typecheck                                                       # tsc -p tsconfig.json --noEmit
npm test                                                                # node --test
```

> ⚠️ 构建脚本调的是 **Windows PowerShell**（`package.json:34`），不是 `pwsh`；`scripts/` 下**没有** `build.sh`。
> `-Checkout` 的默认值是脱敏占位路径 `C:\Users\<user>\...`，**不传参直接 `npm run build` 会在第 24 行抛「checkout 不可用」**。

`scripts/build.ps1` 先按精确 junction 链接构建依赖（cordis / schemastery / dsh-tools / dsh-llm /
react / react-dom / dsh-client-ui-slots / dsh-client-ui-conversation / tsdown / @types/node），
再 `tsc` 编译宿主半、`tsdown` 打包客户端半，最后校验 `lib/client.js` 的
`window.__ModuleLoader__.load` 工厂头、插件 id、factory 签名与工厂尾。
前置条件：`-Checkout` 指向的 DSH 源码 checkout（含 `node_modules\.bin\tsc.cmd` 与 `node_modules\tsdown`）；
参数 `-SkipLinks`、`-SkipClient`。**构建脚本不跑测试**，测试是独立步骤。

**本机实测**（2026-09-28）：`node --test` → **231 例 / 230 通过 / 1 失败**。失败的是
`test/shortcut-target.test.mjs:82` 契约用例 —— 它把官方源码路径写成了脱敏占位符
`C:/Users/<user>/Documents/...`（第 85 行），实际文件不存在 ⇒ `ENOENT`。
同类占位符还有 `scripts/build.ps1:15` 的 `-Checkout` 默认值与 `scripts/e2e-preset-commands.mjs:24-26`
（后者可用 `PW_PATH` 环境变量覆盖 playwright 那一处）。**占位符是脱敏的产物，不是笔误**：
要跑这些脚本/用例，需把 `<user>` / `<repo>` 换成本机真实用户名与仓库名（或改成从环境变量推导）。

真机端到端（需本机 DSH 环境，package.json 里没有对应 script，需手工执行）：

```powershell
node scripts/e2e-preset-workspace.mjs    # 追加文案按工作区隔离（20 项）
node scripts/e2e-preset-commands.mjs     # 预存命令菜单/弹窗（60 项，含 computed style 实测）
```

## 八、注意事项与坑

1. **新建工作区的追加文案是空的**：默认文案不再兜底，需要点弹窗里的「填入默认文案」一键填回
   （`preset-store.ts:26-28`）。
2. **文案按工作区 ID 隔离**：换工作区就是换一份文案，互不影响；编辑期间切换工作区也只写回原工作区。
3. **换模型要改源码**：v0.3.1 起模型/思考强度由宿主单点决定（默认 `deepseek-flash` + `max`），
   弹窗里已无相关控件；旧 README 提到的「优化模型/思考强度」设置项**已不存在**——以源码为准。
4. **解析中不重复发请求**：左键/右键/快捷键都被拦截成固定 toast，按钮保持正常可点击外观
   （不 disabled、不 loading 遮罩）。
5. **客户端改动必须重新构建并刷新浏览器**：只改 `src/client/**` 也要跑 `tsdown`，然后 Ctrl+F5。
6. **`Shift+Alt+F` 依赖输入面判定**：新输入面认 `data-composer-input`（Lexical contenteditable），
   旧 textarea 作为兜底；判定为纯函数 + 回归测试（`test/shortcut-target.test.mjs`）。
7. **localStorage 是唯一存储**：清浏览器数据 = 丢文案与预存命令；隐私模式/配额超限会有可见失败提示，
   本页仍可用但刷新即丢。
8. **图片全失败会降级**：此时只在结果里标注「未采纳图片信息」，不会编造图片内容。
9. **spec 上下文缓存写在 `$DSH_HOME`**，不进源仓库；缓存损坏会自动回退全量重建，不抛错。
10. **客户端源码不受 tsc 检查**：`tsconfig.json` 显式 `exclude: ["src/client"]`，客户端正确性靠
    「逻辑下沉到零依赖叶子 + `test/*-wiring.test.mjs` 扫源码文本」两类兜底 ⇒ **重构客户端会误伤文本门禁**，
    改客户端必须同步改门禁。
11. **`exports["./client"].types` 指向不存在的文件**：`package.json:47` 指向 `./lib/types/client/index.d.ts`，
    但 `lib/types/` 下没有 `client` 目录 ⇒ 引用方拿不到客户端类型声明（运行不受影响）。
12. **客户端仍在发宿主从不读的 `preset` 字段**（`src/client/index.ts:1455`；宿主只读
    `draft`/`context`/`cwd`/`images`）。这是**登记在案的现状**（冻结断言 `test/client-shape.test.mjs`
    标为「Q11 待核实」）：客户端已自行追加过预设，**宿主一旦开始读它就会把预设叠加两次** ——
    改任一侧都必须在同一提交内改另一侧。
13. **宿主端点是"本机信任"模型**：只校验 POST、体积 ≤64MB、JSON 可解析、`draft` 非空，**无鉴权、无调用方身份校验**；
    任何能访问该路径的请求都会触发一次真实 LLM 调用（烧 token）。
14. **隐私面**：优化会把项目根规范、`docs/` 全部 md、`plugins/*/{SPEC,README,DESIGN}.md`（净化 + 24 万字符预算内）
    连同最近 3 轮对话与图片 base64 发往 `deepseek-official`；净化只按标题剔除日志类章节，**不做脱敏**。
15. **客户端 `apply` 吞异常**：整段 try-catch，崩溃只 `console.error('[dsh-quick-append] apply crashed: …')`
    （好处是不影响 dsh web 启动，代价是"按钮就是没出现"，需看浏览器控制台才能定位）。
16. **改了 `src/index.ts` 或宿主引用的 `src/lib/**` 必须整体重建**：`npm run build` 会同时跑宿主半与客户端半；
    只跑 `build:client` 会让 profile 继续加载旧宿主（本机 `lib/index.js` 就比 `lib/client.js` 旧）。
17. **弹层滚动条被全局隐藏**（`scrollbar-width:none`），内容超出时没有可见滚动提示。
18. **非 web 平台只有宿主半可用**：客户端声明 `platform: 'web'`，依赖 `createImageBitmap` / `canvas` /
    `localStorage` / `document.createRange`；headless/sdk 场景没有 UI。

## 九、变更记录

以下为历史记录，条目按时间倒序保留原文（**注意 v0.3.0 一节里的「模型/思考强度可在设置里覆盖」
已被 v0.3.1 的宿主策略单点取代**，勿照该节配置）。

## v0.5.1 — 「预存命令」弹窗控件 UI 精致化（2026-09-24）

按项目根规范（`plugin-design-spec-template.md` §10.7.2/§10.7.3/§10.7.4 + `JSON-CSS-SPEC.md` 的 `ct-*`/`sp-*`/`sf-*` 配方）把"不精致"逐条拆成偏差并修掉。**功能与结构零改动**，只改表现层：

- **遮罩**：`rgba(5,8,12,0.32)+blur(2px)` → 规范值 `rgba(9,12,17,0.72)+blur(6px)`（弹窗真正"浮"起来）。
- **按钮**：普通按钮补 `rgba(120,140,170,0.08)` 底 + `.15s` 过渡 + hover 提亮 + `:active` + 键盘焦点环（`ct-button`）；**主按钮由黑底白字改为 `accent` 绿底 + 语义黑字 `#0A0E13`**（`ct-button-primary`）；行内「编辑/删除」改胶囊（`ct-button-capsule`）。
- **菜单项**：`ct-menu-item` 配方（`7px 12px` / 圆角 7 / 600 字重），hover 与键盘高亮统一为**淡紫** `rgba(147,136,255,0.14)` + 提亮文字（`tk-violet` = 选中语义；旧版冷灰 hover 无法表达"选中"）。
- **弹窗骨架**：新增头部（左标题 + 右「N 条」计数 + 1px 分割线）与底部操作行分割线；内容区分组（组 10px / 字段 8px）；label 改弱化小字 + 字距。
- **输入框**：`ct-input` 配方（`7px 10px` / 13px / `.15s` 过渡 / 聚焦 info 边 + 2px 光环 0.25）；弹窗正文框去掉缩放把手并加高到 96px（**既有「点击追加」弹层的输入框保持原样**）。
- **空态**：按 `ct-empty-state`（居中 + 弱化文字 + 无边框）。
- **滚动区**：三处补齐 `overscroll-behavior: contain`（滚动到底不再带着宿主页面滚）。
- **高度上限**：`min(86vh, 460px)`（`sf-modal-panel`），像素上限仍取叶子常量 ⇒ 定位估算与实际样式同源。
- **图层反馈**：两个图标按钮共用**一条** hover/focus 规则（一致性由结构保证）。
- **门禁**：新增 `test/command-dialog-style.test.mjs`（**15 例**：规范值逐条钉住 + 令牌纪律 + 动效纪律 + 结构契约回归锁），`node --test` **231/231**；真机 `e2e-preset-commands.mjs` 扩到 **60 项**（G1–G11 为浏览器算出的 computed style 实测），并落两张**只含面板本身**的目视截图 `docs/169-quick-append-编辑弹窗.png` / `docs/169-quick-append-上拉菜单.png`。
- **连带动到既有「点击追加」弹窗**（共用 `.dsh-qa-btn` 的必然结果，见 `docs/170` §0 末与 §6）：它的取消/保存/填入默认文案按钮获得规范底色与交互反馈，保存键变绿，正文框聚焦光环 0.22 → 0.25。若要回退只影响旧弹窗，加一层作用域即可。

## v0.5.0 — 预存命令：按钮 + 上拉菜单 + 编辑弹窗（2026-09-24）

在 composer 右侧新增第二个按钮（**点击追加左侧 5px**，仅扳手图标），提供预存指令的**展示 / 一键写入 / 增删改**能力；「点击追加」按钮的 DOM、行为与文案**逐字未变**（回归锁 K18 + 既有真机脚本复跑 20/20）。

- **位置与外观**：新按钮与「点击追加」同在一个 `.dsh-qa-tools` 容器（`flex gap:5px`，不用绝对定位 ⇒ 不挤压/不换行/不遮挡）；两个按钮**共用**同一份样式常量 `ICON_BUTTON_STYLE` 与图标属性 `ICON_SVG_PROPS` —— "尺寸/圆角/边框/颜色完全一致"靠结构保证，而不是靠人眼维持。图标为本插件既有的内联 SVG 方案（无图标库），扳手路径 24 格坐标系、16×16、描边 2。
- **左键 = 向上拉起菜单**：在按钮正上方 5px（`bottom` 锚定 ⇒ 视觉间距与面板真实高度无关），上方放不下自动翻转到下方，四向限位；点条目把**正文**插入输入区（`草稿 + 空行 + 正文`，空草稿只放正文，**永不覆盖**用户已写内容），并把焦点与光标送回输入区末尾（新输入面是 Lexical contenteditable，落位必须等一帧）。**无数据时不展示空菜单**，改弹引导 toast「暂无预存命令，右键『预存命令』可录入指令」。
- **右键 = 编辑弹窗**：列表 + 表单，可新增/修改/删除；标题/正文 trim 后必填，上限 50 / 2000 字（提示带当前字数）；删除为**内联两步确认**（第一下只变「确认删除」并起 4s 计时）；关闭（遮罩/Esc/关闭按钮/取消编辑）对**未保存变更先问**「确定放弃？」，提供「继续编辑」。
- **浮层**：`react-dom` 的 `createPortal` 挂到 `document.body`（composer 的 `overflow`/`backdrop-filter` 裁不到），层级登记 `COMMAND_LAYER = {menu:110, mask:110, dialog:111}`（既有弹层 100 = ALIGN-10，本轮新增登记为 **ALIGN-11**）；卸载时收回宿主节点与全部全局监听。
- **关闭时机与互斥**：再点按钮 / 点外部 / Esc（回焦按钮）/ 滚动（捕获阶段）/ resize 全部关闭；与「点击追加」的右键弹窗**互不同时存在**。
- **键盘**：原生 button 可 Tab；Enter/Space 触发左键；Shift+F10 / 菜单键 = 右键；菜单 ↑↓ 导航 + Enter 选择 + Esc 关闭。
- **存储**：沿用 localStorage，新键 `dsh-quick-append.commands = { version:1, commands:[{id,title,content}] }`（数组顺序即展示顺序）；"按用户维度隔离"在客户端落到**当前浏览器画像**（客户端拿不到宿主身份，也不得触碰鉴权）。读取宽容：脏数据永不抛，整包损坏 → 空列表 + "读取失败"，部分损坏 → 保留可读条目 + "已忽略 N 条"；写入失败 → 「预存命令保存失败：…（当前页面内仍可继续使用，刷新后会丢失）」，且**先内存后落盘**（失败时本页仍可用）。
- **风格统一**：编辑弹窗与菜单**直接复用**既有右键弹窗的卡面/标题/输入框/按钮/footer 类（`.dsh-qa-popover` `.dsh-qa-title` `.dsh-qa-textarea` `.dsh-qa-btn` `.dsh-qa-footer`）与同一批 `--al-*` 令牌，未另起样式体系；输入框聚焦态改为 input/textarea **共用一条**规则（否则两个输入框会长得不一样）。
- **门禁**：叶子 43 例 + 客户端接线 18 例 + 产物层 6 例（`node --test` **216/216**）；真机 `node scripts/e2e-preset-commands.mjs`（**49 项**，不切工作区、不建会话、只动自己浏览器上下文的 localStorage）。变更详情见 `docs/169-quick-append-预存命令能力-20260924.md`。

## v0.4.1 — 默认文案更新为用户指定新版（2026-09-23）

「填入默认文案」按钮填入的那段文案，按用户 2026-09-23 给的**原文**更新。**只改文本内容，不改任何行为**：

- 第 1 条改为「…进行一次细节的扩展**使需求更加精准**。扩展后要**结合项目实际现状**，对合理性做一次逐条校验…」；
- 附加约束**首条新增**「-使用Ponytail 的 full模式开发」；
- 附加约束**末三条**（插件窗口UI 规范 / 插件安全规范 / 画布互动规则 三个具体文件名）合并为通用一条
  「-项目规范，安全规范，交互规范，严格遵守根目录配置文件：*.md」；
- 逐字采用原文，仅剥掉行尾空白这一处复制痕迹；条目符号沿用原文「-」后不加空格的写法。

> ⚠️ **行为未变**：这只改**默认文案常量**（「填入默认文案」按钮的内容）。**新建工作区仍然默认空白**（v0.4.0 的行为与你写下的验收标准 3 未变）。

- **门禁**：A4 同时钉住"新措辞必须在 / 旧措辞必须不在"（旧措辞、旧的三条规范文件引用一旦残留即红）；产物层 B2 钉住"未重新 `build:client` 就红"。
- **真机实测**：按钮填入后文本框长度 `380 → 322` 字符（真机 20/20，工作区解析为真实 ID、刷新保持、失败降级等一并复验）。

## v0.4.0 — 追加文案按工作区隔离 + 本地持久化（2026-09-23）

- **维度**：追加文案改为**按工作区（workspaceId）隔离** —— 每个工作区一份，互不影响、互不覆盖、互不继承。键用 **ID** 而不是展示名：重命名不影响配置、两个同名工作区也不会串。
- **"当前工作区"怎么解析**：照抄 DSH 自己的口径 —— 工作区列表里 `sessionIds` 含当前会话（插槽标准 props 的 `sessionId`）的那条的 `workspaceId`（`ui-workspace/src/client/navigation.ts:158-160`）。解析不出（会话未归属任何工作区）→ 占位桶 `__no-workspace__`。
- **存储结构**：`localStorage['dsh-quick-append.presets'] = { version: 1, workspaces: { [workspaceId]: { appendText } } }`。沿用既有 localStorage 方案，**未引入任何依赖**、不动宿主契约面。
- **新建工作区默认空白**（缺省不再回落默认文案，验收 3）；那段既有默认文案改由弹窗里的 **「填入默认文案」** 按钮一键填回。
- **弹窗新增一行只读提示**「写入：<工作区名>」，随时看得出这次编辑写进哪个工作区。
- **写入**：打开弹窗时**捕获**该工作区键，保存时带键提交 ⇒ 编辑期间切换工作区也只会写回原工作区；合并写入器在 250ms 窗口内对同一工作区只落一次盘；`pagehide` / `visibilitychange` / 切换工作区 / 组件卸载四处 flush。
- **失败可见 + 内存态降级**：存储不可用或配额超限 → 「追加文案保存失败：…（当前页面内仍可继续使用，刷新后会丢失）」提示（此前是 `catch { /* ignore */ }` 静默吞掉）。写入路径**先更新内存、再落盘** ⇒ 这一笔编辑在本页仍然可用，同时磁盘上仍是旧值（不假装写成功）。
- **多标签页**：监听 `storage` 事件失效内存缓存并重算（先失效再 flush，避免用旧缓存整包覆盖另一个标签页刚写的内容）。
- **旧配置迁移**：老的单键 `dsh-quick-append.text` 第一次读到就迁给**当前**工作区，随后**删除旧键**（不删的话以后每个新工作区都会被这段旧值污染 = 隔离失效）。
- **门禁**：叶子 33 例 + 客户端接线 13 例 + 产物层 5 例（`node --test` **149/149**）；真机 `node scripts/e2e-preset-workspace.mjs`（**20 项**，不切工作区、不建会话、只动自己浏览器上下文的 localStorage）。变更详情见 `docs/168-quick-append-追加文案按工作区隔离-20260923.md`。

## v0.3.0 — 提示词优化链路升级与常驻反馈（2026-09-06）

### 一、LLM 模型与调用参数

- **默认模型**：`deepseek-v4-flash-vision-exp`（deepseek 适配器目录：`contextWindow=1_000_000` 即 **1M tokens 档位**、`inputModalities=['text','image']`）。模型可在插件设置（右键弹层「优化模型」输入框）中**回退/可覆盖**；留空/非法 → 宿主回退默认标识（`normalizeModel` 纯函数归一化）。
- **1M 上下文**：请求组装不截断用户正文/图片/对话上下文（全量承载）；host 每次请求经 `llm.resolveModelInfo` 读取并 console.log 输出 `contextWindow`（1M 档位证据）。
- **思考模式**：`reasoningEffort` 按 llm-deepseek 适配器实际枚举显式传入（`off/low/high/max`），默认 **high**（设置「思考强度」下拉可配置）。
- **确定性约束与容错**：`temperature: 0`；输出为 JSON 信封 `{"optimized","imageNote"}`；解析走 **extractJSON 多路兜底**（裸 JSON / 代码围栏 / 首{尾}子串 / 平衡扫描 → 纯文本兜底）；瞬态失败（调用错误/超时/空输出/解析失败）**重试 2 次**（共 3 次尝试）；单次尝试超时 **600s**（1M+思考上调）；客户端断开立即中止上游流。

### 二、多模态输入（图片参与优化）

- 输入区当前全部图片附件（顺序）与正文合并进**同一条 user 消息**（harness 多模态协议 ImageBlock；客户端 base64 → 宿主 `ctx.attachments.saveImage` 准入生成引用）。
- System 约束补充图片语义规则：必须读取图片视觉信息（截图/长图/文档/弹窗文字 + 图表/数据/曲线/K线/界面），视为用户真实意图参与重构；无法识别或不相关 → 在优化后提示词中明确标注「未采纳图片信息」，**不得编造**。
- **发送前校验与轻量压缩**（`src/lib/images.ts` 纯函数决策 + 浏览器 canvas 执行）：png/jpeg/webp ≤4MB 原样发送；>4MB → 受限尺寸（最长边 ≤2048）+ JPEG(0.85)；gif → 静态首帧 JPEG；不支持格式/空文件剔除；**全部失败 → 降级纯文本优化 + 可见提示**（宿主响应 `imagesDropped=true` 并在结果标注）。

### 三、优化过程常驻 Toast

- 优化任务触发且进入 LLM 调用前，立即展示固定文案 **「正在优化提示词中…」**（旋转指示），**不自动消失**（无自动关闭计时，不随 blur/轮询关闭）。
- 单实例：重复触发先关旧再开新（解析中拦截 + `toastOnOptimizeStart` 纯函数双保险，不堆叠）。
- 结束时机严格绑定优化 Promise 终态：成功 → 短暂切换「优化完成」（2s 后自动退出，计时器纳入 effect 清理）；失败 → 关闭常驻 toast 后走既有错误提示（自动消失 toast）；取消（组件卸载/路由切换 abort）→ 静默关闭，并中止在途请求（不留孤儿任务/节点）。

### 测试与构建

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh   # host 编译
npm run build:client                             # client bundle（tsdown）
npm test                                         # node --test 全量（v0.3.0：65/65）
```

- 纯函数：`src/lib/optimize.ts`（模型/思考归一化、extractJSON、解析、重试判定、提示词、图片 payload 校验）、`src/lib/images.ts`（预处理决策）、`src/lib/interaction.ts`（常驻 toast 状态机）。
- 门禁：`test/host-optimize.test.mjs`（host 产物接线）、`test/client-optimize.test.mjs`（client bundle 接线）、`test/optimize.test.mjs`（19 例）、`test/images.test.mjs`（9 例）、`test/interaction.test.mjs`（含常驻 toast 状态机）。

## 解析中交互（v0.1.0）

「LLM优化」开启时，最近一次解析任务运行期间（请求已发出未返回/流式未结束），按钮交互如下：

- **无禁用感知**：按钮保持正常可点击外观（永不 disabled/loading 遮罩/`cursor: wait`/透明度变化）；
- **左键/快捷键（Shift+Alt+F）**：拦截业务动作（不发起重复「优化→追加」请求），弹出固定文案 toast「提示词正在生成，请稍后再试！」；
- **右键**：拦截 `contextmenu`（阻止浏览器原生菜单与自定义编辑弹层），同样弹出固定文案 toast；
- **toast**：单实例 + 自动消失（2.5s）+ 去重（同文案重复点击仅保持可见/刷新时长，不叠加）；
- **常规态回归**：任务成功/失败/超时/取消后立即恢复原语义（左键=追加逻辑，右键=设置弹层）；拦截只在「解析中」生效，非常态零侵入、零副作用（纯操作反馈，不改业务数据/不发新请求/不建任务）。

判定与去重逻辑为纯函数（`src/lib/interaction.ts`，11 例单测覆盖状态/手势/去重/过期边界）。

## 十、依赖与许可

- peerDependencies：`cordis`、`schemastery`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、
  `@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-conversation`、`react`、`react-dom`。
- 许可：`BSD-3-Clause`（`package.json`）。
