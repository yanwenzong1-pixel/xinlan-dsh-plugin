# dsh-anime-desktop-pet

> 作者自己使用的简单桌宠 + 装饰，无推荐功能。以下内容仅供维护/复现参考。

独立 DSH 覆盖层插件。**v0.9.7 起默认挂载素材驱动的「蓝色大肥鱼直播间」场景，同时恢复旧版可拖动/等比缩放的大横幅、左下角固定入口 GIF，以及对话行旁的工作/很累小动画与设置里的两个动画开关**：场景切出 28 个独立透明元素，按 `layout.json` 的归一化坐标/图层/动效还原参考环境图；LIVE、竖幅、4 个文字气泡、4 只金鱼均可拖拽并记住位置（F5 保持）；场景不再渲染两个女孩主宠和固定顶部横幅。旧版完整模式仍可用 `scene: false` 回退。

旧版模式：运行中的对话 / 折叠工作区以**统一标准尺寸动画**展示「蓝色大肥鱼正在工作」，
用**纯几何确定性仲裁**决定哪些动画可见（相邻冲突时只保留上方），并避开固定形象基准；
设置中可同时启用「正在工作」与「很累」两个动画；两者都启用时上下文用量超过 45% 自动切换为「很累」。
支持右键设置、动画库选择、**角色三视图预览与右键复制图片**；
**不修改、不 fork、不 patch DSH 侧边栏源码与 DOM**。

- 版本：`0.9.7`（插件目录 `dsh-anime-desktop-pet/`，包名 `@dsh-external/dsh-anime-desktop-pet`）
- 形态：Client 覆盖层（`src/client/scene.mjs` 新场景 + `scene-core.mjs` 纯逻辑 + 旧 `overlay.mjs` 回退）+ 极薄 Host 半（`src/index.ts`，提供 GIF、三视图、动态横幅、场景 `manifest/layout/@1x/@2x` 路由）
- 依赖：client 只注入 DSH 公开的 `sessions` 服务；无 React、无第三方运行时依赖

## 功能

1. **统一标准尺寸（R1）**：不再有小缩略图与 hover 放大两套状态。运行中动画直接按
   `STANDARD_ANIMATION_SIZE = 实测行高 × HOVER_DEFAULTS.scale`（默认行高 32 → **80px**，
   即旧 hover 放大尺寸；工作区头 34 → 85px）渲染。装饰性 GIF 节点固定定位、脱离文档流，
   不改变行高/行间距/列表总高/滚动范围；整层与图片 `pointer-events: none`，不拦截下层 hover/点击/拖拽；
  动画容器使用 **15px 圆角并裁切**（`SIDEBAR_ANIMATION_RADIUS_PX = 15`），图片/canvas 同步继承圆角。
   **上下文变体**：设置面板现在提供**两个可勾选动画**：「蓝色大肥鱼正在工作」与「蓝色大肥鱼很累」
   （16 帧、300ms/帧、`assets/animated/blue-fat-fish-tired.gif`）。可只勾一个或两个都勾：
   只勾一个时始终用该动画；两个都勾时读取公开 `contextPressure` 投影，用量 `> 45%` 用「很累」，
   `<= 45%` 用「工作」。折叠工作区取其中运行会话的最大用量决定变体。
2. **只挂载可见实例（R1.4/R1.5）**：仲裁隐藏的动画不创建或立即卸载，避免后台 GIF 循环；GIF 节点
   `aria-hidden="true"`、不可 Tab 聚焦；运行状态仍由会话行既有状态点/文本承担，不丢失可访问信息。
3. **纯函数几何仲裁（R2/R6）**：`computeAnimationPlacements(input)` 只做纯几何计算，不读 DOM：
   按 DOM 显示顺序生成「以行中心为中心、STANDARD 大小」的候选矩形，与固定基准/已放置矩形做
   带 `ANIMATION_ARBITRATION_GAP`（8px）的相交检测；冲突则隐藏，否则放置。7 个对话的验收用例：
   仅 #1 → #1；#1+#3 → #1；#1+#3+#4 → #1、#4；#1 结束后 #3 接替、#4 隐藏；#3 结束后 #4 恢复。
4. **工作区折叠态（R3）**：工作区 `aria-expanded="false"` 且其中至少一个会话运行中时，在文件夹行
   显示**一个**工作区级动画（不再按会话叠加）；展开后工作区动画消失、回落会话级仲裁。纯函数中
   工作区优先级高于会话级。
5. **固定基准遮挡（R4）**：左侧浮动「大肥鱼」固定形象是基准，永远保留、不参与隐藏；任何侧栏动画
   与其实测矩形（含 gap）相交时不渲染，优先级为「固定基准 > 工作区 > 会话」。两者复用同一个
   `rectsOverlap` 与同一轮测量结果，不存在两套判定。
6. **全量重算与调度（R2.4/R6.3/R7）**：运行状态、会话增删/排序、工作区展开收起（`aria-expanded`）、
   行高/容器 resize、滚动跟随、固定形象拖动都合并到同一个 rAF 调度器；同一帧多次变化只计算一次，
   重算幂等、无残留标记。单次仲裁为一次顺序遍历；卸载时断开 observer、取消 rAF 并移除全部节点。
   **三运行兜底（v0.7.1，v0.7.3 调整）**：当有 ≥3 个运行会话、严格仲裁只剩 1 个动画时，把第一个
   被隐藏的候选放在同一列（与已放置动画上下堆叠、不脱离左边栏），避免第二张图闪一下就消失。
7. **降级与可访问性（R7.2/R5）**：`prefers-reduced-motion: reduce` 时把 GIF 首帧绘制到 canvas 静态
   展示（不循环，仲裁结果不变）；所有动画 `aria-hidden`，不新增后端事件/Remote/持久化格式。
8. **设置与预览**：固定形象右键 →「设置」；动画库勾选/持久化、单/多动画规则；三视图模态预览与
   右键「复制图片」（PNG 走剪贴板，无「另存为图片」）；固定形象可拖动/记位置；`Ctrl+Shift+F12`
   一键显隐整个组件，**显隐状态持久化到 localStorage，刷新后保持**；卸载清理全部监听/节点/rAF/objectURL 并释放滚动锁。
9. **桌面直播横幅（v0.8.0 动态化）**：透明 **动画 GIF** 横幅（24 帧、80ms/帧、1086×362，3:1 比例）默认 720×240 显示在
   桌面底部居中；拖动主体移动、拖动右下角蓝色把手等比缩放（240–1920px 宽，保持宽高比与视口内 clamp），
   位置和宽度持久化。设置面板有「展示桌面横幅」开关，**默认开启**；关闭后立即隐藏。
   动画由切出的气球、彩带、星星元素叠加：星星飘动、气球随风摆动、彩带抖动；全部 126 个元素切成
   `assets/banner/elements/{balloon,ribbon,star}/*.png` 并附 `manifest.json`。静态基准图仍需
   `python scripts/build-banner.py`，动画由 `python scripts/build-banner-animation.py` 生成。

## 直播间场景（v0.9.7 默认）

- 素材源图：`assets/source/sprite-sheet.png`（透明素材图）；布局参考图来自作者本机 DSH UI 截图，文件名 `scene-reference.png`，**因含本地界面内容不随公开仓库分发**（布局已按截图校准，详见下文）。
- 切图脚本（幂等）：`python scripts/slice-live-scene.py` → `assets/slices/@1x/`、`@2x/`、`manifest.json`、QA 预览 `assets/raw/preview-scene-slices.png`。
- 当前产出 **28 个元素**：横幅、LIVE 徽章、竖幅、4 个对话气泡、4 只金鱼、底部横幅书带、12 个 L3 星星/气泡/彩带氛围片。所有元素保留 RGBA，@1x 为 @2x 的严格 0.5 倍；两个女孩切片仍保留在清单中，但不再进入场景布局。
- **底部横条**：`ui-bottom-strip` 来自原图底部连续的蓝色彩带、气泡与书本/杯子；**按素材原始逻辑尺寸显示（@2x/2 = 488×112 CSS px），不拉伸、不强行铺满**；`align: "bottom-right"` 贴住视口右下角，素材不够宽时自然靠右留白。
- 布局：`assets/slices/layout.json`，默认视口坐标系，锚点 `(x,y) ∈ [0,1]`，`scale` 为 `min(viewportWidth, viewportHeight)` 的比例；`zIndex` 对应 `L0 背景`/`L1 道具`/`L2 宠物`/`L3 氛围`/`L4 UI` 语义。当前 19 个场景实例，其中 10 个可拖拽（LIVE、竖幅、4 个文字气泡、4 只金鱼）。
- **右下书带氛围动效**：底部 `ui-bottom-strip` 旁边新增第二个 `emitters` 发射器，持续从书本/丝带区域上方飘出星星、彩带碎片和大号气泡，带随机横向漂移、旋转和淡出；与左侧竖幅粒子互相独立计数（各自上限 8/10）。
- **大号气泡素材**：新增 `fx-bubble-large`（92×84 @2x），所有自动上浮气泡与左侧竖幅粒子中的气泡强制使用 `@2x` 资源，显示宽度约 42–52px，避免把小气泡素材拉伸导致模糊。
- 动效：`float`、`sway`、`tailWave`、`finWave`、`blink`、`bubbleRise`、`lightSweep`（CSS transform/opacity；随机参数使用可注入 seed，启动 stagger 0–800ms）。`layout.json` 的 `interactions.petClick` 控制点击气泡数量/间隔/上限与生成层；`layout.json` 的 `emitters` 把星星/气泡从左侧竖幅底部持续向上喷出并淡出，参数含 `attachTo`、`slices`、生成间隔、并发上限、上升距离与粒子尺寸。
- 运行时：`scene-core.mjs` 纯函数（校验、几何、PRNG、状态机、暂停规则、位置解析）+ `scene.mjs` 渲染器。状态机仍支持 `idle/hover/pressed/dragging/sleeping`；当前文字标签/金鱼使用稳定的拖拽绑定，拖拽结束持久化位置；标签页隐藏/组件不可见暂停全部动画与计时器；`prefers-reduced-motion` 关闭循环位移/气泡/水光并显示静态姿态。
- 路由：宿主前缀 `/@dsh-external/dsh-anime-desktop-pet/assets/scene/` 服务 `manifest.json`、`layout.json`、`@1x/*.png`、`@2x/*.png`，按 DPR 取值并封顶 2x。
- 场景装饰默认 `pointer-events:none`；仅 10 个可拖动标签/金鱼节点 `pointer-events:auto`，不新增 Tab 焦点。拖动结束把归一化坐标写入 `dsh-anime-desktop-pet/scene-positions`，刷新后保持；窗口缩放时按百分比自适应并 clamp。
- **旧版大横幅与固定入口恢复**：默认场景模式仍挂载旧覆盖层的横幅与固定入口 GIF（z-index 在场景上方），横幅继续支持拖动主体、右下角把手等比缩放和位置持久化；固定入口继续读取 `dsh-anime-desktop-pet/fixed-position`（用户原先拖动到的左下角位置会保留），尺寸 220px、可拖动/右键设置。旧覆盖层的**对话行右侧小动画已恢复**：运行中会话继续显示「蓝色大肥鱼正在工作」/「蓝色大肥鱼很累」，上下文 >45% 自动切换；旧设置面板（固定入口右键 → 设置）继续提供两个动画勾选开关（默认只勾工作图），并保留横幅展示开关。完整旧模式用 `window.__DSH_ANIME_PET_OPTIONS__ = { scene: false }` 打开。
- 修改素材/布局只需替换 source + 重跑切图 + 改 `layout.json`，无需改渲染代码。
- 当前偏差：参考图 B 是整页 DSH UI 截图，场景因此采用**全视口 stage + overflow:hidden**，而非固定 16:9 画布；1280/1024/768/375 宽度已验收不溢出，L3 在 <768px 隐藏。JS 渲染层配合 `.d.ts` 与运行时校验；TS strict 的纯函数/类型定义已覆盖数据契约，未强行把既有 `.mjs` 客户端迁成 TS。

## 素材与 GIF

- 唯一视觉素材：任务附件 16 格分镜图（4×4，阅读顺序即帧序）。原始图保留在
  `assets/raw/grid.png`（1254×1254 RGBA），切分后的 16 帧原图保留在 `assets/raw/frames/frame-01..16.png`。
- 生成命令（需要 Pillow 11+）：
  ```bash
  python scripts/build-gif.py
  ```
- 生成参数集中在 `scripts/build-gif.py` 顶部：统一画布 256²、透明边距 4px、每帧 250ms（v0.1.2
  起由 150ms 放慢；16 帧整轮约 4 秒）、255 色局部调色板 + 索引 255 透明、alpha ≥128 置不透明后
  1px 腐蚀去白边。
- 产出 `assets/blue-fat-fish-working.gif`：16 帧、256×256、无限循环（loop=0）、250ms/帧、
  透明通道、约 0.46 MB（16 帧整轮 4 秒，播放节奏已按要求放慢）。脚本末尾会自动回读校验
  帧数/尺寸/透明/循环/延时并打印结果；`test/gif.test.mjs` 另用零依赖二进制解析做同样门禁，
  并断言 16 帧延时统一且落在 200–500ms 的放慢区间。
- 运行时由宿主半把该文件挂到
  `GET /@dsh-external/dsh-anime-desktop-pet/assets/blue-fat-fish-working.gif`
  （`src/index.ts`）。宿主半**按请求读取文件**，所以之后只改 GIF 内容时不需要再重启宿主；
  客户端 URL 带 `?v=<ASSET_VERSION>`（`src/client/core.mjs`），改 GIF 时递增该版本号即可绕过
  `immutable` 浏览器缓存，只刷新页面就能换动画。资源缺失时返回 503 JSON，不阻塞宿主。

## 固定形象 GIF（25 帧）

- 素材：本次会话收到的 5×5=25 格拼图，原图保存在 `assets/raw/fixed-character-grid.png`
  （1254×1254 RGBA）；切分的 25 张原图保存在 `assets/raw/fixed-frames/frame-01..25.png`。
- 生成命令（与工作态 GIF 相同工具链，独立脚本）：
  ```bash
  python scripts/build-fixed-gif.py
  ```
- **裁剪方式（v0.3.1 修正）**：这张 5×5 拼图不是等分网格（直接 `image/5` 会把相邻行的桌面/食物条带进
  帧里，也是用户指出的“上面/左边有内容”问题）。脚本改为：
  1) 用蓝色头发连通域检测出 25 个角色锚点（恰好 25 个，按行排序）；
  2) 在相邻锚点之间搜索**真实内容空隙**作为每条行/列分界线，按每格的实际矩形裁剪；
  3) 删除接触裁剪边界的邻居残片（保留大块主体，避免误删角色）；
  4) 生成后额外断言**所有帧四周边界必须透明**（`edge_opaque_pixels=0`），作为防串帧回归门禁。
- 产出 `assets/animated/blue-fat-fish-eating.gif`：25 帧、256×256、透明、无限循环、
  **300ms/帧**（比工作态更慢，整轮约 7.5 秒）、约 0.6 MB。生成脚本会回读校验
  帧数/尺寸/透明/循环/延时/边界透明；`test/gif.test.mjs` 同样做二进制门禁。
- 宿主半通过 prefix 路由 `/@dsh-external/dsh-anime-desktop-pet/assets/animated/` 服务该 GIF 及未来
  同类动画资源（图片扩展名白名单，拒绝穿越）。
- **去掉桌面投影（v0.3.2）**：固定形象原先加了一层 `filter: drop-shadow(...)`；对“桌子平底”的帧，
  这会在角色下方形成一条横向阴影带，看起来像图片边框。v0.3.2 已移除该 CSS 投影，角色完全贴着透明
  GIF 显示，不再有额外阴影区。
- 会话中第一版拼图底部被裁切，已按用户重新上传的完整 25 格图重建；原始拼图与切分帧均保留。

## 上下文「很累」动画 GIF（16 帧）

- 素材：用户提供的 4×4 拼图（1295×1214 RGBA），原图保留在 `assets/raw/tired-grid.png`，切分帧在
  `assets/raw/tired-frames/frame-01..16.png`。
- 生成命令：
  ```bash
  python scripts/build-tired-gif.py
  ```
- 该拼图行高不等分，脚本用 **alpha 投影检测行/列空隙**后按真实面板裁剪（不是简单 `image/4`），
  避免把相邻行的桌面/气泡带进帧里；产出 `assets/animated/blue-fat-fish-tired.gif`：16 帧、256×256、
  透明、无限循环、**300ms/帧**、约 0.46 MB。
- 运行时由同一 `animated` prefix 路由提供；设置面板可勾选它，两个动画都勾选时上下文用量
  **严格大于 45%** 替换工作图，`<=45%` 或投影缺失时仍使用 `blue-fat-fish-working.gif`。

## 三视图素材（已接入）

- 用户已提供三视图图片 `assets/three-view/blue-fat-fish-working.png`（1536×1024），预览层会按
  `object-fit: contain` 等比展示，右键可复制 PNG；不再提供「另存为图片」入口。
- 约定目录：`assets/three-view/<animation-id>.png`（也接受 `.jpg/.jpeg/.webp/.gif`）；新增角色只需
  在 `src/client/core.mjs` 的 `ANIMATIONS` 声明 `threeView` 字段并放图，无需改预览组件。
- 宿主前缀路由：`GET /@dsh-external/dsh-anime-desktop-pet/assets/three-view/<file>`；只接受扁平图片
  文件名白名单扩展名，拒绝子目录与 `..` 穿越，缺失文件返回 404 JSON。

## 构建与安装

```bash
# 1) 构建 host + client（需 DSH checkout；会链接 @types/node、jsdom 供测试）
$env:DSH_CHECKOUT='<dsh checkout>'
npm run build

# 2) 安装到 profile：把插件目录 link 进 profile 依赖，并把 bundle 加进 dsh.profile.bundles
#    （本机 staged profile 示例）
#      dependencies += "@dsh-external/dsh-anime-desktop-pet": "link:<插件绝对路径>"
#      dsh.profile.bundles += "@dsh-external/dsh-anime-desktop-pet"
#    然后在 profile/node_modules/@dsh-external 下建同名 junction 指向插件目录

# 3) 刷新页面（Ctrl+F5）加载新客户端 bundle
```

安装/更新插件或修改宿主半后用 `dsh` 重启 DSH 宿主一次（本机 watchdog/手动重启均可；会话数据
保留），再刷新页面。之后**只调 GIF 内容**（例如放慢帧延时）不需要重启宿主：重新生成 GIF、递增
`core.mjs` 里的 `ASSET_VERSION`、`npm run build`、刷新页面即可。

## 配置

- 尺寸/边距/层级：加载插件前设置
  `window.__DSH_ANIME_PET_OPTIONS__ = { sizePx: 64, gapPx: 6, edgePx: 4, zIndex: 2147483045 }`。
  `sizePx` 是**上限**，每行实际收敛到 `min(sizePx, 行高)`（默认行高 32px 时即 32px）；
  `gapPx` 只在探测不到对话列表边界时作为行右缘回退间距；图标左缘始终至少位于列表边界右缘外 1px；
  `edgePx` 是视口安全边距；`zIndex` 默认高于 DSH 插件蒙版层（2147483005）。
- 标准尺寸与仲裁：`HOVER_DEFAULTS.scale`（2.5，旧 hover 放大令牌）决定 STANDARD 尺寸；
  `ANIMATION_ARBITRATION_GAP`（8px）是唯一安全间距令牌；可用 `standardScale`、`arbitrationGapPx`、
  `standardSizePx` 覆盖，均集中定义在 `core.mjs`，无散落魔数。
- 圆角：`SIDEBAR_ANIMATION_RADIUS_PX = 15`，同时用于 `.pet` 容器与图片/canvas；只影响裁切，不改变
  候选矩形与仲裁几何。
- 固定形象：`fixedSizePx`（默认 220，最小 40）与 `fixedMarginPx`（默认 24，非负）可随同一对象覆盖；
  最后拖动位置存于 `dsh-anime-desktop-pet/fixed-position`（JSON `{x,y}`），损坏/越界会自动回退并 clamp。
- 桌面横幅：`BANNER_DEFAULTS`（默认宽 720、最小 240、最大 1920、边距 24、宽高比 2172/724）；
  位置/宽度存于 `dsh-anime-desktop-pet/banner-position`，开关存于
  `dsh-anime-desktop-pet/banner-visible`（缺省开启）。`bannerMarginPx` 可覆盖边距。
- 总显隐：`OVERLAY_VISIBLE_KEY = dsh-anime-desktop-pet/overlay-visible`（string `true`/`false`，缺省可见；
  Ctrl+Shift+F12 与设置状态共用）。
- 上下文变体：`CONTEXT_TIRED_THRESHOLD = 45`（两个动画都勾选时严格大于才切换）；`contextUsagePercent(pressure)` 与
  DSH 上下文占用展示一致（优先 `projectedTokens`，回退 `pressureTokens`，上限 100）。
- 动画库：`src/client/core.mjs` 的 `ANIMATIONS`（`id`/`name`/`characterName`/`file`/`enabled`/`threeView`），
  首个动画的显示名固定为「蓝色大肥鱼正在工作」，角色名「蓝色大肥鱼」。新增动画时把 GIF 放进
  `assets/`，并在 `core.mjs` 与宿主路由（`src/index.ts`）各加一条；`test/*` 里已有多动画规则用例，
  可注入假动画库验证。
- 勾选持久化键：`dsh-anime-desktop-pet/selection`（localStorage，JSON 数组）。坏数据/空集合
  自动回退到首个可用动画，永不出现空选择。

## 运行契约

- 会话行锚点：`data-row-key="session:<sessionId>"`（DSH 工作区会话列表的稳定行键）。
- 运行状态：`ctx.sessions.list`（`SessionSummary.running`），一次订阅，列表变化时增量对账。
- 订阅契约：`sessions.list.subscribe(fn)` 是**失效通知**（回调不带快照），必须在回调里重新
  `getSnapshot()` 再投影 running；否则首屏之后到达的列表/运行态更新会丢失（真机验收抓到并已修复，
  `test/entry.client.test.mjs` 按该契约打桩）。
- 定位与仲裁：每轮用 `getBoundingClientRect()` 一次性测量行/工作区头/固定形象矩形，经 rAF 合并后
  交给纯函数 `computeAnimationPlacements`；动画固定定位在行右侧、行中心垂直居中。行缺失、尺寸为 0
  或滚出视口时不产生候选；不逐项读写布局，也不使用 `elementFromPoint` 遮挡探针。
- 随机绑定：每个运行会话从已勾选动画中随机取一个，`sessionId` 绑定在本次运行期间保持稳定；
  勾选集合变化会立即校正仍越界的绑定。
- 可见性仲裁：候选按 DOM 显示顺序；与固定基准或已放置矩形相交（含 `ANIMATION_ARBITRATION_GAP`）
  即隐藏；工作区级优先于会话级，同级先到先得；被隐藏的节点立即卸载，不留动画循环。
- 剪贴板：优先 `navigator.clipboard.write` + `ClipboardItem({'image/png': blob})`；非 PNG 先经
  canvas `toBlob('image/png')`；API 缺失/拒绝时仅给出提示（不再提供「另存为图片」）。
- 固定形象：独立 `<img data-xllh-pet-fixed>`，默认右下角（视口 - 尺寸 - 24px）；`pointerdown` 拖动、
  `pointerup` 持久化位置（`dsh-anime-desktop-pet/fixed-position`），`render`/`resize` 时 clamp；
  右键菜单复用插件菜单（仅「设置」）。侧栏运行中图标**不再拦截 contextmenu**，DSH 原生菜单保留。
- 快捷键：`Ctrl+Shift+F12` 在 document 捕获阶段切换整个 host 的显示/隐藏；隐藏时关闭菜单/设置/
  预览并结束拖动。状态写入 `dsh-anime-desktop-pet/overlay-visible`（缺省可见），F5/重启后
  保持隐藏或显示；运行态生效，不修改 profile。
- 三视图资源：角色注册表 `threeView` 字段 → `GIF_BASE_PATH + threeView`；真实图片位于
  `assets/three-view/blue-fat-fish-working.png`，预览只发起一次 `fetch` 得到 blob + objectURL，
  图片展示与「复制图片」共用同一份 blob；关闭/卸载时 revoke objectURL。

## 测试

```bash
npm test          # node --test，91 例：场景切片/清单/布局/纯逻辑/渲染/清理、四套 GIF + 横幅元素清单门禁、旧覆盖层与宿主路由
                  # overlay(jsdom：标准尺寸、上下文变体、折叠工作区、固定基准、横幅拖动/缩放/开关、设置/预览/清理)、
                  # client 入口、宿主 GIF/三视图/固定形象路由、bundle 形状门禁
python scripts/slice-live-scene.py  # 直播间素材切图 + manifest/QA 预览
python scripts/build-gif.py         # 工作态 GIF 生成 + 回读校验
python scripts/build-fixed-gif.py   # 固定形象 25 帧 GIF 生成 + 回读校验
python scripts/build-tired-gif.py  # 很累 16 帧 GIF 生成 + 回读校验
python scripts/build-banner.py             # 横幅静态基准：去 checkerboard、恢复透明通道 + QA 预览
python scripts/build-banner-animation.py   # 切气球/彩带/星星元素并合成动态横幅 GIF + QA 预览
npm run build                       # tsc(host) + tsdown(client) + 工厂形状检查
```

### 真机验收（脚本）

宿主加载插件并刷新页面后运行（`DSH_VERIFY_HIDE_MASKS=1` 只在该 headless 页面隐藏第三方全屏蒙版）：

```powershell
$env:DSH_CHECKOUT='<dsh checkout>'
$env:DSH_HOME='<staging-home>'
$env:DSH_VERIFY_HIDE_MASKS='1'
node scripts/verify-scene-live.mjs   # 场景验收：元素/动效/交互/响应式/隐藏持久化/reduced-motion
node scripts/verify-live.mjs         # 旧覆盖层验收（脚本内部强制 scene:false）
```

断言：插件行存在 → GIF/三视图/固定形象路由字节一致 → 覆盖层宿主 `pointer-events:none` → 以 DSH
`[data-state="ongoing"]` 为运行态 oracle，每个已挂载动画的标准尺寸 = 行高×2.5、垂直居中、
`aria-hidden`、不可 Tab、无 hover transform、图片已加载 → 相邻动画不重叠 → GIF 截图像素变化 →
动画中心 `elementFromPoint` 命中下层（穿透）→ 固定形象右键菜单/设置/预览/复制/快捷键回归。

本机 2026-10-26 实测（1680×1000）：`91/91` 单测全绿；场景真机验收 0 failures（18 场景元素全加载/底部横条 488×112 保持原尺寸并贴右下角/左侧竖幅星星气泡持续上浮/右下书带区域星星彩带气泡上浮/自动气泡全部使用 fx-bubble-large@2x/旧横幅可拖动且保留缩放把手和等比缩放/固定入口按持久化左下坐标恢复/运行行小动画节点恢复/设置面板 2 个动画开关与横幅开关存在/10 个标签金鱼可拖动且 F5 保持/两次截图不同/1280-1024-768-375 响应式/F5 隐藏持久化/reduced-motion；rAF 帧率 60.2fps，旧覆盖层基线 60.6fps）；旧覆盖层验收 0 failures。设置面板显示 2 个可勾选动画 + 横幅开关，运行会话 2 个、可见
标准动画 2 个（均 `80×80`、`border-radius=15px`）；固定形象 `220×220`；很累 GIF 路由 `200 image/gif`（460KB）；桌面横幅实测 `720×240`、`/assets/banner/...gif` 路由 `200 image/gif`、两次截图不同（GIF 在动）、切换开关可隐藏/恢复；布局/滚动高度在隐藏覆盖层前后完全一致；
动画中心 `elementFromPoint` 命中页面而非覆盖层。追加真机证据：
- 折叠含运行会话的工作区 → 会话动画卸载，文件夹行出现唯一 `85×85` 工作区动画；
  展开 → 工作区动画卸载、会话 `80×80` 动画恢复。
- 把固定形象实测矩形临时移到动画位置 → 动画卸载；移开后 resize 重算 → 动画恢复。
- 真实 Chromium 页面（注入公开 sessions 快照形状，并在 localStorage 勾选两个动画）验证上下文变体：
  75% 会话挂载 `blue-fat-fish-tired.gif`、50% 会话挂载 `blue-fat-fish-working.gif`，相邻冲突实例被仲裁隐藏，
  节点均为 80×80 且 `aria-hidden=true`。
- `prefers-reduced-motion: reduce` 下 canvas 静态首帧 `256×256` 可见、img 隐藏，间隔 500ms
  两次截图完全一致，仲裁尺寸仍为 `80×80`。

## 业务关键验收场景

无运行对话 → 无动画；有运行对话 → 动画出现在**对应行右侧**（多会话各一个，垂直居中）；
**动画高度不超过对话行高、下边缘与行底对齐、左缘位于对话列表边界右缘外 ≥1px，相邻两个运行行
的动画不重叠**；运行结束后立即消失；左键点击动画覆盖区域仍能命中下层 DSH 控件（穿透）；
**侧栏运行中图标保留 DSH 原生右键、不再弹插件菜单**；设置面板显示「蓝色大肥鱼正在工作」，
单动画时复选框锁定；多动画时随机展示且不能全部取消（取消最后一个有提示）；刷新/重启后勾选恢复；
卸载/禁用插件后页面无残留节点与监听；GIF 始终 16 帧、透明、无限循环。
**运行中图标直接以标准尺寸（行高×2.5）展示，不再有 hover 缩放；每个节点都有内联 15px 圆角裁切；隐藏实例立即卸载，不重载
GIF、不引起其他图标位移或列表重排；`prefers-reduced-motion` 用静态首帧。**
**两个动画都可勾选；两者同时启用时上下文用量 >45% 自动换成「蓝色大肥鱼很累」，<=45% 保持工作图；跨阈值无需刷新。**
**桌面固定形象常驻（默认 220px）：可拖动、位置持久化并在重载/缩放后 clamp；右键弹菜单 → 设置；
其 GIF 为 25 帧、300ms/帧、透明循环；`Ctrl+Shift+F12` 一键隐藏/恢复整个组件。**
**设置面板「蓝色大肥鱼」行有独立三视图按钮：点击只开预览、不改变勾选；预览层居中、可经关闭/
Esc/遮罩关闭并回焦按钮，背景滚动与焦点陷阱关闭后释放；真实三视图图片正常显示；预览图右键可
复制 PNG（剪贴板失败仅提示，不再提供「另存为图片」）。**

## 业务关键验收场景

- **标准渲染**：运行中会话直接出现 80px（行高×2.5）动画；无小缩略图、无 hover 放大、无 transform；
  动画不改变行高/列表总高/滚动条；左键 hover/点击/拖拽穿透到下层；装饰节点 `aria-hidden`。
- **7 个对话仲裁**：仅 #1 运行 → #1；#1+#3 → 仅 #1；#1+#3+#4 → #1、#4；#1 结束 → #3 展示、
  #4 隐藏；#3 结束 → #4 恢复；顺序变化后可见集合等于对当前顺序重新执行算法的结果（幂等）。
- **折叠工作区**：全部收起且至少一个会话运行 → 文件夹行一个 85px 动画；多运行会话不叠加；
  展开后回落到会话级；展开/收起均触发重算。
- **固定基准**：左侧悬浮大肥鱼保持不变；任何侧栏动画与其矩形（含 8px gap）相交则不渲染；
  优先级「固定基准 > 工作区 > 会话」，同级按显示顺序先到先得。
- **上下文变体**：两个动画都勾选时，同一运行会话用量 45% 时仍为工作图，46% 时切换「很累」图；回落 45% 时切回工作图；只勾选一个时始终使用该图；
  投影缺失/非法时按工作图降级；折叠工作区取内部运行会话最大用量。
- **交互回归**：hover/点击/拖拽会话、展开收起工作区、运行→空闲、多工作区并行运行、窗口缩放均正常；
  `prefers-reduced-motion` 下静态首帧且仲裁不变；卸载后无残留节点/监听/rAF。

## 素材采纳说明

任务附件 1 的 4×4 分镜图 16 格全部采纳为工作态 GIF 的 16 帧（阅读顺序），没有丢弃或替换任何一格。
任务附件 2 的 5×5 拼图 25 格全部采纳为固定形象的 25 帧 GIF（用户后续上传了完整的 1254×1254 版本）。
后续附件 4×4 拼图 16 格全部采纳为「蓝色大肥鱼很累」的 16 帧 GIF（1295×1214 原图 + 16 张切分帧）。
直播横幅原图（2172×724）背景实际是烘焙的 checkerboard；`scripts/build-banner.py` 从边缘泛洪移除
低饱和亮色背景，恢复透明通道并保留横幅白色布面/文字；原始图保存在 `assets/raw/banner-source.png`。
元素原图 `assets/raw/banner-elements.png`；生成脚本会把 126 个元素切到 `assets/banner/elements/` 并合成动画。
原始整图与两套切分帧都保留在 `assets/raw/`，GIF 由脚本确定性生成；三视图图片由用户放入
`assets/three-view/blue-fat-fish-working.png`，预览与复制均使用该真实文件。

## 已知限制

- GIF 只支持 1-bit 透明：半透明抗锯齿边被阈值化并腐蚀 1px（避免白边），极细发丝边缘可能略瘦；
  若需更高保真需换 APNG/WebP（超出本任务 GIF 要求）。
- 动画库当前只发布 1 个动画：UI 已实现多动画规则（多选、至少保留一个、随机绑定），
  但没有第二个真实素材，多动画只在测试中用假库覆盖。
- 行锚点依赖 DSH 的 `data-row-key="session:<id>"`；DSH 若改行 DOM 契约需更新本插件的
  `rowsBySession()`（集中在此一处）。`ponytail:` 升级路径：优先接入 DSH 提供的会话行 Slot，
  次选增加 `data-session-id` 兼容选择器。
- 遮挡检测用 `elementFromPoint` 单点采样（行左缘内 8px）：被全屏蒙版盖住时会隐藏；
  例如 AI 助手演示模式的全屏黑色蒙版（`.aia-mask`）覆盖工作区时，动画按遮挡规则隐藏，
  关闭蒙版即恢复；若行内容恰好在该点有覆盖元素则视为可见（正常列表行满足），不做多点扫描。
- 动画高度收敛到行高（DSH 当前 32px），宽度随 GIF 等比=行高；左缘贴在对话列表边界外侧 1px。
  边界探测是「向上最多 8 层、取宽度小于视口 90% 的祖先的最大右缘」；DSH 若重构侧栏容器导致探测
  失败，会回退到「行右缘 + gapPx」，此时可能重新压到侧栏内边距。`ponytail:` 升级路径是让 DSH 暴露
  稳定的列表/侧栏 Slot 或 data 属性。
- 极窄窗口下动画左缘被视口夹紧时，1px 边界间距可能被牺牲（优先保证动画不出屏）。
- 覆盖层是固定定位小图，不参与 DSH 布局；极端缩放/窗口跳变时最多延迟到下一帧 rAF 校正。
- 设置面板为插件自有最小 UI（Shadow DOM），只保证键盘可操作与 Escape/外点关闭，
  不复用 DSH 设置系统样式；三视图预览是**刻意带半透明遮罩的模态层**（与设置面板「无蒙层」策略不同）。
- 固定形象默认尺寸 220px、默认右下角；拖动位置按视口绝对坐标保存，换分辨率/缩放窗口后会 clamp
  到可视范围，但不做比例缩放。`Ctrl+Shift+F12` 是浏览器/系统可能占用的组合键，若被宿主抢先处理
  则快捷键无效（可在控制台验证 keydown）。
- 侧栏运行中图标的插件右键菜单已**按用户要求移除**，设置入口只剩固定形象右键菜单；用快捷键隐藏
  组件后固定形象也会隐藏，但用同一快捷键可恢复。
- 三视图预览不再提供「另存为图片」；剪贴板不可用时只有提示，图片请通过其他方式保存。
- 固定形象 GIF 为 300ms/帧（25 帧整轮 7.5 秒）；素材为 AI 生成拼图，透明背景同样经过阈值+腐蚀
  处理，极细发丝边缘可能略瘦。
- 三视图前缀路由只接受 `assets/three-view/` 下扁平图片文件名（png/jpg/jpeg/webp/gif，白名单校验、
  拒绝穿越）；素材更新后浏览器缓存最长 5 分钟（`max-age=300`）。
- 复制依赖 `navigator.clipboard` + `ClipboardItem`（通常要求 HTTPS/localhost 安全上下文与权限）；
  DSH Desktop 壳或受限浏览器里可能不可用，此时只显示失败提示（v0.3.0 起无「另存为图片」兜底）。
- 超大尺寸三视图经 canvas 转 PNG 会占用等量内存；建议单图 ≤ 8K，预览容器内滚动而非超出视口。
- 可见性仲裁按实测几何执行；滚动/缩放/折叠后由同一 rAF 调度器重算，不做逐项 hover 命中扫描。
- 标准尺寸按**会话行高**计算；若 DSH 行高随字体/主题变化，下一次重算会自动更新尺寸与候选矩形。
- 上下文变体依赖 token-meter 公开的 `contextPressure` 投影；若该投影不可用/尚未到达，动画按工作图
  降级，不会报错。阈值使用与 DSH 展示一致的取整百分比，**严格大于 45** 才切换；只勾选一个动画时不走阈值。
- 「很累」GIF 来自用户 4×4 拼图，裁剪依赖 alpha 投影检测面板空隙；若后续替换为不等分/无透明背景的
  拼图，需要调整 `scripts/build-tired-gif.py` 的分割阈值。
- `prefers-reduced-motion: reduce` 时用 canvas 静态首帧替代 GIF 循环，仲裁与几何不变。
- 宿主半注册一个 exact GIF 路由 + 一个 three-view prefix 路由；新增动画资源需同步扩展路由与
  角色注册表。prefix 路由注册路径**不能带尾斜杠**（webServer 匹配规则），已在实现与 Host 测试中固定。

## 风险清单

- 若 DSH 后续调整会话列表 DOM（行键属性/滚动容器/虚拟化），动画可能不显示；仅有行键单点契约。
- 若 DSH 改侧栏容器结构导致边界探测失效，图标会回退到行右缘外侧（可能压住侧栏右边距 1px 内）。
- 其它插件若使用 ≥2147483045 的浮层并与侧栏重叠，小动画可能被其盖住（层级可配置规避）。
- `window.__DSH_ANIME_PET_OPTIONS__` 必须在插件加载前注入；普通用户无法在设置面板改尺寸（当前只做动画勾选）。
- 新增动画 = 新 GIF + 路由 + 清单三处同步，忘记任一处会出现 404 或不可选。
- 素材为 AI 生成图片，透明背景由脚本阈值化近似，不等同于手工抠图；极端背景/浅色主体可能残留边缘。
- profile 变更需要刷新页面；宿主半变更（新增路由）在未热加载的宿主上仍需重启一次。
- **三视图素材已接入**（`assets/three-view/blue-fat-fish-working.png`），真机已验证图片显示与复制；
  若文件名/扩展名不符合白名单或文件缺失，预览会回退到「三视图暂未提供」占位而非报错。
- 剪贴板能力依赖浏览器权限与安全上下文；DSH Desktop 壳/内嵌 WebView 若不支持 `ClipboardItem`，
  复制只显示失败提示（v0.3.0 起不再提供「另存为图片」等价入口）。
- 仲裁碰撞检测目前对每个候选扫描已放置矩形（同屏动画通常个位数，开销可忽略）；
  `ponytail:` 若未来宠物数量上百，再升级为空间索引/命中缓存。
- 三视图预览是高层级模态层（z-index 高于设置面板）；用户主动打开，但与其它插件极高浮层可能发生
  层叠竞争，必要时通过 `zIndex` 配置整体抬高。
- 三视图 prefix 路由只白名单图片扩展名；新增格式（如 avif）需同时扩展宿主白名单与客户端约定。
- 折叠工作区匹配使用「会话 cwd basename == 工作区标题」的启发式；若 DSH 允许显式重命名工作区，
  这种匹配可能失效，需要接入公开工作区投影后替换。
- 固定形象位置是视口绝对坐标：换分辨率/浏览器缩放后保持左上坐标并按可视区 clamp，不按比例缩放；
  若用户在多显示器间移动窗口，可能落在新窗口边缘而非原来相对位置。
- `Ctrl+Shift+F12` 可能被浏览器/系统/其它插件占用；若被抢占则无法切换，属环境冲突而非插件报错。
- 固定形象 GIF 约 0.6MB（25 帧/256²）；首次加载有一次性网络开销，之后由浏览器缓存（5 分钟）。
  素材更新时需递增 `core.mjs` 的 `ASSET_VERSION` 并重建客户端，才能绕过浏览器旧缓存。
- 固定形象裁剪依赖「25 个蓝色头发连通域 + 相邻锚点空隙」启发式：若未来拼图不再是同一风格/
  头发颜色变化，脚本可能找不到 25 个锚点而直接失败（不会静默生成错帧）；届时需调整颜色阈值或
  提供分好格的素材。生成脚本会强制检查帧边界透明，仍带串帧则拒绝产出。
- 侧栏图标右键菜单移除是用户明确要求：设置入口只有固定形象右键菜单；若固定形象被隐藏，
  需先用同一快捷键恢复。




