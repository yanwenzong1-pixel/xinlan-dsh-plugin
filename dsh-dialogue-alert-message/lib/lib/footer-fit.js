/**
 * 侧栏底部动作行的空间判定 —— 状态栏「显示全文 / 降级为紧凑图标」的纯函数决策。
 *
 * 【为什么需要】`sidebar.footer.action` 是**一行 flex**（ui-sidebar `SidebarRoot.module.css`
 * `.footerActions { display: flex }`），DSH 内置 Cordis 行的根节点是 `flex: 0 0 auto;
 * width: 100%` ⇒ 整行被它占满，本插件曾被压成 `width: 0px`、文案只剩 20px 残条
 * （2026-10-13 真机实测：footerActions 256px、Cordis 层 256px、本插件 clientWidth 20 /
 * scrollWidth 169）。用户指令：不抢 DSH 自带 UI，改为**实测空间不足就降级**。
 *
 * 无副作用、不依赖 DOM：DOM 侧只负责把 free/required 量出来交给这里判定。
 */
/** 恢复全文所需的额外余量（迟滞带宽，防止在临界点反复切换）。 */
export const FOOTER_FIT_MARGIN_PX = 12;
/**
 * 紧凑图标的宽度。真机几何：`footerActions` 右边界 268、侧栏右边界 280
 * ⇒ 放在行尾时**完全可见**的最大宽度就是 12px（再宽会被侧栏边缘裁掉）。
 */
export const COMPACT_ICON_WIDTH_PX = 12;
/**
 * 计算「显示全文」真正可用的宽度：**始终先扣掉自己紧凑图标的占位**。
 *
 * 为什么必须扣：`free` 若按当前布局直接算，会出现自我循环 —— 我们已展开时会把同行插件挤小
 * （真机实测：Cordis 行被挤到 87px），于是"剩余空间"看起来够，判定就一直维持展开，
 * 等于反过来挤压 DSH 自带 UI。先扣掉自己的 12px 占位，判定就与自身当前形态无关：
 * 放不下 → 收敛回紧凑图标 → 同行恢复原宽 → 判定稳定（不再互相挤压）。
 *
 * @param rowWidth 所在行的可用宽度（clientWidth）
 * @param usedBySiblings 同行其他占位者已占用的宽度合计
 */
export function availableForText(rowWidth, usedBySiblings) {
    if (!Number.isFinite(rowWidth) || !Number.isFinite(usedBySiblings))
        return Number.NaN;
    return rowWidth - usedBySiblings - COMPACT_ICON_WIDTH_PX;
}
/**
 * 是否应降级为紧凑图标。
 * - 非有限值/负值（量不出来）→ 一律降级：宁可只显示图标，也不显示被裁断的残条；
 * - 已在紧凑态 → 需要 `required + FOOTER_FIT_MARGIN_PX` 才恢复全文（迟滞）；
 * - 正常态 → 空间小于 `required` 即降级。
 */
export function shouldCompact(input) {
    const free = Number.isFinite(input?.free) ? input.free : Number.NaN;
    const required = Number.isFinite(input?.required) ? input.required : Number.NaN;
    if (!Number.isFinite(free) || !Number.isFinite(required) || free < 0 || required < 0)
        return true;
    if (input.wasCompact)
        return free < required + FOOTER_FIT_MARGIN_PX;
    return free < required;
}
//# sourceMappingURL=footer-fit.js.map