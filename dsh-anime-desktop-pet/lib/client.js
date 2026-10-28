window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-anime-desktop-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/core.mjs
		/**
		* Overlay core: animation library, selection rules, stable random binding,
		* session-row anchor parsing, right-click hit testing and persistence codecs.
		* Pure functions only — the DOM wiring lives in overlay.mjs.
		*/
		/** Host route prefix for additional packaged animation GIFs. */
		const ANIMATED_BASE_PATH = "/@dsh-external/dsh-anime-desktop-pet/assets/animated/";
		/** Default animation: shown while context use is within the threshold. */
		const WORKING_ANIMATION = {
			id: "blue-fat-fish-working",
			name: "蓝色大肥鱼正在工作",
			/** Human-facing character name (used by preview labels); falls back to `name`. */
			characterName: "蓝色大肥鱼",
			file: "blue-fat-fish-working.gif",
			enabled: true,
			/** Optional per-character three-view reference image (served from assets/three-view/). */
			threeView: "three-view/blue-fat-fish-working.png"
		};
		/** Context-pressure variant: selectable in settings, auto-selected above the threshold. */
		const TIRED_ANIMATION = {
			id: "blue-fat-fish-tired",
			name: "蓝色大肥鱼很累",
			characterName: "蓝色大肥鱼",
			file: "blue-fat-fish-tired.gif",
			base: ANIMATED_BASE_PATH,
			enabled: true
		};
		/** Selectable library: the user may activate either one or both. */
		const ANIMATIONS = [WORKING_ANIMATION, TIRED_ANIMATION];
		/** Bounded context-use percent from the public `contextPressure` projection. */
		function contextUsagePercent(pressure) {
			if (pressure === null || typeof pressure !== "object") return null;
			const used = Number.isFinite(pressure.projectedTokens) ? pressure.projectedTokens : pressure.pressureTokens;
			const window = pressure.contextWindow;
			if (!Number.isFinite(used) || !Number.isFinite(window) || window <= 0 || used < 0) return null;
			return Math.min(100, Math.round(used / window * 100));
		}
		/** Whether a context percent selects the tired variant (strictly > 45%). */
		function shouldUseTiredAnimation(percent) {
			return Number.isFinite(percent) && percent > 45;
		}
		/**
		* Resolve the context pair selection:
		* - both active: > threshold -> tired, otherwise working;
		* - only tired active: tired regardless of context;
		* - only working active: working regardless of context;
		* - neither active: null (caller falls back to legacy random binding for other libraries).
		*/
		function selectContextAnimation(selectedIds, percent) {
			const ids = Array.isArray(selectedIds) ? selectedIds : [];
			const hasWorking = ids.includes(WORKING_ANIMATION.id);
			if (ids.includes(TIRED_ANIMATION.id) && (!hasWorking || shouldUseTiredAnimation(percent))) return TIRED_ANIMATION.id;
			if (hasWorking) return WORKING_ANIMATION.id;
			return null;
		}
		/** Fixed desktop character: independent of running sessions, draggable, position persisted. */
		const FIXED_PET = {
			id: "blue-fat-fish-eating",
			name: "蓝色大肥鱼",
			file: "blue-fat-fish-eating.gif"
		};
		/** Fixed character defaults: size and the viewport margin used for placement/clamping. */
		const FIXED_DEFAULTS = {
			sizePx: 220,
			marginPx: 24
		};
		/** Desktop live banner (independent transparent overlay layer). */
		const BANNER_BASE_PATH = "/@dsh-external/dsh-anime-desktop-pet/assets/banner/";
		const BANNER_FILE = "blue-fat-fish-live-banner.gif";
		const BANNER_DEFAULTS = {
			widthPx: 720,
			minWidthPx: 240,
			maxWidthPx: 1920,
			marginPx: 24
		};
		const BANNER_POSITION_KEY = "dsh-anime-desktop-pet/banner-position";
		const BANNER_VISIBLE_KEY = "dsh-anime-desktop-pet/banner-visible";
		const OVERLAY_VISIBLE_KEY = "dsh-anime-desktop-pet/overlay-visible";
		function bannerUrl(base = BANNER_BASE_PATH) {
			return `${base}${BANNER_FILE}?v=3`;
		}
		function clampBannerWidth(width) {
			const value = Number.isFinite(width) ? width : BANNER_DEFAULTS.widthPx;
			return Math.round(Math.min(Math.max(value, BANNER_DEFAULTS.minWidthPx), BANNER_DEFAULTS.maxWidthPx));
		}
		function bannerSize(width) {
			const clamped = clampBannerWidth(width);
			return {
				width: clamped,
				height: Math.round(clamped / 3)
			};
		}
		function defaultBannerPosition(viewport, width = BANNER_DEFAULTS.widthPx, margin = BANNER_DEFAULTS.marginPx) {
			if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null;
			const size = bannerSize(width);
			const gap = Number.isFinite(margin) ? Math.max(0, margin) : BANNER_DEFAULTS.marginPx;
			return {
				x: Math.round((viewport.width - size.width) / 2),
				y: Math.max(gap, Math.round(viewport.height - size.height - gap))
			};
		}
		function clampBannerPosition(position, viewport, width = position?.width ?? BANNER_DEFAULTS.widthPx, margin = BANNER_DEFAULTS.marginPx) {
			if (!position || !viewport) return null;
			if (![position.x, position.y].every(Number.isFinite)) return null;
			if (![viewport.width, viewport.height].every(Number.isFinite)) return null;
			if (viewport.width <= 0 || viewport.height <= 0) return null;
			const size = bannerSize(width);
			const gap = Number.isFinite(margin) ? Math.max(0, margin) : BANNER_DEFAULTS.marginPx;
			return {
				x: Math.round(Math.min(Math.max(position.x, gap), Math.max(gap, viewport.width - size.width - gap))),
				y: Math.round(Math.min(Math.max(position.y, gap), Math.max(gap, viewport.height - size.height - gap)))
			};
		}
		function parseBannerState(raw) {
			if (typeof raw !== "string" || raw === "") return null;
			let value;
			try {
				value = JSON.parse(raw);
			} catch {
				return null;
			}
			if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
			if (![
				value.x,
				value.y,
				value.width
			].every(Number.isFinite)) return null;
			return {
				x: value.x,
				y: value.y,
				width: clampBannerWidth(value.width)
			};
		}
		function serializeBannerState(state) {
			return JSON.stringify({
				x: Math.round(state.x),
				y: Math.round(state.y),
				width: clampBannerWidth(state.width)
			});
		}
		/** Visibility defaults to true; only an explicit persisted "false" hides it. */
		function parseBannerVisible(raw) {
			return raw !== "false" && raw !== "0";
		}
		/** Global overlay visibility from Ctrl+Shift+F12; absent means visible. */
		function parseOverlayVisible(raw) {
			return raw !== "false" && raw !== "0";
		}
		/** localStorage key for the fixed character's last dragged position. */
		const FIXED_POSITION_KEY = "dsh-anime-desktop-pet/fixed-position";
		/** Resolve the fixed character's packaged GIF URL. */
		function fixedPetUrl(base = ANIMATED_BASE_PATH) {
			return `${base}${FIXED_PET.file}?v=3`;
		}
		/** Bottom-right default position for the fixed character. */
		function defaultFixedPosition(viewport, size = FIXED_DEFAULTS.sizePx, margin = FIXED_DEFAULTS.marginPx) {
			if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return null;
			const gap = Number.isFinite(margin) ? Math.max(0, margin) : FIXED_DEFAULTS.marginPx;
			const box = Number.isFinite(size) ? Math.max(1, size) : FIXED_DEFAULTS.sizePx;
			return {
				x: Math.round(viewport.width - box - gap),
				y: Math.round(viewport.height - box - gap)
			};
		}
		/** Keep a dragged fixed-character position fully inside the viewport (margin preserved). */
		function clampFixedPosition(position, viewport, size = FIXED_DEFAULTS.sizePx, margin = FIXED_DEFAULTS.marginPx) {
			if (!position || !viewport) return null;
			if (![position.x, position.y].every(Number.isFinite)) return null;
			if (![viewport.width, viewport.height].every(Number.isFinite)) return null;
			if (viewport.width <= 0 || viewport.height <= 0) return null;
			const box = Number.isFinite(size) ? Math.max(1, size) : FIXED_DEFAULTS.sizePx;
			const gap = Number.isFinite(margin) ? Math.max(0, margin) : FIXED_DEFAULTS.marginPx;
			const maxX = Math.max(gap, viewport.width - box - gap);
			const maxY = Math.max(gap, viewport.height - box - gap);
			return {
				x: Math.round(Math.min(Math.max(position.x, gap), maxX)),
				y: Math.round(Math.min(Math.max(position.y, gap), maxY))
			};
		}
		/** Parse a persisted fixed-character position; malformed values return null. */
		function parseFixedPosition(raw) {
			if (typeof raw !== "string" || raw === "") return null;
			let value;
			try {
				value = JSON.parse(raw);
			} catch {
				return null;
			}
			if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
			if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
			return {
				x: value.x,
				y: value.y
			};
		}
		/** Serialize the fixed-character position for localStorage. */
		function serializeFixedPosition(position) {
			return JSON.stringify({
				x: Math.round(position.x),
				y: Math.round(position.y)
			});
		}
		/** Hover enlargement defaults: one place for the magnification contract. */
		const HOVER_DEFAULTS = {
			/** Standard = measured row height × this old hover-scale token. */
			scale: 2.5,
			/** Safety gap between arbitrated animations (old hover edge-margin token). */
			marginPx: 8
		};
		/**
		* Sidebar visibility arbitration tokens (single source, no scattered magic numbers):
		* the standard rendered size is the old hover-enlarged size (row height × scale),
		* and the safety gap reuses the existing spacing token.
		*/
		const ANIMATION_ARBITRATION_GAP = HOVER_DEFAULTS.marginPx;
		/** Standard (only) sidebar animation size: measured row height enlarged by the old hover token. */
		function standardAnimationSize(basePx, scale = HOVER_DEFAULTS.scale) {
			if (!Number.isFinite(basePx) || basePx <= 0) return 0;
			const factor = Number.isFinite(scale) && scale > 0 ? scale : HOVER_DEFAULTS.scale;
			return Math.round(basePx * factor);
		}
		function normalizeBox(box) {
			if (box === null || typeof box !== "object") return null;
			const left = Number.isFinite(box.left) ? box.left : box.x;
			const top = Number.isFinite(box.top) ? box.top : box.y;
			let width = Number.isFinite(box.width) ? box.width : null;
			let height = Number.isFinite(box.height) ? box.height : null;
			if ((width === null || width <= 0) && Number.isFinite(box.right) && Number.isFinite(left)) width = box.right - left;
			if ((height === null || height <= 0) && Number.isFinite(box.bottom) && Number.isFinite(top)) height = box.bottom - top;
			if (![
				left,
				top,
				width,
				height
			].every(Number.isFinite)) return null;
			if (width <= 0 || height <= 0) return null;
			return {
				left,
				top,
				width,
				height,
				right: left + width,
				bottom: top + height
			};
		}
		/** Shared rectangle intersection predicate used by arbitration and the view layer. */
		function rectsOverlap(a, b, gap = 0) {
			const padding = Number.isFinite(gap) && gap > 0 ? gap : 0;
			return a.left < b.right + padding && b.left < a.right + padding && a.top < b.bottom + padding && b.top < a.bottom + padding;
		}
		const KIND_PRIORITY = {
			workspace: 0,
			conversation: 1
		};
		/**
		* Deterministic sidebar animation arbitration (pure; no DOM/state reads).
		*
		* Input: { candidates:[{ id, kind:'conversation'|'workspace', running, anchorRect }],
		*          size, gap, benchmarkRect? }
		* Candidate geometry: STANDARD-sized square, horizontally just right of its row and
		* vertically centered on that row. A candidate is shown only when it does not
		* overlap the fixed benchmark rect or any already placed candidate (+gap).
		* Workspace candidates win over conversation candidates; within a kind DOM order wins.
		* Returns { visibleIds, placements } in original (display) order.
		*/
		function computeAnimationPlacements(input = {}) {
			const empty = {
				visibleIds: [],
				placements: []
			};
			if (input === null || typeof input !== "object") return empty;
			const size = Number.isFinite(input.size) && input.size > 0 ? input.size : 0;
			if (size === 0) return empty;
			const gap = Number.isFinite(input.gap) && input.gap > 0 ? input.gap : 0;
			const candidates = Array.isArray(input.candidates) ? input.candidates : [];
			const benchmark = normalizeBox(input.benchmarkRect);
			const seen = /* @__PURE__ */ new Set();
			const indexed = [];
			for (let index = 0; index < candidates.length; index += 1) {
				const candidate = candidates[index];
				if (candidate === null || typeof candidate !== "object") continue;
				if (typeof candidate.id !== "string" || candidate.id === "" || seen.has(candidate.id)) continue;
				if (candidate.running !== true) continue;
				const kind = candidate.kind === "workspace" ? "workspace" : candidate.kind === "conversation" ? "conversation" : null;
				if (kind === null) continue;
				const anchor = normalizeBox(candidate.anchorRect);
				if (anchor === null) continue;
				const left = anchor.right + gap;
				const top = anchor.top + (anchor.height - size) / 2;
				const rect = {
					left,
					top,
					width: size,
					height: size,
					right: left + size,
					bottom: top + size
				};
				if (![
					rect.left,
					rect.top,
					rect.right,
					rect.bottom
				].every(Number.isFinite)) continue;
				seen.add(candidate.id);
				indexed.push({
					index,
					candidate,
					kind,
					rect
				});
			}
			indexed.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.index - b.index);
			const decided = new Array(candidates.length).fill(null);
			const placedWorkspaces = [];
			const workspaceQueue = indexed.filter((entry) => entry.kind === "workspace");
			const conversationQueue = indexed.filter((entry) => entry.kind === "conversation");
			workspaceQueue.sort((a, b) => a.rect.top - b.rect.top || a.index - b.index);
			conversationQueue.sort((a, b) => a.rect.top - b.rect.top || a.index - b.index);
			for (const entry of workspaceQueue) {
				if (benchmark !== null && rectsOverlap(entry.rect, benchmark, gap)) continue;
				const previous = placedWorkspaces[placedWorkspaces.length - 1];
				if (previous !== void 0 && rectsOverlap(entry.rect, previous.rect, gap)) continue;
				placedWorkspaces.push(entry);
				decided[entry.index] = {
					id: entry.candidate.id,
					kind: entry.kind,
					rect: entry.rect
				};
			}
			const staticIntervals = [...placedWorkspaces.map((entry) => entry.rect), ...benchmark === null ? [] : [benchmark]].sort((a, b) => a.top - b.top);
			let cursor = 0;
			let previousConversation = null;
			for (const entry of conversationQueue) {
				if (previousConversation !== null && rectsOverlap(entry.rect, previousConversation.rect, gap)) continue;
				while (cursor < staticIntervals.length && staticIntervals[cursor].bottom + gap <= entry.rect.top) cursor += 1;
				let blocked = false;
				for (let index = cursor; index < staticIntervals.length && staticIntervals[index].top < entry.rect.bottom + gap; index += 1) if (rectsOverlap(entry.rect, staticIntervals[index], gap)) {
					blocked = true;
					break;
				}
				if (blocked) continue;
				previousConversation = entry;
				decided[entry.index] = {
					id: entry.candidate.id,
					kind: entry.kind,
					rect: entry.rect
				};
			}
			const placements = decided.filter((placement) => placement !== null);
			return {
				visibleIds: placements.map((placement) => placement.id),
				placements
			};
		}
		/** Host route serving the packaged animation assets (see src/index.ts). */
		const GIF_BASE_PATH = "/@dsh-external/dsh-anime-desktop-pet/assets/";
		/** localStorage key for the checked animation ids. */
		const STORAGE_KEY = "dsh-anime-desktop-pet/selection";
		const SESSION_ROW_PREFIX = "session:";
		/** Resolve one animation's packaged URL; `animation.base` selects a non-default route. */
		function animationUrl(animation, base = animation?.base ?? "/@dsh-external/dsh-anime-desktop-pet/assets/") {
			return `${base}${animation.file}?v=3`;
		}
		/** Whether one character declares a three-view reference image. */
		function hasThreeView(animation) {
			return Boolean(animation) && typeof animation.threeView === "string" && animation.threeView !== "";
		}
		/** Human-facing character label for preview UI; never returns a non-string. */
		function characterLabel(animation) {
			if (!animation) return "";
			if (typeof animation.characterName === "string" && animation.characterName !== "") return animation.characterName;
			return typeof animation.name === "string" ? animation.name : "";
		}
		/** Resolve one character's three-view URL, or null when the character has none. */
		function threeViewUrl(animation, base = GIF_BASE_PATH) {
			return hasThreeView(animation) ? `${base}${animation.threeView}` : null;
		}
		/** Animations eligible for display (missing `enabled` means enabled). */
		function enabledAnimations(library) {
			return (Array.isArray(library) ? library : []).filter((animation) => animation && typeof animation.id === "string" && animation.enabled !== false);
		}
		/** Row key (`data-row-key`) of one conversation row, or null for group rows. */
		function parseSessionRowKey(key) {
			if (typeof key !== "string" || !key.startsWith(SESSION_ROW_PREFIX)) return null;
			const sessionId = key.slice(8);
			return sessionId === "" ? null : sessionId;
		}
		/** Keep only checked ids that still exist, are enabled and unique; never empty. */
		function normalizeSelection(selectedIds, library) {
			const enabled = enabledAnimations(library);
			const selected = [];
			if (Array.isArray(selectedIds)) {
				for (const id of selectedIds) if (typeof id === "string" && !selected.includes(id) && enabled.some((animation) => animation.id === id)) selected.push(id);
			}
			if (selected.length > 0) return selected;
			return enabled.length > 0 ? [enabled[0].id] : [];
		}
		/**
		* Toggle one checkbox. `blocked` carries the reason the UI must surface:
		* `single` (library has one animation), `last` (refuse to uncheck the last one),
		* `unknown` (id no longer in the library).
		*/
		function selectionAfterToggle(selectedIds, id, library) {
			const enabled = enabledAnimations(library);
			const current = normalizeSelection(selectedIds, library);
			if (enabled.find((animation) => animation.id === id) === void 0) return {
				selected: current,
				blocked: true,
				reason: "unknown"
			};
			if (!current.includes(id)) return {
				selected: [...current, id],
				blocked: false
			};
			if (enabled.length <= 1) return {
				selected: current,
				blocked: true,
				reason: "single"
			};
			const next = current.filter((animationId) => animationId !== id);
			if (next.length === 0) return {
				selected: current,
				blocked: true,
				reason: "last"
			};
			return {
				selected: next,
				blocked: false
			};
		}
		/**
		* Pick the animation for one running session, keeping an existing valid binding
		* stable across scroll/re-render. Returns null when nothing can be shown.
		*/
		function bindAnimation(bindings, sessionId, selectedIds, random = Math.random) {
			if (typeof sessionId !== "string" || sessionId === "") return null;
			const selected = Array.isArray(selectedIds) ? selectedIds : [];
			const existing = bindings.get(sessionId);
			if (existing !== void 0 && selected.includes(existing)) return existing;
			if (selected.length === 0) {
				bindings.delete(sessionId);
				return null;
			}
			const sample = Number(random());
			const clamped = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON) : 0;
			const picked = selected[Math.floor(clamped * selected.length)];
			bindings.set(sessionId, picked);
			return picked;
		}
		/** Parse a persisted selection; malformed values return null (caller falls back). */
		function parseSelection(raw) {
			if (typeof raw !== "string" || raw === "") return null;
			let value;
			try {
				value = JSON.parse(raw);
			} catch {
				return null;
			}
			if (!Array.isArray(value)) return null;
			return value.filter((entry) => typeof entry === "string");
		}
		/** Serialize a selection, deduped, for localStorage. */
		function serializeSelection(selectedIds) {
			const unique = [];
			for (const id of Array.isArray(selectedIds) ? selectedIds : []) if (typeof id === "string" && !unique.includes(id)) unique.push(id);
			return JSON.stringify(unique);
		}
		//#endregion
		//#region src/client/overlay.mjs
		/**
		* Independent overlay for dsh-anime-desktop-pet.
		*
		* Renders one small GIF beside every RUNNING conversation row, without touching
		* DSH layout or sidebar source: a singleton fixed host in document.body, open
		* Shadow DOM, pointer-events:none for left-click pass-through, and a document
		* capture-phase contextmenu listener that only claims right-clicks inside a
		* visible animation bounding box.
		*/
		/** User-facing block messages shown inside the settings panel. */
		const SETTINGS_MESSAGES = {
			single: "动画库只有一个动画，无法取消勾选",
			last: "至少保留一个动画，不能取消最后一个",
			unknown: "该动画已不在动画库中"
		};
		/** User-facing copy for the three-view preview (kept in one place for future i18n). */
		const PREVIEW_MESSAGES = {
			actionLabel: (name) => `查看${name}三视图`,
			titleSuffix: "三视图",
			missing: "三视图暂未提供",
			close: "关闭三视图",
			copy: "复制图片",
			copySuccess: "图片已复制到剪贴板",
			copyFailed: "复制失败，请检查剪贴板权限后重试"
		};
		const DEFAULTS = {
			sizePx: 64,
			gapPx: 6,
			edgePx: 4,
			zIndex: 2147483045
		};
		const STYLE$1 = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .pet { position: fixed; pointer-events: none; z-index: 2147483000; border-radius: 15px; overflow: hidden; }
  .pet[hidden] { display: none !important; }
  .pet img, .pet canvas { display: block; width: 100%; height: 100%; pointer-events: none; border-radius: inherit; }
  .pet [hidden] { display: none !important; }
  .menu, .settings {
    position: fixed; pointer-events: auto; z-index: 2147483001;
    box-sizing: border-box; color: #f2f4f7; background: #1c1f26;
    border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .menu { padding: 4px; min-width: 96px; }
  .menu button, .settings button {
    display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 6px;
    color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible, .settings button:hover, .settings button:focus-visible { background: rgba(255,255,255,.10); outline: none; }
  .settings { width: 248px; padding: 12px; }
  .settings h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
  .settings .role-row { display: flex; align-items: center; gap: 4px; }
  .settings .role-row label { flex: 1; }
  .settings label { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }
  .settings label[data-locked] { cursor: default; color: #9aa2b1; }
  .settings input { accent-color: #4f8cff; pointer-events: auto; }
  .settings .preview-open {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; flex: 0 0 auto;
    color: #cfd6e4; background: transparent; border: 0; border-radius: 6px; cursor: pointer;
  }
  .settings .preview-open svg { width: 14px; height: 14px; display: block; }
  .settings .preview-open:hover, .settings .preview-open:focus-visible { background: rgba(255,255,255,.12); outline: none; }
  .settings .notice { min-height: 18px; margin: 6px 0 0; color: #ffb26b; }
  .settings .close { margin-top: 6px; text-align: right; }
  .settings .close button { display: inline-block; width: auto; padding: 3px 10px; background: rgba(255,255,255,.10); }
  .preview[hidden], .preview-menu[hidden], .preview [hidden] { display: none !important; }
  .preview {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55); pointer-events: auto;
  }
  .preview-dialog {
    position: relative; box-sizing: border-box;
    width: min(86vw, 980px); max-height: 86vh; display: flex; flex-direction: column;
    padding: 12px; color: #f2f4f7; background: #1c1f26; border: 1px solid rgba(255,255,255,.14);
    border-radius: 10px; box-shadow: 0 18px 48px rgba(0,0,0,.5);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .preview-title { margin: 0 28px 8px 0; font-size: 13px; font-weight: 600; }
  .preview-close {
    position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; padding: 0;
    color: inherit; background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: 16px; line-height: 1;
  }
  .preview-close:hover, .preview-close:focus-visible { background: rgba(255,255,255,.12); outline: none; }
  .preview-body { flex: 1; min-height: 120px; overflow: auto; display: flex; align-items: center; justify-content: center; }
  .preview-body img { display: block; max-width: 100%; max-height: 70vh; object-fit: contain; }
  .preview-missing { padding: 36px 16px; color: #9aa2b1; text-align: center; }
  .preview-status { min-height: 18px; margin: 6px 0 0; color: #7bd88f; }
  .fixed-pet {
    position: fixed; pointer-events: auto; z-index: 2147483000;
    cursor: grab; user-select: none; touch-action: none;
    /* No drop-shadow: for table-edge frames it painted a straight horizontal
       shadow band under the character, making the GIF look like a framed image. */
  }
  .fixed-pet:active { cursor: grabbing; }
  .desktop-banner {
    position: fixed; pointer-events: auto; z-index: 2147483000;
    cursor: grab; user-select: none; touch-action: none;
  }
  .desktop-banner:active { cursor: grabbing; }
  .desktop-banner[hidden] { display: none !important; }
  .desktop-banner img { display: block; width: 100%; height: 100%; pointer-events: none; user-select: none; }
  .banner-resize {
    position: absolute; right: 6px; bottom: 6px; width: 18px; height: 18px;
    border: 2px solid #fff; border-radius: 50%; background: #4f8cff;
    box-shadow: 0 2px 8px rgba(0,0,0,.35); cursor: nwse-resize; pointer-events: auto;
  }
  .settings .banner-row {
    margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.12);
  }
  .preview-menu {
    position: fixed; padding: 4px; min-width: 108px; pointer-events: auto;
    color: #f2f4f7; background: #1c1f26; border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.45);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .preview-menu button {
    display: block; width: 100%; padding: 6px 10px; color: inherit; background: transparent;
    border: 0; border-radius: 6px; font: inherit; text-align: left; cursor: pointer;
  }
  .preview-menu button:hover, .preview-menu button:focus-visible { background: rgba(255,255,255,.12); outline: none; }
`;
		/** localStorage without throwing (private mode / disabled storage). */
		function safeStorage(window) {
			try {
				return window.localStorage;
			} catch {
				return null;
			}
		}
		/** Default three-view loader: one network request per preview open, reused for copying. */
		async function defaultLoadThreeView(url) {
			const response = await fetch(url, { credentials: "include" });
			if (!response.ok) throw new Error(`three-view asset missing: ${response.status}`);
			const contentType = response.headers.get("content-type") ?? "";
			if (!contentType.startsWith("image/")) throw new Error(`three-view asset is not an image: ${contentType}`);
			const blob = await response.blob();
			return {
				blob,
				objectUrl: URL.createObjectURL(blob)
			};
		}
		/** Default asset release for the object URL created by the loader. */
		function defaultReleaseThreeView(objectUrl) {
			try {
				URL.revokeObjectURL(objectUrl);
			} catch {}
		}
		/** Canvas fallback: non-PNG three-view sources are re-encoded before clipboard.write. */
		async function defaultToPngBlob(blob) {
			const objectUrl = URL.createObjectURL(blob);
			try {
				const image = new Image();
				await new Promise((resolve, reject) => {
					image.onload = () => resolve(void 0);
					image.onerror = () => reject(/* @__PURE__ */ new Error("three-view decode failed"));
					image.src = objectUrl;
				});
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, image.naturalWidth);
				canvas.height = Math.max(1, image.naturalHeight);
				const context = canvas.getContext("2d");
				if (context === null) throw new Error("2d canvas unavailable");
				context.drawImage(image, 0, 0);
				const pngBlob = await new Promise((resolve) => {
					canvas.toBlob(resolve, "image/png");
				});
				if (pngBlob === null) throw new Error("png encode failed");
				return pngBlob;
			} finally {
				URL.revokeObjectURL(objectUrl);
			}
		}
		/** Mount the singleton overlay; returns the plugin-facing handle. */
		function mountOverlay(options = {}) {
			const document = options.document ?? globalThis.document;
			const window = options.window ?? globalThis.window;
			if (!document || !window) throw new Error("mountOverlay needs a document and a window");
			const animations = (Array.isArray(options.animations) ? options.animations : ANIMATIONS).filter((animation) => animation && animation.enabled !== false);
			const animationLibrary = animations.some((animation) => animation.id === TIRED_ANIMATION.id) ? animations : [...animations, TIRED_ANIMATION];
			const storage = options.storage ?? safeStorage(window);
			const random = options.random ?? Math.random;
			const size = Math.max(16, options.sizePx ?? DEFAULTS.sizePx);
			Math.max(0, options.gapPx ?? DEFAULTS.gapPx);
			Math.max(0, options.edgePx ?? DEFAULTS.edgePx);
			const zIndex = Math.max(1, options.zIndex ?? DEFAULTS.zIndex);
			const standardScale = options.standardScale ?? HOVER_DEFAULTS.scale;
			const arbitrationGap = Math.max(0, options.arbitrationGapPx ?? ANIMATION_ARBITRATION_GAP);
			const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
			const fixedSize = Math.max(40, options.fixedSizePx ?? FIXED_DEFAULTS.sizePx);
			const fixedMargin = Math.max(0, options.fixedMarginPx ?? FIXED_DEFAULTS.marginPx);
			const bannerMargin = Math.max(0, options.bannerMarginPx ?? BANNER_DEFAULTS.marginPx);
			let bannerState = null;
			let bannerDrag = null;
			let bannerVisible = parseBannerVisible(storage?.getItem?.("dsh-anime-desktop-pet/banner-visible") ?? null);
			let running = /* @__PURE__ */ new Map();
			const loadThreeView = options.loadThreeView ?? defaultLoadThreeView;
			const releaseThreeView = options.releaseThreeView ?? defaultReleaseThreeView;
			const toPngBlob = options.toPngBlob ?? defaultToPngBlob;
			const clipboard = options.clipboard ?? window.navigator?.clipboard ?? null;
			const ClipboardItemCtor = options.ClipboardItemCtor ?? window.ClipboardItem ?? globalThis.ClipboardItem ?? null;
			let previewState = null;
			let savedOverflow = null;
			let fixedPosition = null;
			let fixedDrag = null;
			let uiHidden = !parseOverlayVisible(storage?.getItem?.("dsh-anime-desktop-pet/overlay-visible") ?? null);
			let selection = normalizeSelection(parseSelection(storage?.getItem?.("dsh-anime-desktop-pet/selection") ?? null), animations);
			let destroyed = false;
			let frame = null;
			let boxes = [];
			const nodes = /* @__PURE__ */ new Map();
			const bindings = /* @__PURE__ */ new Map();
			const host = document.createElement("div");
			host.setAttribute("data-xllh-pet-host", "");
			host.style.position = "fixed";
			host.style.inset = "0";
			host.style.pointerEvents = "none";
			host.style.zIndex = String(zIndex);
			host.style.display = uiHidden ? "none" : "";
			const shadow = host.attachShadow({ mode: "open" });
			const style = document.createElement("style");
			style.textContent = STYLE$1;
			shadow.append(style);
			const layer = document.createElement("div");
			layer.className = "layer";
			layer.style.pointerEvents = "none";
			shadow.append(layer);
			const bannerWrap = document.createElement("div");
			bannerWrap.className = "desktop-banner";
			bannerWrap.setAttribute("data-xllh-banner", "");
			bannerWrap.setAttribute("role", "img");
			bannerWrap.setAttribute("aria-label", "蓝色大肥鱼！编程！启动~");
			bannerWrap.style.position = "fixed";
			bannerWrap.style.pointerEvents = "auto";
			bannerWrap.style.zIndex = String(zIndex);
			const bannerImg = document.createElement("img");
			bannerImg.setAttribute("data-xllh-banner-image", "");
			bannerImg.alt = "";
			bannerImg.draggable = false;
			bannerImg.src = bannerUrl();
			const bannerResize = document.createElement("span");
			bannerResize.className = "banner-resize";
			bannerResize.setAttribute("data-xllh-banner-resize", "");
			bannerResize.setAttribute("aria-hidden", "true");
			bannerResize.title = "拖动调整横幅大小";
			bannerWrap.append(bannerImg, bannerResize);
			shadow.append(bannerWrap);
			const fixedPet = document.createElement("img");
			fixedPet.className = "fixed-pet";
			fixedPet.setAttribute("data-xllh-pet-fixed", "");
			fixedPet.setAttribute("role", "img");
			fixedPet.setAttribute("aria-label", `${FIXED_PET.name}桌宠`);
			fixedPet.draggable = false;
			fixedPet.src = fixedPetUrl();
			fixedPet.style.position = "fixed";
			fixedPet.style.pointerEvents = "auto";
			fixedPet.style.width = `${fixedSize}px`;
			fixedPet.style.height = `${fixedSize}px`;
			fixedPet.style.zIndex = String(zIndex);
			shadow.append(fixedPet);
			const menu = document.createElement("div");
			menu.className = "menu";
			menu.setAttribute("data-xllh-pet-menu", "");
			menu.setAttribute("role", "menu");
			menu.hidden = true;
			menu.style.pointerEvents = "auto";
			menu.style.zIndex = String(zIndex + 1);
			const settingsButton = document.createElement("button");
			settingsButton.type = "button";
			settingsButton.setAttribute("role", "menuitem");
			settingsButton.textContent = "设置";
			settingsButton.addEventListener("click", () => {
				hideMenu();
				openSettings();
			});
			menu.append(settingsButton);
			shadow.append(menu);
			const settings = document.createElement("div");
			settings.className = "settings";
			settings.setAttribute("data-xllh-pet-settings", "");
			settings.setAttribute("role", "dialog");
			settings.setAttribute("aria-label", "动画设置");
			settings.hidden = true;
			settings.style.pointerEvents = "auto";
			settings.style.zIndex = String(zIndex + 1);
			settings.style.left = "50%";
			settings.style.top = "50%";
			settings.style.transform = "translate(-50%, -50%)";
			shadow.append(settings);
			const previewRoot = document.createElement("div");
			previewRoot.className = "preview";
			previewRoot.setAttribute("data-xllh-pet-preview", "");
			previewRoot.hidden = true;
			previewRoot.style.zIndex = String(zIndex + 3);
			previewRoot.style.pointerEvents = "auto";
			const previewDialog = document.createElement("div");
			previewDialog.className = "preview-dialog";
			previewDialog.setAttribute("data-xllh-pet-preview-dialog", "");
			previewDialog.setAttribute("role", "dialog");
			previewDialog.setAttribute("aria-modal", "true");
			const previewTitle = document.createElement("h2");
			previewTitle.className = "preview-title";
			previewTitle.setAttribute("data-xllh-pet-preview-title", "");
			const previewClose = document.createElement("button");
			previewClose.type = "button";
			previewClose.className = "preview-close";
			previewClose.setAttribute("data-xllh-pet-preview-close", "");
			previewClose.setAttribute("aria-label", PREVIEW_MESSAGES.close);
			previewClose.textContent = "×";
			const previewBody = document.createElement("div");
			previewBody.className = "preview-body";
			const previewImage = document.createElement("img");
			previewImage.setAttribute("data-xllh-pet-preview-image", "");
			previewImage.alt = "";
			previewImage.hidden = true;
			const previewMissing = document.createElement("div");
			previewMissing.className = "preview-missing";
			previewMissing.setAttribute("data-xllh-pet-preview-missing", "");
			previewMissing.textContent = PREVIEW_MESSAGES.missing;
			previewMissing.hidden = true;
			previewBody.append(previewImage, previewMissing);
			const previewStatus = document.createElement("p");
			previewStatus.className = "preview-status";
			previewStatus.setAttribute("role", "status");
			previewStatus.setAttribute("aria-live", "polite");
			previewDialog.append(previewTitle, previewClose, previewBody, previewStatus);
			previewRoot.append(previewDialog);
			shadow.append(previewRoot);
			const previewMenu = document.createElement("div");
			previewMenu.className = "preview-menu";
			previewMenu.setAttribute("data-xllh-pet-preview-menu", "");
			previewMenu.setAttribute("role", "menu");
			previewMenu.hidden = true;
			previewMenu.style.zIndex = String(zIndex + 4);
			previewMenu.style.pointerEvents = "auto";
			const previewCopyButton = document.createElement("button");
			previewCopyButton.type = "button";
			previewCopyButton.setAttribute("role", "menuitem");
			previewCopyButton.setAttribute("data-xllh-pet-preview-copy", "");
			previewCopyButton.textContent = PREVIEW_MESSAGES.copy;
			previewMenu.append(previewCopyButton);
			shadow.append(previewMenu);
			document.body.append(host);
			persist();
			applyStoredFixedPosition();
			applyStoredBannerState();
			function persist() {
				try {
					storage?.setItem?.(STORAGE_KEY, serializeSelection(selection));
				} catch {}
			}
			function viewportSize() {
				return {
					width: window.innerWidth,
					height: window.innerHeight
				};
			}
			function applyFixedPosition() {
				if (fixedPosition === null) return;
				fixedPet.style.left = `${fixedPosition.x}px`;
				fixedPet.style.top = `${fixedPosition.y}px`;
			}
			function persistFixedPosition() {
				if (fixedPosition === null) return;
				try {
					storage?.setItem?.(FIXED_POSITION_KEY, serializeFixedPosition(fixedPosition));
				} catch {}
			}
			function applyStoredFixedPosition() {
				const stored = parseFixedPosition(storage?.getItem?.("dsh-anime-desktop-pet/fixed-position") ?? null);
				const fallback = defaultFixedPosition(viewportSize(), fixedSize, fixedMargin) ?? {
					x: fixedMargin,
					y: fixedMargin
				};
				fixedPosition = clampFixedPosition(stored ?? fallback, viewportSize(), fixedSize, fixedMargin) ?? fallback;
				applyFixedPosition();
			}
			function clampFixedPositionNow() {
				if (fixedPosition === null) return;
				const next = clampFixedPosition(fixedPosition, viewportSize(), fixedSize, fixedMargin);
				if (next !== null) {
					fixedPosition = next;
					applyFixedPosition();
				}
			}
			function applyBannerState() {
				if (bannerState === null) return;
				const size = bannerSize(bannerState.width);
				bannerWrap.style.width = `${size.width}px`;
				bannerWrap.style.height = `${size.height}px`;
				bannerWrap.style.left = `${bannerState.x}px`;
				bannerWrap.style.top = `${bannerState.y}px`;
				bannerWrap.hidden = !bannerVisible;
			}
			function persistBannerState() {
				if (bannerState === null) return;
				try {
					storage?.setItem?.(BANNER_POSITION_KEY, serializeBannerState(bannerState));
				} catch {}
			}
			function applyStoredBannerState() {
				const stored = parseBannerState(storage?.getItem?.("dsh-anime-desktop-pet/banner-position") ?? null);
				const width = clampBannerWidth(stored?.width ?? BANNER_DEFAULTS.widthPx);
				const fallback = defaultBannerPosition(viewportSize(), width, bannerMargin) ?? {
					x: bannerMargin,
					y: bannerMargin
				};
				const position = clampBannerPosition(stored ?? fallback, viewportSize(), width, bannerMargin) ?? fallback;
				bannerState = {
					x: position.x,
					y: position.y,
					width
				};
				applyBannerState();
			}
			function clampBannerNow() {
				if (bannerState === null) return;
				const position = clampBannerPosition(bannerState, viewportSize(), bannerState.width, bannerMargin);
				if (position === null) return;
				bannerState = {
					...position,
					width: bannerState.width
				};
				applyBannerState();
			}
			function setBannerVisible(visible) {
				bannerVisible = Boolean(visible);
				try {
					storage?.setItem?.(BANNER_VISIBLE_KEY, String(bannerVisible));
				} catch {}
				if (bannerVisible && bannerState === null) applyStoredBannerState();
				applyBannerState();
			}
			function onBannerPointerDown(event) {
				if (destroyed || uiHidden || event.button !== 0 || bannerState === null) return;
				bannerDrag = {
					mode: event.target === bannerResize || typeof event.target?.closest === "function" && event.target.closest("[data-xllh-banner-resize]") !== null ? "resize" : "move",
					startX: event.clientX,
					startY: event.clientY,
					originX: bannerState.x,
					originY: bannerState.y,
					originWidth: bannerState.width,
					moved: false
				};
				bannerWrap.setPointerCapture?.(event.pointerId);
				document.addEventListener("pointermove", onBannerPointerMove, true);
				document.addEventListener("pointerup", onBannerPointerUp, true);
				event.preventDefault();
			}
			function onBannerPointerMove(event) {
				if (bannerDrag === null) return;
				const dx = event.clientX - bannerDrag.startX;
				const dy = event.clientY - bannerDrag.startY;
				if (!bannerDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) bannerDrag.moved = true;
				if (bannerDrag.mode === "resize") {
					const width = clampBannerWidth(bannerDrag.originWidth + dx);
					const position = clampBannerPosition({
						x: bannerDrag.originX,
						y: bannerDrag.originY
					}, viewportSize(), width, bannerMargin);
					if (position === null) return;
					bannerState = {
						x: position.x,
						y: position.y,
						width
					};
				} else {
					const position = clampBannerPosition({
						x: bannerDrag.originX + dx,
						y: bannerDrag.originY + dy
					}, viewportSize(), bannerState.width, bannerMargin);
					if (position === null) return;
					bannerState = {
						...position,
						width: bannerState.width
					};
				}
				applyBannerState();
			}
			function onBannerPointerUp() {
				if (bannerDrag === null) return;
				document.removeEventListener("pointermove", onBannerPointerMove, true);
				document.removeEventListener("pointerup", onBannerPointerUp, true);
				if (bannerDrag.moved) persistBannerState();
				bannerDrag = null;
			}
			function onFixedPointerDown(event) {
				if (destroyed || uiHidden || event.button !== 0 || fixedPosition === null) return;
				fixedDrag = {
					startX: event.clientX,
					startY: event.clientY,
					originX: fixedPosition.x,
					originY: fixedPosition.y,
					moved: false
				};
				fixedPet.setPointerCapture?.(event.pointerId);
				document.addEventListener("pointermove", onFixedPointerMove, true);
				document.addEventListener("pointerup", onFixedPointerUp, true);
				event.preventDefault();
			}
			function onFixedPointerMove(event) {
				if (fixedDrag === null) return;
				const dx = event.clientX - fixedDrag.startX;
				const dy = event.clientY - fixedDrag.startY;
				if (!fixedDrag.moved && Math.abs(dx) + Math.abs(dy) > 3) fixedDrag.moved = true;
				const next = clampFixedPosition({
					x: fixedDrag.originX + dx,
					y: fixedDrag.originY + dy
				}, viewportSize(), fixedSize, fixedMargin);
				if (next === null) return;
				fixedPosition = next;
				applyFixedPosition();
				schedule();
			}
			function onFixedPointerUp() {
				if (fixedDrag === null) return;
				document.removeEventListener("pointermove", onFixedPointerMove, true);
				document.removeEventListener("pointerup", onFixedPointerUp, true);
				if (fixedDrag.moved) persistFixedPosition();
				fixedDrag = null;
				schedule();
			}
			function onFixedContextMenu(event) {
				if (destroyed || uiHidden) return;
				event.preventDefault();
				event.stopPropagation();
				openMenu(event.clientX, event.clientY);
			}
			function toggleVisibility() {
				uiHidden = !uiHidden;
				host.style.display = uiHidden ? "none" : "";
				try {
					storage?.setItem?.(OVERLAY_VISIBLE_KEY, String(!uiHidden));
				} catch {}
				if (uiHidden) {
					hideMenu();
					hideSettings();
					closePreview();
					hidePreviewMenu();
					onFixedPointerUp();
				} else schedule();
			}
			function animationById(id) {
				return animationLibrary.find((animation) => animation.id === id);
			}
			function showAnimation(node, animationId) {
				const animation = animationById(animationId);
				if (animation === void 0) {
					node.el.hidden = true;
					return;
				}
				if (node.animationId !== animationId) {
					node.animationId = animationId;
					node.img.hidden = false;
					node.canvas.hidden = true;
					node.img.src = animationUrl(animation);
					node.img.alt = animation.name;
					node.img.dataset.animationId = animationId;
					renderStillFrame(node);
				}
			}
			/** Static first frame for prefers-reduced-motion: canvas holds one decode, no loop. */
			function renderStillFrame(node) {
				if (!reduceMotion || node.img.complete !== true || node.img.naturalWidth === 0) return;
				try {
					node.canvas.width = node.img.naturalWidth;
					node.canvas.height = node.img.naturalHeight;
					const context = node.canvas.getContext("2d");
					if (context === null) return;
					context.drawImage(node.img, 0, 0);
					node.img.hidden = true;
					node.canvas.hidden = false;
				} catch {}
			}
			function ensureNode(id, kind) {
				const existing = nodes.get(id);
				if (existing !== void 0) return existing;
				const el = document.createElement("div");
				el.className = "pet";
				el.setAttribute("aria-hidden", "true");
				if (kind === "workspace") {
					el.setAttribute("data-xllh-workspace-animation", "");
					el.setAttribute("data-workspace-id", id);
				} else {
					el.setAttribute("data-xllh-pet", "");
					el.setAttribute("data-session-id", id);
				}
				el.style.position = "fixed";
				el.style.pointerEvents = "none";
				el.style.zIndex = String(zIndex);
				el.style.borderRadius = `15px`;
				el.style.overflow = "hidden";
				el.style.clipPath = `inset(0 round 15px)`;
				const img = document.createElement("img");
				img.src = "";
				img.alt = "";
				img.draggable = false;
				img.style.pointerEvents = "none";
				img.style.borderRadius = "inherit";
				const canvas = document.createElement("canvas");
				canvas.hidden = true;
				canvas.setAttribute("aria-hidden", "true");
				canvas.style.pointerEvents = "none";
				canvas.style.borderRadius = "inherit";
				el.append(img, canvas);
				layer.append(el);
				const node = {
					el,
					img,
					canvas,
					animationId: null
				};
				img.addEventListener("load", () => renderStillFrame(node));
				nodes.set(id, node);
				return node;
			}
			/** Accept legacy Map<id,true> and the richer Map<id,SessionSummary>; true alone = no metadata. */
			function runningEntries(runningBySession) {
				const map = /* @__PURE__ */ new Map();
				if (runningBySession instanceof Map) {
					for (const [id, value] of runningBySession) if (value) map.set(String(id), value && typeof value === "object" ? value : null);
				} else if (runningBySession && typeof runningBySession === "object") {
					for (const [id, value] of Object.entries(runningBySession)) if (value) map.set(id, value && typeof value === "object" ? value : null);
				}
				return map;
			}
			function update(runningBySession) {
				if (destroyed) return;
				running = runningEntries(runningBySession);
				schedule();
			}
			function rowVisible(rect) {
				return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
			}
			/** Basename of a session cwd; used to map hidden (collapsed-workspace) sessions. */
			function cwdBasename(meta) {
				if (meta === null || typeof meta !== "object" || typeof meta.cwd !== "string") return "";
				const parts = meta.cwd.split(/[\\/]/).filter((part) => part !== "");
				return parts.length === 0 ? "" : parts[parts.length - 1];
			}
			function median(values) {
				if (values.length === 0) return 0;
				const sorted = [...values].sort((a, b) => a - b);
				return sorted[Math.floor(sorted.length / 2)];
			}
			function render() {
				frame = null;
				if (destroyed) return;
				const rows = [];
				const sessionRowIds = /* @__PURE__ */ new Set();
				const sessionHeights = [];
				const workspaceHeights = [];
				const workRows = [];
				for (const row of document.querySelectorAll("[data-row-key]")) {
					const key = row.getAttribute("data-row-key") ?? "";
					const rect = row.getBoundingClientRect();
					if (![
						rect.left,
						rect.top,
						rect.width,
						rect.height
					].every(Number.isFinite)) continue;
					const sessionId = parseSessionRowKey(key);
					if (sessionId !== null) {
						if (rect.height > 0) sessionHeights.push(rect.height);
						sessionRowIds.add(sessionId);
						if (running.has(sessionId) && rowVisible(rect)) {
							const meta = running.get(sessionId);
							rows.push({
								id: sessionId,
								kind: "conversation",
								running: true,
								anchorRect: rect,
								contextPercent: Number.isFinite(meta?.contextPercent) ? meta.contextPercent : null
							});
						}
						continue;
					}
					if (key.startsWith("workspace:")) {
						if (rect.height > 0) workspaceHeights.push(rect.height);
						workRows.push({
							key,
							row,
							rect,
							collapsed: row.getAttribute("aria-expanded") === "false"
						});
					}
				}
				const hiddenRunning = [...running.keys()].filter((id) => !sessionRowIds.has(id));
				for (const workspace of workRows) {
					if (!workspace.collapsed) continue;
					const name = (workspace.row.textContent ?? "").trim();
					if (name === "") continue;
					const matched = hiddenRunning.filter((id) => cwdBasename(running.get(id)) === name);
					if (matched.length === 0 || !rowVisible(workspace.rect)) continue;
					const percents = matched.map((id) => running.get(id)?.contextPercent).filter((percent) => Number.isFinite(percent));
					rows.push({
						id: workspace.key,
						kind: "workspace",
						running: true,
						anchorRect: workspace.rect,
						contextPercent: percents.length === 0 ? null : Math.max(...percents)
					});
				}
				const basePx = median(sessionHeights) || median(workspaceHeights) || size;
				const animationSize = Math.max(1, Math.round(options.standardSizePx ?? standardAnimationSize(basePx, standardScale)));
				let benchmarkRect = null;
				const fixedRect = fixedPet.getBoundingClientRect();
				if (rowVisible(fixedRect)) benchmarkRect = {
					left: fixedRect.left,
					top: fixedRect.top,
					right: fixedRect.right,
					bottom: fixedRect.bottom
				};
				const result = computeAnimationPlacements({
					candidates: rows,
					size: animationSize,
					gap: arbitrationGap,
					benchmarkRect
				});
				const placements = [...result.placements];
				if (running.size >= 3 && placements.length === 1 && rows.length >= 2) {
					const placed = placements[0];
					const hidden = rows.find((candidate) => !result.visibleIds.includes(candidate.id));
					if (hidden !== void 0) {
						const left = placed.rect.left;
						const naturalTop = hidden.anchorRect.top + (hidden.anchorRect.height - animationSize) / 2;
						const overlapsPlaced = (top) => {
							return rectsOverlap({
								left,
								top,
								right: left + animationSize,
								bottom: top + animationSize
							}, placed.rect, arbitrationGap);
						};
						let top = naturalTop;
						if (overlapsPlaced(top)) {
							const below = placed.rect.bottom + arbitrationGap;
							const above = placed.rect.top - arbitrationGap - animationSize;
							if (below + animationSize <= window.innerHeight) top = below;
							else if (above >= 0) top = above;
							else top = null;
						}
						if (top !== null) {
							const rect = {
								left,
								top,
								width: animationSize,
								height: animationSize,
								right: left + animationSize,
								bottom: top + animationSize
							};
							const fits = left >= 0 && top >= 0 && left + animationSize <= window.innerWidth && top + animationSize <= window.innerHeight;
							const overlapsBenchmark = benchmarkRect !== null && rectsOverlap(rect, benchmarkRect, arbitrationGap);
							if (fits && !overlapsBenchmark) placements.push({
								id: hidden.id,
								kind: hidden.kind,
								rect
							});
						}
					}
				}
				try {
					window.__DSH_ANIME_PET_DEBUG__ = {
						runningIds: [...running.keys()],
						candidates: rows.map((candidate) => ({
							id: candidate.id,
							kind: candidate.kind,
							top: Math.round(candidate.anchorRect.top),
							height: Math.round(candidate.anchorRect.height),
							contextPercent: candidate.contextPercent
						})),
						placements: placements.map((placement) => placement.id),
						animationSize
					};
				} catch {}
				const visible = new Set(placements.map((placement) => placement.id));
				for (const [id, node] of nodes) {
					if (visible.has(id)) continue;
					node.el.remove();
					nodes.delete(id);
					bindings.delete(id);
				}
				const candidatesById = new Map(rows.map((candidate) => [candidate.id, candidate]));
				boxes = [];
				for (const placement of placements) {
					const node = ensureNode(placement.id, placement.kind);
					const contextPercent = candidatesById.get(placement.id)?.contextPercent ?? null;
					showAnimation(node, selectContextAnimation(selection, contextPercent) ?? bindAnimation(bindings, placement.id, selection, random));
					const rect = placement.rect;
					node.el.style.width = `${animationSize}px`;
					node.el.style.height = `${animationSize}px`;
					node.el.style.left = `${Math.round(rect.left)}px`;
					node.el.style.top = `${Math.round(rect.top)}px`;
					boxes.push({
						id: placement.id,
						kind: placement.kind,
						sessionId: placement.kind === "conversation" ? placement.id : null,
						left: rect.left,
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom,
						visible: true
					});
				}
				clampFixedPositionNow();
				clampBannerNow();
			}
			function schedule() {
				if (destroyed || frame !== null) return;
				if (typeof window.requestAnimationFrame === "function") frame = window.requestAnimationFrame(render);
				else frame = window.setTimeout(render, 16);
			}
			function cancelFrame() {
				if (frame === null) return;
				if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
				else window.clearTimeout(frame);
				frame = null;
			}
			function hideMenu() {
				menu.hidden = true;
			}
			function openMenu(clientX, clientY) {
				menu.hidden = false;
				menu.style.left = `${Math.round(Math.min(clientX, window.innerWidth - 140))}px`;
				menu.style.top = `${Math.round(Math.min(clientY, window.innerHeight - 60))}px`;
				settingsButton.focus();
			}
			function renderSettings() {
				settings.replaceChildren();
				const title = document.createElement("h2");
				title.textContent = "动画设置";
				settings.append(title);
				for (const animation of animations) {
					const row = document.createElement("div");
					row.className = "role-row";
					row.setAttribute("data-xllh-pet-role", animation.id);
					const label = document.createElement("label");
					const checkbox = document.createElement("input");
					checkbox.type = "checkbox";
					checkbox.checked = selection.includes(animation.id);
					if (animations.length <= 1) {
						checkbox.disabled = true;
						label.setAttribute("data-locked", "");
					}
					checkbox.addEventListener("change", () => toggleSelection(animation.id, checkbox.checked));
					const name = document.createElement("span");
					name.textContent = animation.name;
					label.append(checkbox, name);
					row.append(label);
					if (hasThreeView(animation)) {
						const viewButton = document.createElement("button");
						viewButton.type = "button";
						viewButton.className = "preview-open";
						viewButton.setAttribute("data-xllh-pet-preview-open", animation.id);
						viewButton.setAttribute("aria-label", PREVIEW_MESSAGES.actionLabel(characterLabel(animation)));
						viewButton.title = PREVIEW_MESSAGES.actionLabel(characterLabel(animation));
						viewButton.innerHTML = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\" focusable=\"false\"><rect x=\"1.5\" y=\"3\" width=\"13\" height=\"10\" rx=\"2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"6\" cy=\"6.8\" r=\"1.1\" fill=\"currentColor\"/><path d=\"M3.2 12l3.1-3.2 2.2 2.1 2-1.7 2.3 2.8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.1\"/></svg>";
						viewButton.addEventListener("click", (event) => {
							event.preventDefault();
							event.stopPropagation();
							openPreview(animation, viewButton);
						});
						row.append(viewButton);
					}
					settings.append(row);
				}
				const bannerRow = document.createElement("label");
				bannerRow.className = "banner-row";
				const bannerToggle = document.createElement("input");
				bannerToggle.type = "checkbox";
				bannerToggle.setAttribute("data-xllh-banner-toggle", "");
				bannerToggle.checked = bannerVisible;
				bannerToggle.addEventListener("change", () => setBannerVisible(bannerToggle.checked));
				const bannerLabel = document.createElement("span");
				bannerLabel.textContent = "展示桌面横幅";
				bannerRow.append(bannerToggle, bannerLabel);
				settings.append(bannerRow);
				const notice = document.createElement("p");
				notice.className = "notice";
				notice.setAttribute("role", "status");
				notice.setAttribute("aria-live", "polite");
				settings.append(notice);
				const close = document.createElement("div");
				close.className = "close";
				const closeButton = document.createElement("button");
				closeButton.type = "button";
				closeButton.textContent = "关闭";
				closeButton.addEventListener("click", () => hideSettings());
				close.append(closeButton);
				settings.append(close);
			}
			function setNotice(message) {
				const notice = settings.querySelector("[role=\"status\"]");
				if (notice !== null) notice.textContent = message;
			}
			function toggleSelection(id, checked) {
				const result = selectionAfterToggle(selection, id, animations);
				if (result.blocked) {
					setNotice(SETTINGS_MESSAGES[result.reason] ?? "");
					renderSettings();
					setNotice(SETTINGS_MESSAGES[result.reason] ?? "");
					return;
				}
				applySelection(result.selected);
				renderSettings();
				setNotice("");
			}
			function applySelection(ids) {
				selection = normalizeSelection(ids, animations);
				persist();
				schedule();
			}
			function openSettings() {
				hideMenu();
				renderSettings();
				settings.hidden = false;
				settings.querySelector("input")?.focus();
			}
			function hideSettings() {
				settings.hidden = true;
			}
			function showPreviewMissing() {
				previewImage.hidden = true;
				previewImage.removeAttribute("src");
				previewMissing.hidden = false;
			}
			/** Open the singleton three-view modal for one character (no backdrop-free conflict). */
			function openPreview(animation, trigger) {
				if (previewState !== null) return;
				const state = {
					animation,
					trigger,
					blob: null,
					objectUrl: null
				};
				previewState = state;
				const character = characterLabel(animation);
				previewTitle.textContent = `${character} · ${PREVIEW_MESSAGES.titleSuffix}`;
				previewDialog.setAttribute("aria-label", `${character} ${PREVIEW_MESSAGES.titleSuffix}`);
				previewImage.alt = `${character} ${PREVIEW_MESSAGES.titleSuffix}`;
				previewImage.hidden = true;
				previewImage.removeAttribute("src");
				previewMissing.hidden = true;
				previewStatus.textContent = "";
				savedOverflow = {
					documentElement: document.documentElement.style.overflow,
					body: document.body.style.overflow
				};
				document.documentElement.style.overflow = "hidden";
				document.body.style.overflow = "hidden";
				previewRoot.hidden = false;
				previewClose.focus();
				const url = threeViewUrl(animation);
				if (url === null) {
					previewMissing.hidden = false;
					return;
				}
				loadThreeView(url).then((asset) => {
					if (previewState !== state) {
						try {
							releaseThreeView(asset.objectUrl);
						} catch {}
						return;
					}
					state.blob = asset.blob;
					state.objectUrl = asset.objectUrl;
					previewImage.src = asset.objectUrl;
					previewImage.hidden = false;
					previewMissing.hidden = true;
				}).catch(() => {
					if (previewState !== state) return;
					showPreviewMissing();
				});
			}
			function closePreview() {
				if (previewState === null) return;
				const state = previewState;
				previewState = null;
				hidePreviewMenu();
				previewRoot.hidden = true;
				previewImage.hidden = true;
				previewImage.removeAttribute("src");
				previewMissing.hidden = true;
				previewStatus.textContent = "";
				if (state.objectUrl !== null) releaseThreeView(state.objectUrl);
				if (savedOverflow !== null) {
					document.documentElement.style.overflow = savedOverflow.documentElement;
					document.body.style.overflow = savedOverflow.body;
					savedOverflow = null;
				}
				state.trigger?.focus?.();
			}
			function previewFocusables() {
				return [...previewDialog.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")].filter((element) => !element.hidden);
			}
			/** Keep keyboard focus inside the modal while it is open. */
			function trapPreviewTab(event) {
				const focusables = previewFocusables();
				if (focusables.length === 0) return;
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				const active = shadow.activeElement ?? document.activeElement;
				if (event.shiftKey) {
					if (active === first || !previewDialog.contains(active)) {
						event.preventDefault();
						last.focus();
					}
					return;
				}
				if (active === last || !previewDialog.contains(active)) {
					event.preventDefault();
					first.focus();
				}
			}
			previewClose.addEventListener("click", () => closePreview());
			previewRoot.addEventListener("click", (event) => {
				if (event.target === previewRoot) closePreview();
			});
			previewImage.addEventListener("contextmenu", (event) => {
				if (previewState === null) return;
				event.preventDefault();
				event.stopPropagation();
				openPreviewMenu(event.clientX, event.clientY);
			});
			previewImage.addEventListener("error", () => {
				if (previewState !== null) showPreviewMissing();
			});
			previewCopyButton.addEventListener("click", () => {
				hidePreviewMenu();
				copyPreviewImage();
			});
			fixedPet.addEventListener("pointerdown", onFixedPointerDown);
			fixedPet.addEventListener("contextmenu", onFixedContextMenu);
			bannerWrap.addEventListener("pointerdown", onBannerPointerDown);
			function setPreviewStatus(text) {
				previewStatus.textContent = text ?? "";
			}
			function hidePreviewMenu() {
				previewMenu.hidden = true;
			}
			function openPreviewMenu(clientX, clientY) {
				previewMenu.hidden = false;
				previewMenu.style.left = `${Math.round(Math.min(clientX, window.innerWidth - 150))}px`;
				previewMenu.style.top = `${Math.round(Math.min(clientY, window.innerHeight - 80))}px`;
				previewCopyButton.focus();
			}
			/** Copy the ALREADY LOADED three-view blob (no second network request). */
			async function copyPreviewImage() {
				const state = previewState;
				if (state === null || state.blob === null) {
					if (state !== null) setPreviewStatus(PREVIEW_MESSAGES.copyFailed);
					return;
				}
				if (state.copying === true) return;
				state.copying = true;
				try {
					const pngBlob = state.blob.type === "image/png" ? state.blob : await toPngBlob(state.blob);
					if (previewState !== state) return;
					if (clipboard === null || typeof clipboard.write !== "function" || ClipboardItemCtor === null) throw new Error("clipboard unavailable");
					await clipboard.write([new ClipboardItemCtor({ "image/png": pngBlob })]);
					if (previewState === state) setPreviewStatus(PREVIEW_MESSAGES.copySuccess);
				} catch {
					if (previewState === state) setPreviewStatus(PREVIEW_MESSAGES.copyFailed);
				} finally {
					if (previewState === state) state.copying = false;
				}
			}
			function onPointerDown(event) {
				if (destroyed) return;
				const path = event.composedPath?.() ?? [];
				if (!previewMenu.hidden && !path.includes(previewMenu)) hidePreviewMenu();
				if (path.includes(host)) return;
				hideMenu();
				if (!settings.hidden) hideSettings();
			}
			function onKeyDown(event) {
				if (destroyed) return;
				if (event.ctrlKey && event.shiftKey && (event.key === "F12" || event.code === "F12")) {
					event.preventDefault();
					toggleVisibility();
					return;
				}
				if (previewState !== null) {
					if (event.key === "Escape") {
						event.preventDefault?.();
						if (!previewMenu.hidden) hidePreviewMenu();
						else closePreview();
						return;
					}
					if (event.key === "Tab" && previewMenu.hidden) {
						trapPreviewTab(event);
						return;
					}
					return;
				}
				if (event.key !== "Escape") return;
				if (!menu.hidden) hideMenu();
				if (!settings.hidden) hideSettings();
			}
			function onViewportChange() {
				schedule();
			}
			document.addEventListener("pointerdown", onPointerDown, true);
			document.addEventListener("keydown", onKeyDown, true);
			window.addEventListener("resize", onViewportChange, true);
			window.addEventListener("scroll", onViewportChange, true);
			const observer = typeof window.MutationObserver === "function" ? new window.MutationObserver(onViewportChange) : null;
			observer?.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: [
					"data-row-key",
					"style",
					"class",
					"aria-expanded"
				]
			});
			let resizeObserver = null;
			if (typeof window.ResizeObserver === "function") {
				resizeObserver = new window.ResizeObserver(onViewportChange);
				resizeObserver.observe(document.body);
			}
			return {
				update,
				openSettings,
				dispose() {
					if (destroyed) return;
					destroyed = true;
					cancelFrame();
					closePreview();
					hidePreviewMenu();
					onFixedPointerUp();
					onBannerPointerUp();
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("resize", onViewportChange, true);
					window.removeEventListener("scroll", onViewportChange, true);
					observer?.disconnect();
					resizeObserver?.disconnect();
					for (const node of nodes.values()) node.el.remove();
					nodes.clear();
					bindings.clear();
					boxes = [];
					host.remove();
				}
			};
		}
		//#endregion
		//#region src/client/scene-core.mjs
		/**
		* Pure scene logic: asset validation, normalized layout geometry, deterministic
		* random/stagger, pause rules and the single-active-state interaction machine.
		* The DOM renderer in scene.mjs only maps these decisions to nodes/CSS.
		*/
		/** Allowed draw layers, bottom to top. */
		const SCENE_LAYERS = [
			"L0",
			"L1",
			"L2",
			"L3",
			"L4"
		];
		/** Animation primitives supported by layout.json. */
		const SCENE_ANIMATION_TYPES = [
			"none",
			"float",
			"sway",
			"tailWave",
			"finWave",
			"blink",
			"bubbleRise",
			"lightSweep"
		];
		/** Persisted normalized positions for draggable scene elements. */
		const SCENE_POSITIONS_KEY = "dsh-anime-desktop-pet/scene-positions";
		/** Parse the positions map defensively; any invalid entry is ignored. */
		function parseScenePositions(raw) {
			if (typeof raw !== "string" || raw === "") return {};
			try {
				const value = JSON.parse(raw);
				if (!isObject(value)) return {};
				const clean = {};
				for (const [id, position] of Object.entries(value)) {
					if (typeof id !== "string" || !isObject(position)) continue;
					if (!isUnitNumber(position.x) || !isUnitNumber(position.y)) continue;
					clean[id] = {
						x: Number(position.x.toFixed(6)),
						y: Number(position.y.toFixed(6))
					};
				}
				return clean;
			} catch {
				return {};
			}
		}
		/** @param {Record<string, {x:number,y:number}>} positions */
		function serializeScenePositions(positions) {
			return JSON.stringify(positions ?? {});
		}
		const BREAKPOINTS = {
			wide: 1280,
			medium: 768
		};
		/** @typedef {'wide' | 'medium' | 'narrow'} SceneBreakpoint */
		/** @param {number} width @returns {SceneBreakpoint} */
		function sceneBreakpoint(width) {
			if (Number.isFinite(width) && width >= BREAKPOINTS.wide) return "wide";
			if (Number.isFinite(width) && width >= BREAKPOINTS.medium) return "medium";
			return "narrow";
		}
		/** @param {{width:number,height:number}} viewport */
		function sceneUnit(viewport) {
			const width = Number.isFinite(viewport?.width) ? viewport.width : 0;
			const height = Number.isFinite(viewport?.height) ? viewport.height : 0;
			return Math.max(1, Math.min(width || height || 1, height || width || 1));
		}
		function isObject(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function isUnitNumber(value) {
			return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
		}
		/** Validate manifest.json shape and @1x/@2x naming invariants. */
		function validateSceneManifest(manifest) {
			const errors = [];
			if (!isObject(manifest)) return {
				ok: false,
				errors: ["manifest must be an object"]
			};
			if (manifest.version !== 1) errors.push("manifest.version must be 1");
			if (!isObject(manifest.stage) || !(manifest.stage.width > 0) || !(manifest.stage.height > 0)) errors.push("manifest.stage must have positive width/height");
			if (!Array.isArray(manifest.slices) || manifest.slices.length === 0) {
				errors.push("manifest.slices must be a non-empty array");
				return {
					ok: false,
					errors
				};
			}
			const ids = /* @__PURE__ */ new Set();
			for (const [index, slice] of manifest.slices.entries()) {
				const label = `slices[${index}]`;
				if (!isObject(slice)) {
					errors.push(`${label} must be an object`);
					continue;
				}
				if (typeof slice.id !== "string" || slice.id === "") errors.push(`${label}.id is required`);
				else if (ids.has(slice.id)) errors.push(`${label}.id duplicated: ${slice.id}`);
				else ids.add(slice.id);
				if (!SCENE_LAYERS.includes(slice.layer)) errors.push(`${label}.layer invalid: ${slice.layer}`);
				if (!Array.isArray(slice.tags) || slice.tags.some((tag) => typeof tag !== "string")) errors.push(`${label}.tags must be string[]`);
				if (!isObject(slice.pivot) || !isUnitNumber(slice.pivot.x) || !isUnitNumber(slice.pivot.y)) errors.push(`${label}.pivot must be normalized 0..1`);
				if (!(Number.isInteger(slice.width) && slice.width > 1 && slice.width % 2 === 0)) errors.push(`${label}.width must be an even positive integer`);
				if (!(Number.isInteger(slice.height) && slice.height > 1 && slice.height % 2 === 0)) errors.push(`${label}.height must be an even positive integer`);
				if (typeof slice.file !== "string" || !slice.file.includes("@2x/") || !slice.file.includes(`/${slice.id}@2x.png`)) errors.push(`${label}.file must point at @2x/${slice.id}@2x.png`);
				if (typeof slice.file1x !== "string" || !slice.file1x.includes("@1x/") || !slice.file1x.includes(`/${slice.id}@1x.png`)) errors.push(`${label}.file1x must point at @1x/${slice.id}@1x.png`);
			}
			return {
				ok: errors.length === 0,
				errors
			};
		}
		/**
		* Validate layout.json against the manifest. Layout changes never require code edits.
		* @param {unknown} layout
		* @param {unknown} manifest
		*/
		function validateSceneLayout(layout, manifest) {
			const errors = [];
			if (!isObject(layout)) return {
				ok: false,
				errors: ["layout must be an object"]
			};
			if (layout.version !== 1) errors.push("layout.version must be 1");
			if (!Array.isArray(layout.elements) || layout.elements.length === 0) {
				errors.push("layout.elements must be a non-empty array");
				return {
					ok: false,
					errors
				};
			}
			if (layout.elements.length > 60) errors.push("layout.elements must stay <= 60 DOM nodes");
			if (layout.interactions !== void 0 && !isObject(layout.interactions)) errors.push("layout.interactions must be an object");
			if (layout.effects !== void 0 && !isObject(layout.effects)) errors.push("layout.effects must be an object");
			if (layout.effects?.lightSweep !== void 0) {
				const sweep = layout.effects.lightSweep;
				if (!isObject(sweep)) errors.push("layout.effects.lightSweep must be an object");
				else {
					if (sweep.durationMs !== void 0 && !(sweep.durationMs >= 8e3 && sweep.durationMs <= 15e3)) errors.push("lightSweep.durationMs out of range");
					if (sweep.opacity !== void 0 && !(sweep.opacity >= 0 && sweep.opacity <= .35)) errors.push("lightSweep.opacity out of range");
				}
			}
			if (layout.interactions?.petClick !== void 0) {
				const petClick = layout.interactions.petClick;
				if (!isObject(petClick)) errors.push("layout.interactions.petClick must be an object");
				else {
					if (petClick.bubbleCount !== void 0 && !(Number.isInteger(petClick.bubbleCount) && petClick.bubbleCount >= 1 && petClick.bubbleCount <= 12)) errors.push("petClick.bubbleCount out of range");
					if (petClick.bubbleLayer !== void 0 && !SCENE_LAYERS.includes(petClick.bubbleLayer)) errors.push("petClick.bubbleLayer invalid");
					if (petClick.bubbleIntervalMs !== void 0 && !(petClick.bubbleIntervalMs >= 600 && petClick.bubbleIntervalMs <= 1500)) errors.push("petClick.bubbleIntervalMs out of range");
					if (petClick.bubbleCap !== void 0 && !(Number.isInteger(petClick.bubbleCap) && petClick.bubbleCap >= 0 && petClick.bubbleCap <= 12)) errors.push("petClick.bubbleCap out of range");
					if (petClick.bubbleSlices !== void 0) if (!Array.isArray(petClick.bubbleSlices) || petClick.bubbleSlices.length === 0) errors.push("petClick.bubbleSlices must be non-empty");
					else for (const sliceId of petClick.bubbleSlices) {
						const slice = Array.isArray(manifest?.slices) ? manifest.slices.find((entry) => entry?.id === sliceId) : void 0;
						if (slice === void 0) errors.push(`petClick.bubbleSlices unknown: ${sliceId}`);
						else if (slice.layer !== "L3") errors.push(`petClick.bubbleSlices must be L3: ${sliceId}`);
					}
					if (petClick.bubbleWidth !== void 0 && !(petClick.bubbleWidth > .01 && petClick.bubbleWidth <= .12)) errors.push("petClick.bubbleWidth out of range");
				}
			}
			const slices = new Map((Array.isArray(manifest?.slices) ? manifest.slices : []).map((slice) => [slice?.id, slice]));
			const ids = /* @__PURE__ */ new Set();
			for (const [index, element] of layout.elements.entries()) {
				const label = `elements[${index}]`;
				if (!isObject(element)) {
					errors.push(`${label} must be an object`);
					continue;
				}
				if (typeof element.instanceId !== "string" || element.instanceId === "") errors.push(`${label}.instanceId is required`);
				else if (ids.has(element.instanceId)) errors.push(`${label}.instanceId duplicated: ${element.instanceId}`);
				else ids.add(element.instanceId);
				if (!slices.has(element.slice)) errors.push(`${label}.slice unknown: ${element.slice}`);
				else if (element.layer !== slices.get(element.slice).layer) errors.push(`${label}.layer must match slice layer`);
				if (!SCENE_LAYERS.includes(element.layer)) errors.push(`${label}.layer invalid: ${element.layer}`);
				if (!isObject(element.anchor) || !isUnitNumber(element.anchor.x) || !isUnitNumber(element.anchor.y)) errors.push(`${label}.anchor must be normalized`);
				if (!(typeof element.scale === "number" && Number.isFinite(element.scale) && element.scale > 0 && element.scale <= 1.5)) errors.push(`${label}.scale out of range`);
				if (!(typeof element.opacity === "number" && element.opacity >= 0 && element.opacity <= 1)) errors.push(`${label}.opacity out of range`);
				if (!Number.isInteger(element.zIndex)) errors.push(`${label}.zIndex must be an integer`);
				if (element.draggable !== void 0 && typeof element.draggable !== "boolean") errors.push(`${label}.draggable must be boolean`);
				if (element.interactive !== void 0 && typeof element.interactive !== "boolean") errors.push(`${label}.interactive must be boolean`);
				if (element.widthMode !== void 0 && ![
					"scale",
					"viewport",
					"intrinsic"
				].includes(element.widthMode)) errors.push(`${label}.widthMode invalid`);
				if (element.align !== void 0 && ![
					"center",
					"bottom",
					"bottom-right"
				].includes(element.align)) errors.push(`${label}.align invalid`);
				if (element.animation !== void 0) {
					if (!isObject(element.animation) || !SCENE_ANIMATION_TYPES.includes(element.animation.type)) errors.push(`${label}.animation.type invalid`);
					if (!(element.animation.duration === void 0 || element.animation.duration >= 800 && element.animation.duration <= 3e4)) errors.push(`${label}.animation.duration out of range`);
				}
				if (element.responsive !== void 0 && !isObject(element.responsive)) errors.push(`${label}.responsive must be an object`);
				for (const breakpoint of ["medium", "narrow"]) {
					const override = element.responsive?.[breakpoint];
					if (override !== void 0) if (!isObject(override)) errors.push(`${label}.responsive.${breakpoint} must be an object`);
					else {
						if (override.hidden !== void 0 && typeof override.hidden !== "boolean") errors.push(`${label}.responsive.${breakpoint}.hidden must be boolean`);
						if (override.scaleMultiplier !== void 0 && !(override.scaleMultiplier > 0 && override.scaleMultiplier <= 2)) errors.push(`${label}.responsive.${breakpoint}.scaleMultiplier out of range`);
					}
				}
			}
			if (layout.emitters !== void 0) if (!Array.isArray(layout.emitters)) errors.push("layout.emitters must be an array");
			else {
				const emitterIds = /* @__PURE__ */ new Set();
				for (const [index, emitter] of layout.emitters.entries()) {
					const label = `emitters[${index}]`;
					if (!isObject(emitter)) {
						errors.push(`${label} must be an object`);
						continue;
					}
					if (typeof emitter.id !== "string" || emitter.id === "") errors.push(`${label}.id is required`);
					else if (emitterIds.has(emitter.id)) errors.push(`${label}.id duplicated`);
					else emitterIds.add(emitter.id);
					if (!ids.has(emitter.attachTo)) errors.push(`${label}.attachTo unknown element: ${emitter.attachTo}`);
					if (!Array.isArray(emitter.slices) || emitter.slices.length === 0) errors.push(`${label}.slices must be non-empty`);
					else for (const sliceId of emitter.slices) if (!slices.has(sliceId)) errors.push(`${label}.slices unknown: ${sliceId}`);
					else if (slices.get(sliceId).layer !== "L3") errors.push(`${label}.slices must reference L3 fx: ${sliceId}`);
					const pair = (key, min, max, integer = false) => {
						const value = emitter[key];
						if (!Array.isArray(value) || value.length !== 2) {
							errors.push(`${label}.${key} must be [min,max]`);
							return;
						}
						const [low, high] = value;
						if (!(typeof low === "number" && typeof high === "number" && Number.isFinite(low) && Number.isFinite(high) && low >= min && high <= max && low <= high && (!integer || Number.isInteger(low) && Number.isInteger(high)))) errors.push(`${label}.${key} out of range`);
					};
					pair("intervalMs", 300, 3e3);
					pair("perSpawn", 1, 3, true);
					pair("durationMs", 1e3, 8e3);
					pair("risePx", 20, 400);
					pair("sizePx", 8, 80);
					if (!Number.isInteger(emitter.cap) || emitter.cap < 1 || emitter.cap > 12) errors.push(`${label}.cap out of range`);
					if (!(typeof emitter.spreadPx === "number" && emitter.spreadPx >= 0 && emitter.spreadPx <= 400)) errors.push(`${label}.spreadPx out of range`);
					if (!Number.isInteger(emitter.zIndex)) errors.push(`${label}.zIndex must be an integer`);
				}
			}
			return {
				ok: errors.length === 0,
				errors
			};
		}
		/**
		* Resolve one layout element to viewport pixels.
		* @param {any} element
		* @param {any} slice
		* @param {{width:number,height:number}} viewport
		* @param {SceneBreakpoint} breakpoint
		* @param {any} layout
		*/
		function resolveSceneElement(element, slice, viewport, breakpoint = "wide", layout = void 0) {
			const unit = sceneUnit(viewport);
			const responsive = layout?.responsive?.[breakpoint] ?? {};
			const own = element?.responsive?.[breakpoint] ?? {};
			const multiplier = (responsive.scaleMultiplier ?? 1) * (own.scaleMultiplier ?? 1);
			const width = Math.max(1, (element?.scale ?? 0) * unit * multiplier);
			const aspect = slice?.width > 0 && slice?.height > 0 ? slice.height / slice.width : 1;
			const hidden = own.hidden === true || Array.isArray(responsive.hideLayers) && responsive.hideLayers.includes(element?.layer);
			return {
				left: (element?.anchor?.x ?? 0) * (viewport?.width ?? 0),
				top: (element?.anchor?.y ?? 0) * (viewport?.height ?? 0),
				width,
				height: width * aspect,
				opacity: element?.opacity ?? 1,
				hidden,
				breakpoint
			};
		}
		/** Deterministic xorshift32 PRNG; every scene random value is seeded. */
		function createSeededRandom(seed = 1) {
			let state = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
			if (state === 0) state = 2654435769;
			return {
				next() {
					state ^= state << 13;
					state >>>= 0;
					state ^= state >>> 17;
					state ^= state << 5;
					state >>>= 0;
					return state / 4294967296;
				},
				int(maxExclusive) {
					return Math.floor(this.next() * Math.max(1, maxExclusive));
				},
				range(min, max) {
					return min + this.next() * (max - min);
				}
			};
		}
		/** Deterministic 0..maxMs stagger so elements never start in lockstep. */
		function staggerDelay(index, seed = 1, maxMs = 800) {
			const random = createSeededRandom((Number(seed) || 1) + (Number(index) || 0) * 2654435761);
			return Math.round(random.next() * Math.max(0, maxMs));
		}
		/** Pause all loops when the tab is hidden, reduced motion is requested, or the stage is offscreen. */
		function shouldPauseScene({ documentHidden = false, reducedMotion = false, intersecting = true } = {}) {
			return documentHidden === true || reducedMotion === true || intersecting === false;
		}
		const TRANSITIONS = {
			idle: new Set([
				"hover",
				"pressed",
				"sleeping"
			]),
			hover: new Set([
				"idle",
				"pressed",
				"sleeping"
			]),
			pressed: new Set([
				"hover",
				"idle",
				"dragging"
			]),
			dragging: new Set(["idle", "hover"]),
			sleeping: new Set([
				"idle",
				"hover",
				"pressed"
			])
		};
		/**
		* Single-active-state machine for the interactive main pet.
		* States: idle, hover, pressed, dragging, sleeping.
		* @param {{sleepAfterMs?:number, now?:() => number, onChange?:(next:string, previous:string) => void}} [options]
		*/
		function createSceneStateMachine(options = {}) {
			const sleepAfterMs = Math.max(1e3, options.sleepAfterMs ?? 3e4);
			const now = typeof options.now === "function" ? options.now : () => Date.now();
			let state = "idle";
			let idleSince = now();
			let clickPending = false;
			const listeners = /* @__PURE__ */ new Set();
			const machine = {
				get state() {
					return state;
				},
				/** @param {string} next */
				transition(next) {
					if (!TRANSITIONS[state]?.has(next)) return false;
					const previous = state;
					state = next;
					if (next === "idle") idleSince = now();
					if (next === "sleeping") clickPending = false;
					options.onChange?.(next, previous);
					for (const listener of listeners) listener(next, previous);
					return true;
				},
				activity() {
					if (state === "sleeping") {
						idleSince = now();
						machine.transition("idle");
					} else if (state === "idle") idleSince = now();
				},
				pointerEnter() {
					if (state === "sleeping") {
						idleSince = now();
						machine.transition("idle");
						machine.transition("hover");
					} else machine.transition("hover");
				},
				pointerLeave() {
					if (state === "hover") machine.transition("idle");
				},
				pointerDown() {
					clickPending = false;
					if (!machine.transition("pressed")) return false;
					clickPending = true;
					idleSince = now();
					return true;
				},
				pointerUp() {
					if (state !== "pressed") return false;
					const clicked = clickPending;
					clickPending = clicked;
					machine.transition("hover");
					return clicked;
				},
				dragStart() {
					return machine.transition("dragging");
				},
				dragEnd() {
					clickPending = false;
					if (state !== "dragging") return false;
					return machine.transition("hover");
				},
				tick() {
					if (state !== "idle") return false;
					if (now() - idleSince < sleepAfterMs) return false;
					return machine.transition("sleeping");
				},
				consumeClick() {
					const value = clickPending;
					clickPending = false;
					return value;
				},
				/** @param {(next:string, previous:string) => void} listener */
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				remainingSleepMs() {
					return Math.max(0, sleepAfterMs - (now() - idleSince));
				}
			};
			return machine;
		}
		//#endregion
		//#region src/client/scene.mjs
		/**
		* Material-driven live-room scene renderer.
		*
		* The scene is a fixed full-viewport, overflow-hidden stage. Every visible
		* element comes from a sliced transparent asset and is positioned by
		* assets/slices/layout.json (normalized anchors + min-viewport scale). This
		* module only maps layout data to DOM/CSS and owns interaction/cleanup; all
		* decisions that are worth testing live in scene-core.mjs.
		*/
		/** Prefix route for scene manifest/layout/@1x/@2x assets. */
		const SCENE_BASE_PATH = "/@dsh-external/dsh-anime-desktop-pet/assets/scene/";
		const SCENE_DEFAULTS = {
			basePath: SCENE_BASE_PATH,
			zIndex: 2147483046,
			seed: 20261026,
			bubbleIntervalMs: 1200,
			bubbleCap: 8,
			sleepAfterMs: 3e4
		};
		/** @param {string} file root-relative manifest file path */
		function sceneAssetRelative(file) {
			return String(file ?? "").replace(/^assets\/slices\//, "");
		}
		/** Pick @1x for standard screens, @2x for HiDPI; capped at 2x. */
		function sceneAssetUrl(basePath, slice, devicePixelRatio = 1) {
			return `${basePath}${sceneAssetRelative(Number(devicePixelRatio) >= 2 ? slice.file : slice.file1x)}`;
		}
		function fetchJson(fetchImpl, url) {
			return Promise.resolve(fetchImpl(url, { credentials: "same-origin" })).then(async (response) => {
				if (!response || response.ok !== true) throw new Error(`scene asset request failed: ${url} (${response?.status ?? "network"})`);
				try {
					return await response.json();
				} catch {
					throw new Error(`scene asset is not valid JSON: ${url}`);
				}
			});
		}
		/**
		* Load and validate the scene manifest/layout from the host route.
		* @param {typeof fetch} fetchImpl
		* @param {string} [basePath]
		*/
		async function loadSceneData(fetchImpl = globalThis.fetch, basePath = SCENE_BASE_PATH) {
			if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
			const [manifest, layout] = await Promise.all([fetchJson(fetchImpl, `${basePath}manifest.json`), fetchJson(fetchImpl, `${basePath}layout.json`)]);
			const manifestCheck = validateSceneManifest(manifest);
			if (!manifestCheck.ok) throw new Error(`invalid scene manifest: ${manifestCheck.errors.slice(0, 3).join("; ")}`);
			const layoutCheck = validateSceneLayout(layout, manifest);
			if (!layoutCheck.ok) throw new Error(`invalid scene layout: ${layoutCheck.errors.slice(0, 3).join("; ")}`);
			return {
				manifest,
				layout
			};
		}
		const STYLE = `
:host { all: initial; }
.scene-stage {
  position: fixed; inset: 0; overflow: hidden; pointer-events: none;
  z-index: var(--scene-z, 2147483046); contain: layout paint style;
  --scene-unit: min(100vw, 100vh);
  --scene-responsive: 1;
}
.scene-stage[hidden] { display: none; }
.scene-element {
  position: absolute; width: calc(var(--scale) * var(--scene-unit) * var(--scene-responsive));
  left: var(--x); top: var(--y);
  transform: translate(-50%, -50%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
  transform-origin: 50% 85%;
  opacity: var(--opacity, 1); z-index: var(--z, 10);
}
.scene-element[data-width-mode="viewport"] { width: 100vw; }
.scene-element[data-width-mode="intrinsic"] { max-width: 100vw; }
.scene-element[data-align="bottom"] {
  transform: translate(-50%, -100%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
}
.scene-element[data-align="bottom-right"] {
  transform: translate(-100%, -100%) translate(var(--dx, 0px), var(--dy, 0px)) rotate(calc(var(--rot, 0deg) + var(--look, 0deg)));
}
.scene-element[data-interactive="true"] { pointer-events: auto; cursor: grab; touch-action: none; }
.scene-element[data-interactive="true"]:active { cursor: grabbing; }
.scene-element[data-draggable="true"] { pointer-events: auto; cursor: grab; touch-action: none; }
.scene-element[data-draggable="true"][data-dragging="true"] { cursor: grabbing; }
.scene-inner { animation-duration: var(--dur, 4s); animation-delay: var(--delay, 0ms); animation-iteration-count: infinite; animation-timing-function: ease-in-out; animation-play-state: var(--play-state, running); will-change: transform; }
.scene-element[data-anim="float"] .scene-inner { animation-name: scene-float; animation-direction: alternate; }
.scene-element[data-anim="sway"] .scene-inner { animation-name: scene-sway; animation-direction: alternate; }
.scene-element[data-anim="tailWave"] .scene-inner { animation-name: scene-tail; animation-direction: alternate; }
.scene-element[data-anim="finWave"] .scene-inner { animation-name: scene-fin; animation-direction: alternate; }
.scene-element[data-anim="blink"] .scene-inner { animation-name: scene-blink; animation-timing-function: steps(1, end); }
.scene-element[data-anim="bubbleRise"] .scene-inner { animation-name: scene-rise; animation-timing-function: ease-in-out; }
.scene-element img {
  display: block; width: 100%; height: auto; pointer-events: none; user-select: none;
  transform: scaleX(var(--mirror, 1)); transition: transform 180ms ease-out, filter 180ms ease-out;
}
.scene-element[data-interactive="true"] img { filter: drop-shadow(0 4px 8px rgba(39, 92, 160, 0.10)); }
.scene-element[data-mirror="true"] img { --mirror: -1; }
.scene-element[data-state="hover"] img { transform: scaleX(var(--mirror, 1)) scale(1.04); filter: drop-shadow(0 8px 14px rgba(39, 92, 160, 0.18)); }
.scene-element[data-state="pressed"] img { transform: scaleX(var(--mirror, 1)) scale(0.95, 0.9); }
.scene-element[data-state="dragging"] img { transition: none; filter: drop-shadow(0 14px 22px rgba(39, 92, 160, 0.22)); }
.scene-element[data-state="sleeping"] { opacity: calc(var(--opacity, 1) * 0.72); }
.scene-element[data-state="sleeping"] .scene-inner { animation-play-state: paused; }
.scene-stage[data-paused="true"] .scene-inner { animation-play-state: paused !important; }
.scene-light {
  position: absolute; inset: -12%; pointer-events: none; opacity: var(--sweep-opacity, 0.22);
  background: linear-gradient(115deg, transparent 32%, rgba(255,255,255,0.65) 48%, transparent 62%);
  background-size: 220% 220%; animation: scene-sweep var(--sweep-duration, 12s) ease-in-out infinite;
  will-change: transform;
}
.scene-bubble {
  position: absolute; width: calc(var(--bubble-width, 0.035) * var(--scene-unit)); pointer-events: none;
  animation: scene-bubble-rise var(--bubble-dur, 5200ms) ease-in forwards;
  opacity: 0; z-index: 35;
}
.scene-bubble img { width: 100%; height: auto; display: block; }
.scene-particle {
  position: absolute; width: var(--particle-size, 24px); pointer-events: none;
  opacity: 0; z-index: var(--particle-z, 34);
  animation: scene-particle-rise var(--particle-dur, 4000ms) ease-out forwards;
}
.scene-particle img { width: 100%; height: auto; display: block; }
.scene-stage[data-paused="true"] .scene-bubble,
.scene-stage[data-paused="true"] .scene-particle { animation-play-state: paused !important; }
.scene-status {
  position: absolute; left: 50%; bottom: max(12px, env(safe-area-inset-bottom));
  transform: translateX(-50%); pointer-events: none; opacity: 0;
  padding: 3px 10px; border-radius: 999px; font: 600 11px/1.4 system-ui, sans-serif;
  color: #24558c; background: rgba(255,255,255,0.72);
  transition: opacity 180ms ease-out; white-space: nowrap;
}
.scene-element[data-state="pressed"] + .scene-status,
.scene-element[data-state="hover"] + .scene-status { opacity: 1; }
@keyframes scene-float { from { transform: translateY(calc(var(--amp, 6px) * -0.55)); } to { transform: translateY(calc(var(--amp, 6px) * 0.55)); } }
@keyframes scene-sway { from { transform: rotate(calc(var(--amp, 2deg) * -0.5)); } to { transform: rotate(calc(var(--amp, 2deg) * 0.5)); } }
@keyframes scene-tail { 0%, 100% { transform: skewX(0deg); } 50% { transform: skewX(calc(var(--amp, 2deg) * 1)); } }
@keyframes scene-fin { 0%, 100% { transform: scaleX(0.98); } 50% { transform: scaleX(1.02); } }
@keyframes scene-blink { 0%, 93%, 100% { transform: scaleY(1); } 95%, 97% { transform: scaleY(0.94); } }
@keyframes scene-rise { 0% { transform: translateY(0); opacity: 0; } 18% { opacity: 0.9; } 80% { opacity: 0.75; } 100% { transform: translateY(calc(var(--amp, 18px) * -3)); opacity: 0; } }
@keyframes scene-bubble-rise { 0% { transform: translateY(10px) scale(0.7); opacity: 0; } 18% { opacity: 0.85; } 75% { opacity: 0.7; } 100% { transform: translateY(-80px) scale(1.15); opacity: 0; } }
@keyframes scene-particle-rise {
  0% { transform: translate(-50%, -50%) translateY(8px) scale(0.65) rotate(0deg); opacity: 0; }
  16% { opacity: 0.9; }
  72% { opacity: 0.78; }
  100% { transform: translate(-50%, -50%) translate(var(--particle-drift, 0px), calc(-1 * var(--particle-rise, 120px))) scale(1.08) rotate(var(--particle-rot, 0deg)); opacity: 0; }
}
@keyframes scene-sweep { 0%, 100% { transform: translateX(-18%); } 50% { transform: translateX(18%); } }
@media (max-width: 1279px) { .scene-stage { --scene-responsive: 0.86; } }
@media (max-width: 767px) {
  .scene-stage { --scene-responsive: 0.68; }
  .scene-element[data-layer="L3"] { display: none; }
  .scene-element[data-narrow-hidden="true"] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .scene-inner { animation: none !important; }
  .scene-light, .scene-bubble { display: none !important; }
  .scene-element img { transition: none; }
}
`;
		function resolveVisibility(options) {
			const storage = options.storage ?? options.window?.localStorage ?? null;
			if (options.visible === false) return false;
			return parseOverlayVisible(storage?.getItem?.("dsh-anime-desktop-pet/overlay-visible") ?? null);
		}
		/**
		* Mount the scene layer. Returns immediately; `ready` resolves once manifest,
		* layout and all images have rendered.
		* @param {{document:Document, window:Window, manifest?:object, layout?:object, fetchImpl?:typeof fetch, options?:object}} input
		*/
		function mountScene(input) {
			const doc = input.document;
			const win = input.window;
			const options = {
				...SCENE_DEFAULTS,
				...input.options ?? {}
			};
			const storage = options.storage ?? win?.localStorage ?? null;
			const host = doc.createElement("div");
			host.setAttribute("data-xllh-scene-host", "");
			host.style.position = "fixed";
			host.style.inset = "0";
			host.style.pointerEvents = "none";
			host.style.zIndex = String(options.zIndex);
			host.style.display = resolveVisibility({
				...options,
				storage,
				window: win
			}) ? "" : "none";
			const shadow = host.attachShadow({ mode: "open" });
			const style = doc.createElement("style");
			style.textContent = STYLE;
			const stage = doc.createElement("div");
			stage.className = "scene-stage";
			stage.setAttribute("aria-hidden", "true");
			stage.style.setProperty("--scene-z", String(options.zIndex));
			shadow.append(style, stage);
			const light = doc.createElement("div");
			light.className = "scene-light";
			stage.append(light);
			doc.body.append(host);
			const random = createSeededRandom(options.seed);
			const machine = createSceneStateMachine({ sleepAfterMs: options.sleepAfterMs });
			const cleanupFns = [];
			const elementNodes = /* @__PURE__ */ new Map();
			let disposed = false;
			let manifest = input.manifest ?? null;
			let layout = input.layout ?? null;
			let positions = parseScenePositions(storage?.getItem?.("dsh-anime-desktop-pet/scene-positions") ?? null);
			let paused = false;
			let hostHidden = host.style.display === "none";
			let sleepingTimer = null;
			let bubbleTimer = null;
			let emitterTimer = null;
			let emitterConfigs = [];
			const particleNodes = /* @__PURE__ */ new Set();
			const emitterActive = /* @__PURE__ */ new Map();
			let activeBubbles = 0;
			let dragged = null;
			let interactiveNode = null;
			let statusNode = null;
			let readyResolve;
			let readyReject;
			const ready = new Promise((resolve, reject) => {
				readyResolve = resolve;
				readyReject = reject;
			});
			const addListener = (target, type, handler, opts) => {
				target.addEventListener(type, handler, opts);
				cleanupFns.push(() => target.removeEventListener(type, handler, opts));
			};
			const reducedMotion = () => typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
			const hasMedia = typeof win.matchMedia === "function";
			function assetFor(slice) {
				return sceneAssetUrl(options.basePath, slice, win.devicePixelRatio ?? 1);
			}
			function applyPause() {
				paused = hostHidden || shouldPauseScene({
					documentHidden: doc.hidden === true,
					reducedMotion: reducedMotion(),
					intersecting: options.intersecting !== false
				});
				stage.dataset.paused = paused ? "true" : "false";
				if (paused) {
					stopBubbleTimer();
					stopEmitters();
				} else {
					startBubbleTimer();
					startEmitters();
				}
			}
			function createElementNode(element, slice, geom) {
				const wrapper = doc.createElement("div");
				const anchor = positions[element.instanceId] ?? element.anchor;
				wrapper.className = "scene-element";
				wrapper.dataset.elementId = element.instanceId;
				wrapper.dataset.layer = element.layer;
				wrapper.dataset.anim = element.animation?.type ?? "none";
				wrapper.dataset.mirror = element.mirror === true ? "true" : "false";
				wrapper.dataset.state = "idle";
				wrapper.dataset.interactive = element.interactive === true ? "true" : "false";
				wrapper.dataset.draggable = element.draggable === true ? "true" : "false";
				wrapper.dataset.widthMode = element.widthMode ?? "scale";
				wrapper.dataset.align = element.align ?? "center";
				if (element.widthMode === "intrinsic") wrapper.style.width = `${Math.round(slice.width / 2)}px`;
				if (element.responsive?.narrow?.hidden === true) wrapper.dataset.narrowHidden = "true";
				wrapper.style.setProperty("--x", `${anchor.x * 100}%`);
				wrapper.style.setProperty("--y", `${anchor.y * 100}%`);
				wrapper.style.setProperty("--scale", String(element.scale));
				wrapper.style.setProperty("--rot", `${element.rotation ?? 0}deg`);
				wrapper.style.setProperty("--opacity", String(element.opacity ?? 1));
				wrapper.style.setProperty("--z", String(element.zIndex ?? 10));
				wrapper.style.setProperty("--dur", `${element.animation?.duration ?? 4200}ms`);
				wrapper.style.setProperty("--delay", `${(element.animation?.delay ?? 0) + staggerDelay(elementNodes.size, options.seed, 800)}ms`);
				const angleAmplitude = element.animation?.type === "sway" || element.animation?.type === "tailWave";
				wrapper.style.setProperty("--amp", `${element.animation?.amplitude ?? 6}${angleAmplitude ? "deg" : "px"}`);
				const inner = doc.createElement("div");
				inner.className = "scene-inner";
				const image = doc.createElement("img");
				image.alt = "";
				image.draggable = false;
				image.decoding = "async";
				image.loading = "lazy";
				image.src = assetFor(slice);
				inner.append(image);
				wrapper.append(inner);
				stage.append(wrapper);
				elementNodes.set(element.instanceId, {
					wrapper,
					inner,
					image,
					element,
					slice,
					geom
				});
				return wrapper;
			}
			function updatePausedState() {
				applyPause();
			}
			function setState(next) {
				for (const node of elementNodes.values()) if (node.element.interactive === true) node.wrapper.dataset.state = next;
				if (statusNode !== null) statusNode.textContent = next === "sleeping" ? "呼呼…" : next === "dragging" ? "拖动中" : next === "pressed" ? "捏一下" : "蓝色大肥鱼在陪你";
			}
			machine.subscribe((next) => setState(next));
			function finishDrag() {
				if (dragged === null) return;
				const { wrapper } = dragged;
				wrapper.style.setProperty("--dx", `${dragged.dx}px`);
				wrapper.style.setProperty("--dy", `${dragged.dy}px`);
				dragged = null;
				machine.dragEnd();
			}
			function bindInteractive(wrapper) {
				const elementNode = elementNodes.get(wrapper.dataset.elementId);
				if (!elementNode) return;
				const { image } = elementNode;
				addListener(wrapper, "pointerenter", () => {
					machine.pointerEnter();
					setState(machine.state);
				});
				addListener(wrapper, "pointerleave", () => {
					wrapper.style.setProperty("--look", "0deg");
					if (dragged === null) {
						machine.pointerLeave();
						setState(machine.state);
					}
				});
				addListener(wrapper, "pointerdown", (event) => {
					if (event.button !== void 0 && event.button !== 0) return;
					event.preventDefault();
					wrapper.setPointerCapture?.(event.pointerId);
					dragged = {
						pointerId: event.pointerId,
						wrapper,
						startX: event.clientX,
						startY: event.clientY,
						baseDx: parseFloat(wrapper.style.getPropertyValue("--dx")) || 0,
						baseDy: parseFloat(wrapper.style.getPropertyValue("--dy")) || 0,
						dx: parseFloat(wrapper.style.getPropertyValue("--dx")) || 0,
						dy: parseFloat(wrapper.style.getPropertyValue("--dy")) || 0,
						moved: false
					};
					machine.pointerDown();
					setState(machine.state);
				});
				addListener(wrapper, "pointermove", (event) => {
					if (dragged === null || dragged.pointerId !== event.pointerId) {
						const bounds = wrapper.getBoundingClientRect();
						const ratio = Math.max(-1, Math.min(1, (event.clientX - (bounds.left + bounds.width / 2)) / Math.max(1, bounds.width)));
						wrapper.style.setProperty("--look", `${(ratio * 2.2).toFixed(2)}deg`);
						machine.activity();
						return;
					}
					const dx = dragged.baseDx + event.clientX - dragged.startX;
					const dy = dragged.baseDy + event.clientY - dragged.startY;
					if (!dragged.moved && Math.hypot(event.clientX - dragged.startX, event.clientY - dragged.startY) > 4) {
						dragged.moved = true;
						machine.dragStart();
					}
					if (dragged.moved) {
						dragged.dx = dx;
						dragged.dy = dy;
						wrapper.style.setProperty("--dx", `${dx}px`);
						wrapper.style.setProperty("--dy", `${dy}px`);
						setState(machine.state);
					}
				});
				addListener(wrapper, "pointerup", (event) => {
					if (dragged === null || dragged.pointerId !== event.pointerId) return;
					const wasDrag = dragged.moved;
					const clicked = !wasDrag && machine.pointerUp();
					if (wasDrag) {
						finishDrag();
						wrapper.style.transition = "transform 260ms cubic-bezier(0.22, 1.2, 0.36, 1)";
						wrapper.style.setProperty("--dx", "0px");
						wrapper.style.setProperty("--dy", "0px");
						win.setTimeout(() => {
							wrapper.style.transition = "";
						}, 280);
					}
					setState(machine.state);
					if (clicked) {
						image.animate?.([
							{ transform: "scaleX(var(--mirror,1)) scale(1)" },
							{ transform: "scaleX(var(--mirror,1)) scale(1.1,0.88)" },
							{ transform: "scaleX(var(--mirror,1)) scale(1)" }
						], {
							duration: 220,
							easing: "ease-out"
						});
						spawnBubbles(layout?.interactions?.petClick?.bubbleCount ?? 3, wrapper);
						machine.activity();
					}
				});
				addListener(wrapper, "pointercancel", () => {
					if (dragged !== null) {
						dragged = null;
						wrapper.style.setProperty("--dx", "0px");
						wrapper.style.setProperty("--dy", "0px");
						machine.dragEnd();
						setState(machine.state);
					}
				});
				sleepingTimer = win.setInterval(() => {
					machine.tick();
				}, 1e3);
				cleanupFns.push(() => win.clearInterval(sleepingTimer));
				statusNode = doc.createElement("div");
				statusNode.className = "scene-status";
				statusNode.textContent = "蓝色大肥鱼在陪你";
				stage.append(statusNode);
				interactiveNode = elementNode;
			}
			function bindDraggable(wrapper) {
				const node = elementNodes.get(wrapper.dataset.elementId);
				if (!node) return;
				let drag = null;
				addListener(wrapper, "pointerdown", (event) => {
					if (event.button !== void 0 && event.button !== 0) return;
					event.preventDefault();
					wrapper.setPointerCapture?.(event.pointerId);
					drag = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						dx: 0,
						dy: 0,
						moved: false
					};
					wrapper.dataset.dragging = "true";
				});
				addListener(wrapper, "pointermove", (event) => {
					if (drag === null || drag.pointerId !== event.pointerId) return;
					const dx = event.clientX - drag.startX;
					const dy = event.clientY - drag.startY;
					if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
					if (!drag.moved) return;
					drag.dx = dx;
					drag.dy = dy;
					wrapper.style.setProperty("--dx", `${dx}px`);
					wrapper.style.setProperty("--dy", `${dy}px`);
				});
				addListener(wrapper, "pointerup", (event) => {
					if (drag === null || drag.pointerId !== event.pointerId) return;
					const wasMoved = drag.moved;
					const { dx, dy } = drag;
					drag = null;
					wrapper.dataset.dragging = "false";
					wrapper.style.setProperty("--dx", "0px");
					wrapper.style.setProperty("--dy", "0px");
					if (!wasMoved) return;
					const W = Math.max(1, win.innerWidth);
					const H = Math.max(1, win.innerHeight);
					const width = node.geom?.width ?? 1;
					const height = node.geom?.height ?? 1;
					const currentX = parseFloat(wrapper.style.getPropertyValue("--x")) || 0;
					const currentY = parseFloat(wrapper.style.getPropertyValue("--y")) || 0;
					const marginX = Math.min(.5, width / 2 / W);
					const marginY = Math.min(.5, height / 2 / H);
					const x = Math.min(1 - marginX, Math.max(marginX, (currentX / 100 * W + dx) / W));
					const y = Math.min(1 - marginY, Math.max(marginY, (currentY / 100 * H + dy) / H));
					wrapper.style.setProperty("--x", `${(x * 100).toFixed(4)}%`);
					wrapper.style.setProperty("--y", `${(y * 100).toFixed(4)}%`);
					positions[node.element.instanceId] = {
						x: Number(x.toFixed(6)),
						y: Number(y.toFixed(6))
					};
					try {
						storage?.setItem?.(SCENE_POSITIONS_KEY, serializeScenePositions(positions));
					} catch {}
				});
				addListener(wrapper, "pointercancel", () => {
					drag = null;
					wrapper.dataset.dragging = "false";
					wrapper.style.setProperty("--dx", "0px");
					wrapper.style.setProperty("--dy", "0px");
				});
			}
			function bubbleConfig() {
				return layout?.interactions?.petClick ?? {};
			}
			function bubbleSlicePool() {
				const layer = bubbleConfig().bubbleLayer ?? "L3";
				const configured = bubbleConfig().bubbleSlices;
				if (Array.isArray(configured) && configured.length > 0) return (manifest?.slices ?? []).filter((slice) => configured.includes(slice.id));
				return (manifest?.slices ?? []).filter((slice) => slice.layer === layer);
			}
			function bubbleAssetUrl(slice) {
				const dpr = slice.id === "fx-bubble-large" ? Math.max(2, win.devicePixelRatio ?? 1) : win.devicePixelRatio ?? 1;
				return sceneAssetUrl(options.basePath, slice, dpr);
			}
			function defaultBubbleOrigin() {
				return elementNodes.get("fish-01")?.wrapper ?? [...elementNodes.values()].find((node) => node.element.draggable === true)?.wrapper ?? interactiveNode?.wrapper ?? null;
			}
			function spawnBubbles(count = 1, originWrapper = null) {
				if (paused || disposed) return;
				const pool = bubbleSlicePool();
				if (pool.length === 0) return;
				const origin = originWrapper ?? defaultBubbleOrigin();
				if (!origin) return;
				const originX = parseFloat(origin.style.getPropertyValue("--x")) || 50;
				const cap = Math.min(12, bubbleConfig().bubbleCap ?? options.bubbleCap);
				for (let index = 0; index < count; index += 1) {
					if (activeBubbles >= cap) break;
					const slice = pool[random.int(pool.length)];
					const bubble = doc.createElement("div");
					bubble.className = "scene-bubble";
					bubble.style.left = `${Math.min(96, Math.max(2, originX + random.range(-24, 24)))}%`;
					bubble.style.top = `${70 + random.range(-6, 6)}%`;
					bubble.style.setProperty("--bubble-dur", `${Math.round(random.range(4200, 6800))}ms`);
					bubble.style.setProperty("--bubble-width", String(bubbleConfig().bubbleWidth ?? .045));
					const image = doc.createElement("img");
					image.alt = "";
					image.src = bubbleAssetUrl(slice);
					bubble.append(image);
					stage.append(bubble);
					activeBubbles += 1;
					const remove = () => {
						bubble.remove();
						activeBubbles = Math.max(0, activeBubbles - 1);
					};
					bubble.addEventListener("animationend", remove, { once: true });
					cleanupFns.push(() => {
						bubble.remove();
						activeBubbles = Math.max(0, activeBubbles - 1);
					});
				}
			}
			function startBubbleTimer() {
				if (bubbleTimer !== null || paused || reducedMotion() || disposed) return;
				bubbleTimer = win.setInterval(() => {
					spawnBubbles(1);
				}, bubbleConfig().bubbleIntervalMs ?? options.bubbleIntervalMs);
				cleanupFns.push(() => {
					win.clearInterval(bubbleTimer);
					bubbleTimer = null;
				});
			}
			function stopBubbleTimer() {
				if (bubbleTimer !== null) {
					win.clearInterval(bubbleTimer);
					bubbleTimer = null;
				}
			}
			function scheduleEmitter() {
				if (emitterConfigs.length === 0) return;
				const [min, max] = emitterConfigs[0].intervalMs;
				const wait = Math.round(random.range(min, max));
				emitterTimer = win.setTimeout(() => {
					emitterTimer = null;
					if (paused || disposed) return;
					spawnEmitterParticles();
					scheduleEmitter();
				}, wait);
			}
			function startEmitters() {
				if (emitterTimer !== null || paused || reducedMotion() || disposed || emitterConfigs.length === 0) return;
				scheduleEmitter();
			}
			function stopEmitters() {
				if (emitterTimer !== null) {
					win.clearTimeout(emitterTimer);
					emitterTimer = null;
				}
			}
			function spawnEmitterParticles() {
				if (paused || disposed) return;
				const slices = new Map((manifest?.slices ?? []).map((slice) => [slice.id, slice]));
				for (const emitter of emitterConfigs) {
					const activeForEmitter = emitterActive.get(emitter.id) ?? 0;
					if (activeForEmitter >= emitter.cap) continue;
					const target = elementNodes.get(emitter.attachTo)?.wrapper;
					if (!target) continue;
					const rect = target.getBoundingClientRect();
					if (rect.width < 2 || rect.height < 2) continue;
					const [minCount, maxCount] = emitter.perSpawn;
					const count = random.int(maxCount - minCount + 1) + minCount;
					let added = 0;
					for (let index = 0; index < count; index += 1) {
						if (activeForEmitter + added >= emitter.cap) break;
						const sliceId = emitter.slices[random.int(emitter.slices.length)];
						const slice = slices.get(sliceId);
						if (!slice) continue;
						const size = random.range(emitter.sizePx[0], emitter.sizePx[1]);
						const rise = random.range(emitter.risePx[0], emitter.risePx[1]);
						const drift = random.range(-emitter.spreadPx * .6, emitter.spreadPx * .6);
						const duration = random.range(emitter.durationMs[0], emitter.durationMs[1]);
						const left = rect.left + random.range(rect.width * .1, rect.width * .95);
						const top = rect.top + random.range(rect.height * .35, rect.height * .92);
						const particle = doc.createElement("div");
						particle.className = "scene-particle";
						particle.style.left = `${left}px`;
						particle.style.top = `${top}px`;
						particle.style.setProperty("--particle-size", `${Math.round(size)}px`);
						particle.style.setProperty("--particle-rise", `${Math.round(rise)}px`);
						particle.style.setProperty("--particle-drift", `${Math.round(drift)}px`);
						particle.style.setProperty("--particle-rot", `${random.range(-24, 24).toFixed(1)}deg`);
						particle.style.setProperty("--particle-dur", `${Math.round(duration)}ms`);
						particle.style.setProperty("--particle-z", String(emitter.zIndex));
						const image = doc.createElement("img");
						image.alt = "";
						image.src = slice.id === "fx-bubble-large" ? bubbleAssetUrl(slice) : sceneAssetUrl(options.basePath, slice, win.devicePixelRatio ?? 1);
						particle.append(image);
						stage.append(particle);
						particleNodes.add(particle);
						added += 1;
						particle.addEventListener("animationend", () => {
							particle.remove();
							particleNodes.delete(particle);
							emitterActive.set(emitter.id, Math.max(0, (emitterActive.get(emitter.id) ?? 1) - 1));
						}, { once: true });
					}
					emitterActive.set(emitter.id, activeForEmitter + added);
				}
			}
			function render(data) {
				manifest = data.manifest;
				layout = data.layout;
				emitterConfigs = Array.isArray(layout.emitters) ? layout.emitters : [];
				const breakpoint = sceneBreakpoint(win.innerWidth);
				const slices = new Map(manifest.slices.map((slice) => [slice.id, slice]));
				const sweep = layout.effects?.lightSweep ?? {};
				stage.style.setProperty("--sweep-duration", `${sweep.durationMs ?? 12e3}ms`);
				stage.style.setProperty("--sweep-opacity", String(sweep.opacity ?? .22));
				const sorted = [...layout.elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
				for (const element of sorted) {
					const slice = slices.get(element.slice);
					if (!slice) continue;
					const geom = resolveSceneElement(element, slice, {
						width: win.innerWidth,
						height: win.innerHeight
					}, breakpoint, layout);
					const wrapper = createElementNode(element, slice, geom);
					if (geom.hidden) wrapper.style.display = "none";
					if (element.interactive === true) bindInteractive(wrapper);
					if (element.draggable === true) bindDraggable(wrapper);
				}
				applyPause();
				startBubbleTimer();
				stage.dataset.ready = "true";
				readyResolve({
					host,
					stage,
					manifest,
					layout,
					elements: elementNodes
				});
			}
			if (manifest !== null && layout !== null) try {
				render({
					manifest,
					layout
				});
			} catch (error) {
				readyReject(error);
			}
			else loadSceneData(input.fetchImpl ?? win.fetch?.bind(win), options.basePath).then((data) => {
				if (!disposed) render(data);
			}).catch((error) => {
				if (!disposed) readyReject(error);
			});
			addListener(doc, "visibilitychange", updatePausedState);
			if (hasMedia) {
				const media = win.matchMedia("(prefers-reduced-motion: reduce)");
				const onMedia = () => applyPause();
				media.addEventListener?.("change", onMedia);
				cleanupFns.push(() => media.removeEventListener?.("change", onMedia));
			}
			if (typeof win.IntersectionObserver === "function") {
				const observer = new win.IntersectionObserver((entries) => {
					options.intersecting = entries.some((entry) => entry.isIntersecting);
					applyPause();
				});
				observer.observe(host);
				cleanupFns.push(() => observer.disconnect());
			}
			addListener(doc, "keydown", (event) => {
				if (!(event.ctrlKey && event.shiftKey && (event.key === "F12" || event.code === "F12"))) return;
				event.preventDefault();
				event.stopPropagation();
				const hidden = host.style.display === "none";
				hostHidden = !hidden;
				host.style.display = hidden ? "" : "none";
				applyPause();
				try {
					storage?.setItem?.(OVERLAY_VISIBLE_KEY, String(hidden ? true : false));
				} catch {}
			}, true);
			return {
				host,
				stage,
				ready,
				get elements() {
					return elementNodes;
				},
				get paused() {
					return paused;
				},
				dispose() {
					if (disposed) return;
					disposed = true;
					stopBubbleTimer();
					stopEmitters();
					for (const particle of particleNodes) particle.remove();
					particleNodes.clear();
					emitterActive.clear();
					if (sleepingTimer !== null) win.clearInterval(sleepingTimer);
					for (const cleanup of cleanupFns.reverse()) try {
						cleanup();
					} catch {}
					elementNodes.clear();
					host.remove();
				}
			};
		}
		//#endregion
		//#region src/client/index.mjs
		/**
		* @dsh-external/dsh-anime-desktop-pet — client half.
		*
		* Material-driven live-room scene is the default UI. It is rendered entirely
		* from assets/slices + layout.json by scene.mjs. The previous overlay (running
		* row animations / fixed character / live banner) remains available as an
		* explicit fallback when the scene fails to load or scene mode is disabled.
		*/
		/** Required client service: the session list/projections store. */
		const inject = ["sessions"];
		/** Defaults; runtime override: window.__DSH_ANIME_PET_OPTIONS__ = { sizePx, gapPx, edgePx }. */
		const OVERLAY_OPTIONS = {
			sizePx: 64,
			gapPx: 6,
			edgePx: 4,
			zIndex: 2147483045
		};
		/** Extract sessionId -> running summary + bounded context percent from one SessionListState. */
		function runningMap(snapshot) {
			const running = /* @__PURE__ */ new Map();
			if (snapshot === null || typeof snapshot !== "object") return running;
			const byId = snapshot.byId;
			if (byId === null || typeof byId !== "object") return running;
			const ids = Array.isArray(snapshot.ids) ? snapshot.ids : Object.keys(byId);
			for (const id of ids) {
				const row = byId[id];
				if (!row || row.running !== true) continue;
				const pressure = snapshot.projectionsBySession?.[id]?.values?.contextPressure;
				running.set(String(id), {
					...row,
					contextPercent: contextUsagePercent(pressure)
				});
			}
			return running;
		}
		function mountLegacy(ctx, overlayOptions) {
			const overlay = mountOverlay(overlayOptions);
			const list = ctx?.get?.("sessions")?.list;
			if (overlayOptions.runningAnimations === false || typeof list?.subscribe !== "function" || typeof list.getSnapshot !== "function") return { dispose: () => overlay.dispose() };
			const sync = () => {
				overlay.update(runningMap(list.getSnapshot()));
			};
			sync();
			const stop = list.subscribe(sync);
			return { dispose() {
				try {
					stop?.();
				} finally {
					overlay.dispose();
				}
			} };
		}
		/** Legacy overlay is restored above the scene for the banner, fixed entry and row animations. */
		const RESTORE_OPTIONS = { zIndex: 2147483052 };
		/**
		* Mount the live-room scene (default) or the legacy overlay.
		* @param {object} ctx Cordis client context with the `sessions` service.
		*/
		function apply(ctx) {
			const globalOptions = globalThis.__DSH_ANIME_PET_OPTIONS__ ?? {};
			const sceneOptions = {
				...globalThis.__DSH_ANIME_PET_SCENE_OPTIONS__ ?? {},
				...globalOptions.sceneOptions ?? {}
			};
			const sceneEnabled = sceneOptions.enabled !== false && globalOptions.scene !== false;
			let scene = null;
			let legacy = null;
			let disposed = false;
			if (sceneEnabled && typeof globalThis.document?.createElement === "function" && globalThis.window) {
				try {
					scene = mountScene({
						document: globalThis.document,
						window: globalThis.window,
						options: sceneOptions
					});
				} catch {
					scene = null;
				}
				if (scene === null) legacy = mountLegacy(ctx, {
					...OVERLAY_OPTIONS,
					...globalOptions
				});
				else {
					legacy = mountLegacy(ctx, {
						...OVERLAY_OPTIONS,
						...globalOptions,
						...RESTORE_OPTIONS
					});
					scene.ready.catch((error) => {
						if (disposed) return;
						try {
							globalThis.console?.warn?.("[dsh-anime-desktop-pet] live scene unavailable; using legacy overlay:", error?.message ?? error);
						} catch {}
						try {
							scene?.dispose();
						} catch {}
						try {
							legacy?.dispose();
						} catch {}
						scene = null;
						legacy = mountLegacy(ctx, {
							...OVERLAY_OPTIONS,
							...globalOptions
						});
					});
				}
			} else legacy = mountLegacy(ctx, {
				...OVERLAY_OPTIONS,
				...globalOptions
			});
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				try {
					legacy?.dispose();
				} finally {
					try {
						scene?.dispose();
					} catch {}
				}
			};
			if (typeof ctx.effect === "function") ctx.effect(() => cleanup, "dsh-anime-desktop-pet: scene or overlay");
			else return cleanup;
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map