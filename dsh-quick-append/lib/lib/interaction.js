/**
 * 「点击追加」按钮解析中交互纯函数核心。
 * 无副作用：解析中拦截判定（左/右键）、固定文案、toast 去重/自动消失时长。
 * 规则：拦截与提示只在「解析中」生效；常规态零侵入；未知输入按常规态处理。
 * 单测见 test/interaction.test.mjs。
 */
/** 解析中拦截提示的固定文案（不可变更，需求锁定）。 */
export const PARSING_TOAST = '提示词正在生成，请稍后再试！';
/** toast 自动消失时长（毫秒）。 */
export const TOAST_DURATION_MS = 2500;
/**
 * 一次手势的判定（纯函数）。
 * - parsing：任意手势 → 拦截 + 固定文案；不打开菜单。
 * - idle：左键放行业务、右键允许打开自定义菜单；零提示。
 * - 未知状态/手势：按常规态处理（零侵入、零副作用）。
 */
export function gestureDecision(state, gesture) {
    if (state !== 'parsing')
        return { intercepted: false, toast: null, openMenu: gesture === 'contextmenu' };
    if (gesture !== 'click' && gesture !== 'contextmenu')
        return { intercepted: false, toast: null, openMenu: false };
    return { intercepted: true, toast: PARSING_TOAST, openMenu: false };
}
/**
 * toast 去重/替换（纯函数）：单实例。
 * - 同文案（含解析中固定文案重复触发）→ 复用，仅刷新到期时间（不叠加、保持可见）。
 * - 异文案 → 替换并刷新到期时间。
 */
export function nextToast(prev, incoming, now) {
    const deadline = now + TOAST_DURATION_MS;
    if (prev !== null && prev.text === incoming)
        return { text: prev.text, deadline };
    return { text: incoming, deadline };
}
/** 到期判定：now >= deadline 即过期（无槽位视为过期）。 */
export function isToastExpired(deadline, now) {
    return deadline === null || now >= deadline;
}
// ── 常驻任务态 toast（v0.3.0）──
// 优化任务触发即展示「正在优化提示词中…」，不自动消失（无自动关闭计时），
// 结束时机严格绑定优化 Promise 终态：成功 → 短暂「优化完成」后退出；失败/取消 → 关闭后走既有错误提示。
/** 常驻优化 toast 固定文案（需求锁定，不可变更）。 */
export const OPTIMIZING_TOAST = '正在优化提示词中…';
/** 成功态短暂文案。 */
export const DONE_TOAST = '优化完成';
/** 成功态自动退出时长（ms）：仅完成态允许自动退出。 */
export const DONE_TOAST_MS = 2000;
/** 优化开始：任意前置状态 → 优化中（单实例：重复触发先关旧实例再展示新实例，永不堆叠）。 */
export function toastOnOptimizeStart(_prev) {
    return { kind: 'optimizing' };
}
/** 优化终态（成功）：优化中 → 完成态；其余状态保持（idle 不产生完成态）。 */
export function toastOnOptimizeEnd(prev, now) {
    if (prev === null)
        return { kind: 'idle' };
    if (prev.kind !== 'optimizing')
        return prev;
    return { kind: 'done', since: Number.isFinite(now) ? now : 0 };
}
/** 完成态到期判定：仅 done 且距 since ≥ DONE_TOAST_MS；optimizing/idle 永不因计时关闭。 */
export function isDoneToastExpired(state, now) {
    if (state === null || state.kind !== 'done')
        return false;
    const n = Number.isFinite(now) ? now : 0;
    return n - state.since >= DONE_TOAST_MS;
}
// ── 快捷键输入面判定（v0.3.2）──
// 崩溃/失效根因（2026-09-11，升级 DSH 0.1.5-rc.1 后 Shift+Alt+F 完全无响应）：
// 0.1.5 把 composer 从 <textarea> 换成了 Lexical 驱动的 contenteditable div
// （packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx
//  :42-46，性质为 role="textbox" 的 div，带 data-composer-input）。
// 旧判定 `el instanceof HTMLTextAreaElement` 因此恒为 false，守卫在第一步就 return。
// 结论：判定必须按「性质」而非「标签」——新输入面认 data-composer-input，
// 旧输入面（textarea，0.1.5 之前及未来的回退形态）保留 tagName 兜底。
// 本次只放宽输入面判定，不引入任何其他行为变化。
/** 新输入面的稳定钩子（官方组件自己声明的属性，非本插件自造类名）。 */
export const COMPOSER_INPUT_ATTR = 'data-composer-input';
/** 旧输入面标签名（0.1.5 之前的 composer；作为回退保留）。 */
export const COMPOSER_LEGACY_TAG = 'TEXTAREA';
/**
 * 判定聚焦元素是否为 composer 输入面（纯函数，副作用为零）。
 * - 命中 `data-composer-input` → 新输入面（contenteditable div）。
 * - 否则 `tagName === 'TEXTAREA'` → 旧输入面兜底。
 * - null / 非元素 / 形状不符 → 一律 false（未知输入按「不在输入面」处理，零侵入）。
 * @param el - 待判定元素（通常为 `document.activeElement`）。
 */
export function isComposerInputPoint(el) {
    if (el === null || el === undefined)
        return false;
    const candidate = el;
    if (typeof candidate.hasAttribute !== 'function')
        return false;
    if (typeof candidate.tagName !== 'string')
        return false;
    if (candidate.hasAttribute(COMPOSER_INPUT_ATTR))
        return true;
    return candidate.tagName.toUpperCase() === COMPOSER_LEGACY_TAG;
}
//# sourceMappingURL=interaction.js.map