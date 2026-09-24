/**
 * 「点击追加」按钮解析中交互纯函数核心。
 * 无副作用：解析中拦截判定（左/右键）、固定文案、toast 去重/自动消失时长。
 * 规则：拦截与提示只在「解析中」生效；常规态零侵入；未知输入按常规态处理。
 * 单测见 test/interaction.test.mjs。
 */
/** 解析中/常规态。parsing = 最近一次 LLM 解析任务仍在运行（请求已发出未返回/流式未结束）。 */
export type ParsingState = 'idle' | 'parsing';
/** 手势：左键 / 右键（contextmenu）。 */
export type Gesture = 'click' | 'contextmenu';
/** 一次手势的判定结果：是否拦截业务、是否提示、是否允许打开自定义菜单。 */
export interface GestureDecision {
    intercepted: boolean;
    toast: string | null;
    openMenu: boolean;
}
/** 解析中拦截提示的固定文案（不可变更，需求锁定）。 */
export declare const PARSING_TOAST = "\u63D0\u793A\u8BCD\u6B63\u5728\u751F\u6210\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\uFF01";
/** toast 自动消失时长（毫秒）。 */
export declare const TOAST_DURATION_MS = 2500;
/**
 * 一次手势的判定（纯函数）。
 * - parsing：任意手势 → 拦截 + 固定文案；不打开菜单。
 * - idle：左键放行业务、右键允许打开自定义菜单；零提示。
 * - 未知状态/手势：按常规态处理（零侵入、零副作用）。
 */
export declare function gestureDecision(state: ParsingState, gesture: Gesture): GestureDecision;
/** 当前 toast 槽位：文本 + 到期时间戳。 */
export interface ToastSlot {
    text: string;
    deadline: number;
}
/**
 * toast 去重/替换（纯函数）：单实例。
 * - 同文案（含解析中固定文案重复触发）→ 复用，仅刷新到期时间（不叠加、保持可见）。
 * - 异文案 → 替换并刷新到期时间。
 */
export declare function nextToast(prev: ToastSlot | null, incoming: string, now: number): ToastSlot;
/** 到期判定：now >= deadline 即过期（无槽位视为过期）。 */
export declare function isToastExpired(deadline: number | null, now: number): boolean;
/** 常驻优化 toast 固定文案（需求锁定，不可变更）。 */
export declare const OPTIMIZING_TOAST = "\u6B63\u5728\u4F18\u5316\u63D0\u793A\u8BCD\u4E2D\u2026";
/** 成功态短暂文案。 */
export declare const DONE_TOAST = "\u4F18\u5316\u5B8C\u6210";
/** 成功态自动退出时长（ms）：仅完成态允许自动退出。 */
export declare const DONE_TOAST_MS = 2000;
/** 常驻优化 toast 状态机。optimizing 永不因计时关闭；done 经 DONE_TOAST_MS 退出；idle 无展示。 */
export type OptimizeToastState = {
    kind: 'idle';
} | {
    kind: 'optimizing';
} | {
    kind: 'done';
    since: number;
};
/** 优化开始：任意前置状态 → 优化中（单实例：重复触发先关旧实例再展示新实例，永不堆叠）。 */
export declare function toastOnOptimizeStart(_prev: OptimizeToastState | null): OptimizeToastState;
/** 优化终态（成功）：优化中 → 完成态；其余状态保持（idle 不产生完成态）。 */
export declare function toastOnOptimizeEnd(prev: OptimizeToastState | null, now: number): OptimizeToastState;
/** 完成态到期判定：仅 done 且距 since ≥ DONE_TOAST_MS；optimizing/idle 永不因计时关闭。 */
export declare function isDoneToastExpired(state: OptimizeToastState | null, now: number): boolean;
/** 新输入面的稳定钩子（官方组件自己声明的属性，非本插件自造类名）。 */
export declare const COMPOSER_INPUT_ATTR = "data-composer-input";
/** 旧输入面标签名（0.1.5 之前的 composer；作为回退保留）。 */
export declare const COMPOSER_LEGACY_TAG = "TEXTAREA";
/** 判定所需的最小元素形状：真实 DOM 元素天然满足，单测可用极简桩替代。 */
export interface InputPointLike {
    /** 该元素是否带有指定属性（`Element.hasAttribute`）。 */
    hasAttribute(name: string): boolean;
    /** 该元素的限定标签名（`Element.tagName`，恒为大写）。 */
    readonly tagName: string;
}
/**
 * 判定聚焦元素是否为 composer 输入面（纯函数，副作用为零）。
 * - 命中 `data-composer-input` → 新输入面（contenteditable div）。
 * - 否则 `tagName === 'TEXTAREA'` → 旧输入面兜底。
 * - null / 非元素 / 形状不符 → 一律 false（未知输入按「不在输入面」处理，零侵入）。
 * @param el - 待判定元素（通常为 `document.activeElement`）。
 */
export declare function isComposerInputPoint(el: InputPointLike | Element | null | undefined): boolean;
