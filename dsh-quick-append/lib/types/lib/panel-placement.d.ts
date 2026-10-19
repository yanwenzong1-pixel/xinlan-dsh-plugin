/**
 * 「快捷追加文案」面板的放置计算（纯函数，单测见 test/panel-placement.test.mjs）。
 *
 * 【为什么有它】原实现把面板放在 composer 内部：`position: absolute; right: 0; bottom: 32px;
 * z-index: 100`。真机实测（DSH 0.2.1-rc.2，2026-10-19）两个后果：
 *   ① 面板被困在 composer 的层叠上下文里 ⇒ 会被边栏 / 应用浮层（overlayLayer z=20）盖住；
 *   ② 窄窗（900×700）实测 left = -91 ⇒ 面板左侧整块跑到屏幕外，点不到。
 * 修法：与菜单/弹窗同一条路 —— portal 到 body + `position: fixed`，位置由本叶子算：
 * 右对齐触发区、底边贴在触发区上方（保持旧视觉关系），并**在视口内双向夹取**。
 *
 * 层级不在这里决定：面板继续用既有 `.dsh-qa-popover` 的 `z-index: 100`；
 * 挂到 body 之后它才真正参与根层叠（100 > 应用 overlayLayer 的 20 / tabCell 的 10）。
 */
/** 面板设计宽度（与旧 CSS `width: 320px` 一致）。 */
export declare const PANEL_WIDTH = 320;
/** 与视口边缘保留的安全距离。 */
export declare const PANEL_MARGIN = 8;
/** 面板底边相对触发区底边的上抬量（旧实现 `bottom: 32px` 的等价换算）。 */
export declare const PANEL_OFFSET_ABOVE_TRIGGER = 32;
/** 极窄视口下的宽度下限（再窄就夹到可用宽度，绝不产生负宽度）。 */
export declare const PANEL_MIN_WIDTH = 160;
export interface PanelAnchor {
    /** 触发区（两个按钮的容器）右边界，视口坐标。 */
    right: number;
    /** 触发区底边，视口坐标。 */
    bottom: number;
    viewportWidth: number;
    viewportHeight: number;
}
export interface PanelPlacement {
    left: number;
    /** 面板用 bottom 定位（与旧实现一致：贴在触发区上方），不设 top。 */
    top: null;
    bottom: number;
    width: number;
}
/**
 * 算出面板的 fixed 放置。
 * - 宽度：`min(PANEL_WIDTH, 可用宽度)`，下限 PANEL_MIN_WIDTH（可用宽度更小时以可用宽度为准）；
 * - 左边界：右对齐触发区后夹进 `[margin, vw - width - margin]`；
 * - bottom 偏移：`vh - (触发区底边 - OFFSET)`，夹进 `[margin, vh - margin]`。
 * 任何非有限输入都退回安全值（宁可靠边显示，也不产出 NaN 样式）。
 */
export declare function panelPlacementOf(anchor: PanelAnchor): PanelPlacement;
