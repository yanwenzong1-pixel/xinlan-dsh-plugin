/**
 * 「追加文案」的**按工作区隔离存储**叶子 —— 零依赖、无 DOM、无 IO（2026-09-23）。
 *
 * 为什么单独成层：
 *  1) `tsconfig.json` 显式 `exclude: ["src/client"]` ⇒ 客户端源码**不被 tsc 检查**；
 *     把"键怎么拼、脏数据怎么收敛、写失败怎么办"留在客户端，等于没有任何一道门能拦住它。
 *     下沉到这里之后，`npm run typecheck` 与 `node --test` 都能覆盖。
 *  2) 结构只有一处定义：键名、版本、占位键、默认文案，客户端只许引用常量，不得自己拼字符串。
 *
 * 设计口径（对应需求逐条）：
 *  · 唯一维度 = 工作区**ID**（不是展示名）：重命名不影响、同名的两个工作区互不串写（见 workspaceKeyOf）。
 *  · 惰性初始化：不存在的键读出来就是空串，**读取绝不写盘**（presetOf 是纯函数）。
 *  · 旧值迁移：老版本只有一个全局键；第一次读到它时迁给"当前工作区"，随后**删掉旧键** ——
 *    不删的话，将来每建一个新工作区都会被这段旧值污染（= 隔离失效）。
 *  · 写盘失败**不冒泡**：调用点在浏览器渲染路径上，抛出去会整页挂；失败转成 onError 回调 → 可见提示。
 */
export declare const PRESET_STORE_KEY = "dsh-quick-append.presets";
export declare const LEGACY_PRESET_KEY = "dsh-quick-append.text";
export declare const PRESET_STORE_VERSION = 1;
/** 会话不归属任何工作区时的专用占位键（不用空串，避免与"非法输入"混淆）。 */
export declare const NO_WORKSPACE_KEY = "__no-workspace__";
/** 合并写入的窗口：窗口内对同一工作区的多次提交只落一次盘。 */
export declare const PRESET_WRITE_COALESCE_MS = 250;
export declare const PRESET_SAVED_TEXT = "\u5DF2\u4FDD\u5B58";
/**
 * 默认文案（原 `DEFAULT_PRESET`）：**不再作为缺省值**——按需求，新建工作区的追加文案为空；
 * 这段文案改由弹窗里的「填入默认文案」按钮一键填回（用户 2026-09-23 选定）。
 *
 * 2026-09-23 内容修订（**用户指定原文**，逐字写入，只剥掉行尾空白这一处复制痕迹）：
 *   · 第 1 条改为「…扩展使需求更加精准。扩展后要结合项目实际现状，对合理性…」；
 *   · 附加约束首条新增「-使用Ponytail 的 full模式开发」；
 *   · 末三条（插件窗口UI / 插件安全 / 画布互动 三个具体规范文件名）合并为通用一条
 *     「-项目规范，安全规范，交互规范，严格遵守根目录配置文件：*.md」；
 *   · 条目符号沿用用户原文的「-」后不加空格写法（其余文字一字未改）。
 *   门禁：test/preset-store.test.mjs 的 A4 同时钉住"新措辞必须在"与"旧措辞必须不在"。
 */
export declare const DEFAULT_APPEND_TEXT = "\u6700\u9AD8\u4F18\u5148\u7EA7\u89C4\u5219\uFF1A\n1\u3001\u6839\u636E\u7528\u6237\u9700\u6C42\u8FDB\u884C\u4E00\u6B21\u7EC6\u8282\u7684\u6269\u5C55\u4F7F\u9700\u6C42\u66F4\u52A0\u7CBE\u51C6\u3002\u6269\u5C55\u540E\u8981\u7ED3\u5408\u9879\u76EE\u5B9E\u9645\u73B0\u72B6\uFF0C\u5BF9\u5408\u7406\u6027\u505A\u4E00\u6B21\u9010\u6761\u6821\u9A8C\uFF08\u5982\u679C\u53D1\u73B0\u4E0D\u5408\u7406\u5FC5\u987B\u91CD\u5199\uFF09\u3002\n2\u3001\u5C06\u9700\u6C42\u62C6\u89E3\u4E3A\u6700\u5C0F\u3001\u53EF\u72EC\u7ACB\u9A8C\u8BC1\u7684\u539F\u5B50\u5316\u6B65\u9AA4\uFF0C\u9010\u4E2A\u5B8C\u6210\u3002\n3\u3001TDD\u6D4B\u8BD5\u9A71\u52A8\u5F00\u53D1\uFF1A\u5148\u5199\u6D4B\u8BD5\uFF0C\u518D\u5199\u5B9E\u73B0\uFF0C\u9075\u5FAA\u7EA2\u2011\u7EFF\u2011\u91CD\u6784\uFF0C\u7981\u6B62\u8DF3\u8FC7\u6D4B\u8BD5\u76F4\u63A5\u5199\u4E1A\u52A1\u4EE3\u7801\u3002\n\n\u9644\u52A0\u7EA6\u675F\uFF1A\n-\u4F7F\u7528Ponytail \u7684 full\u6A21\u5F0F\u5F00\u53D1\n-\u5355\u5143\u6D4B\u8BD5\u5FC5\u987B\u8986\u76D6\u8FB9\u754C\u4E0E\u5F02\u5E38\u8F93\u5165\uFF0C\u62D2\u7EDD\u65E0\u6548\u4F2A\u6D4B\u8BD5\u3002\n-\u5217\u51FA\u4E1A\u52A1\u5173\u952E\u9A8C\u6536\u573A\u666F\u3002\n-\u5B8C\u6210\u540E\u8F93\u51FA\u7B80\u77ED\u7684\u6F5C\u5728\u98CE\u9669\u3002\n-\u6A21\u7CCA\u9700\u6C42\u76F4\u63A5\u63D0\u95EE\uFF0C\u7981\u6B62\u8111\u8865\u903B\u8F91\u3002\n-\u9879\u76EE\u89C4\u8303\uFF0C\u5B89\u5168\u89C4\u8303\uFF0C\u4EA4\u4E92\u89C4\u8303\uFF0C\u4E25\u683C\u9075\u5B88\u6839\u76EE\u5F55\u914D\u7F6E\u6587\u4EF6\uFF1A*.md\n\n\u8F93\u51FA\u987A\u5E8F\uFF1A\u539F\u5B50\u6B65\u9AA4 \u2192 \u9A8C\u6536\u573A\u666F \u2192 \u5355\u5143\u6D4B\u8BD5 \u2192 \u5B9E\u73B0\u4EE3\u7801 \u2192 \u98CE\u9669\u6E05\u5355\u3002";
export interface PresetEntry {
    readonly appendText: string;
}
export interface PresetStore {
    readonly version: number;
    readonly workspaces: Readonly<Record<string, PresetEntry>>;
}
/** 工作区列表条目里本叶子依赖的最小子集（`WorkspaceView` 的结构兼容形）。 */
export interface WorkspaceItemLike {
    readonly workspaceId?: unknown;
    readonly sessionIds?: unknown;
}
export interface PresetWriteRequest {
    readonly key: string;
    readonly text: string;
}
export interface LegacyMigration {
    readonly store: PresetStore;
    /** 是否真的把旧值迁进了目标工作区。 */
    readonly migrated: boolean;
    /** 是否应当删除旧键（读出过字符串就必须删，否则会持续污染新工作区）。 */
    readonly dropLegacy: boolean;
}
export interface CoalescingWriterOptions {
    readonly delayMs: number;
    /** 真正落盘；抛错表示失败（由 onError 承接，不冒泡给调用方）。 */
    readonly write: (request: PresetWriteRequest) => void;
    readonly onApplied?: (request: PresetWriteRequest) => void;
    readonly onError?: (request: PresetWriteRequest, error: unknown) => void;
    /** 注入计时器（默认 setTimeout/clearTimeout），单测用假计时器。 */
    readonly schedule?: (fn: () => void, delayMs: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
}
export interface CoalescingWriter {
    /** 提交一次写入（同键覆盖，窗口内合并）。 */
    submit(key: string, text: string): void;
    /** 立即落盘（保存/页面隐藏/卸载/切换工作区时调用）。 */
    flush(): void;
    /** 尚未落盘的键（测试与调试用）。 */
    pending(): readonly string[];
}
export declare function emptyPresetStore(): PresetStore;
/**
 * 宽容解析：任何脏输入（null/空串/非 JSON/标量/数组/条目非法）都收敛成"能读多少读多少"，**绝不抛**。
 * 版本字段只做归一化：遇到未来版本仍读取已知字段（前向兼容），不整包丢弃。
 */
export declare function parsePresetStore(raw: unknown): PresetStore;
export declare function serializePresetStore(store: PresetStore): string;
/** 读取某个工作区的追加文案：不存在 → 空串（惰性初始化，不产生写入）。 */
export declare function presetOf(store: PresetStore, workspaceKey: string): string;
/** 不可变写入：返回新 store，原对象不动（避免"读到一半被改"的隐式共享）。 */
export declare function withPreset(store: PresetStore, workspaceKey: string, text: string): PresetStore;
/**
 * 解析"当前工作区键"：按 DSH 自己的口径 —— 工作区列表里 `sessionIds` 含当前会话的那个 `workspaceId`。
 * 解析不出来（无会话/未归属）→ NO_WORKSPACE_KEY。任何脏输入都不抛。
 *
 * 为什么必须按 ID：展示名可改、可重名；用名字当键会同时坏掉"重命名保留配置"和"同名工作区隔离"。
 */
export declare function workspaceKeyOf(input: {
    readonly sessionId?: unknown;
    readonly items?: unknown;
}): string;
/**
 * 旧版全局配置迁移：只在目标工作区**还没有**条目时迁入；只要读到过字符串就要求删旧键。
 * `legacyRaw` 非字符串（键不存在，或 storage 读取失败）→ 什么都不做且**不删键**（下次启动可重试）。
 */
export declare function migrateLegacyPreset(store: PresetStore, legacyRaw: unknown, workspaceKey: string): LegacyMigration;
/**
 * 合并写入器：窗口内同一键的多次提交合并成一次落盘（保留最后一次的值）；
 * `flush()` 立即落盘并撤销计时器。写入异常**不冒泡**，转 onError（写盘失败要让用户看见，但不能让页面挂）。
 */
export declare function createCoalescingWriter(options: CoalescingWriterOptions): CoalescingWriter;
/**
 * 写盘失败的可见文案。两条硬要求：
 *  ① 不得为空（空提示 = 静默失败）；
 *  ② 必须讲清降级形态 —— "本页仍可用、刷新后会丢"，否则用户会以为这一笔编辑彻底没了。
 */
export declare function presetWriteFailedText(reason: unknown): string;
