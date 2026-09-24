# 170 · 「预存命令」弹窗控件 UI 精致化（2026-09-24）

> 需求原文：**"继续修改「预存命令」弹窗，美化弹窗控件的 ui 样式（现在样式不精致）"**。
> 开发模式：Ponytail full（把"不精致"拆成可判定的差距清单 → 对着**项目根规范**逐条取证 → 原子步骤 → **先红后绿** → 真机实测 + 人工目视 → 写回）。
> 范围：只落 `test/dsh-quick-append`（客户端 CSS 与少量渲染结构 + 一层新门禁 + 真机脚本扩展）。
> **宿主侧零改动**：`lib/index.js` mtime 仍是 `2026-09-17 11:36:45` ⇒ **不需要重启宿主**。
> 运行面：dev 3080（PID `25368`，本轮未重启）。客户端产物 `lib/client.js` **88,229 B**、mtime `2026-09-24 22:17:40`、sha256 前缀 `FCFBA2C95E3A5D46`。
> 人工目视件：`docs/169-quick-append-编辑弹窗.png`、`docs/169-quick-append-上拉菜单.png`（**元素截图**，只含本插件面板，不含宿主页面内容）。

## 0. "不精致"的逐条取证（对着规范找差距，不凭感觉调）

"不精致"不是可判定的话，所以先把它拆成"与项目根规范的**具体偏差**"。取证来源：`plugin-design-spec-template.md` §10.7.2 设计令牌 / §10.7.3 玻璃卡面与遮罩 / §10.7.4 组件视觉约定；`JSON-CSS-SPEC.md` 的 `ct-button` / `ct-button-primary` / `ct-input` / `ct-menu-item` / `ct-empty-state` / `ct-scrollbar-hidden` / `sp-window-skeleton`。

| # | 改前（v0.5.0） | 规范要求 | 处置 |
|---|---|---|---|
| 1 | 遮罩 `rgba(5,8,12,0.32)` + `blur(2px)` | §10.7.3：`rgba(9,12,17,0.72)` + `blur(6px)` | 改为规范值（改前那层"灰纱"既压不住背景、又让弹窗显得浮在纸片上） |
| 2 | 菜单项 hover 冷灰 `rgba(120,140,170,0.14)`，默认字色 `--al-text` | `ct-menu-item`：hover/选中是**淡紫** `rgba(147,136,255,0.14)` + 弱化字色 → hover 提亮到 `--al-text`；`padding 7px 12px`、圆角 `7px`、字重 600 | 全量对齐（灰底无法表达"选中"，violet 才是生态的选中语义） |
| 3 | 普通按钮：**透明底**、无 hover 底、无过渡、无键盘焦点环 | `ct-button`：`rgba(120,140,170,0.08)` 底 + `0.15s` 过渡 + hover 提亮边 + 焦点可见 | 全量对齐 |
| 4 | 主按钮：**黑底白字** | `ct-button-primary`：`accent` 底 + 语义黑字 `#0A0E13`，仅关键动作用 | 改为 accent（黑底白字在本仓是"筛选按钮"的语义，不是主 CTA） |
| 5 | 输入框 `6px 8px` / `12px`，无过渡；聚焦光环 `0.22` | `ct-input`：`7px 10px` / `13px` / `transition: border-color .15s, box-shadow .15s` / 光环 `rgba(100,181,246,0.25)` | 全量对齐（12px 表单字在 380px 弹窗里明显偏小） |
| 6 | 弹窗无骨架：标题只是一行 `.dsh-qa-title`，列表/表单/底部操作行之间只有间距 | `sp-window-skeleton`：标题栏（左标题 + 右侧信息）+ `padding-bottom` + `border-bottom` 分割线；底部操作区与内容分离 | 新增 `.dsh-qa-head`（标题 + `N 条` 计数 + 分割线）与 `.dsh-qa-footer` 的 `border-top` |
| 7 | 列表/表单/确认行直接平铺 | §10.1/§10.2 设置弹窗结构：分组标题 → 输入单元（label + 控件）→ 底部操作行 | 新增 `.dsh-qa-body`（组间距 10px）+ `.dsh-qa-field`（label + 控件成组），label 用 11px 弱化字 + 字距 |
| 8 | 空态沿用 `.dsh-qa-menu-hint`（左对齐小灰字，像"提示条"） | `ct-empty-state`：居中、`--al-text3`、无边框 | 改为 `.dsh-qa-empty` |
| 9 | 行内「编辑/删除」是方角小按钮，与主按钮同一形状语言 | `ct-button-capsule`：`999px` / `3px 10px` / 11px 600 | 行内操作改胶囊 ⇒ 与主按钮形成"轻操作 vs 主操作"的层级差 |
| 10 | 滚动区只有"隐藏滚动条"，没有 `overscroll-behavior` | `ct-scrollbar-hidden` + `sp-window-skeleton`：`overscroll-behavior: contain` | 三处滚动区补齐（滚动到底不再把宿主页面带着滚） |
| 11 | 弹窗高度固定 `460px` | `sf-modal-panel`：`max-height: 86vh` | 改为 `min(86vh, 460px)`（小屏不溢出；像素上限仍取叶子常量，定位估算与样式同源） |
| 12 | 正文输入框带**缩放把手**（右下角小三角） | 规范未强制，但模态里它是"没打磨过"的典型特征 | 弹窗内的正文框 `resize: none` + `min-height: 96px`；**既有「点击追加」弹层的输入框保持原样**（`resize: vertical`，不动它的既有手感） |
| 13 | 图标按钮（扳手/闪电）无 hover/focus 反馈 | §10.7.4：可点击控件要有明确反馈 | 用**一条**规则同时命中两个按钮（`.dsh-qa-tools button:hover/:focus-visible`）⇒ 一致性由结构保证，不靠人眼 |

**三处需要用户知情的连带改动**（`.dsh-qa-btn` 是插件内共用的类，改它会同时影响既有「点击追加」弹窗）：

1. 「点击追加」弹窗的 **取消/保存/填入默认文案** 三个按钮：底色由透明变成规范要求的 `rgba(120,140,170,0.08)`，并新增 hover/active/焦点环；
2. 「点击追加」弹窗的 **保存** 按钮：由黑底白字变为 `accent` 绿底黑字（与 `ct-button-primary` 一致）；
3. 「点击追加」弹窗的正文框**聚焦光环**由 0.22 变 0.25（规范精确值）。
> 这三处是"同一套样式体系"的必然结果 —— 需求 5.1 明确禁止"另起一套"。若希望左边这个旧弹窗保持原样，只需给弹窗内的按钮加一层作用域类（一行改动），见 §6.1。

## 1. 原子步骤（TDD：先红后绿）

| 步 | 内容 | 证据 |
|---|---|---|
| S1 | 取证：读根规范的设计令牌表 / 玻璃卡面 / 组件配方（`ct-*` / `sp-*` / `sf-*`），把"不精致"拆成 §0 的 13 条可判定差距 | 规范条目逐条引用（含 `ct-input` 的 `0.25` 光环、`ct-menu-item` 的 violet 0.14 等精确值） |
| S2 | **先写样式门禁** `test/command-dialog-style.test.mjs`（U1–U15） | **红**：231 项 / 219 过 / **12 红**，EXIT=1 |
| S3 | 改 CSS：按钮族 / 遮罩 / 菜单 / 弹窗骨架 / 表单 / 空态 / 滚动区 | U 门禁 12 红 → 3 红（U7 判据过宽、U10 简写 padding、U13 白名单带空格） |
| S4 | **修三处门禁自身的缺陷**（不是改实现）：U7 负面判据缩到菜单 hover 块内（冷灰 0.14 是按钮的合规配方）；U10 的 `padding-bottom` 长写法；U13 比对前归一色值空格 | `node --test` **231/231** EXIT=0 |
| S5 | 改渲染结构：`.dsh-qa-head`（标题 + 计数）、`.dsh-qa-body`、`.dsh-qa-field` 分组、空态类名、`min(86vh, …)` | `npm run build:client` EXIT=0（形状门禁 13/13）；`check-client-bundles --root test` **2/2** EXIT=0 |
| S6 | 真机加 **G1–G11**：把规范配方落在浏览器**算出来的样式**上（不只是源码里有），并落两张**元素截图** | 首轮 58/60：G8/G9 红 |
| S7 | **红因定位（重要）**：G8/G9 不是样式错，是**读数时机**错 —— 我在 `0.15s` 过渡未跑完时读 computed style，读到 `rgba(100,181,246,0.976)` / `1.93855px` / `0.137` 这类中间值。改为**等过渡结束再读** + 数值容差比对（±1 通道 / ±0.01 alpha） | 真机 **60/60** EXIT=0；G8 实测 `rgba(100, 181, 246, 0.25) 0px 0px 0px 2px`、G9 实测 `rgba(147, 136, 255, 0.14)` |
| S8 | 目视复核截图 → 发现两处仍需打磨（缩放把手、列表行偏紧）⇒ **先补判据（红）再改实现（绿）** | U6 扩展先红（缺 `resize: none`）→ 改后 `node --test` **231/231**；真机 **60/60**；既有真机 **20/20** |
| S9 | 写回 | 本文 + `README.md` v0.5.1 + 版本号 + 两张截图 |

## 2. 业务关键验收场景（视觉验收清单）

1. **遮罩**：打开弹窗时背景被明显压暗且背景内容模糊（`rgba(9,12,17,0.72)` + `blur(6px)`），弹窗"浮起来"而不是"贴"在页面上。
2. **头部可扫读**：左上「预存命令」、右上「N 条」，下方一条 1px 分割线；数字等宽对齐。
3. **表单可读**：标签是弱化小字（11px + 字距），标题输入框 13px 字；正文框默认高度能一眼看全两行，**没有缩放把手**。
4. **聚焦可见**：键盘 Tab 到输入框 / 按钮时有明确的可见焦点（输入框 info 蓝边 + 2px 光环；按钮 2px outline）。
5. **选中可辨**：菜单里键盘/鼠标高亮的那一项、以及列表里"正在编辑"的那一行，都是淡紫底（+ 紫边），与 hover 的浅灰**一眼可分**。
6. **主次分明**：主操作是绿色实底按钮，普通操作是描边按钮，行内操作是胶囊小按钮 —— 三种权重不混淆。
7. **分割与呼吸**：内容区/底部操作行之间有分割线，组与组之间 10px、字段之间 8px，不挤成一坨。
8. **小屏不溢出**：窗口高度不足时弹窗高度不超过 86vh（真机 G7：`h=338 / vh=1000`）。
9. **无位移/弹跳**：所有 hover/active 只变色（规范禁止放大弹跳），过渡统一 `.15s`。
10. **回归**：「点击追加」弹窗功能、两个按钮的位置/间距/尺寸、浮层层级、菜单截断与内部滚动全部不变。

## 3. 单元测试（231 项全绿）

| 层 | 文件 | 例数 | 钉住什么 |
|---|---|---|---|
| UI 样式（本轮新增） | `test/command-dialog-style.test.mjs` | 15 | U1–U3 遮罩=规范值且不越权（不加边框/圆角/阴影、不加 `pointer-events:none`）；U4 按钮=ct-button（含"hover 不得位移"）；U5 主按钮=ct-button-primary 且**旧黑底白字已下线**；U6 输入框=ct-input（聚焦 2px/0.25、弹窗正文框 `resize:none`+`96px`、**既有弹层保持 `resize: vertical`**）；U7 菜单项=ct-menu-item（violet 0.14 + 提亮字，负面判据缩到 hover 块内）；U8 选中语义统一（菜单高亮与"正在编辑"行同为 violet）；U9 空态=ct-empty-state 且无边框；U10 骨架（头部/底部 1px 分割线 + 标题/计数 + `tabular-nums`）；U11 三处滚动区=隐藏滚动条 + `overscroll-behavior: contain`；U12 86vh 且像素上限来自叶子常量；**U13 令牌纪律**（新增样式的颜色只允许 `var(--al-*)` 或规范列明的配方，白名单外即红）；**U14 动效纪律**（无 transform/scale/keyframes，过渡一律 `.15s`）；U15 结构契约回归锁（类名/5px 间距/层级/截断/内部滚动不得被"美化"改掉） |
| 既有四层 | 叶子 43 / 接线 18 / 产物 6 / 形状 13 | 216 | 见 `docs/169`（本轮未改判据，全部保持绿） |

> 断言可信度自检：本轮红了三次，**三次都是门禁自身的问题**而不是实现 —— ①U7 的负面判据写成"全源码不得出现冷灰 0.14"，而那是 `ct-button` 的合规 hover 配方（判据过宽 = 假红）；②U10 用简写 `padding: 4px 8px 10px` 时断言 `padding-bottom: 10px`（判据与写法不匹配）；③U13 白名单按紧凑写法(`rgba(242,80,86,0.14)`)而 CSS 用带空格写法（判据过严 = 假红）。三处都改成"判据与被判对象同一口径"，没有一处靠放宽实现要求过关。

## 4. 实现代码（文件 / 位置 / 复用来源）

| 文件 | 位置 | 行为 |
|---|---|---|
| `src/client/index.ts` | `SKIN_CSS` 的 `.dsh-qa-btn` 家族 | 按 `ct-button` / `ct-button-primary` 重写：0.08 冷灰底、`.15s` 过渡、hover 提亮、`:active`、`:focus-visible` outline、主按钮 accent + `#0A0E13` |
| 同上 | `SKIN_CSS` 的 `.dsh-qa-mask` | 遮罩改规范值（`rgba(9,12,17,0.72)` + `blur(6px)` 双写） |
| 同上 | `.dsh-qa-menu` / `.dsh-qa-menu-head` / `.dsh-qa-menu-list` / `.dsh-qa-menu-item` / `.dsh-qa-menu-foot` | 菜单容器按 `sf-menu-panel`（圆角 10 / padding 6 / min-width 132）；项按 `ct-menu-item`；头部/底部分割线；滚动区补 `overscroll` |
| 同上 | `.dsh-qa-head` / `.dsh-qa-head-title` / `.dsh-qa-head-count` | 菜单与弹窗**共用**的头部骨架（标题左、计数右、`tabular-nums`） |
| 同上 | `.dsh-qa-dialog` / `.dsh-qa-body` / `.dsh-qa-cmd-list` / `.dsh-qa-cmd-row` | 弹窗 padding `14px 16px`、86vh 上限、`overscroll`；内容区分组 10px；列表行 hover 浅灰、选中 violet |
| 同上 | `.dsh-qa-form` / `.dsh-qa-field` / `.dsh-qa-label` / `.dsh-qa-input` / `.dsh-qa-form .dsh-qa-textarea` / `:focus` | 表单按 `ct-input` + 设置弹窗结构（label + 控件成组）；正文框 `resize:none` / `96px` |
| 同上 | `.dsh-qa-empty` | 空态按 `ct-empty-state`（替换旧 `.dsh-qa-menu-hint`） |
| 同上 | `.dsh-qa-cmd-row .dsh-qa-btn` / `.dsh-qa-btn-danger` | 行内操作胶囊（999px）+ danger 令牌与 hover 轻红底 |
| 同上 | `.dsh-qa-tools button:hover` / `:focus-visible` | 两个图标按钮共用一条反馈规则（一致性由结构保证） |
| 同上 | 渲染：`.dsh-qa-head`（标题 + `N 条`）、`.dsh-qa-body`、`.dsh-qa-field` ×2、`className: 'dsh-qa-empty'`、`DIALOG_MAX_HEIGHT` | 结构层面落地骨架与分组 |
| 同上 | `DIALOG_MAX_HEIGHT = 'min(86vh, ' + String(COMMAND_DIALOG_HEIGHT) + 'px)'` | 86vh 规范化，同时**定位估算仍取叶子常量**（避免"估算 460、实际 86vh"导致越界） |
| `test/command-dialog-style.test.mjs`（新） | —— | 上述 15 条样式门禁 |
| `scripts/e2e-preset-commands.mjs` | G1–G11 | 真机 computed-style 实测 + 两张元素截图 + `colorNear` 容差比对 |
| `README.md` / `package.json` | v0.5.1 | 变更记录与版本号 |

**复用的既有资产（显式来源）**：卡面配方与类 `.dsh-qa-popover`（本插件 v0.5.0 起）；设计令牌 `--al-card / --al-bgDeep / --al-border / --al-borderHi / --al-info / --al-violet / --al-danger / --al-text / --al-text2 / --al-text3 / --al-radius / --al-blur`（`plugin-design-spec-template.md` §10.7.2，均带字面量兜底）；组件配方 `ct-button` / `ct-button-primary` / `ct-button-capsule` / `ct-input` / `ct-menu-item` / `ct-empty-state` / `ct-scrollbar-hidden` / `ct-error-state`（`JSON-CSS-SPEC.md`）；骨架与留白 `sp-window-skeleton` / `sp-content-padding`；弹窗体 `sf-modal-panel` / `sf-menu-panel`。

## 5. 人工目视复核

- `docs/169-quick-append-编辑弹窗.png`（380×352）：头部标题 + `1 条` + 分割线；选中行淡紫；标题框聚焦蓝环；正文框无缩放把手；底部三键（取消编辑/保存修改=绿/关闭）。
- `docs/169-quick-append-上拉菜单.png`（320×128）：头部 + 分割线；高亮项淡紫；底部提示 + 「管理」按钮。
- 两张都由真机脚本在每次运行时重新生成（元素截图，**只截面板本身**，不把宿主页面里的会话/研报等内容带进仓库）。

## 6. 风险清单

1. **连带动到既有「点击追加」弹窗**（§0 末三条）：按钮底色/主按钮配色/聚焦光环。这是"同一套样式体系"的必然结果，需求 5.1 禁止另起一套；若要回退只影响旧弹窗，加一层作用域即可（把 `.dsh-qa-btn` 系列复制成 `.dsh-qa-popover:not(.dsh-qa-dialog) .dsh-qa-btn` 覆盖）。
2. **主按钮由黑转绿是观感级改动**：与生态 `ct-button-primary` 一致，但与本插件 v0.1–v0.4 的历史外观不同；若你更偏好黑底，改一个声明即可（`background: var(--al-bgDeep)` + `color: #FFFFFF`）。
3. **遮罩明显变深**（0.32 → 0.72）：这是规范值，弹窗更聚焦；但背景内容的可见度显著下降（只有模糊轮廓）。
4. **`.dsh-qa-textarea` 的焦点光环按规范全站统一**（0.22 → 0.25）：影响面是所有用到该类的地方（含既有弹层）。
5. **弹窗高度上限从固定 460px 变为 `min(86vh, 460px)`**：≤ 522px 高的视口下弹窗会变矮并内部滚动（功能不受影响，但内容需要滚）。
6. **未做浅色主题适配**：与全仓现状一致（颜色走 `--al-*` 令牌，令牌本身不随浅色主题切换）；遮罩/错误底/选中底用的是规范里的 `rgba()` 常量，不随主题变。
7. **G8/G9 的读数是"过渡结束后"的稳定值**：本轮已把等待时间从 150ms 提到 600ms 并加数值容差；若将来把过渡时长调大，这两条会先红（这是预期的：判据与规范值绑定）。
8. **截图随真机脚本写入仓库**：每次跑 `e2e-preset-commands.mjs` 都会覆盖 `docs/169-*.png`（这是有意的：让"观感"也有可复核的产物）。
9. **未覆盖的机器判据**：无。"是否好看"属人工判断（已提供两张截图与目视清单）。

## 7. 五行自检

- **改动**：`src/client/index.ts`（SKIN_CSS 的按钮族/遮罩/菜单/骨架/表单/空态/滚动区 + 渲染结构 + `DIALOG_MAX_HEIGHT`）；新增 `test/command-dialog-style.test.mjs`（15 例）；扩展 `scripts/e2e-preset-commands.mjs`（+11 项与 2 张截图）；`README.md`（v0.5.1）、`package.json`（0.5.1）、本文件、2 张 PNG。**宿主侧与业务逻辑零改动**。
- **命中与未触碰的铁律**：命中 1（每步附命令+退出码）、2（真机 60/60 + 人工目视）、3（只改 Client 层）、4（三次红都当真问题查到底）、5（三态标注：规范值=确证 / 观感=人工）、19/20（模板串内零反引号）、21、32/35（`build:client` → 形状门禁 → 产物实例化预检）、38（`package.json` 无 BOM）、43（客户端改动免重启）、45（浏览器实测到新样式）、53（裸 `node --test`）、55；**未触碰** 6–18、41–42、46–52、54。
- **证据**：样式门禁先红 `231 项 / 219 过 / 12 红` EXIT=1 → 实现后 3 红（门禁自身缺陷）→ 修判据后 **`node --test` 231/231 EXIT=0**；`npm run build:client` EXIT=0（形状 **13/13**）；`check-client-bundles --root test` **2/2** EXIT=0；真机 `e2e-preset-commands.mjs` **60/60** EXIT=0（G1–G11 全部为浏览器算出的 computed style）；既有 `e2e-preset-workspace.mjs` **20/20** EXIT=0。
- **生效动作**：已 `npm run build:client`（`lib/client.js` **88,229 B**、mtime `2026-09-24 22:17:40`、sha256 前缀 `FCFBA2C95E3A5D46`）；**无需重启宿主**（`lib/index.js` mtime 未变）→ 刷新页面即生效（页面内已实测）。
- **沉淀**：CSS 内注释逐条写明"为什么是这个值、规范出处"；本文；`README.md` v0.5.1；两张目视截图；真机 G1–G11 可复跑。
- **尚未由机器覆盖的项**：无。
