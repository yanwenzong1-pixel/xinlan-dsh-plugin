/**
 * @dsh-external/dsh-quick-append — client half.
 * Registers an icon button in the composer's right tool row
 * (`conversation.input.right`).
 *
 * Left click:
 * - LLM优化 off: append preset text (two newlines before) to the draft.
 * - LLM优化 on: ask the host LLM endpoint to optimize the draft with recent
 *   conversation context, then append the preset text after the optimized
 *   prompt.
 * Right click: open an AeroLoad-style dark popover to edit/save the preset.
 *
 * 解析中交互（v0.2.0）：最近一次 LLM 解析任务运行期间（请求已发出未返回/流式
 * 未结束），左/右键与快捷键一律拦截业务动作并提示固定文案
 * 「提示词正在生成，请稍后再试！」（toast 单实例、自动消失、重复点击去重）；
 * 按钮保持正常可点击外观（无 disabled/loading 感知）；任务结束后立即恢复原语义。
 * 判定逻辑见 src/lib/interaction.ts（纯函数 + 单测）。
 *
 * v0.3.2 修复：快捷键 Shift+Alt+F 在 DSH 0.1.5-rc.1 上静默失效。
 * 根因——0.1.5 把 composer 从 <textarea> 换成 Lexical contenteditable div
 * （ComposerContentEditable.tsx:42-46，带 data-composer-input），
 * 旧守卫 `activeElement instanceof HTMLTextAreaElement` 恒为 false，
 * 事件在第一步就被 return 掉。现按「性质」判定（data-composer-input），
 * 并保留 textarea 兜底以兼容旧输入面；纯函数 + 回归测试见
 * src/lib/interaction.ts 与 test/shortcut-target.test.mjs。
 *
 * v0.5.0 新增「预存命令」按钮（需求：组件扩展——新增按钮与指令管理与插入能力）：
 * - 位置：「点击追加」左侧 5px（同一 flex 容器的 gap，不用绝对定位）；仅扳手图标、
 *   无文字；尺寸/圆角/内边距/颜色与「点击追加」共用同一份样式常量（ICON_BUTTON_STYLE）。
 * - 左键：在按钮正上方 5px 拉起菜单（上不足→翻转下方，四向限位，见叶子 dropUpLineFor）；
 *   点条目把正文插入输入区并把光标落到插入文本末尾；无数据时不展示空菜单，改弹引导 toast。
 * - 右键：阻止原生菜单并弹出编辑弹窗（列表 + 表单，可增/改/删；删除二次确认；
 *   关闭前对未保存变更先问）；风格复用「点击追加」右键弹窗的同一套令牌与类
 *   （.dsh-qa-popover / .dsh-qa-title / .dsh-qa-textarea / .dsh-qa-btn / .dsh-qa-footer）。
 * - 浮层经 react-dom 的 createPortal 挂到 body（绕开 composer 的 overflow/backdrop-filter 裁剪），
 *   卸载时收回宿主节点与全部全局监听；同一时刻只允许一个浮层展开（与既有右键弹窗互斥）。
 * - 端口/键/上限/层级/文案全部来自 src/lib/command-store.ts（零依赖叶子，纯函数 + 单测）。
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  gestureDecision,
  isToastExpired,
  nextToast,
  TOAST_DURATION_MS,
  OPTIMIZING_TOAST,
  DONE_TOAST,
  DONE_TOAST_MS,
  toastOnOptimizeStart,
  toastOnOptimizeEnd,
  isDoneToastExpired,
  isComposerInputPoint,
  type ToastSlot,
  type OptimizeToastState,
} from '../lib/interaction.js'
import {
  type OptimizeImagePayload,
} from '../lib/optimize.js'
import {
  planImage,
  buildPreprocessNote,
  REENCODE_MAX_DIMENSION,
  REENCODE_QUALITY,
  type ImageFileLike,
} from '../lib/images.js'
// 「追加文案」的按工作区隔离存储：结构、键名、脏数据收敛、失败文案全在这个叶子里（纯函数 + 单测）。
import {
  PRESET_STORE_KEY,
  LEGACY_PRESET_KEY,
  NO_WORKSPACE_KEY,
  DEFAULT_APPEND_TEXT,
  PRESET_WRITE_COALESCE_MS,
  PRESET_SAVED_TEXT,
  parsePresetStore,
  serializePresetStore,
  presetOf,
  withPreset,
  workspaceKeyOf,
  migrateLegacyPreset,
  createCoalescingWriter,
  presetWriteFailedText,
  type PresetStore,
  type CoalescingWriter,
} from '../lib/preset-store.js'
// 「预存命令」的键/上限/层级/文案/定位/二次确认：全部在这个零依赖叶子里（纯函数 + 单测）。
import {
  COMMAND_STORE_KEY,
  COMMAND_TITLE_MAX,
  COMMAND_CONTENT_MAX,
  COMMAND_MENU_WIDTH,
  COMMAND_MENU_HEIGHT,
  COMMAND_DIALOG_WIDTH,
  COMMAND_DIALOG_HEIGHT,
  COMMAND_EMPTY_TOAST,
  COMMAND_SAVED_TEXT,
  COMMAND_DELETED_TEXT,
  DELETE_CONFIRM_MS,
  commandsOf,
  commandOf,
  parseCommandStore,
  serializeCommandStore,
  createCommandId,
  withCommandAdded,
  withCommandUpdated,
  withCommandRemoved,
  validateCommandDraft,
  commandDraftOf,
  commandDraftDirty,
  insertionText,
  commandDamagedText,
  commandWriteFailedText,
  dropUpLineFor,
  centerPlacementOf,
  nextDeleteConfirm,
  isDeleteConfirmActive,
  type CommandDraft,
  type CommandStore,
  type StoredCommand,
  type DeleteConfirmState,
} from '../lib/command-store.js'

type ClientContext = {
  slots: any
  get?: (name: string) => unknown
}

/** 会话服务最小接口（结构兼容 client 侧 conversation 服务，取输入区图片 File）。 */
interface ConversationServiceLike {
  draftImages(ids: readonly string[]): readonly { file: File }[]
}

export const inject = ['slots', 'conversation']

// 追加文案的存储键**不在这里**：它随结构一起在 src/lib/preset-store.ts（单一来源，防两处漂移）。
// 下面两个开关是全局偏好（不属于"某个工作区的追加文案"），保持原有的单键存储。
const LLM_KEY = 'dsh-quick-append.llm'
const GOAL_KEY = 'dsh-quick-append.goal'
const SKIN_ID = 'dsh-quick-append-skin'

/** apply 时捕获的会话服务（卸载/热重载由模块级变量重新赋值，组件卸载即释放）。 */
let conversationService: ConversationServiceLike | undefined

// ── 「预存命令」按钮的标识 / 图标 / 共享样式（v0.5.0）───────────────────────
/** 按钮名称：title 与 aria-label 必须同源（图标按钮的可访问名唯一来源，需求 2.1）。 */
const COMMAND_LABEL = '预存命令'
/** 「点击追加」的闪电图标路径（原内联字面量，抽成常量只为让两个图标共用同一份 svg 属性）。 */
const BOLT_PATH = 'M13 2 3 14h8l-1 8 11-12h-8l1-8z'
/** 扳手图标（24 格坐标系；描边风格与尺寸由 ICON_SVG_PROPS 统一，需求 2.2）。 */
const WRENCH_PATH = 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'
/**
 * 两个按钮**唯一的**样式来源（需求 2.3：尺寸、圆角、内边距、各交互态、颜色、过渡必须一致）。
 * 既有按钮本来没有 hover/active/disabled 专属样式 —— 所以"一致"的正确做法是
 * 不新增任何单边样式，而不是给新按钮补一套好看的状态。
 */
const ICON_BUTTON_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: '1px solid var(--al-border, rgba(120,140,170,0.18))',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--al-text, #E6E9EF)',
  cursor: 'pointer',
}
/** 两个图标**唯一的** svg 属性来源（需求 2.2：尺寸与线宽风格一致）。 */
const ICON_SVG_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}
/**
 * 弹窗高度上限：规范 sf-modal-panel 要求 `max-height: 86vh`（小屏不溢出视口），
 * 像素上限取叶子常量 —— 定位估算与实际样式同源，避免"估算 460、实际 86vh"导致越界。
 */
const DIALOG_MAX_HEIGHT = 'min(86vh, ' + String(COMMAND_DIALOG_HEIGHT) + 'px)'

// 旧版全局默认文案常量 DEFAULT_PRESET 已移入 src/lib/preset-store.ts（DEFAULT_APPEND_TEXT）。


const SKIN_CSS = `
.dsh-qa-popover {
  position: absolute;
  right: 0;
  bottom: 32px;
  z-index: 100;
  width: 320px;
  padding: 14px;
  box-sizing: border-box;
  color: var(--al-text, #E6E9EF);
  background-color: var(--al-card, rgba(22,28,40,0.92));
  background-image:
    linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0) 38%),
    radial-gradient(rgba(255,255,255,0.012), rgba(120,150,190,0.01)),
    radial-gradient(rgba(255,255,255,0.012), rgba(120,150,190,0.01));
  background-size: 100% 100%, 3px 3px, 3px 3px;
  background-repeat: no-repeat, repeat, repeat;
  backdrop-filter: blur(var(--al-blur, 12px));
  -webkit-backdrop-filter: blur(var(--al-blur, 12px));
  border: 1px solid var(--al-border, rgba(120,140,170,0.18));
  border-radius: var(--al-radius, 12px);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.05),
    0 8px 24px rgba(5,8,12,0.5),
    0 16px 48px rgba(5,8,12,0.35);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
.dsh-qa-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--al-text2, #9AA3B2);
}
.dsh-qa-textarea {
  scrollbar-width: none;
  -ms-overflow-style: none;
  width: 100%;
  box-sizing: border-box;
  min-height: 108px;
  resize: vertical;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 1.55;
  color: var(--al-text, #E6E9EF);
  background: var(--al-bgDeep, #090C11);
  border: 1px solid var(--al-border, rgba(120,140,170,0.18));
  border-radius: 8px;
  outline: none;
}
.dsh-qa-textarea::-webkit-scrollbar {
  display: none;
}
.dsh-qa-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  /* 回归防护：footer 曾因内部塞入两个定宽设置行（各 56px 标签 + flex:1 输入）
     而横向溢出 320px 弹窗，把「取消/保存」按钮挤出窗口之外。
     现在设置行已移除，这里再加一层约束：分组 + 允许换行 + 子项不被压缩。 */
  flex-wrap: wrap;
  min-width: 0;
}
.dsh-qa-toggles {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  min-width: 0;
}
.dsh-qa-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--al-text2, #9AA3B2);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.dsh-qa-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-left: auto;
  flex: none;
}
/* 按钮 = 规范 ct-button 配方（JSON-CSS-SPEC）：冷灰半透底 + 冷灰边 + 主文字 +
   0.15s 过渡；hover 只提亮（不位移不弹跳）；键盘焦点给可见环（鼠标点击不出环）。 */
.dsh-qa-btn {
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border-radius: 8px;
  border: 1px solid var(--al-border, rgba(120,140,170,0.18));
  background: rgba(120,140,170,0.08);
  color: var(--al-text, #E6E9EF);
  cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.dsh-qa-btn:hover {
  border-color: var(--al-borderHi, rgba(140,164,200,0.36));
  background: rgba(120,140,170,0.14);
}
.dsh-qa-btn:active {
  background: rgba(120,140,170,0.18);
}
.dsh-qa-btn:focus-visible {
  outline: 2px solid var(--al-info, #64B5F6);
  outline-offset: 1px;
}
/* 主按钮 = 规范 ct-button-primary（accent 底 + 语义黑字 #0A0E13）：
   "关键动作"在生态里是荧光绿，不是黑底 —— 黑底白字是筛选按钮（ct-filter-all）的语义。 */
.dsh-qa-btn-primary {
  border: none;
  background: var(--al-accent, #88DD44);
  color: #0A0E13;
  font-weight: 600;
  transition: border-color .15s, background .15s, color .15s;
}
.dsh-qa-btn-primary:hover {
  background: var(--al-accent, #88DD44);
  filter: brightness(1.06);
}
.dsh-qa-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
}
.dsh-qa-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--al-text2, #9AA3B2);
  white-space: nowrap;
}
.dsh-qa-opt.done {
  color: var(--al-accent, #88DD44);
}
.dsh-qa-opt-spin {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--al-border, rgba(120,140,170,0.18));
  border-top-color: var(--al-accent, #88DD44);
  animation: dsh-qa-spin 0.9s linear infinite;
  flex: none;
}
@keyframes dsh-qa-spin {
  to { transform: rotate(360deg); }
}
/* 追加文案的落点说明行（2026-09-23）：左边显示"这次编辑会写进哪个工作区"（隔离可见、可核对），
   右边「填入默认文案」把叶子里的默认文案一键填回 —— 新建工作区默认空白（需求 4），但不必手打。 */
.dsh-qa-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--al-text2, #9AA3B2);
}
.dsh-qa-meta-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-qa-meta .dsh-qa-btn {
  flex: none;
  padding: 3px 10px;
  font-size: 11px;
}
/* 曾用于「优化模型 / 思考强度」设置行的样式（定宽标签 + 自适应输入）。
   控件已移除（模型与思考强度改为宿主策略），故连同样式一并删除：
   它们正是弹窗横向溢出的根因，留着只会诱使后来者再把设置行塞回 footer。 */

/* ── 「预存命令」按钮对（v0.5.0）──
   5px 间距由同一 flex 容器的 gap 提供（需求 2.1/2.3）：不用绝对定位 ⇒
   不挤压、不换行、不遮挡既有按钮；两个按钮的尺寸/边框/颜色走同一份内联常量。 */
.dsh-qa-tools {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
}
/* 两个图标按钮的交互反馈由**一条规则同时命中**（顺序写在一起，天然一致）：
   只变边框/底色，不位移不弹跳（规范 §10.7.2 hover 只提亮透明度）。 */
.dsh-qa-tools button {
  transition: border-color .15s, background .15s, color .15s;
}
.dsh-qa-tools button:hover {
  border-color: var(--al-borderHi, rgba(140,164,200,0.36));
  background: rgba(120,140,170,0.08);
}
.dsh-qa-tools button:focus-visible {
  outline: 2px solid var(--al-info, #64B5F6);
  outline-offset: 1px;
}
/* portal 宿主节点：自身不参与布局、不拦截指针（面板自己 fixed 定位到视口坐标）。 */
.dsh-qa-portal {
  position: static;
  width: 0;
  height: 0;
}
/* 遮罩 = 规范 §10.7.3 精确值（rgba(9,12,17,0.72) + blur(6px) 双写）：
   遮罩只负责压暗背景，不套卡面配方（无边框/圆角/阴影）。层级 110：高于输入区与既有弹层 100。 */
.dsh-qa-mask {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(9,12,17,0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
/* 左键上拉菜单：复用 .dsh-qa-popover 的卡面配方（背景/高光/噪点/磨砂/阴影/字体），
   这里只覆盖定位方式、层级与内边距 —— 菜单容器按规范 sf-menu-panel：小圆角 10 / 紧凑内边距 / min-width 132。
   （宽度与最大高度由内联样式来自叶子常量。） */
.dsh-qa-menu {
  position: fixed;
  right: auto;
  bottom: auto;
  z-index: 110;
  min-width: 132px;
  padding: 6px;
  border-radius: 10px;
}
/* 面板头部（菜单与弹窗共用一套）：标题左、计数右，底部 1px 分割线（骨架规范）。
   用 padding-bottom 长写法，两处的"底部 10px"是同一个声明来源。 */
.dsh-qa-menu-head,
.dsh-qa-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--al-border, rgba(120,140,170,0.18));
}
/* 菜单头在小面板里需要左右内边距（弹窗头由弹窗自身的 padding 提供）。 */
.dsh-qa-menu-head {
  padding: 4px 8px 10px;
}
.dsh-qa-head-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--al-text, #E6E9EF);
}
.dsh-qa-head-count {
  flex: none;
  font-size: 11px;
  color: var(--al-text3, #606B7C);
  font-variant-numeric: tabular-nums;
}
.dsh-qa-menu-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  margin-top: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 滚动条与既有输入框同口径（隐藏、不占位），需求 5.2 + 规范 ct-scrollbar-hidden */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dsh-qa-menu-list::-webkit-scrollbar {
  display: none;
}
/* 菜单项 = 规范 ct-menu-item 配方：7px 12px / 圆角 7 / 600 字重；
   hover 与"当前高亮项"用同一套淡紫底 + 提亮文字（tk-violet = 选中/激活语义）。 */
.dsh-qa-menu-item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 12px;
  text-align: left;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--al-text2, #9AA3B2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
  transition: background .15s, color .15s;
  /* 标题过长省略号截断（需求 3.2）；完整标题由 title 属性兜底 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-qa-menu-item:hover,
.dsh-qa-menu-item.on {
  background: rgba(147,136,255,0.14);
  color: var(--al-text, #E6E9EF);
}
.dsh-qa-menu-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 8px 4px 2px;
  border-top: 1px solid var(--al-border, rgba(120,140,170,0.18));
  font-size: 11px;
  color: var(--al-text3, #606B7C);
}
/* 编辑弹窗面板：同一卡面 + 更高层级（111 必须 > 遮罩 110，否则第一下点在遮罩上）。
   骨架按 sp-window-skeleton：头部（标题/计数 + 1px 分割线）→ 内容区 → 底部操作行；
   滚动按 ct-scrollbar-hidden（隐藏但可滚 + overscroll 不外溢）。 */
.dsh-qa-dialog {
  position: fixed;
  right: auto;
  bottom: auto;
  z-index: 111;
  padding: 14px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dsh-qa-dialog::-webkit-scrollbar {
  display: none;
}
/* 内容区分组节奏：列表 → 表单 → （可选）确认行，组间距 10px（8px 栅格）。 */
.dsh-qa-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 12px;
}
.dsh-qa-cmd-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 150px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dsh-qa-cmd-list::-webkit-scrollbar {
  display: none;
}
/* 列表行：hover 才浮起淡灰，正在编辑的那条用淡紫底 + 紫边（与菜单高亮同一语义，一眼可辨）。 */
.dsh-qa-cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: background .15s, border-color .15s;
}
.dsh-qa-cmd-row:hover {
  background: rgba(120,140,170,0.10);
}
.dsh-qa-cmd-row.on {
  background: rgba(147,136,255,0.14);
  border-color: rgba(147,136,255,0.36);
}
.dsh-qa-cmd-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--al-text, #E6E9EF);
}
/* 行内操作按钮：按规范 ct-button-capsule 的几何（胶囊 999px / 3px 10px / 11px 600），
   与弹窗主操作（ct-button 方角 8px）形成"行内轻操作 vs 主操作"的层级差。 */
.dsh-qa-cmd-row .dsh-qa-btn {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
}
/* 危险动作（删除 / 放弃修改）：danger 令牌 + 轻红底，hover 才补红底（与普通按钮同动效时长）。 */
.dsh-qa-btn-danger {
  color: var(--al-danger, #F25056);
  border-color: rgba(242,80,86,0.32);
}
.dsh-qa-btn-danger:hover {
  background: rgba(242,80,86,0.14);
  border-color: rgba(242,80,86,0.32);
}
/* 表单：字段分组（label + 控件）纵向 6px，字段之间 8px —— 标签用弱化小字 + 字距，
   控件按规范 ct-input（7px 10px / 13px / bgDeep 底 / 冷灰边 / focus info + 2px 光环）。 */
.dsh-qa-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-qa-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsh-qa-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: .02em;
  color: var(--al-text2, #9AA3B2);
}
.dsh-qa-label .dsh-qa-head-count {
  color: var(--al-text3, #606B7C);
}
.dsh-qa-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--al-text, #E6E9EF);
  background: var(--al-bgDeep, #090C11);
  border: 1px solid var(--al-border, rgba(120,140,170,0.18));
  border-radius: 8px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.dsh-qa-form .dsh-qa-textarea {
  min-height: 96px;
  font-size: 13px;
  line-height: 1.6;
  /* 模态里的输入面不给缩放把手：右下角那个小三角是"没打磨过"的典型特征，
     且拖拽只改本框高度、对模态整体布局没有意义（要更大空间请直接滚动/最大化窗口）。 */
  resize: none;
  transition: border-color .15s, box-shadow .15s;
}
/* 输入框聚焦态统一（需求 5.2）：既有 textarea 与新增 input 共用一条规则 ——
   若只给新输入框加聚焦态，两个输入框就会长得不一样。口径取规范 ct-input
   （bgDeep 底 + border 边 + focus info 边 + 2px 光环 0.25）。 */
.dsh-qa-textarea:focus,
.dsh-qa-input:focus {
  border-color: var(--al-info, #64B5F6);
  box-shadow: 0 0 0 2px rgba(100,181,246,0.25);
}
/* 空态（无预存命令）= 规范 ct-empty-state：弱化文字居中，不画卡片、不画边框。 */
.dsh-qa-empty {
  padding: 20px 8px;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: var(--al-text3, #606B7C);
}
/* 弹窗里的按钮统一按 ct-button 尺寸（弹窗比 320px 的小弹层宽，5px 内边距会显得局促）。 */
.dsh-qa-dialog .dsh-qa-btn {
  padding: 7px 14px;
}
/* 底部操作行与内容分离：顶部 1px 分割线 + 12px 呼吸。 */
.dsh-qa-dialog .dsh-qa-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--al-border, rgba(120,140,170,0.18));
}
.dsh-qa-dialog .dsh-qa-footer .dsh-qa-meta-text {
  font-size: 11px;
  color: var(--al-text3, #606B7C);
}
/* 校验失败提示：与生态错误态同一配方（danger 字 + 半透红底 + 红边）。 */
.dsh-qa-err {
  margin-top: 6px;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--al-danger, #F25056);
  background: rgba(242, 80, 86, 0.14);
  border: 1px solid rgba(242, 80, 86, 0.30);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-all;
}
/* 未保存变更的二次确认行（需求 4.5：默认提示确认放弃）。 */
.dsh-qa-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(242, 80, 86, 0.10);
  border: 1px solid rgba(242, 80, 86, 0.30);
  border-radius: 8px;
}
.dsh-qa-confirm .dsh-qa-meta-text {
  color: var(--al-danger, #F25056);
}
`

type InputLike = { draft: string; imageIds?: readonly string[] }
type QuickAppendProps = {
  useInput: (selector: (state: InputLike) => InputLike) => InputLike
  useSession: (selector: (state: any) => any) => any
  useWorkspaces: (selector: (state: any) => any) => any
  inputActions: { setDraft(text: string): void }
  /**
   * 插槽标准 props 里的当前会话 id（`conversation.input.right` 提供）。
   * 用途：反查"当前工作区"——工作区列表里 `sessionIds` 含该会话的那一条（与 DSH 自己的口径一致）。
   */
  sessionId?: string
}

function ensureSkinStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(SKIN_ID) !== null) return
  const style = document.createElement('style')
  style.id = SKIN_ID
  style.textContent = SKIN_CSS
  document.head.appendChild(style)
}

// ── 「追加文案」的按工作区隔离持久化（2026-09-23）─────────────────────────────
// 结构 / 键名 / 脏数据收敛 / 失败文案全部在 src/lib/preset-store.ts（纯函数 + 单测）；
// 这里只做浏览器侧 I/O 与一层内存缓存：readPreset 在渲染路径上，每次 JSON.parse 整包不划算。
// 缓存失效点只有两处：本页写入成功（就地更新）、另一个标签页改了配置（storage 事件置空）。
let cachedPresetStore: PresetStore | null = null
/** 旧版全局键只迁移一次：一次渲染里可能多处读取（渲染 + 打开弹窗），不得重复迁移。 */
let legacyMigrationDone = false

function readRawValue(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function currentPresetStore(): PresetStore {
  if (cachedPresetStore === null) cachedPresetStore = parsePresetStore(readRawValue(PRESET_STORE_KEY))
  return cachedPresetStore
}

/** 落盘整包并更新缓存；**失败直接抛**（由合并写入器的 onError 转成可见提示，绝不静默吞掉）。 */
function commitPresetStore(store: PresetStore): void {
  localStorage.setItem(PRESET_STORE_KEY, serializePresetStore(store))
  cachedPresetStore = store
}

/**
 * 旧版全局配置 → 当前工作区（一次性）。
 * 顺序要紧：**先落盘成功，再删旧键**。反过来（先删后写）一旦落盘失败，用户的老文案就永久没了。
 */
function migrateLegacyPresetOnce(workspaceKey: string): void {
  if (legacyMigrationDone) return
  legacyMigrationDone = true
  const legacyRaw = readRawValue(LEGACY_PRESET_KEY)
  const migration = migrateLegacyPreset(currentPresetStore(), legacyRaw, workspaceKey)
  if (migration.migrated) {
    try {
      commitPresetStore(migration.store)
    } catch {
      return // 没写成功就保留旧键，下次启动重试（不删 = 不丢）
    }
  }
  if (migration.dropLegacy) {
    try { localStorage.removeItem(LEGACY_PRESET_KEY) } catch { /* 删不掉只会导致下次再迁一次（同值，幂等） */ }
  }
}

/**
 * 读某个工作区的追加文案；没有该工作区的条目 → 空串（惰性初始化，读取本身不产生写入）。
 * 注意副作用：**首次调用**会把旧版全局键迁给该工作区（一次性、幂等，见上）。
 * 为什么落在读取路径而不是 useEffect：effect 在首帧之后才跑，那一帧 preset 还是空的，
 * 用户此刻点「追加」会拿到空文案并提示去设置 —— 那是升级瞬间的假故障。
 */
function readPreset(workspaceKey: string): string {
  migrateLegacyPresetOnce(workspaceKey)
  return presetOf(currentPresetStore(), workspaceKey)
}

// ── 「预存命令」的浏览器侧 I/O（结构/键名/校验全在 src/lib/command-store.ts）────
// 与追加文案同口径：一层内存缓存（读取在渲染路径上）+ 落盘失败**抛给调用方**转成可见提示。
// 为什么不做合并写入器：命令只在用户点「新增/保存/删除」时写，本来就是低频显式动作，
// 直接写盘能让成功/失败提示与这一笔操作严格对应（不需要 250ms 窗口）。
let cachedCommandStore: CommandStore | null = null
/** 解析时发现的损坏条数（null = 本次没发现）；由组件在 effect 里一次性转成 toast。 */
let pendingCommandDamage: number | null = null

function currentCommandStore(): CommandStore {
  if (cachedCommandStore === null) {
    const parsed = parseCommandStore(readRawValue(COMMAND_STORE_KEY))
    cachedCommandStore = parsed.store
    if (parsed.damaged) pendingCommandDamage = parsed.dropped
  }
  return cachedCommandStore
}

/** 落盘整包并更新缓存；**失败直接抛**（由调用方转成可见提示，绝不静默吞掉）。 */
function commitCommandStore(store: CommandStore): void {
  localStorage.setItem(COMMAND_STORE_KEY, serializeCommandStore(store))
  cachedCommandStore = store
}

function readCommands(): readonly StoredCommand[] {
  return commandsOf(currentCommandStore())
}

function commandIdsOf(store: CommandStore): string[] {
  return commandsOf(store).map((command) => command.id)
}

/**
 * 把焦点与光标送回输入区**末尾**（需求 3.3：插入后用户可直接发送）。
 * 0.1.5 起 composer 是 Lexical 的 contenteditable div（带 data-composer-input），
 * 旧形态是 textarea；两种都认，认不出来就静默返回（正文已经写进去了，焦点没落位不算失败）。
 */
function focusComposerEnd(): void {
  try {
    const el = (document.querySelector('[data-composer-card] [data-composer-input]')
      ?? document.querySelector('[data-composer-input]')) as (HTMLElement & { setSelectionRange?: (a: number, b: number) => void }) | null
    if (el === null) return
    if (typeof el.focus === 'function') el.focus()
    // 旧输入面：直接把光标设到末尾。
    if (typeof el.setSelectionRange === 'function' && typeof (el as any).value === 'string') {
      const end = String((el as any).value).length
      el.setSelectionRange(end, end)
      return
    }
    // 新输入面（contenteditable）：选区块折叠到内容末尾。
    const selection = document.getSelection === undefined ? null : document.getSelection()
    if (selection === null) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  } catch { /* 焦点/光标落位失败不影响已写入的正文 */ }
}

/** 面板定位样式**唯一出口**：只给 left + (top|bottom) 之一，另一个显式 auto（否则会互相撑变形）。 */
function layerStyleOf(line: { left: number; top: number | null; bottom: number | null }, width: number, maxHeight: number | string): Record<string, unknown> {
  return {
    right: 'auto',
    left: line.left,
    top: line.top === null ? 'auto' : line.top,
    bottom: line.bottom === null ? 'auto' : line.bottom,
    width,
    maxHeight,
  }
}

function readLlmEnabled(): boolean {
  try { return localStorage.getItem(LLM_KEY) !== '0' } catch { return true }
}

function writeLlmEnabled(value: boolean): void {
  try { localStorage.setItem(LLM_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

function readGoalMode(): boolean {
  try { return localStorage.getItem(GOAL_KEY) !== '0' } catch { return true }
}

function writeGoalMode(value: boolean): void {
  try { localStorage.setItem(GOAL_KEY, value ? '1' : '0') } catch { /* ignore */ }
}

// 模型与思考强度已改为**宿主策略**（deepseek-flash / max），
// 客户端不再读写 localStorage、也不再发送这两个字段 —— 详见 lib/optimize.ts 的契约说明。

function nodeText(node: any): string | null {
  if (!node) return null
  if (node.kind === 'user') {
    const blocks = Array.isArray(node.content) ? node.content : []
    return blocks.map((b: any) => b.type === 'text' ? b.text : '').join(' ').trim() || null
  }
  if (node.kind === 'assistant') {
    const blocks = Array.isArray(node.blocks) ? node.blocks : []
    return blocks.map((b: any) => b.type === 'text' ? b.text : '').join(' ').trim() || null
  }
  return null
}

function buildRecentContext(session: any): string {
  const nodes: any[] = Array.isArray(session?.nodes) ? session.nodes
    : (Array.isArray(session?.chat?.legacy?.nodes) ? session.chat.legacy.nodes : [])
  const recent = nodes.filter((n) => n.kind === 'user' || n.kind === 'assistant').slice(-6)
  return recent
    .map((n) => {
      const text = nodeText(n)
      if (!text) return null
      return `${n.kind === 'user' ? 'User' : 'Assistant'}: ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

// ── 图片发送前校验与轻量压缩（v0.3.0）──
// 决策口径见 src/lib/images.ts（可单测）；此处仅执行浏览器侧编码：
// keep → 原样 base64；reencode → createImageBitmap + canvas 受限尺寸 + JPEG(toBlob)。

async function bytesToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function reencodeToJpeg(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, REENCODE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', REENCODE_QUALITY))
    if (blob === null) return null
    return bytesToBase64(await blob.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * 发送前预处理：逐张按决策执行；失败单张剔除（不阻塞其余）；
 * 全部失败 → images=[] + 降级提示（宿主按纯文本优化并在结果标注）。
 */
async function prepareImages(attachments: readonly { file: File }[]): Promise<{ images: OptimizeImagePayload[]; note: string | null }> {
  const images: OptimizeImagePayload[] = []
  for (const attachment of attachments) {
    const plan = planImage(attachment.file as unknown as ImageFileLike)
    if (!plan.ok) continue
    let data: string | null
    if (plan.action === 'keep') {
      data = await bytesToBase64(await attachment.file.arrayBuffer())
    } else {
      data = await reencodeToJpeg(attachment.file)
    }
    if (data === null || data === '') continue
    images.push({
      mediaType: plan.action === 'keep' ? plan.mediaType : 'image/jpeg',
      data,
      ...(attachment.file.name !== '' ? { name: attachment.file.name } : {}),
    })
  }
  return { images, note: buildPreprocessNote(attachments.length, images.length) }
}

function QuickAppendButton({ useInput, useSession, useWorkspaces, inputActions, sessionId }: QuickAppendProps) {
  const [toastSlot, setToastSlot] = useState<ToastSlot | null>(null)
  const [editing, setEditing] = useState(false)
  const [presetDraft, setPresetDraft] = useState('')
  const [llmEnabled, setLlmEnabled] = useState(true)
  const [goalMode, setGoalMode] = useState(true)
  // 多标签页同步用：storage 事件里自增它 ⇒ 触发这次渲染；preset 在渲染体里重读，不需要参与计算。
  const [storeRevision, setStoreRevision] = useState(0)
  // v0.3.1：常驻任务态 toast（不自动消失；终态驱动）。模型/思考档位控件已移除（宿主策略）。
  const [optimizeToast, setOptimizeToast] = useState<OptimizeToastState | null>(null)
  // 解析中同步锁：ref 而非 state —— 双击/快捷键同帧内第二次点击也能立即拦截（不经渲染），
  // 且界面不呈现任何 disabled/loading 视觉（需求：解析中保持正常可点击外观）。
  const parsingRef = useRef(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  // 优化请求取消句柄：组件卸载/会话切换时 abort（任务随 toast 一起终止，不留孤儿任务）。
  const optimizeAbortRef = useRef<AbortController | null>(null)
  // 本次编辑所属的工作区键：**打开弹窗时捕获**，保存时用它提交 ——
  // 这样"编辑期间切换了工作区"也只会写回它原本那个工作区（需求 3：写入必须带明确的工作区上下文）。
  const editKeyRef = useRef('')
  // 合并写入器（单实例）：窗口内对同一工作区的多次提交只落一次盘。
  const writerRef = useRef<CoalescingWriter | null>(null)
  // 写入结果的唯一提示出口：用 ref 承接最新 showToast，避免把写入器建在 effect 里（那会反复重建）。
  const noticeRef = useRef<(text: string) => void>(() => {})

  // ── 「预存命令」状态（v0.5.0）：菜单开关 / 弹窗开关 / 当前编辑项 / 列表 / 错误态 ──
  // 列表与脏数据的唯一来源是叶子 + 模块级缓存；这里只放"可预测的界面状态"（需求 6.2）。
  const [commandRevision, setCommandRevision] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuLine, setMenuLine] = useState<{ left: number; top: number | null; bottom: number | null } | null>(null)
  const [menuActive, setMenuActive] = useState(0)
  const [commandDialogOpen, setCommandDialogOpen] = useState(false)
  const [dialogPlacement, setDialogPlacement] = useState<{ left: number; top: number } | null>(null)
  const [commandDraft, setCommandDraft] = useState<CommandDraft>({ title: '', content: '' })
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [discardIntent, setDiscardIntent] = useState<'close' | 'cancel'>('close')
  // portal 宿主节点：首次挂载后才有值（在此之前不打开任何浮层，见各自的 effect 依赖）。
  const [layerHost, setLayerHost] = useState<HTMLElement | null>(null)

  // 浮层引用（点外部关闭、焦点回位用）
  const commandButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuLayerRef = useRef<HTMLDivElement | null>(null)
  const dialogLayerRef = useRef<HTMLDivElement | null>(null)
  const layerHostRef = useRef<HTMLElement | null>(null)
  /** 光标落位计时器（插入正文后异步落位，卸载时必须收回）。 */
  const caretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const input = useInput((s) => s)
  const session = useSession((s) => s)
  const workspaces = useWorkspaces((s) => s)
  // 当前会话 id：优先用插槽标准 props（最精确）；缺失时回落到会话快照自带的 sessionId。
  const sessionIdOfSnapshot = useSession((s: any) => (s === null || s === undefined ? '' : String(s.sessionId ?? '')))
  // 当前工作区键：与 DSH 自己的口径一致 —— 工作区列表里 sessionIds 含当前会话的那条的 workspaceId；
  // 解析不出来（无会话 / 会话未归属任何工作区）→ 占位键，仍然各自独立、不与他人共享配置。
  const presetWorkspaceKey = workspaceKeyOf({
    sessionId: sessionId ?? sessionIdOfSnapshot,
    items: workspaces?.items,
  })
  const currentDraft = input?.draft ?? ''

  const showToast = useCallback((text: string): void => {
    const now = Date.now()
    setToastSlot(prev => nextToast(prev, text, now))
  }, [])

  // 提示出口指向最新的 showToast（写入器的回调是长期存活的闭包，不能捕获某一次渲染的旧函数）。
  useEffect(() => { noticeRef.current = showToast }, [showToast])

  // 合并写入器只建一次（懒初始化）：delayMs 窗口内同一工作区的多次提交合并成一次落盘。
  // 真写盘的是 commitPresetStore —— 失败会抛，由 onError 转成可见提示（禁止静默失败）。
  if (writerRef.current === null) {
    writerRef.current = createCoalescingWriter({
      delayMs: PRESET_WRITE_COALESCE_MS,
      // 顺序要紧：**先更新内存态、再落盘**。落盘会因配额超限/隐私模式抛错，那时这一笔编辑
      // 至少在本页仍然可用（配合 onError 的"刷新后会丢"提示）；反过来先落盘，抛错时这笔编辑
      // 连本页都没了 —— 用户看到的是"编辑被吃掉 + 只有一句报错"。
      write: (request) => {
        const next = withPreset(currentPresetStore(), request.key, request.text)
        cachedPresetStore = next
        commitPresetStore(next)
      },
      onApplied: () => { noticeRef.current(PRESET_SAVED_TEXT) },
      onError: (_request, error) => { noticeRef.current(presetWriteFailedText(error)) },
    })
  }

  // toast 自动消失：单实例；重复触发仅刷新时长（deadline 变化重排 timer）。
  useEffect(() => {
    if (toastSlot === null) return
    const timer = setTimeout(() => {
      setToastSlot(prev => isToastExpired(prev?.deadline ?? null, Date.now()) ? null : prev)
    }, TOAST_DURATION_MS + 20)
    return () => clearTimeout(timer)
  }, [toastSlot])

  // 常驻 toast 完成态短暂展示后自动退出（仅 done 态计时；optimizing 永不自动关闭）。
  // 定时器纳入 effect 管理：状态变化/组件卸载时 cleanup 清理，无泄漏。
  useEffect(() => {
    if (optimizeToast === null || optimizeToast.kind !== 'done') return
    const timer = setTimeout(() => {
      setOptimizeToast(prev => (prev !== null && prev.kind === 'done' && isDoneToastExpired(prev, Date.now())) ? { kind: 'idle' } : prev)
    }, DONE_TOAST_MS + 20)
    return () => clearTimeout(timer)
  }, [optimizeToast])

  // 组件卸载/热重载/会话切换：中止在途优化请求（宿主 res close → 上游流停止），不留孤儿任务与残留 toast。
  useEffect(() => () => {
    optimizeAbortRef.current?.abort()
    optimizeAbortRef.current = null
  }, [])

  useEffect(() => {
    setLlmEnabled(readLlmEnabled())
    setGoalMode(readGoalMode())
  }, [])

  // 未落盘的写入必须在这些时刻落地：切换工作区 / 页面隐藏（切标签页、最小化）/ 组件卸载（含热重载）。
  // 三处都调 flush：写入器有 250ms 合并窗口，不 flush 的话这几种时机就是丢数据的窗口。
  useEffect(() => {
    writerRef.current?.flush()
  }, [presetWorkspaceKey])

  useEffect(() => () => {
    writerRef.current?.flush()
  }, [])

  useEffect(() => {
    const flushPending = (): void => { writerRef.current?.flush() }
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 多标签页最终一致：另一个标签页改了同一份配置 ⇒ 丢掉内存缓存、重算本次渲染。
  // 顺序要紧：**先置空缓存再 flush** —— 待写的那条会重新读整包（已含另一标签页的改动）再合并，
  // 反过来（先 flush 后置空）会用本页的旧缓存整包覆盖掉对方刚写的内容。
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      // 另一个标签页改了**预存命令**：失效缓存并重算（列表与弹窗读的是同一份缓存）。
      if (event.key === COMMAND_STORE_KEY) {
        cachedCommandStore = null
        setCommandRevision((n) => n + 1)
        return
      }
      if (event.key !== null && event.key !== PRESET_STORE_KEY) return
      cachedPresetStore = null
      writerRef.current?.flush()
      setStoreRevision((n) => n + 1)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!editing) return
    setPresetDraft(readPreset(editKeyRef.current))
  }, [editing])

  useEffect(() => {
    if (!editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editing])



  useEffect(() => {
    if (!editing) return
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (boxRef.current !== null && boxRef.current.contains(target)) return
      // portal 到 body 的浮层（预存命令菜单/弹窗）在 DOM 上不是本组件的后代，
      // 不排除掉的话，点它们会被误判成"点了外部"而关掉正在编辑的弹窗。
      if (layerHostRef.current !== null && layerHostRef.current.contains(target)) return
      setEditing(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [editing])

  // 当前工作区的展示名：只用于弹窗里提示"这次编辑写进哪个工作区"（配置键始终只用 ID）。
  const presetWorkspaceLabel = presetWorkspaceKey === NO_WORKSPACE_KEY
    ? '未归属工作区'
    : String(workspaces?.items?.find((w: any) => w?.workspaceId === presetWorkspaceKey)?.title ?? '未知工作区')

  // storeRevision 参与依赖：另一个标签页改了配置时它自增 ⇒ 本行必须重算（不能省成 [presetWorkspaceKey]）。
  const preset = useMemo(() => readPreset(presetWorkspaceKey), [presetWorkspaceKey, storeRevision])

  // ── 「预存命令」：数据、互斥、开关、落盘（v0.5.0）─────────────────────────
  // 列表只在 commandRevision 变化时重读；另一个标签页改了配置也自增它（storage 监听在下面）。
  const commandList = useMemo(() => readCommands(), [commandRevision])

  /** 解析中拦截：复用「点击追加」的判定与固定文案 —— 新按钮不得绕过既有互斥。 */
  const commandGestureAllowed = useCallback((): boolean => {
    const decision = gestureDecision(parsingRef.current ? 'parsing' : 'idle', 'click')
    if (!decision.intercepted) return true
    if (decision.toast !== null) showToast(decision.toast)
    return false
  }, [showToast])

  const closeCommandMenu = useCallback((refocus: boolean): void => {
    setMenuOpen(false)
    setMenuLine(null)
    if (refocus) commandButtonRef.current?.focus()
  }, [])

  const openCommandMenu = useCallback((): void => {
    const list = readCommands()
    if (list.length === 0) {
      // 空态：不展示空菜单，改为引导右键录入（需求 3.4）
      showToast(COMMAND_EMPTY_TOAST)
      return
    }
    const el = commandButtonRef.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    setMenuLine(dropUpLineFor({
      rect: { left: box.left, top: box.top, width: box.width, height: box.height },
      panelWidth: COMMAND_MENU_WIDTH,
      panelHeight: COMMAND_MENU_HEIGHT,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
    setMenuActive(0)
    setEditing(false) // 互斥：同一时刻只允许一个浮层展开（需求 3.5）
    setCommandDialogOpen(false)
    setMenuOpen(true)
  }, [showToast])

  const resetCommandDraft = useCallback((): void => {
    setCommandDraft({ title: '', content: '' })
    setEditingCommandId(null)
    setCommandError(null)
    setDiscardConfirm(false)
  }, [])

  const closeCommandDialog = useCallback((): void => {
    setCommandDialogOpen(false)
    setDiscardConfirm(false)
    setDeleteConfirm(null)
    setCommandError(null)
  }, [])

  const openCommandDialog = useCallback((): void => {
    setMenuOpen(false)
    setMenuLine(null)
    setEditing(false) // 互斥：与「点击追加」的右键弹窗不同时存在
    resetCommandDraft()
    setDeleteConfirm(null)
    setDialogPlacement(centerPlacementOf({
      panelWidth: COMMAND_DIALOG_WIDTH,
      panelHeight: COMMAND_DIALOG_HEIGHT,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
    setCommandDialogOpen(true)
  }, [resetCommandDraft])

  const beginEditCommand = useCallback((command: StoredCommand): void => {
    setEditingCommandId(command.id)
    setCommandDraft(commandDraftOf(command))
    setCommandError(null)
    setDiscardConfirm(false)
  }, [])

  const saveCommandDraft = useCallback((): void => {
    const decision = validateCommandDraft(commandDraft)
    if (!decision.ok) {
      // 校验不过：只提示，不写入（需求 4.4）
      setCommandError(decision.message)
      return
    }
    const store = currentCommandStore()
    const next = editingCommandId === null
      ? withCommandAdded(store, decision.value, createCommandId(commandIdsOf(store)))
      : withCommandUpdated(store, editingCommandId, decision.value)
    cachedCommandStore = next // 先内存：落盘失败时这一笔在本页仍可用（与追加文案同口径）
    try {
      commitCommandStore(next)
    } catch (error) {
      setCommandError(commandWriteFailedText(error))
      return
    }
    setCommandRevision((n) => n + 1) // 保存成功 → 左键菜单数据立即刷新（需求 4.5）
    setCommandDraft({ title: '', content: '' })
    setEditingCommandId(null)
    setCommandError(null)
    setDiscardConfirm(false)
    showToast(COMMAND_SAVED_TEXT)
  }, [commandDraft, editingCommandId, showToast])

  const requestDeleteCommand = useCallback((id: string): void => {
    const decision = nextDeleteConfirm(deleteConfirm, id, Date.now())
    setDeleteConfirm(decision.state)
    if (!decision.confirmed) return // 第一次点击只进入待确认（需求 4.4：二次确认）
    const store = currentCommandStore()
    const next = withCommandRemoved(store, id)
    cachedCommandStore = next
    try {
      commitCommandStore(next)
    } catch (error) {
      setCommandError(commandWriteFailedText(error))
      return
    }
    setCommandRevision((n) => n + 1)
    if (editingCommandId === id) {
      setEditingCommandId(null)
      setCommandDraft({ title: '', content: '' })
    }
    showToast(COMMAND_DELETED_TEXT)
  }, [deleteConfirm, editingCommandId, showToast])

  const selectCommand = useCallback((command: StoredCommand): void => {
    inputActions.setDraft(insertionText(currentDraft, command.content))
    closeCommandMenu(false)
    // 焦点与光标必须**等一帧**：受控输入区（Lexical）在本次提交时会同步自己的选区，
    // 同一 tick 里设置会被它覆盖掉。计时器挂在 ref 上，卸载即收回（不留孤儿任务）。
    if (caretTimerRef.current !== null) clearTimeout(caretTimerRef.current)
    caretTimerRef.current = setTimeout(() => {
      caretTimerRef.current = null
      focusComposerEnd()
    }, 0)
  }, [currentDraft, inputActions, closeCommandMenu])

  /** 关闭弹窗的脏检查：脏 → 先问（需求 4.5）；不脏 → 直接关。 */
  const requestCloseDialog = useCallback((): void => {
    const base = editingCommandId === null ? null : commandOf(currentCommandStore(), editingCommandId)
    const dirty = commandDraftDirty(base, commandDraft)
    if (dirty) {
      setDiscardIntent('close')
      setDiscardConfirm(true)
      return
    }
    setDiscardConfirm(false)
    closeCommandDialog()
  }, [commandDraft, editingCommandId, closeCommandDialog])

  /** 取消编辑同样不得静默丢改动。 */
  const requestCancelEdit = useCallback((): void => {
    const base = editingCommandId === null ? null : commandOf(currentCommandStore(), editingCommandId)
    if (commandDraftDirty(base, commandDraft)) {
      setDiscardIntent('cancel')
      setDiscardConfirm(true)
      return
    }
    resetCommandDraft()
  }, [commandDraft, editingCommandId, resetCommandDraft])

  const confirmDiscard = useCallback((): void => {
    if (discardIntent === 'cancel') {
      resetCommandDraft()
      return
    }
    closeCommandDialog()
  }, [discardIntent, resetCommandDraft, closeCommandDialog])

  // portal 宿主：挂到 body —— composer 的 overflow / backdrop-filter 容器裁不到浮层（需求 3.6）。
  useEffect(() => {
    const host = document.createElement('div')
    host.className = 'dsh-qa-portal'
    host.setAttribute('data-dsh-quick-append-layer', '')
    document.body.appendChild(host)
    layerHostRef.current = host
    setLayerHost(host)
    return () => {
      layerHostRef.current = null
      setLayerHost(null)
      host.remove()
    }
  }, [])

  // 数据损坏：解析时只记条数（渲染路径上不许弹 toast），这里转成一次性可见提示（需求 6.1）。
  useEffect(() => {
    currentCommandStore()
    if (pendingCommandDamage === null) return
    const dropped = pendingCommandDamage
    pendingCommandDamage = null
    showToast(commandDamagedText(dropped))
  }, [showToast, commandRevision])

  // 光标落位计时器：卸载即收回。
  useEffect(() => () => {
    if (caretTimerRef.current !== null) {
      clearTimeout(caretTimerRef.current)
      caretTimerRef.current = null
    }
  }, [])

  // 菜单键盘：Esc 关闭并回焦按钮；↑↓ 导航；Enter/Space 选择（需求 7.3）。
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeCommandMenu(true)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMenuActive((index) => (commandList.length === 0 ? 0 : (index + 1) % commandList.length))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMenuActive((index) => (commandList.length === 0 ? 0 : (index - 1 + commandList.length) % commandList.length))
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const picked = commandList[menuActive]
        if (picked === undefined) return
        event.preventDefault()
        selectCommand(picked)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen, commandList, menuActive, closeCommandMenu, selectCommand])

  // 菜单关闭时机：点外部 / 滚动 / resize（需求 3.5）；监听全部在 cleanup 收回（需求 7.4）。
  // scroll 用捕获：composer 内部滚动不会冒泡到 window，只有捕获阶段收得到。
  useEffect(() => {
    if (!menuOpen) return
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (target !== null && menuLayerRef.current !== null && menuLayerRef.current.contains(target)) return
      if (target !== null && commandButtonRef.current !== null && commandButtonRef.current.contains(target)) return
      closeCommandMenu(false)
    }
    const onViewportChange = (): void => { closeCommandMenu(false) }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [menuOpen, closeCommandMenu])

  // 编辑弹窗：Esc 关闭（脏则先问，不静默丢改动）。
  useEffect(() => {
    if (!commandDialogOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      requestCloseDialog()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [commandDialogOpen, requestCloseDialog])

  // 删除二次确认的窗口到期即复位（到点再点只重新进入待确认 ⇒ 不会隔很久误删）。
  useEffect(() => {
    if (deleteConfirm === null) return
    const id = deleteConfirm.id
    const timer = setTimeout(() => {
      setDeleteConfirm((prev) => (prev !== null && prev.id === id && !isDeleteConfirmActive(prev, id, Date.now()) ? null : prev))
    }, DELETE_CONFIRM_MS + 20)
    return () => clearTimeout(timer)
  }, [deleteConfirm])

  const appendPlain = useCallback(() => {
    if (preset === '') {
      showToast('请右键设置追加文案')
      return
    }
    const next = currentDraft === '' ? preset : `${currentDraft}\n\n${preset}`
    inputActions.setDraft(goalMode ? `/goal\n${next}` : next)
  }, [preset, currentDraft, goalMode, inputActions, showToast])

  const appendWithLlm = useCallback(async () => {
    if (preset === '') {
      showToast('请右键设置追加文案')
      return
    }
    if (currentDraft.trim() === '') {
      showToast('请先输入需求')
      return
    }
    if (parsingRef.current) return // 双保险（入口已拦截）：重入不发起重复请求
    parsingRef.current = true
    // 常驻任务态 toast：进入 LLM 调用前立即展示；不自动消失；终态（成功/失败/取消）严格绑定关闭。
    setOptimizeToast(prev => toastOnOptimizeStart(prev))
    const controller = new AbortController()
    optimizeAbortRef.current = controller
    let preprocessNote: string | null = null
    let images: OptimizeImagePayload[] = []
    try {
      // 多模态：输入区当前全部图片附件（顺序）→ 发送前校验/轻量压缩 → 与正文同请求承载。
      const imageIds = input?.imageIds
      const attachments = (Array.isArray(imageIds) && conversationService !== undefined)
        ? conversationService.draftImages(imageIds)
        : []
      const prepared = await prepareImages(attachments)
      images = prepared.images
      preprocessNote = prepared.note
      const response = await fetch('/@dsh-external/dsh-quick-append/api/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          draft: currentDraft,
          context: buildRecentContext(session),
          cwd: workspaces?.items?.find((w: any) => w.workspaceId === workspaces?.recentWorkspaceId)?.path ?? '',
          preset,
          // 模型与思考强度**不在此发送**：由宿主默认策略决定（deepseek-flash / max）。
          images,
        }),
      })
      const body = await response.json() as any
      if (!response.ok || !body.ok || typeof body.optimized !== 'string' || body.optimized.trim() === '') {
        throw new Error(body?.error ?? 'LLM优化失败')
      }
      const optimized = body.optimized.trim()
      inputActions.setDraft(goalMode ? `/goal\n${optimized}\n\n${preset}` : `${optimized}\n\n${preset}`)
      // 成功：切换「优化完成」态（短暂展示后自动退出，effect 管理计时与清理）。
      setOptimizeToast(prev => toastOnOptimizeEnd(prev, Date.now()))
      if (preprocessNote !== null) showToast(preprocessNote)
      else if (body.imagesDropped === true) showToast('图片未能纳入，已按纯文本优化')
    } catch (error) {
      // 取消（卸载/路由切换 abort）→ 静默关闭常驻 toast，不显示错误。
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      setOptimizeToast({ kind: 'idle' })
      if (!aborted) showToast(error instanceof Error ? error.message : 'LLM优化失败')
    } finally {
      parsingRef.current = false
      if (optimizeAbortRef.current === controller) optimizeAbortRef.current = null
    }
  }, [preset, currentDraft, session, goalMode, inputActions, showToast, workspaces, input])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!event.shiftKey || !event.altKey || event.code !== 'KeyF') return
      const el = document.activeElement
      // 输入面判定见 src/lib/interaction.ts：0.1.5 起 composer 是 contenteditable div
      // （data-composer-input），不再是 textarea，按标签判会恒 false 导致快捷键静默失效。
      if (!isComposerInputPoint(el)) return
      if (!el.closest('[data-composer-card]')) return
      if (el.closest('.dsh-qa-popover')) return
      event.preventDefault()
      // 解析中：与左键一致 —— 拦截 + 固定文案 toast（不发起重复请求）。
      const decision = gestureDecision(parsingRef.current ? 'parsing' : 'idle', 'click')
      if (decision.intercepted) {
        if (decision.toast !== null) showToast(decision.toast)
        return
      }
      if (llmEnabled) void appendWithLlm()
      else appendPlain()
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [llmEnabled, appendPlain, appendWithLlm, showToast])


  const openEditor = useCallback(() => {
    // 绑定本次编辑所属的工作区：用"打开弹窗那一刻"的键，保存时不再去看"当前"是哪个（切换工作区不串写）。
    editKeyRef.current = presetWorkspaceKey
    setPresetDraft(readPreset(presetWorkspaceKey))
    // 互斥：同一时刻只允许一个浮层展开（需求 3.5）—— 打开本弹窗要关掉预存命令的菜单与弹窗。
    setMenuOpen(false)
    setMenuLine(null)
    setCommandDialogOpen(false)
    setEditing(true)
  }, [presetWorkspaceKey])

  const save = useCallback(() => {
    // 只提交，不在这里宣告成功：真正落盘由合并写入器完成，成功/失败的提示都来自**真实落盘结果**
    //（先喊"已保存"再写盘失败，就是骗用户 —— 写盘可能在 250ms 合并窗口之后才失败）。
    writerRef.current?.submit(editKeyRef.current, presetDraft)
    setEditing(false)
  }, [presetDraft])

  const toggleLlm = useCallback(() => {
    const next = !llmEnabled
    setLlmEnabled(next)
    writeLlmEnabled(next)
  }, [llmEnabled])

  const toggleGoal = useCallback(() => {
    const next = !goalMode
    setGoalMode(next)
    writeGoalMode(next)
  }, [goalMode])


  // ── 两个按钮的 props（同一 flex 容器内的兄弟：预存命令在左、点击追加在右）──
  // 预存命令：左键向上拉起菜单、右键（含 Shift+F10 / 菜单键）打开编辑弹窗。
  const commandButtonProps: any = {
    type: 'button',
    ref: commandButtonRef,
    title: COMMAND_LABEL,
    'aria-label': COMMAND_LABEL,
    'aria-haspopup': 'menu',
    'aria-expanded': menuOpen,
    onClick: () => {
      if (!commandGestureAllowed()) return
      // 再次点击按钮 → 关闭（需求 3.5）
      if (menuOpen) {
        closeCommandMenu(false)
        return
      }
      openCommandMenu()
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault() // 阻止浏览器原生右键菜单（需求 4.1）
      if (!commandGestureAllowed()) return
      openCommandDialog()
    },
    onKeyDown: (event: any) => {
      // Shift+F10 / 菜单键 = 键盘版右键（需求 7.3）
      const contextKey = event.key === 'ContextMenu' || (event.shiftKey === true && event.key === 'F10')
      if (!contextKey) return
      event.preventDefault()
      if (!commandGestureAllowed()) return
      openCommandDialog()
    },
    style: ICON_BUTTON_STYLE,
  }

  // 点击追加：行为与既有版本逐字一致（仅把内联样式/图标属性换成共享常量，渲染结果不变）。
  const appendButtonProps: any = {
    type: 'button',
    title: '点击追加 / 右键设置',
    onClick: () => {
      // 解析中：拦截业务 + 固定文案 toast；外观保持正常可点击（无 disabled/loading 感知）。
      const decision = gestureDecision(parsingRef.current ? 'parsing' : 'idle', 'click')
      if (decision.intercepted) {
        if (decision.toast !== null) showToast(decision.toast)
        return
      }
      if (llmEnabled) void appendWithLlm()
      else appendPlain()
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault() // 阻止浏览器原生右键菜单（解析中/常规态均拦截原生）
      const decision = gestureDecision(parsingRef.current ? 'parsing' : 'idle', 'contextmenu')
      if (decision.intercepted) {
        if (decision.toast !== null) showToast(decision.toast)
        return // 解析中：不打开任何自定义菜单
      }
      openEditor()
    },
    style: ICON_BUTTON_STYLE,
  }

  return createElement(
    'div',
    { ref: boxRef, style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 4 } },
    // 按钮对：间距 5px 由容器的 flex gap 提供（需求 2.1），不做绝对定位。
    createElement(
      'div',
      { className: 'dsh-qa-tools' },
      createElement(
        'button',
        commandButtonProps,
        createElement('svg', ICON_SVG_PROPS, createElement('path', { d: WRENCH_PATH })),
      ),
      createElement(
        'button',
        appendButtonProps,
        createElement('svg', ICON_SVG_PROPS, createElement('path', { d: BOLT_PATH })),
      ),
    ),
    toastSlot === null ? null : createElement('span', { style: { fontSize: 11, color: 'var(--al-text2, #9AA3B2)' } }, toastSlot.text),
    // 常驻任务态 toast：优化中（固定文案 + 旋转指示）/ 优化完成（短暂成功态）。
    // 与组件同生命周期：卸载即随 DOM 移除（无孤立节点）；计时仅存在于完成态 effect。
    optimizeToast !== null && optimizeToast.kind !== 'idle'
      ? createElement(
          'span',
          { className: 'dsh-qa-opt' + (optimizeToast.kind === 'done' ? ' done' : '') },
          optimizeToast.kind === 'optimizing'
            ? createElement('span', { className: 'dsh-qa-opt-spin', 'aria-hidden': true })
            : null,
          optimizeToast.kind === 'optimizing' ? OPTIMIZING_TOAST : DONE_TOAST,
        )
      : null,
    editing
      ? createElement(
          'div',
          { className: 'dsh-qa-popover' },
          createElement('div', { className: 'dsh-qa-title' }, '快捷追加文案'),
          createElement(
            'textarea',
            {
              className: 'dsh-qa-textarea',
              value: presetDraft,
              onChange: (event: any) => setPresetDraft(event.target.value),
              autoFocus: true,
            },
          ),
          createElement(
            'div',
            { className: 'dsh-qa-meta' },
            createElement(
              'span',
              { className: 'dsh-qa-meta-text', title: '追加文案按工作区隔离保存（切换工作区互不影响）' },
              '写入：' + presetWorkspaceLabel,
            ),
            createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-qa-btn',
                // 新建工作区默认空白（需求 4）；这段默认文案改由本按钮一键填回，不必手打。
                onClick: () => setPresetDraft(DEFAULT_APPEND_TEXT),
              },
              '填入默认文案',
            ),
          ),
          createElement(
            'div',
            { className: 'dsh-qa-footer' },
            createElement(
              'div',
              { className: 'dsh-qa-toggles' },
              createElement(
                'label',
                { className: 'dsh-qa-toggle' },
                createElement('input', {
                  type: 'checkbox',
                  checked: llmEnabled,
                  onChange: toggleLlm,
                }),
                'LLM优化',
              ),
              createElement(
                'label',
                { className: 'dsh-qa-toggle' },
                createElement('input', {
                  type: 'checkbox',
                  checked: goalMode,
                  onChange: toggleGoal,
                }),
                'goal模式',
              ),
            ),
            // 模型与思考强度控件已移除：两者由宿主策略决定（deepseek-flash / max），
            // 弹窗不再暴露 —— 原先两个定宽设置行挤在 footer 里会把按钮推出弹窗。
            createElement(
              'div',
              { className: 'dsh-qa-actions' },
              createElement(
                'button',
                { type: 'button', className: 'dsh-qa-btn', onClick: () => setEditing(false) },
                '取消',
              ),
              createElement(
                'button',
                { type: 'button', className: 'dsh-qa-btn dsh-qa-btn-primary', onClick: save },
                '保存',
              ),
            ),
          ),
        )
      : null,
    // ── 预存命令浮层：portal 到 body（composer 的 overflow/backdrop-filter 裁不到，需求 3.6）──
    // 左键菜单（上拉）与编辑弹窗（遮罩 + 面板）在这里渲染；同一时刻只有一个（互斥见各打开路径）。
    layerHost === null ? null : createPortal(
      createElement(
        'div',
        { className: 'dsh-qa-portal-root' },
        menuOpen && menuLine !== null
          ? createElement(
              'div',
              {
                key: 'command-menu',
                ref: menuLayerRef,
                className: 'dsh-qa-popover dsh-qa-menu',
                role: 'menu',
                'aria-label': COMMAND_LABEL,
                style: layerStyleOf(menuLine, COMMAND_MENU_WIDTH, COMMAND_MENU_HEIGHT),
              },
              createElement(
                'div',
                { className: 'dsh-qa-menu-head' },
                createElement('span', { className: 'dsh-qa-head-title' }, COMMAND_LABEL),
                createElement('span', { className: 'dsh-qa-head-count' }, String(commandList.length) + ' 条'),
              ),
              createElement(
                'div',
                { className: 'dsh-qa-menu-list' },
                commandList.map((command, index) => createElement(
                  'button',
                  {
                    key: command.id,
                    type: 'button',
                    role: 'menuitem',
                    title: command.title,
                    'aria-selected': index === menuActive ? 'true' : 'false',
                    className: 'dsh-qa-menu-item' + (index === menuActive ? ' on' : ''),
                    onMouseEnter: () => setMenuActive(index),
                    onClick: () => selectCommand(command),
                  },
                  command.title,
                )),
              ),
              createElement(
                'div',
                { className: 'dsh-qa-menu-foot' },
                createElement('span', { className: 'dsh-qa-meta-text' }, '左键插入正文 · 右键录入/编辑'),
                createElement('button', { type: 'button', className: 'dsh-qa-btn', onClick: openCommandDialog }, '管理'),
              ),
            )
          : null,
        commandDialogOpen
          ? createElement('div', { key: 'command-mask', className: 'dsh-qa-mask', onClick: requestCloseDialog })
          : null,
        commandDialogOpen && dialogPlacement !== null
          ? createElement(
              'div',
              {
                key: 'command-dialog',
                ref: dialogLayerRef,
                className: 'dsh-qa-popover dsh-qa-dialog',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': COMMAND_LABEL,
                style: layerStyleOf(dialogPlacement, COMMAND_DIALOG_WIDTH, DIALOG_MAX_HEIGHT),
              },
              createElement(
                'div',
                { className: 'dsh-qa-head' },
                createElement('span', { className: 'dsh-qa-head-title' }, COMMAND_LABEL),
                createElement('span', { className: 'dsh-qa-head-count' }, String(commandList.length) + ' 条'),
              ),
              createElement(
                'div',
                { className: 'dsh-qa-body' },
                commandList.length === 0
                  ? createElement('div', { className: 'dsh-qa-empty' }, '还没有预存命令：填好下面的标题与正文，点「新增」')
                  : createElement(
                      'div',
                      { className: 'dsh-qa-cmd-list' },
                      commandList.map((command) => {
                        const armed = isDeleteConfirmActive(deleteConfirm, command.id, Date.now())
                        return createElement(
                          'div',
                          { key: command.id, className: 'dsh-qa-cmd-row' + (command.id === editingCommandId ? ' on' : '') },
                          createElement('span', { className: 'dsh-qa-cmd-title', title: command.title }, command.title),
                          createElement(
                            'button',
                            { type: 'button', className: 'dsh-qa-btn', onClick: () => beginEditCommand(command) },
                            '编辑',
                          ),
                          createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-qa-btn' + (armed ? ' dsh-qa-btn-danger' : ''),
                              onClick: () => requestDeleteCommand(command.id),
                            },
                            armed ? '确认删除' : '删除',
                          ),
                        )
                      }),
                    ),
                createElement(
                  'div',
                  { className: 'dsh-qa-form' },
                  createElement(
                    'div',
                    { className: 'dsh-qa-field' },
                    createElement(
                      'div',
                      { className: 'dsh-qa-label' },
                      '标题（菜单里显示）',
                      createElement('span', { className: 'dsh-qa-head-count' }, '≤ ' + String(COMMAND_TITLE_MAX) + ' 字'),
                    ),
                    createElement('input', {
                      className: 'dsh-qa-input',
                      type: 'text',
                      value: commandDraft.title,
                      onChange: (event: any) => setCommandDraft((prev) => ({ title: event.target.value, content: prev.content })),
                    }),
                  ),
                  createElement(
                    'div',
                    { className: 'dsh-qa-field' },
                    createElement(
                      'div',
                      { className: 'dsh-qa-label' },
                      '正文（选中后插入对话框）',
                      createElement('span', { className: 'dsh-qa-head-count' }, '≤ ' + String(COMMAND_CONTENT_MAX) + ' 字'),
                    ),
                    createElement('textarea', {
                      className: 'dsh-qa-textarea',
                      value: commandDraft.content,
                      onChange: (event: any) => setCommandDraft((prev) => ({ title: prev.title, content: event.target.value })),
                    }),
                  ),
                  commandError === null ? null : createElement('div', { className: 'dsh-qa-err' }, commandError),
                ),
                discardConfirm
                  ? createElement(
                      'div',
                      { className: 'dsh-qa-confirm' },
                      createElement('span', { className: 'dsh-qa-meta-text' }, '有未保存的修改，确定放弃？'),
                      createElement('button', { type: 'button', className: 'dsh-qa-btn', onClick: () => setDiscardConfirm(false) }, '继续编辑'),
                      createElement('button', { type: 'button', className: 'dsh-qa-btn dsh-qa-btn-danger', onClick: confirmDiscard }, '放弃'),
                    )
                  : null,
              ),
              createElement(
                'div',
                { className: 'dsh-qa-footer' },
                createElement('span', { className: 'dsh-qa-meta-text' }, editingCommandId === null ? '新增指令' : '正在编辑'),
                createElement(
                  'div',
                  { className: 'dsh-qa-actions' },
                  editingCommandId === null
                    ? null
                    : createElement('button', { type: 'button', className: 'dsh-qa-btn', onClick: requestCancelEdit }, '取消编辑'),
                  createElement(
                    'button',
                    { type: 'button', className: 'dsh-qa-btn dsh-qa-btn-primary', onClick: saveCommandDraft },
                    editingCommandId === null ? '新增' : '保存修改',
                  ),
                  createElement('button', { type: 'button', className: 'dsh-qa-btn', onClick: requestCloseDialog }, '关闭'),
                ),
              ),
            )
          : null,
      ),
      layerHost,
    ),
  )
}

export function apply(ctx: ClientContext): void {
  // 铁律 5：apply 内 try-catch，异常不冒泡（防 dsh web 启动失败）。
  try {
    ensureSkinStyle()
    // 会话服务（可选依赖）：取输入区图片 File 列表；未装配 → 纯文本优化（图片静默不纳入并提示）。
    conversationService = (ctx.get?.('conversation') ?? undefined) as ConversationServiceLike | undefined
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-quick-append',
      order: 10,
    }, QuickAppendButton))
  } catch (error) {
    console.error('[dsh-quick-append] apply crashed:', String(error))
  }
}