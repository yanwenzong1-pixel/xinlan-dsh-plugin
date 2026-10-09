/**
 * 「预存命令」的**存储 + 校验 + 定位 + 二次确认**叶子 —— 零依赖、无 DOM、无 IO。
 *
 * 为什么单独成层（与 preset-store.ts 同一理由）：
 *  1) `tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**；
 *     "键怎么拼、脏数据怎么收敛、面板越界怎么翻转、删除怎么二次确认、草稿怎么判脏"
 *     若留在客户端，等于没有任何一道门能拦住它们。下沉到这里后，`npm run typecheck`
 *     与 `node --test` 都能覆盖（test/command-store.test.mjs）。
 *  2) 结构只有一处定义：键名、版本、上限、层级、间距、契约文案，客户端只许引用常量。
 *
 * 设计口径（对应需求逐条）：
 *  · 数据模型只有两个业务字段：`title`（菜单展示）+ `content`（插入正文）；
 *    `id` 与数组顺序属于**内部结构字段**，不对用户暴露（需求 4.3）。
 *  · 持久化沿用项目既有 localStorage 方案（键 `<插件命名空间>.<短名>`），
 *    存**当前浏览器画像**一份 —— 客户端拿不到宿主身份，浏览器画像即"用户维度"的
 *    最小可用边界（需求 6.1 的"按用户维度隔离"；不削弱任何鉴权，铁律 46）。
 *  · 读取宽容、写入严格：解析永不抛（脏数据收敛成空/丢条目并计数），校验只在保存时拦。
 *  · 定位是纯函数：向上拉起、上不足翻转下方、视口四向限位、非法几何回退安全位
 *    （范式沿用本仓既有 menu-anchor.ts 的 dockMenuLineFor，见文件末尾说明）。
 *  · 对外 API（需求 6.3）：本文件导出的纯函数即插件的程序化接口 ——
 *    commands = commandsOf / onSelect = insertionText / onSave = validateCommandDraft + withCommand*
 *    / onDelete = withCommandRemoved。插槽组件自身 props 未变（向后兼容）。
 */
/** 存储键：沿用 `dsh-quick-append.*` 命名空间（与追加文案的 presets/text 三键互不覆盖）。 */
export declare const COMMAND_STORE_KEY = "dsh-quick-append.commands";
export declare const COMMAND_STORE_VERSION = 1;
/** 业务字段上限（需求 4.4：项目无统一约束时默认标题 ≤50、正文 ≤2000）。 */
export declare const COMMAND_TITLE_MAX = 50;
export declare const COMMAND_CONTENT_MAX = 2000;
/** 删除二次确认的有效窗口（毫秒）：窗口内再点同一个「确认删除」才真的删。 */
export declare const DELETE_CONFIRM_MS = 4000;
/** 面板与锚点的视觉间距（需求 2.1 的 5px 同源；也是上拉面板与按钮的间距）。 */
export declare const COMMAND_MENU_GAP_PX = 5;
/** 视口安全边距：限位后任何面板边缘都不会贴死屏幕边。 */
export declare const COMMAND_VIEWPORT_EDGE_PX = 5;
/**
 * 浮层层级寄存器（唯一来源）。CSS 模板里必须是同样的数字，门禁会比对两者
 * （test/client-shape.test.mjs 的 z-index 冻结断言直接读这里的值）。
 *  100 = 既有「点击追加」弹层（v0.4.x 登记为 ALIGN-10）
 *  110 = 预存命令面板与遮罩（需求 3.6：高于输入区与既有菜单）
 *  111 = 编辑弹窗面板（必须在自己的遮罩之上，否则点不动）
 */
export declare const COMMAND_LAYER: {
    readonly menu: 110;
    readonly mask: 110;
    readonly dialog: 111;
};
/** 面板尺寸（单一来源：定位计算与内联样式共用，避免 CSS 与 JS 两处漂移）。 */
export declare const COMMAND_MENU_WIDTH = 320;
/**
 * 菜单面板高度**预算**（上拉用 bottom 锚定，视觉间距与真实高度无关；该值同时是面板的 max-height 上限）。
 *
 * 2026-10-04 真机事故：原值 260 只够 5 行 —— 7 条命令时面板装不下内容，最后一行被画到
 * **卡片外**并被宿主元素盖住（用户现场："第 7 条看不到"），而旧门禁只断言"列表能滚"，
 * 于是长期假绿。现按实测行高重算预算：
 *   面板自然高度 = COMMAND_MENU_CHROME_PX + (COMMAND_MENU_ROW_PX × 条数 − 2)
 *   7 条 = 94 + 236 = 330 ⇒ 取 344 让 **7 条无需滚动**（8 条起由列表滚动承接）。
 */
export declare const COMMAND_MENU_HEIGHT = 344;
/** 菜单行占位（条目实测 32px + 列表 gap 2px）；n 行合计 = 该值 × n − 2（首行前无间距）。 */
export declare const COMMAND_MENU_ROW_PX = 34;
/** 列表之外的固定开销：面板 padding 12 + 头部 31 + 上间距 6 + 下间距 6 + 底部提示行 39。 */
export declare const COMMAND_MENU_CHROME_PX = 94;
/** 面板高度下限：矮视口夹紧时至少留出头部 + 一行 + 底部提示（固定开销 82 < 140，故 head/foot 不会被挤掉）。 */
export declare const COMMAND_MENU_MIN_HEIGHT = 140;
/**
 * 列表溢出时的可见提示。滚动条按规范 `ct-scrollbar-hidden` 是**隐藏**的，
 * 所以"还能往下滚"必须有文字兜底 —— 否则 8 条以上时用户只会看到"少了几条"。
 */
export declare const COMMAND_MENU_OVERFLOW_HINT = "\u6EDA\u52A8\u67E5\u770B\u66F4\u591A";
/**
 * 面板自然高度（未受视口限制时）。异常入参按 0 条处理，绝不返回 NaN。
 * @param count - 命令条数（任意入参；非有限正数一律按 0 条）
 * @returns 面板高度像素值，上限为 {@link COMMAND_MENU_HEIGHT}
 */
export declare function commandMenuPanelHeightFor(count: unknown): number;
/**
 * 面板可用高度上限 = min(预算, 视口高 − 2×安全边距)，并不低于 {@link COMMAND_MENU_MIN_HEIGHT}。
 * 视口高非法（非有限正数）时回落到预算 —— 宁可高一点，也不要算出 0 让面板塌掉。
 * @param viewportHeight - window.innerHeight 之类的视口高度
 * @returns 面板 max-height 像素值
 */
export declare function menuPanelMaxHeightOf(viewportHeight: unknown): number;
export declare const COMMAND_DIALOG_WIDTH = 380;
export declare const COMMAND_DIALOG_HEIGHT = 460;
/** 空态引导（需求 3.4 原文）：不展示空菜单，改为 toast 引导到右键录入路径。 */
export declare const COMMAND_EMPTY_TOAST = "\u6682\u65E0\u9884\u5B58\u547D\u4EE4\uFF0C\u53F3\u952E\u300E\u9884\u5B58\u547D\u4EE4\u300F\u53EF\u5F55\u5165\u6307\u4EE4";
export declare const COMMAND_SAVED_TEXT = "\u9884\u5B58\u547D\u4EE4\u5DF2\u4FDD\u5B58";
export declare const COMMAND_DELETED_TEXT = "\u9884\u5B58\u547D\u4EE4\u5DF2\u5220\u9664";
export interface StoredCommand {
    readonly id: string;
    readonly title: string;
    readonly content: string;
}
export interface CommandStore {
    readonly version: number;
    readonly commands: readonly StoredCommand[];
}
export interface CommandDraft {
    readonly title: string;
    readonly content: string;
}
export interface CommandParseResult {
    readonly store: CommandStore;
    /** 是否发生过损坏（非空输入读不出结构，或丢弃过条目）。用于决定要不要给用户提示。 */
    readonly damaged: boolean;
    /** 被丢弃的条目数（非法/重复）。 */
    readonly dropped: number;
}
export type CommandValidation = {
    readonly ok: true;
    readonly value: CommandDraft;
} | {
    readonly ok: false;
    readonly field: 'title' | 'content';
    readonly message: string;
};
export interface DropUpLineInput {
    readonly rect: {
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly height: number;
    };
    readonly panelWidth: number;
    readonly panelHeight: number;
    readonly viewport: {
        readonly width: number;
        readonly height: number;
    };
    readonly gap?: number;
    readonly edge?: number;
}
/** 向上拉起的结果：`bottom` 与 `top` 恒有一个为 null（调用方必须把另一个显式置 auto）。 */
export interface DropUpLine {
    readonly left: number;
    /** 上拉模式：`bottom = 视口高 - 锚点顶边 + gap`（视觉间距与面板真实高度无关）。 */
    readonly bottom: number | null;
    /** 下方翻转模式：`top = 锚点底边 + gap`。 */
    readonly top: number | null;
    readonly flip: boolean;
}
export interface DeleteConfirmState {
    readonly id: string;
    readonly deadline: number;
}
export declare function emptyCommandStore(): CommandStore;
/**
 * 宽容解析：任何脏输入都收敛成"能读多少读多少"，**绝不抛**。
 *  · 从未存过（null/undefined/空白串）→ 空列表，`damaged=false`（不是损坏，别吓用户）。
 *  · 非空但读不出结构 → 空列表，`damaged=true`。
 *  · 逐条：id/title/content 三者都必须是 trim 后非空的字符串；重复 id 只留第一条。
 */
export declare function parseCommandStore(raw: unknown): CommandParseResult;
export declare function serializeCommandStore(store: CommandStore): string;
/** 列表（不可变视图）：结构异常时降级为空数组（调用方在渲染路径上，绝不能抛）。 */
export declare function commandsOf(store: unknown): readonly StoredCommand[];
export declare function commandOf(store: unknown, id: unknown): StoredCommand | null;
/**
 * 生成不与既有集合冲突的内部 id。
 * 随机源退化（恒定值/NaN/负数/超界）时靠兜底序号保证唯一 —— 撞 id 会导致
 * 菜单项 key 冲突与"删一条删掉两条"。
 */
export declare function createCommandId(existing: readonly string[], random?: () => number): string;
/** 新增（追加到末尾，顺序稳定）：返回新 store，原对象不动。 */
export declare function withCommandAdded(store: CommandStore, draft: CommandDraft, id: string): CommandStore;
/** 修改：只换目标条目，顺序与其余条目不动；未知 id 原样返回同一个对象（幂等，不抛）。 */
export declare function withCommandUpdated(store: CommandStore, id: string, draft: CommandDraft): CommandStore;
/** 删除：未知 id 原样返回同一个对象（幂等，不抛）。 */
export declare function withCommandRemoved(store: CommandStore, id: string): CommandStore;
/** 编辑态草稿：null（新增）或脏输入 → 空草稿。 */
export declare function commandDraftOf(command: StoredCommand | null | undefined): CommandDraft;
/**
 * 是否有未保存变更（决定关闭弹窗要不要先问）。
 *  · 新增态：两个字段都只有空白 → 不脏（什么都没填就关窗不该拦人）。
 *  · 编辑态：与回填值逐字符比较（多一个空格也算脏）。
 */
export declare function commandDraftDirty(base: StoredCommand | null | undefined, draft: CommandDraft | null | undefined): boolean;
/**
 * 校验（保存时唯一入口）：trim 后必填 + 上限（闭区间：恰好等于上限通过）。
 * 先标题后正文：两者都非法时提示稳定只报标题。
 */
export declare function validateCommandDraft(input: unknown): CommandValidation;
/**
 * 插入拼接：空草稿 → 只插正文（不留前导空行）；非空 → 原草稿 + 两个换行 + 正文。
 * 与「点击追加」同一口径（`draft + '\n\n' + 文案`），且**永不丢用户已写内容**。
 * 正文为空/非字符串 → 原样返回草稿（调用方据此跳过写入）。
 */
export declare function insertionText(draft: unknown, content: unknown): string;
/** 数据损坏的可见文案：区分"整包读不出"与"丢了 N 条"（后者用户才知道自己的指令少过）。 */
export declare function commandDamagedText(dropped: unknown): string;
/**
 * 写盘失败的可见文案。两条硬要求（与 presetWriteFailedText 同口径）：
 *  ① 不得为空（空提示 = 静默失败）；② 必须讲清降级形态（本页仍可用、刷新后会丢）。
 */
export declare function commandWriteFailedText(reason: unknown): string;
/**
 * 向上拉起定位（纯函数）。范式沿用本仓既有 `menu-anchor.ts` 的 `dockMenuLineFor`：
 *  · 默认在锚点正上方 `gap` 处（用 bottom 锚定 ⇒ 视觉间距与面板真实高度无关）；
 *  · 上方不足 `edge` → 翻转到锚点下方（改用 top 锚定）；
 *  · 水平右缘与锚点右缘对齐（沿用既有弹层 `right: 0` 的口径），四向限位；
 *  · 非法几何/缺字段 → 回退"视口右下角安全位"，**绝不到屏幕左上角**。
 */
export declare function dropUpLineFor(input: unknown): DropUpLine;
/** 编辑弹窗定位（居中 + 限位；非法输入贴安全边距）。遮罩为模态，居中比锚定更稳。 */
export declare function centerPlacementOf(input: unknown): {
    readonly left: number;
    readonly top: number;
};
/**
 * 删除二次确认状态机（纯函数）：
 *  · 第一次点某条 → 进入待确认（带截止时间），**不删**；
 *  · 窗口内再点同一个 id → `confirmed=true`（调用方才执行删除）；
 *  · 到点即失效 → 再点只重新进入待确认（防"隔很久误删"）；
 *  · 期间点另一条 → 目标切换，不动前一条。
 */
export declare function nextDeleteConfirm(prev: DeleteConfirmState | null, id: string, now: number): {
    readonly state: DeleteConfirmState | null;
    readonly confirmed: boolean;
};
/** 与状态机同口径的"是否正在等这条的二次确认"（渲染按钮文案用，不可能与行为不一致）。 */
export declare function isDeleteConfirmActive(state: DeleteConfirmState | null, id: string, now: number): boolean;
