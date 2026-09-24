window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-quick-append",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		//#region src/lib/interaction.ts
		/** 解析中拦截提示的固定文案（不可变更，需求锁定）。 */
		const PARSING_TOAST = "提示词正在生成，请稍后再试！";
		/** toast 自动消失时长（毫秒）。 */
		const TOAST_DURATION_MS = 2500;
		/**
		* 一次手势的判定（纯函数）。
		* - parsing：任意手势 → 拦截 + 固定文案；不打开菜单。
		* - idle：左键放行业务、右键允许打开自定义菜单；零提示。
		* - 未知状态/手势：按常规态处理（零侵入、零副作用）。
		*/
		function gestureDecision(state, gesture) {
			if (state !== "parsing") return {
				intercepted: false,
				toast: null,
				openMenu: gesture === "contextmenu"
			};
			if (gesture !== "click" && gesture !== "contextmenu") return {
				intercepted: false,
				toast: null,
				openMenu: false
			};
			return {
				intercepted: true,
				toast: PARSING_TOAST,
				openMenu: false
			};
		}
		/**
		* toast 去重/替换（纯函数）：单实例。
		* - 同文案（含解析中固定文案重复触发）→ 复用，仅刷新到期时间（不叠加、保持可见）。
		* - 异文案 → 替换并刷新到期时间。
		*/
		function nextToast(prev, incoming, now) {
			const deadline = now + TOAST_DURATION_MS;
			if (prev !== null && prev.text === incoming) return {
				text: prev.text,
				deadline
			};
			return {
				text: incoming,
				deadline
			};
		}
		/** 到期判定：now >= deadline 即过期（无槽位视为过期）。 */
		function isToastExpired(deadline, now) {
			return deadline === null || now >= deadline;
		}
		/** 常驻优化 toast 固定文案（需求锁定，不可变更）。 */
		const OPTIMIZING_TOAST = "正在优化提示词中…";
		/** 成功态短暂文案。 */
		const DONE_TOAST = "优化完成";
		/** 成功态自动退出时长（ms）：仅完成态允许自动退出。 */
		const DONE_TOAST_MS = 2e3;
		/** 优化开始：任意前置状态 → 优化中（单实例：重复触发先关旧实例再展示新实例，永不堆叠）。 */
		function toastOnOptimizeStart(_prev) {
			return { kind: "optimizing" };
		}
		/** 优化终态（成功）：优化中 → 完成态；其余状态保持（idle 不产生完成态）。 */
		function toastOnOptimizeEnd(prev, now) {
			if (prev === null) return { kind: "idle" };
			if (prev.kind !== "optimizing") return prev;
			return {
				kind: "done",
				since: Number.isFinite(now) ? now : 0
			};
		}
		/** 完成态到期判定：仅 done 且距 since ≥ DONE_TOAST_MS；optimizing/idle 永不因计时关闭。 */
		function isDoneToastExpired(state, now) {
			if (state === null || state.kind !== "done") return false;
			return (Number.isFinite(now) ? now : 0) - state.since >= DONE_TOAST_MS;
		}
		/** 旧输入面标签名（0.1.5 之前的 composer；作为回退保留）。 */
		const COMPOSER_LEGACY_TAG = "TEXTAREA";
		/**
		* 判定聚焦元素是否为 composer 输入面（纯函数，副作用为零）。
		* - 命中 `data-composer-input` → 新输入面（contenteditable div）。
		* - 否则 `tagName === 'TEXTAREA'` → 旧输入面兜底。
		* - null / 非元素 / 形状不符 → 一律 false（未知输入按「不在输入面」处理，零侵入）。
		* @param el - 待判定元素（通常为 `document.activeElement`）。
		*/
		function isComposerInputPoint(el) {
			if (el === null || el === void 0) return false;
			const candidate = el;
			if (typeof candidate.hasAttribute !== "function") return false;
			if (typeof candidate.tagName !== "string") return false;
			if (candidate.hasAttribute("data-composer-input")) return true;
			return candidate.tagName.toUpperCase() === COMPOSER_LEGACY_TAG;
		}
		/** 重编码最长边像素上限。 */
		const REENCODE_MAX_DIMENSION = 2048;
		/** 重编码 JPEG 质量。 */
		const REENCODE_QUALITY = .85;
		const KEEP_MEDIA_TYPES = [
			"image/png",
			"image/jpeg",
			"image/webp"
		];
		/** 需要重编码的媒体类型（gif 静态首帧）。 */
		const REENCODE_MEDIA_TYPES = ["image/gif"];
		/** 单张图片发送前决策：keep / reencode / 剔除（不支持格式、空文件）。 */
		function planImage(file) {
			const type = typeof file?.type === "string" ? file.type : "";
			const size = file?.size ?? NaN;
			if (!Number.isFinite(size) || size <= 0) return {
				ok: false,
				reason: "empty-image"
			};
			if (KEEP_MEDIA_TYPES.includes(type)) return {
				ok: true,
				action: size > 4194304 ? "reencode" : "keep",
				mediaType: type
			};
			if (REENCODE_MEDIA_TYPES.includes(type)) return {
				ok: true,
				action: "reencode",
				mediaType: type
			};
			return {
				ok: false,
				reason: "unsupported-image-type"
			};
		}
		/**
		* 图片预处理结果提示（可见提示文案，纯函数）：
		* - 全部失败 → 降级纯文本提示；部分失败 → 数量说明；无图片/全部成功 → null。
		*/
		function buildPreprocessNote(attempted, okCount) {
			const a = Number.isFinite(attempted) && attempted >= 0 ? Math.floor(attempted) : 0;
			const ok = Number.isFinite(okCount) && okCount >= 0 ? Math.floor(okCount) : 0;
			if (a === 0) return null;
			if (ok === 0) return "图片处理失败，已按纯文本优化";
			if (ok < a) return `${a} 张图片中 ${a - ok} 张处理失败，仅发送 ${ok} 张`;
			return null;
		}
		//#endregion
		//#region src/lib/preset-store.ts
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
		const PRESET_STORE_KEY = "dsh-quick-append.presets";
		const LEGACY_PRESET_KEY = "dsh-quick-append.text";
		/** 会话不归属任何工作区时的专用占位键（不用空串，避免与"非法输入"混淆）。 */
		const NO_WORKSPACE_KEY = "__no-workspace__";
		const PRESET_SAVED_TEXT = "已保存";
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
		const DEFAULT_APPEND_TEXT = `最高优先级规则：
1、根据用户需求进行一次细节的扩展使需求更加精准。扩展后要结合项目实际现状，对合理性做一次逐条校验（如果发现不合理必须重写）。
2、将需求拆解为最小、可独立验证的原子化步骤，逐个完成。
3、TDD测试驱动开发：先写测试，再写实现，遵循红‑绿‑重构，禁止跳过测试直接写业务代码。

附加约束：
-使用Ponytail 的 full模式开发
-单元测试必须覆盖边界与异常输入，拒绝无效伪测试。
-列出业务关键验收场景。
-完成后输出简短的潜在风险。
-模糊需求直接提问，禁止脑补逻辑。
-项目规范，安全规范，交互规范，严格遵守根目录配置文件：*.md

输出顺序：原子步骤 → 验收场景 → 单元测试 → 实现代码 → 风险清单。`;
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function emptyPresetStore() {
			return {
				version: 1,
				workspaces: {}
			};
		}
		/**
		* 宽容解析：任何脏输入（null/空串/非 JSON/标量/数组/条目非法）都收敛成"能读多少读多少"，**绝不抛**。
		* 版本字段只做归一化：遇到未来版本仍读取已知字段（前向兼容），不整包丢弃。
		*/
		function parsePresetStore(raw) {
			if (typeof raw !== "string" || raw.trim() === "") return emptyPresetStore();
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return emptyPresetStore();
			}
			if (!isRecord$1(parsed)) return emptyPresetStore();
			const workspaces = {};
			const source = parsed.workspaces;
			if (isRecord$1(source)) for (const [key, value] of Object.entries(source)) {
				if (key === "" || !isRecord$1(value)) continue;
				const text = value.appendText;
				if (typeof text !== "string") continue;
				workspaces[key] = { appendText: text };
			}
			return {
				version: 1,
				workspaces
			};
		}
		function serializePresetStore(store) {
			return JSON.stringify({
				version: 1,
				workspaces: store.workspaces
			});
		}
		/** 读取某个工作区的追加文案：不存在 → 空串（惰性初始化，不产生写入）。 */
		function presetOf(store, workspaceKey) {
			const entry = store.workspaces[workspaceKey];
			return typeof entry?.appendText === "string" ? entry.appendText : "";
		}
		/** 不可变写入：返回新 store，原对象不动（避免"读到一半被改"的隐式共享）。 */
		function withPreset(store, workspaceKey, text) {
			return {
				version: 1,
				workspaces: {
					...store.workspaces,
					[workspaceKey]: { appendText: text }
				}
			};
		}
		/**
		* 解析"当前工作区键"：按 DSH 自己的口径 —— 工作区列表里 `sessionIds` 含当前会话的那个 `workspaceId`。
		* 解析不出来（无会话/未归属）→ NO_WORKSPACE_KEY。任何脏输入都不抛。
		*
		* 为什么必须按 ID：展示名可改、可重名；用名字当键会同时坏掉"重命名保留配置"和"同名工作区隔离"。
		*/
		function workspaceKeyOf(input) {
			const sessionId = input.sessionId;
			if (typeof sessionId !== "string" || sessionId === "") return NO_WORKSPACE_KEY;
			if (!Array.isArray(input.items)) return NO_WORKSPACE_KEY;
			for (const item of input.items) {
				if (!isRecord$1(item)) continue;
				const workspaceId = item.workspaceId;
				if (typeof workspaceId !== "string" || workspaceId === "") continue;
				const sessionIds = item.sessionIds;
				if (!Array.isArray(sessionIds)) continue;
				if (sessionIds.includes(sessionId)) return workspaceId;
			}
			return NO_WORKSPACE_KEY;
		}
		/**
		* 旧版全局配置迁移：只在目标工作区**还没有**条目时迁入；只要读到过字符串就要求删旧键。
		* `legacyRaw` 非字符串（键不存在，或 storage 读取失败）→ 什么都不做且**不删键**（下次启动可重试）。
		*/
		function migrateLegacyPreset(store, legacyRaw, workspaceKey) {
			if (typeof legacyRaw !== "string") return {
				store,
				migrated: false,
				dropLegacy: false
			};
			const hasEntry = Object.prototype.hasOwnProperty.call(store.workspaces, workspaceKey);
			if (legacyRaw === "" || hasEntry) return {
				store,
				migrated: false,
				dropLegacy: true
			};
			return {
				store: withPreset(store, workspaceKey, legacyRaw),
				migrated: true,
				dropLegacy: true
			};
		}
		/**
		* 合并写入器：窗口内同一键的多次提交合并成一次落盘（保留最后一次的值）；
		* `flush()` 立即落盘并撤销计时器。写入异常**不冒泡**，转 onError（写盘失败要让用户看见，但不能让页面挂）。
		*/
		function createCoalescingWriter(options) {
			const schedule = options.schedule ?? ((fn, delayMs) => setTimeout(fn, delayMs));
			const cancel = options.cancel ?? ((handle) => {
				clearTimeout(handle);
			});
			const queue = /* @__PURE__ */ new Map();
			let handle = null;
			const drain = () => {
				handle = null;
				if (queue.size === 0) return;
				const entries = [...queue.entries()];
				queue.clear();
				for (const [key, text] of entries) {
					const request = {
						key,
						text
					};
					try {
						options.write(request);
						options.onApplied?.(request);
					} catch (error) {
						options.onError?.(request, error);
					}
				}
			};
			return {
				submit(key, text) {
					queue.set(key, text);
					if (handle === null) handle = schedule(drain, options.delayMs);
				},
				flush() {
					if (handle !== null) {
						cancel(handle);
						handle = null;
					}
					drain();
				},
				pending() {
					return [...queue.keys()];
				}
			};
		}
		/**
		* 写盘失败的可见文案。两条硬要求：
		*  ① 不得为空（空提示 = 静默失败）；
		*  ② 必须讲清降级形态 —— "本页仍可用、刷新后会丢"，否则用户会以为这一笔编辑彻底没了。
		*/
		function presetWriteFailedText(reason) {
			const detail = (typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "").trim();
			const fallback = "本地存储不可用";
			const hint = "（当前页面内仍可继续使用，刷新后会丢失）";
			return detail === "" ? `追加文案保存失败：${fallback}${hint}` : `追加文案保存失败：${detail}${hint}`;
		}
		//#endregion
		//#region src/lib/command-store.ts
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
		const COMMAND_STORE_KEY = "dsh-quick-append.commands";
		const COMMAND_CONTENT_MAX = 2e3;
		/** 删除二次确认的有效窗口（毫秒）：窗口内再点同一个「确认删除」才真的删。 */
		const DELETE_CONFIRM_MS = 4e3;
		/** 空态引导（需求 3.4 原文）：不展示空菜单，改为 toast 引导到右键录入路径。 */
		const COMMAND_EMPTY_TOAST = "暂无预存命令，右键『预存命令』可录入指令";
		const COMMAND_SAVED_TEXT = "预存命令已保存";
		const COMMAND_DELETED_TEXT = "预存命令已删除";
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function textOf(value) {
			return typeof value === "string" ? value : "";
		}
		function numOf(value) {
			return typeof value === "number" ? value : Number(value);
		}
		function emptyCommandStore() {
			return {
				version: 1,
				commands: []
			};
		}
		/**
		* 宽容解析：任何脏输入都收敛成"能读多少读多少"，**绝不抛**。
		*  · 从未存过（null/undefined/空白串）→ 空列表，`damaged=false`（不是损坏，别吓用户）。
		*  · 非空但读不出结构 → 空列表，`damaged=true`。
		*  · 逐条：id/title/content 三者都必须是 trim 后非空的字符串；重复 id 只留第一条。
		*/
		function parseCommandStore(raw) {
			if (typeof raw !== "string" || raw.trim() === "") return {
				store: emptyCommandStore(),
				damaged: false,
				dropped: 0
			};
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return {
					store: emptyCommandStore(),
					damaged: true,
					dropped: 0
				};
			}
			if (!isRecord(parsed) || !Array.isArray(parsed.commands)) return {
				store: emptyCommandStore(),
				damaged: true,
				dropped: 0
			};
			const commands = [];
			const seen = /* @__PURE__ */ new Set();
			let dropped = 0;
			for (const entry of parsed.commands) {
				if (!isRecord(entry)) {
					dropped += 1;
					continue;
				}
				const id = textOf(entry.id);
				const title = textOf(entry.title);
				const content = textOf(entry.content);
				if (id === "" || title.trim() === "" || content.trim() === "") {
					dropped += 1;
					continue;
				}
				if (seen.has(id)) {
					dropped += 1;
					continue;
				}
				seen.add(id);
				commands.push({
					id,
					title,
					content
				});
			}
			return {
				store: {
					version: 1,
					commands
				},
				damaged: dropped > 0,
				dropped
			};
		}
		function serializeCommandStore(store) {
			return JSON.stringify({
				version: 1,
				commands: commandsOf(store)
			});
		}
		/** 列表（不可变视图）：结构异常时降级为空数组（调用方在渲染路径上，绝不能抛）。 */
		function commandsOf(store) {
			const list = store?.commands;
			return Array.isArray(list) ? list : [];
		}
		function commandOf(store, id) {
			if (typeof id !== "string" || id === "") return null;
			for (const command of commandsOf(store)) if (command.id === id) return command;
			return null;
		}
		/**
		* 生成不与既有集合冲突的内部 id。
		* 随机源退化（恒定值/NaN/负数/超界）时靠兜底序号保证唯一 —— 撞 id 会导致
		* 菜单项 key 冲突与"删一条删掉两条"。
		*/
		function createCommandId(existing, random = Math.random) {
			const taken = new Set(existing);
			for (let attempt = 0; attempt < 64; attempt += 1) {
				const value = numOf(random());
				const seed = Number.isFinite(value) ? Math.floor(Math.abs(value) * 4294967296) : NaN;
				const id = Number.isFinite(seed) ? "cmd-" + seed.toString(36) : "cmd-a" + String(attempt);
				if (!taken.has(id)) return id;
			}
			let n = 1;
			while (taken.has("cmd-n" + String(n))) n += 1;
			return "cmd-n" + String(n);
		}
		/** 新增（追加到末尾，顺序稳定）：返回新 store，原对象不动。 */
		function withCommandAdded(store, draft, id) {
			return {
				version: 1,
				commands: [...commandsOf(store), {
					id,
					title: draft.title,
					content: draft.content
				}]
			};
		}
		/** 修改：只换目标条目，顺序与其余条目不动；未知 id 原样返回同一个对象（幂等，不抛）。 */
		function withCommandUpdated(store, id, draft) {
			const list = commandsOf(store);
			if (!list.some((command) => command.id === id)) return store;
			return {
				version: 1,
				commands: list.map((command) => command.id === id ? {
					id,
					title: draft.title,
					content: draft.content
				} : command)
			};
		}
		/** 删除：未知 id 原样返回同一个对象（幂等，不抛）。 */
		function withCommandRemoved(store, id) {
			const list = commandsOf(store);
			const next = list.filter((command) => command.id !== id);
			if (next.length === list.length) return store;
			return {
				version: 1,
				commands: next
			};
		}
		/** 编辑态草稿：null（新增）或脏输入 → 空草稿。 */
		function commandDraftOf(command) {
			if (command === null || command === void 0) return {
				title: "",
				content: ""
			};
			return {
				title: textOf(command.title),
				content: textOf(command.content)
			};
		}
		/**
		* 是否有未保存变更（决定关闭弹窗要不要先问）。
		*  · 新增态：两个字段都只有空白 → 不脏（什么都没填就关窗不该拦人）。
		*  · 编辑态：与回填值逐字符比较（多一个空格也算脏）。
		*/
		function commandDraftDirty(base, draft) {
			const current = {
				title: textOf(draft?.title),
				content: textOf(draft?.content)
			};
			if (base === null || base === void 0) return current.title.trim() !== "" || current.content.trim() !== "";
			const origin = commandDraftOf(base);
			return current.title !== origin.title || current.content !== origin.content;
		}
		/**
		* 校验（保存时唯一入口）：trim 后必填 + 上限（闭区间：恰好等于上限通过）。
		* 先标题后正文：两者都非法时提示稳定只报标题。
		*/
		function validateCommandDraft(input) {
			const record = isRecord(input) ? input : {};
			const title = textOf(record.title).trim();
			const content = textOf(record.content).trim();
			if (title === "") return {
				ok: false,
				field: "title",
				message: "标题不能为空"
			};
			if (title.length > 50) return {
				ok: false,
				field: "title",
				message: "标题不能超过 " + String(50) + " 字（当前 " + String(title.length) + " 字）"
			};
			if (content === "") return {
				ok: false,
				field: "content",
				message: "正文不能为空"
			};
			if (content.length > 2e3) return {
				ok: false,
				field: "content",
				message: "正文不能超过 " + String(COMMAND_CONTENT_MAX) + " 字（当前 " + String(content.length) + " 字）"
			};
			return {
				ok: true,
				value: {
					title,
					content
				}
			};
		}
		/**
		* 插入拼接：空草稿 → 只插正文（不留前导空行）；非空 → 原草稿 + 两个换行 + 正文。
		* 与「点击追加」同一口径（`draft + '\n\n' + 文案`），且**永不丢用户已写内容**。
		* 正文为空/非字符串 → 原样返回草稿（调用方据此跳过写入）。
		*/
		function insertionText(draft, content) {
			const base = textOf(draft);
			const body = textOf(content);
			if (body === "") return base;
			if (base === "") return body;
			return base + "\n\n" + body;
		}
		/** 数据损坏的可见文案：区分"整包读不出"与"丢了 N 条"（后者用户才知道自己的指令少过）。 */
		function commandDamagedText(dropped) {
			const n = typeof dropped === "number" && Number.isFinite(dropped) && dropped > 0 ? Math.floor(dropped) : 0;
			if (n === 0) return "预存命令数据读取失败：已按空列表处理（原有内容无法恢复）";
			return "预存命令数据有损坏：已忽略 " + String(n) + " 条无法识别的记录";
		}
		/**
		* 写盘失败的可见文案。两条硬要求（与 presetWriteFailedText 同口径）：
		*  ① 不得为空（空提示 = 静默失败）；② 必须讲清降级形态（本页仍可用、刷新后会丢）。
		*/
		function commandWriteFailedText(reason) {
			const detail = (typeof reason === "string" ? reason : reason instanceof Error ? reason.message : "").trim();
			return detail === "" ? "预存命令保存失败：本地存储不可用（当前页面内仍可继续使用，刷新后会丢失）" : "预存命令保存失败：" + detail + "（当前页面内仍可继续使用，刷新后会丢失）";
		}
		/**
		* 向上拉起定位（纯函数）。范式沿用本仓既有 `menu-anchor.ts` 的 `dockMenuLineFor`：
		*  · 默认在锚点正上方 `gap` 处（用 bottom 锚定 ⇒ 视觉间距与面板真实高度无关）；
		*  · 上方不足 `edge` → 翻转到锚点下方（改用 top 锚定）；
		*  · 水平右缘与锚点右缘对齐（沿用既有弹层 `right: 0` 的口径），四向限位；
		*  · 非法几何/缺字段 → 回退"视口右下角安全位"，**绝不到屏幕左上角**。
		*/
		function dropUpLineFor(input) {
			const i = input ?? {};
			const gapRaw = numOf(i.gap);
			const edgeRaw = numOf(i.edge);
			const gap = Number.isFinite(gapRaw) && gapRaw >= 0 ? gapRaw : 5;
			const edge = Number.isFinite(edgeRaw) && edgeRaw >= 0 ? edgeRaw : 5;
			const left = numOf(i.rect?.left);
			const top = numOf(i.rect?.top);
			const width = numOf(i.rect?.width);
			const height = numOf(i.rect?.height);
			const panelWidth = numOf(i.panelWidth);
			const panelHeight = numOf(i.panelHeight);
			const viewWidth = numOf(i.viewport?.width);
			const viewHeight = numOf(i.viewport?.height);
			if ([
				left,
				top,
				width,
				height,
				panelWidth,
				panelHeight,
				viewWidth,
				viewHeight
			].some((n) => !Number.isFinite(n)) || width <= 0 || height <= 0 || panelWidth <= 0 || panelHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return {
				left: edge,
				bottom: edge,
				top: null,
				flip: false
			};
			const raw_left = left + width - panelWidth;
			const clampedLeft = Math.min(Math.max(raw_left, edge), Math.max(edge, viewWidth - edge - panelWidth));
			if (top - gap - panelHeight >= edge) return {
				left: Math.round(clampedLeft),
				bottom: Math.round(viewHeight - top + gap),
				top: null,
				flip: false
			};
			const flipTop = Math.min(Math.max(top + height + gap, edge), Math.max(edge, viewHeight - edge - panelHeight));
			return {
				left: Math.round(clampedLeft),
				bottom: null,
				top: Math.round(flipTop),
				flip: true
			};
		}
		/** 编辑弹窗定位（居中 + 限位；非法输入贴安全边距）。遮罩为模态，居中比锚定更稳。 */
		function centerPlacementOf(input) {
			const i = input ?? {};
			const edgeRaw = numOf(i.edge);
			const edge = Number.isFinite(edgeRaw) && edgeRaw >= 0 ? edgeRaw : 5;
			const panelWidth = numOf(i.panelWidth);
			const panelHeight = numOf(i.panelHeight);
			const viewWidth = numOf(i.viewport?.width);
			const viewHeight = numOf(i.viewport?.height);
			if ([
				panelWidth,
				panelHeight,
				viewWidth,
				viewHeight
			].some((n) => !Number.isFinite(n)) || panelWidth <= 0 || panelHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return {
				left: edge,
				top: edge
			};
			const left = Math.min(Math.max((viewWidth - panelWidth) / 2, edge), Math.max(edge, viewWidth - edge - panelWidth));
			const top = Math.min(Math.max((viewHeight - panelHeight) / 2, edge), Math.max(edge, viewHeight - edge - panelHeight));
			return {
				left: Math.round(left),
				top: Math.round(top)
			};
		}
		/**
		* 删除二次确认状态机（纯函数）：
		*  · 第一次点某条 → 进入待确认（带截止时间），**不删**；
		*  · 窗口内再点同一个 id → `confirmed=true`（调用方才执行删除）；
		*  · 到点即失效 → 再点只重新进入待确认（防"隔很久误删"）；
		*  · 期间点另一条 → 目标切换，不动前一条。
		*/
		function nextDeleteConfirm(prev, id, now) {
			const at = Number.isFinite(now) ? now : 0;
			if (prev !== null && prev.id === id && at < prev.deadline) return {
				state: null,
				confirmed: true
			};
			return {
				state: {
					id,
					deadline: at + DELETE_CONFIRM_MS
				},
				confirmed: false
			};
		}
		/** 与状态机同口径的"是否正在等这条的二次确认"（渲染按钮文案用，不可能与行为不一致）。 */
		function isDeleteConfirmActive(state, id, now) {
			if (state === null || state.id !== id) return false;
			return (Number.isFinite(now) ? now : 0) < state.deadline;
		}
		//#endregion
		//#region src/client/index.ts
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
		const inject = ["slots", "conversation"];
		const LLM_KEY = "dsh-quick-append.llm";
		const GOAL_KEY = "dsh-quick-append.goal";
		const SKIN_ID = "dsh-quick-append-skin";
		/** apply 时捕获的会话服务（卸载/热重载由模块级变量重新赋值，组件卸载即释放）。 */
		let conversationService;
		/** 按钮名称：title 与 aria-label 必须同源（图标按钮的可访问名唯一来源，需求 2.1）。 */
		const COMMAND_LABEL = "预存命令";
		/** 「点击追加」的闪电图标路径（原内联字面量，抽成常量只为让两个图标共用同一份 svg 属性）。 */
		const BOLT_PATH = "M13 2 3 14h8l-1 8 11-12h-8l1-8z";
		/** 扳手图标（24 格坐标系；描边风格与尺寸由 ICON_SVG_PROPS 统一，需求 2.2）。 */
		const WRENCH_PATH = "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";
		/**
		* 两个按钮**唯一的**样式来源（需求 2.3：尺寸、圆角、内边距、各交互态、颜色、过渡必须一致）。
		* 既有按钮本来没有 hover/active/disabled 专属样式 —— 所以"一致"的正确做法是
		* 不新增任何单边样式，而不是给新按钮补一套好看的状态。
		*/
		const ICON_BUTTON_STYLE = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 26,
			height: 26,
			padding: 0,
			border: "1px solid var(--al-border, rgba(120,140,170,0.18))",
			borderRadius: 8,
			background: "transparent",
			color: "var(--al-text, #E6E9EF)",
			cursor: "pointer"
		};
		/** 两个图标**唯一的** svg 属性来源（需求 2.2：尺寸与线宽风格一致）。 */
		const ICON_SVG_PROPS = {
			width: 16,
			height: 16,
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: 2,
			strokeLinecap: "round",
			strokeLinejoin: "round",
			"aria-hidden": true
		};
		/**
		* 弹窗高度上限：规范 sf-modal-panel 要求 `max-height: 86vh`（小屏不溢出视口），
		* 像素上限取叶子常量 —— 定位估算与实际样式同源，避免"估算 460、实际 86vh"导致越界。
		*/
		const DIALOG_MAX_HEIGHT = "min(86vh, " + String(460) + "px)";
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
`;
		function ensureSkinStyle() {
			if (typeof document === "undefined" || document.getElementById(SKIN_ID) !== null) return;
			const style = document.createElement("style");
			style.id = SKIN_ID;
			style.textContent = SKIN_CSS;
			document.head.appendChild(style);
		}
		let cachedPresetStore = null;
		/** 旧版全局键只迁移一次：一次渲染里可能多处读取（渲染 + 打开弹窗），不得重复迁移。 */
		let legacyMigrationDone = false;
		function readRawValue(key) {
			try {
				return localStorage.getItem(key);
			} catch {
				return null;
			}
		}
		function currentPresetStore() {
			if (cachedPresetStore === null) cachedPresetStore = parsePresetStore(readRawValue(PRESET_STORE_KEY));
			return cachedPresetStore;
		}
		/** 落盘整包并更新缓存；**失败直接抛**（由合并写入器的 onError 转成可见提示，绝不静默吞掉）。 */
		function commitPresetStore(store) {
			localStorage.setItem(PRESET_STORE_KEY, serializePresetStore(store));
			cachedPresetStore = store;
		}
		/**
		* 旧版全局配置 → 当前工作区（一次性）。
		* 顺序要紧：**先落盘成功，再删旧键**。反过来（先删后写）一旦落盘失败，用户的老文案就永久没了。
		*/
		function migrateLegacyPresetOnce(workspaceKey) {
			if (legacyMigrationDone) return;
			legacyMigrationDone = true;
			const legacyRaw = readRawValue(LEGACY_PRESET_KEY);
			const migration = migrateLegacyPreset(currentPresetStore(), legacyRaw, workspaceKey);
			if (migration.migrated) try {
				commitPresetStore(migration.store);
			} catch {
				return;
			}
			if (migration.dropLegacy) try {
				localStorage.removeItem(LEGACY_PRESET_KEY);
			} catch {}
		}
		/**
		* 读某个工作区的追加文案；没有该工作区的条目 → 空串（惰性初始化，读取本身不产生写入）。
		* 注意副作用：**首次调用**会把旧版全局键迁给该工作区（一次性、幂等，见上）。
		* 为什么落在读取路径而不是 useEffect：effect 在首帧之后才跑，那一帧 preset 还是空的，
		* 用户此刻点「追加」会拿到空文案并提示去设置 —— 那是升级瞬间的假故障。
		*/
		function readPreset(workspaceKey) {
			migrateLegacyPresetOnce(workspaceKey);
			return presetOf(currentPresetStore(), workspaceKey);
		}
		let cachedCommandStore = null;
		/** 解析时发现的损坏条数（null = 本次没发现）；由组件在 effect 里一次性转成 toast。 */
		let pendingCommandDamage = null;
		function currentCommandStore() {
			if (cachedCommandStore === null) {
				const parsed = parseCommandStore(readRawValue(COMMAND_STORE_KEY));
				cachedCommandStore = parsed.store;
				if (parsed.damaged) pendingCommandDamage = parsed.dropped;
			}
			return cachedCommandStore;
		}
		/** 落盘整包并更新缓存；**失败直接抛**（由调用方转成可见提示，绝不静默吞掉）。 */
		function commitCommandStore(store) {
			localStorage.setItem(COMMAND_STORE_KEY, serializeCommandStore(store));
			cachedCommandStore = store;
		}
		function readCommands() {
			return commandsOf(currentCommandStore());
		}
		function commandIdsOf(store) {
			return commandsOf(store).map((command) => command.id);
		}
		/**
		* 把焦点与光标送回输入区**末尾**（需求 3.3：插入后用户可直接发送）。
		* 0.1.5 起 composer 是 Lexical 的 contenteditable div（带 data-composer-input），
		* 旧形态是 textarea；两种都认，认不出来就静默返回（正文已经写进去了，焦点没落位不算失败）。
		*/
		function focusComposerEnd() {
			try {
				const el = document.querySelector("[data-composer-card] [data-composer-input]") ?? document.querySelector("[data-composer-input]");
				if (el === null) return;
				if (typeof el.focus === "function") el.focus();
				if (typeof el.setSelectionRange === "function" && typeof el.value === "string") {
					const end = String(el.value).length;
					el.setSelectionRange(end, end);
					return;
				}
				const selection = document.getSelection === void 0 ? null : document.getSelection();
				if (selection === null) return;
				const range = document.createRange();
				range.selectNodeContents(el);
				range.collapse(false);
				selection.removeAllRanges();
				selection.addRange(range);
			} catch {}
		}
		/** 面板定位样式**唯一出口**：只给 left + (top|bottom) 之一，另一个显式 auto（否则会互相撑变形）。 */
		function layerStyleOf(line, width, maxHeight) {
			return {
				right: "auto",
				left: line.left,
				top: line.top === null ? "auto" : line.top,
				bottom: line.bottom === null ? "auto" : line.bottom,
				width,
				maxHeight
			};
		}
		function readLlmEnabled() {
			try {
				return localStorage.getItem(LLM_KEY) !== "0";
			} catch {
				return true;
			}
		}
		function writeLlmEnabled(value) {
			try {
				localStorage.setItem(LLM_KEY, value ? "1" : "0");
			} catch {}
		}
		function readGoalMode() {
			try {
				return localStorage.getItem(GOAL_KEY) !== "0";
			} catch {
				return true;
			}
		}
		function writeGoalMode(value) {
			try {
				localStorage.setItem(GOAL_KEY, value ? "1" : "0");
			} catch {}
		}
		function nodeText(node) {
			if (!node) return null;
			if (node.kind === "user") return (Array.isArray(node.content) ? node.content : []).map((b) => b.type === "text" ? b.text : "").join(" ").trim() || null;
			if (node.kind === "assistant") return (Array.isArray(node.blocks) ? node.blocks : []).map((b) => b.type === "text" ? b.text : "").join(" ").trim() || null;
			return null;
		}
		function buildRecentContext(session) {
			return (Array.isArray(session?.nodes) ? session.nodes : Array.isArray(session?.chat?.legacy?.nodes) ? session.chat.legacy.nodes : []).filter((n) => n.kind === "user" || n.kind === "assistant").slice(-6).map((n) => {
				const text = nodeText(n);
				if (!text) return null;
				return `${n.kind === "user" ? "User" : "Assistant"}: ${text}`;
			}).filter(Boolean).join("\n");
		}
		async function bytesToBase64(buffer) {
			const bytes = new Uint8Array(buffer);
			let binary = "";
			const chunkSize = 32768;
			for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
			return btoa(binary);
		}
		async function reencodeToJpeg(file) {
			try {
				const bitmap = await createImageBitmap(file);
				const scale = Math.min(1, REENCODE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
				const width = Math.max(1, Math.round(bitmap.width * scale));
				const height = Math.max(1, Math.round(bitmap.height * scale));
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext("2d");
				if (context === null) return null;
				context.drawImage(bitmap, 0, 0, width, height);
				bitmap.close();
				const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", REENCODE_QUALITY));
				if (blob === null) return null;
				return bytesToBase64(await blob.arrayBuffer());
			} catch {
				return null;
			}
		}
		/**
		* 发送前预处理：逐张按决策执行；失败单张剔除（不阻塞其余）；
		* 全部失败 → images=[] + 降级提示（宿主按纯文本优化并在结果标注）。
		*/
		async function prepareImages(attachments) {
			const images = [];
			for (const attachment of attachments) {
				const plan = planImage(attachment.file);
				if (!plan.ok) continue;
				let data;
				if (plan.action === "keep") data = await bytesToBase64(await attachment.file.arrayBuffer());
				else data = await reencodeToJpeg(attachment.file);
				if (data === null || data === "") continue;
				images.push({
					mediaType: plan.action === "keep" ? plan.mediaType : "image/jpeg",
					data,
					...attachment.file.name !== "" ? { name: attachment.file.name } : {}
				});
			}
			return {
				images,
				note: buildPreprocessNote(attachments.length, images.length)
			};
		}
		function QuickAppendButton({ useInput, useSession, useWorkspaces, inputActions, sessionId }) {
			const [toastSlot, setToastSlot] = (0, react.useState)(null);
			const [editing, setEditing] = (0, react.useState)(false);
			const [presetDraft, setPresetDraft] = (0, react.useState)("");
			const [llmEnabled, setLlmEnabled] = (0, react.useState)(true);
			const [goalMode, setGoalMode] = (0, react.useState)(true);
			const [storeRevision, setStoreRevision] = (0, react.useState)(0);
			const [optimizeToast, setOptimizeToast] = (0, react.useState)(null);
			const parsingRef = (0, react.useRef)(false);
			const boxRef = (0, react.useRef)(null);
			const optimizeAbortRef = (0, react.useRef)(null);
			const editKeyRef = (0, react.useRef)("");
			const writerRef = (0, react.useRef)(null);
			const noticeRef = (0, react.useRef)(() => {});
			const [commandRevision, setCommandRevision] = (0, react.useState)(0);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [menuLine, setMenuLine] = (0, react.useState)(null);
			const [menuActive, setMenuActive] = (0, react.useState)(0);
			const [commandDialogOpen, setCommandDialogOpen] = (0, react.useState)(false);
			const [dialogPlacement, setDialogPlacement] = (0, react.useState)(null);
			const [commandDraft, setCommandDraft] = (0, react.useState)({
				title: "",
				content: ""
			});
			const [editingCommandId, setEditingCommandId] = (0, react.useState)(null);
			const [commandError, setCommandError] = (0, react.useState)(null);
			const [deleteConfirm, setDeleteConfirm] = (0, react.useState)(null);
			const [discardConfirm, setDiscardConfirm] = (0, react.useState)(false);
			const [discardIntent, setDiscardIntent] = (0, react.useState)("close");
			const [layerHost, setLayerHost] = (0, react.useState)(null);
			const commandButtonRef = (0, react.useRef)(null);
			const menuLayerRef = (0, react.useRef)(null);
			const dialogLayerRef = (0, react.useRef)(null);
			const layerHostRef = (0, react.useRef)(null);
			/** 光标落位计时器（插入正文后异步落位，卸载时必须收回）。 */
			const caretTimerRef = (0, react.useRef)(null);
			const input = useInput((s) => s);
			const session = useSession((s) => s);
			const workspaces = useWorkspaces((s) => s);
			const sessionIdOfSnapshot = useSession((s) => s === null || s === void 0 ? "" : String(s.sessionId ?? ""));
			const presetWorkspaceKey = workspaceKeyOf({
				sessionId: sessionId ?? sessionIdOfSnapshot,
				items: workspaces?.items
			});
			const currentDraft = input?.draft ?? "";
			const showToast = (0, react.useCallback)((text) => {
				const now = Date.now();
				setToastSlot((prev) => nextToast(prev, text, now));
			}, []);
			(0, react.useEffect)(() => {
				noticeRef.current = showToast;
			}, [showToast]);
			if (writerRef.current === null) writerRef.current = createCoalescingWriter({
				delayMs: 250,
				write: (request) => {
					const next = withPreset(currentPresetStore(), request.key, request.text);
					cachedPresetStore = next;
					commitPresetStore(next);
				},
				onApplied: () => {
					noticeRef.current(PRESET_SAVED_TEXT);
				},
				onError: (_request, error) => {
					noticeRef.current(presetWriteFailedText(error));
				}
			});
			(0, react.useEffect)(() => {
				if (toastSlot === null) return;
				const timer = setTimeout(() => {
					setToastSlot((prev) => isToastExpired(prev?.deadline ?? null, Date.now()) ? null : prev);
				}, 2520);
				return () => clearTimeout(timer);
			}, [toastSlot]);
			(0, react.useEffect)(() => {
				if (optimizeToast === null || optimizeToast.kind !== "done") return;
				const timer = setTimeout(() => {
					setOptimizeToast((prev) => prev !== null && prev.kind === "done" && isDoneToastExpired(prev, Date.now()) ? { kind: "idle" } : prev);
				}, 2020);
				return () => clearTimeout(timer);
			}, [optimizeToast]);
			(0, react.useEffect)(() => () => {
				optimizeAbortRef.current?.abort();
				optimizeAbortRef.current = null;
			}, []);
			(0, react.useEffect)(() => {
				setLlmEnabled(readLlmEnabled());
				setGoalMode(readGoalMode());
			}, []);
			(0, react.useEffect)(() => {
				writerRef.current?.flush();
			}, [presetWorkspaceKey]);
			(0, react.useEffect)(() => () => {
				writerRef.current?.flush();
			}, []);
			(0, react.useEffect)(() => {
				const flushPending = () => {
					writerRef.current?.flush();
				};
				const onVisibility = () => {
					if (document.visibilityState === "hidden") flushPending();
				};
				window.addEventListener("pagehide", flushPending);
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					window.removeEventListener("pagehide", flushPending);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, []);
			(0, react.useEffect)(() => {
				const onStorage = (event) => {
					if (event.key === "dsh-quick-append.commands") {
						cachedCommandStore = null;
						setCommandRevision((n) => n + 1);
						return;
					}
					if (event.key !== null && event.key !== "dsh-quick-append.presets") return;
					cachedPresetStore = null;
					writerRef.current?.flush();
					setStoreRevision((n) => n + 1);
				};
				window.addEventListener("storage", onStorage);
				return () => window.removeEventListener("storage", onStorage);
			}, []);
			(0, react.useEffect)(() => {
				if (!editing) return;
				setPresetDraft(readPreset(editKeyRef.current));
			}, [editing]);
			(0, react.useEffect)(() => {
				if (!editing) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") setEditing(false);
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [editing]);
			(0, react.useEffect)(() => {
				if (!editing) return;
				const onOutside = (event) => {
					const target = event.target;
					if (boxRef.current !== null && boxRef.current.contains(target)) return;
					if (layerHostRef.current !== null && layerHostRef.current.contains(target)) return;
					setEditing(false);
				};
				document.addEventListener("mousedown", onOutside);
				return () => document.removeEventListener("mousedown", onOutside);
			}, [editing]);
			const presetWorkspaceLabel = presetWorkspaceKey === "__no-workspace__" ? "未归属工作区" : String(workspaces?.items?.find((w) => w?.workspaceId === presetWorkspaceKey)?.title ?? "未知工作区");
			const preset = (0, react.useMemo)(() => readPreset(presetWorkspaceKey), [presetWorkspaceKey, storeRevision]);
			const commandList = (0, react.useMemo)(() => readCommands(), [commandRevision]);
			/** 解析中拦截：复用「点击追加」的判定与固定文案 —— 新按钮不得绕过既有互斥。 */
			const commandGestureAllowed = (0, react.useCallback)(() => {
				const decision = gestureDecision(parsingRef.current ? "parsing" : "idle", "click");
				if (!decision.intercepted) return true;
				if (decision.toast !== null) showToast(decision.toast);
				return false;
			}, [showToast]);
			const closeCommandMenu = (0, react.useCallback)((refocus) => {
				setMenuOpen(false);
				setMenuLine(null);
				if (refocus) commandButtonRef.current?.focus();
			}, []);
			const openCommandMenu = (0, react.useCallback)(() => {
				if (readCommands().length === 0) {
					showToast(COMMAND_EMPTY_TOAST);
					return;
				}
				const el = commandButtonRef.current;
				if (el === null) return;
				const box = el.getBoundingClientRect();
				setMenuLine(dropUpLineFor({
					rect: {
						left: box.left,
						top: box.top,
						width: box.width,
						height: box.height
					},
					panelWidth: 320,
					panelHeight: 260,
					viewport: {
						width: window.innerWidth,
						height: window.innerHeight
					}
				}));
				setMenuActive(0);
				setEditing(false);
				setCommandDialogOpen(false);
				setMenuOpen(true);
			}, [showToast]);
			const resetCommandDraft = (0, react.useCallback)(() => {
				setCommandDraft({
					title: "",
					content: ""
				});
				setEditingCommandId(null);
				setCommandError(null);
				setDiscardConfirm(false);
			}, []);
			const closeCommandDialog = (0, react.useCallback)(() => {
				setCommandDialogOpen(false);
				setDiscardConfirm(false);
				setDeleteConfirm(null);
				setCommandError(null);
			}, []);
			const openCommandDialog = (0, react.useCallback)(() => {
				setMenuOpen(false);
				setMenuLine(null);
				setEditing(false);
				resetCommandDraft();
				setDeleteConfirm(null);
				setDialogPlacement(centerPlacementOf({
					panelWidth: 380,
					panelHeight: 460,
					viewport: {
						width: window.innerWidth,
						height: window.innerHeight
					}
				}));
				setCommandDialogOpen(true);
			}, [resetCommandDraft]);
			const beginEditCommand = (0, react.useCallback)((command) => {
				setEditingCommandId(command.id);
				setCommandDraft(commandDraftOf(command));
				setCommandError(null);
				setDiscardConfirm(false);
			}, []);
			const saveCommandDraft = (0, react.useCallback)(() => {
				const decision = validateCommandDraft(commandDraft);
				if (!decision.ok) {
					setCommandError(decision.message);
					return;
				}
				const store = currentCommandStore();
				const next = editingCommandId === null ? withCommandAdded(store, decision.value, createCommandId(commandIdsOf(store))) : withCommandUpdated(store, editingCommandId, decision.value);
				cachedCommandStore = next;
				try {
					commitCommandStore(next);
				} catch (error) {
					setCommandError(commandWriteFailedText(error));
					return;
				}
				setCommandRevision((n) => n + 1);
				setCommandDraft({
					title: "",
					content: ""
				});
				setEditingCommandId(null);
				setCommandError(null);
				setDiscardConfirm(false);
				showToast(COMMAND_SAVED_TEXT);
			}, [
				commandDraft,
				editingCommandId,
				showToast
			]);
			const requestDeleteCommand = (0, react.useCallback)((id) => {
				const decision = nextDeleteConfirm(deleteConfirm, id, Date.now());
				setDeleteConfirm(decision.state);
				if (!decision.confirmed) return;
				const next = withCommandRemoved(currentCommandStore(), id);
				cachedCommandStore = next;
				try {
					commitCommandStore(next);
				} catch (error) {
					setCommandError(commandWriteFailedText(error));
					return;
				}
				setCommandRevision((n) => n + 1);
				if (editingCommandId === id) {
					setEditingCommandId(null);
					setCommandDraft({
						title: "",
						content: ""
					});
				}
				showToast(COMMAND_DELETED_TEXT);
			}, [
				deleteConfirm,
				editingCommandId,
				showToast
			]);
			const selectCommand = (0, react.useCallback)((command) => {
				inputActions.setDraft(insertionText(currentDraft, command.content));
				closeCommandMenu(false);
				if (caretTimerRef.current !== null) clearTimeout(caretTimerRef.current);
				caretTimerRef.current = setTimeout(() => {
					caretTimerRef.current = null;
					focusComposerEnd();
				}, 0);
			}, [
				currentDraft,
				inputActions,
				closeCommandMenu
			]);
			/** 关闭弹窗的脏检查：脏 → 先问（需求 4.5）；不脏 → 直接关。 */
			const requestCloseDialog = (0, react.useCallback)(() => {
				if (commandDraftDirty(editingCommandId === null ? null : commandOf(currentCommandStore(), editingCommandId), commandDraft)) {
					setDiscardIntent("close");
					setDiscardConfirm(true);
					return;
				}
				setDiscardConfirm(false);
				closeCommandDialog();
			}, [
				commandDraft,
				editingCommandId,
				closeCommandDialog
			]);
			/** 取消编辑同样不得静默丢改动。 */
			const requestCancelEdit = (0, react.useCallback)(() => {
				if (commandDraftDirty(editingCommandId === null ? null : commandOf(currentCommandStore(), editingCommandId), commandDraft)) {
					setDiscardIntent("cancel");
					setDiscardConfirm(true);
					return;
				}
				resetCommandDraft();
			}, [
				commandDraft,
				editingCommandId,
				resetCommandDraft
			]);
			const confirmDiscard = (0, react.useCallback)(() => {
				if (discardIntent === "cancel") {
					resetCommandDraft();
					return;
				}
				closeCommandDialog();
			}, [
				discardIntent,
				resetCommandDraft,
				closeCommandDialog
			]);
			(0, react.useEffect)(() => {
				const host = document.createElement("div");
				host.className = "dsh-qa-portal";
				host.setAttribute("data-dsh-quick-append-layer", "");
				document.body.appendChild(host);
				layerHostRef.current = host;
				setLayerHost(host);
				return () => {
					layerHostRef.current = null;
					setLayerHost(null);
					host.remove();
				};
			}, []);
			(0, react.useEffect)(() => {
				currentCommandStore();
				if (pendingCommandDamage === null) return;
				const dropped = pendingCommandDamage;
				pendingCommandDamage = null;
				showToast(commandDamagedText(dropped));
			}, [showToast, commandRevision]);
			(0, react.useEffect)(() => () => {
				if (caretTimerRef.current !== null) {
					clearTimeout(caretTimerRef.current);
					caretTimerRef.current = null;
				}
			}, []);
			(0, react.useEffect)(() => {
				if (!menuOpen) return;
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						closeCommandMenu(true);
						return;
					}
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setMenuActive((index) => commandList.length === 0 ? 0 : (index + 1) % commandList.length);
						return;
					}
					if (event.key === "ArrowUp") {
						event.preventDefault();
						setMenuActive((index) => commandList.length === 0 ? 0 : (index - 1 + commandList.length) % commandList.length);
						return;
					}
					if (event.key === "Enter" || event.key === " ") {
						const picked = commandList[menuActive];
						if (picked === void 0) return;
						event.preventDefault();
						selectCommand(picked);
					}
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [
				menuOpen,
				commandList,
				menuActive,
				closeCommandMenu,
				selectCommand
			]);
			(0, react.useEffect)(() => {
				if (!menuOpen) return;
				const onMouseDown = (event) => {
					const target = event.target;
					if (target !== null && menuLayerRef.current !== null && menuLayerRef.current.contains(target)) return;
					if (target !== null && commandButtonRef.current !== null && commandButtonRef.current.contains(target)) return;
					closeCommandMenu(false);
				};
				const onViewportChange = () => {
					closeCommandMenu(false);
				};
				document.addEventListener("mousedown", onMouseDown);
				window.addEventListener("scroll", onViewportChange, true);
				window.addEventListener("resize", onViewportChange);
				return () => {
					document.removeEventListener("mousedown", onMouseDown);
					window.removeEventListener("scroll", onViewportChange, true);
					window.removeEventListener("resize", onViewportChange);
				};
			}, [menuOpen, closeCommandMenu]);
			(0, react.useEffect)(() => {
				if (!commandDialogOpen) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					requestCloseDialog();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [commandDialogOpen, requestCloseDialog]);
			(0, react.useEffect)(() => {
				if (deleteConfirm === null) return;
				const id = deleteConfirm.id;
				const timer = setTimeout(() => {
					setDeleteConfirm((prev) => prev !== null && prev.id === id && !isDeleteConfirmActive(prev, id, Date.now()) ? null : prev);
				}, 4020);
				return () => clearTimeout(timer);
			}, [deleteConfirm]);
			const appendPlain = (0, react.useCallback)(() => {
				if (preset === "") {
					showToast("请右键设置追加文案");
					return;
				}
				const next = currentDraft === "" ? preset : `${currentDraft}\n\n${preset}`;
				inputActions.setDraft(goalMode ? `/goal\n${next}` : next);
			}, [
				preset,
				currentDraft,
				goalMode,
				inputActions,
				showToast
			]);
			const appendWithLlm = (0, react.useCallback)(async () => {
				if (preset === "") {
					showToast("请右键设置追加文案");
					return;
				}
				if (currentDraft.trim() === "") {
					showToast("请先输入需求");
					return;
				}
				if (parsingRef.current) return;
				parsingRef.current = true;
				setOptimizeToast((prev) => toastOnOptimizeStart(prev));
				const controller = new AbortController();
				optimizeAbortRef.current = controller;
				let preprocessNote = null;
				let images = [];
				try {
					const imageIds = input?.imageIds;
					const prepared = await prepareImages(Array.isArray(imageIds) && conversationService !== void 0 ? conversationService.draftImages(imageIds) : []);
					images = prepared.images;
					preprocessNote = prepared.note;
					const response = await fetch("/@dsh-external/dsh-quick-append/api/optimize", {
						method: "POST",
						headers: { "content-type": "application/json" },
						signal: controller.signal,
						body: JSON.stringify({
							draft: currentDraft,
							context: buildRecentContext(session),
							cwd: workspaces?.items?.find((w) => w.workspaceId === workspaces?.recentWorkspaceId)?.path ?? "",
							preset,
							images
						})
					});
					const body = await response.json();
					if (!response.ok || !body.ok || typeof body.optimized !== "string" || body.optimized.trim() === "") throw new Error(body?.error ?? "LLM优化失败");
					const optimized = body.optimized.trim();
					inputActions.setDraft(goalMode ? `/goal\n${optimized}\n\n${preset}` : `${optimized}\n\n${preset}`);
					setOptimizeToast((prev) => toastOnOptimizeEnd(prev, Date.now()));
					if (preprocessNote !== null) showToast(preprocessNote);
					else if (body.imagesDropped === true) showToast("图片未能纳入，已按纯文本优化");
				} catch (error) {
					const aborted = controller.signal.aborted || error instanceof Error && error.name === "AbortError";
					setOptimizeToast({ kind: "idle" });
					if (!aborted) showToast(error instanceof Error ? error.message : "LLM优化失败");
				} finally {
					parsingRef.current = false;
					if (optimizeAbortRef.current === controller) optimizeAbortRef.current = null;
				}
			}, [
				preset,
				currentDraft,
				session,
				goalMode,
				inputActions,
				showToast,
				workspaces,
				input
			]);
			(0, react.useEffect)(() => {
				const onShortcut = (event) => {
					if (!event.shiftKey || !event.altKey || event.code !== "KeyF") return;
					const el = document.activeElement;
					if (!isComposerInputPoint(el)) return;
					if (!el.closest("[data-composer-card]")) return;
					if (el.closest(".dsh-qa-popover")) return;
					event.preventDefault();
					const decision = gestureDecision(parsingRef.current ? "parsing" : "idle", "click");
					if (decision.intercepted) {
						if (decision.toast !== null) showToast(decision.toast);
						return;
					}
					if (llmEnabled) appendWithLlm();
					else appendPlain();
				};
				document.addEventListener("keydown", onShortcut);
				return () => document.removeEventListener("keydown", onShortcut);
			}, [
				llmEnabled,
				appendPlain,
				appendWithLlm,
				showToast
			]);
			const openEditor = (0, react.useCallback)(() => {
				editKeyRef.current = presetWorkspaceKey;
				setPresetDraft(readPreset(presetWorkspaceKey));
				setMenuOpen(false);
				setMenuLine(null);
				setCommandDialogOpen(false);
				setEditing(true);
			}, [presetWorkspaceKey]);
			const save = (0, react.useCallback)(() => {
				writerRef.current?.submit(editKeyRef.current, presetDraft);
				setEditing(false);
			}, [presetDraft]);
			const toggleLlm = (0, react.useCallback)(() => {
				const next = !llmEnabled;
				setLlmEnabled(next);
				writeLlmEnabled(next);
			}, [llmEnabled]);
			const toggleGoal = (0, react.useCallback)(() => {
				const next = !goalMode;
				setGoalMode(next);
				writeGoalMode(next);
			}, [goalMode]);
			const commandButtonProps = {
				type: "button",
				ref: commandButtonRef,
				title: COMMAND_LABEL,
				"aria-label": COMMAND_LABEL,
				"aria-haspopup": "menu",
				"aria-expanded": menuOpen,
				onClick: () => {
					if (!commandGestureAllowed()) return;
					if (menuOpen) {
						closeCommandMenu(false);
						return;
					}
					openCommandMenu();
				},
				onContextMenu: (event) => {
					event.preventDefault();
					if (!commandGestureAllowed()) return;
					openCommandDialog();
				},
				onKeyDown: (event) => {
					if (!(event.key === "ContextMenu" || event.shiftKey === true && event.key === "F10")) return;
					event.preventDefault();
					if (!commandGestureAllowed()) return;
					openCommandDialog();
				},
				style: ICON_BUTTON_STYLE
			};
			const appendButtonProps = {
				type: "button",
				title: "点击追加 / 右键设置",
				onClick: () => {
					const decision = gestureDecision(parsingRef.current ? "parsing" : "idle", "click");
					if (decision.intercepted) {
						if (decision.toast !== null) showToast(decision.toast);
						return;
					}
					if (llmEnabled) appendWithLlm();
					else appendPlain();
				},
				onContextMenu: (event) => {
					event.preventDefault();
					const decision = gestureDecision(parsingRef.current ? "parsing" : "idle", "contextmenu");
					if (decision.intercepted) {
						if (decision.toast !== null) showToast(decision.toast);
						return;
					}
					openEditor();
				},
				style: ICON_BUTTON_STYLE
			};
			return (0, react.createElement)("div", {
				ref: boxRef,
				style: {
					position: "relative",
					display: "flex",
					alignItems: "center",
					gap: 4
				}
			}, (0, react.createElement)("div", { className: "dsh-qa-tools" }, (0, react.createElement)("button", commandButtonProps, (0, react.createElement)("svg", ICON_SVG_PROPS, (0, react.createElement)("path", { d: WRENCH_PATH }))), (0, react.createElement)("button", appendButtonProps, (0, react.createElement)("svg", ICON_SVG_PROPS, (0, react.createElement)("path", { d: BOLT_PATH })))), toastSlot === null ? null : (0, react.createElement)("span", { style: {
				fontSize: 11,
				color: "var(--al-text2, #9AA3B2)"
			} }, toastSlot.text), optimizeToast !== null && optimizeToast.kind !== "idle" ? (0, react.createElement)("span", { className: "dsh-qa-opt" + (optimizeToast.kind === "done" ? " done" : "") }, optimizeToast.kind === "optimizing" ? (0, react.createElement)("span", {
				className: "dsh-qa-opt-spin",
				"aria-hidden": true
			}) : null, optimizeToast.kind === "optimizing" ? OPTIMIZING_TOAST : DONE_TOAST) : null, editing ? (0, react.createElement)("div", { className: "dsh-qa-popover" }, (0, react.createElement)("div", { className: "dsh-qa-title" }, "快捷追加文案"), (0, react.createElement)("textarea", {
				className: "dsh-qa-textarea",
				value: presetDraft,
				onChange: (event) => setPresetDraft(event.target.value),
				autoFocus: true
			}), (0, react.createElement)("div", { className: "dsh-qa-meta" }, (0, react.createElement)("span", {
				className: "dsh-qa-meta-text",
				title: "追加文案按工作区隔离保存（切换工作区互不影响）"
			}, "写入：" + presetWorkspaceLabel), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: () => setPresetDraft(DEFAULT_APPEND_TEXT)
			}, "填入默认文案")), (0, react.createElement)("div", { className: "dsh-qa-footer" }, (0, react.createElement)("div", { className: "dsh-qa-toggles" }, (0, react.createElement)("label", { className: "dsh-qa-toggle" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: llmEnabled,
				onChange: toggleLlm
			}), "LLM优化"), (0, react.createElement)("label", { className: "dsh-qa-toggle" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: goalMode,
				onChange: toggleGoal
			}), "goal模式")), (0, react.createElement)("div", { className: "dsh-qa-actions" }, (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: () => setEditing(false)
			}, "取消"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn dsh-qa-btn-primary",
				onClick: save
			}, "保存")))) : null, layerHost === null ? null : (0, react_dom.createPortal)((0, react.createElement)("div", { className: "dsh-qa-portal-root" }, menuOpen && menuLine !== null ? (0, react.createElement)("div", {
				key: "command-menu",
				ref: menuLayerRef,
				className: "dsh-qa-popover dsh-qa-menu",
				role: "menu",
				"aria-label": COMMAND_LABEL,
				style: layerStyleOf(menuLine, 320, 260)
			}, (0, react.createElement)("div", { className: "dsh-qa-menu-head" }, (0, react.createElement)("span", { className: "dsh-qa-head-title" }, COMMAND_LABEL), (0, react.createElement)("span", { className: "dsh-qa-head-count" }, String(commandList.length) + " 条")), (0, react.createElement)("div", { className: "dsh-qa-menu-list" }, commandList.map((command, index) => (0, react.createElement)("button", {
				key: command.id,
				type: "button",
				role: "menuitem",
				title: command.title,
				"aria-selected": index === menuActive ? "true" : "false",
				className: "dsh-qa-menu-item" + (index === menuActive ? " on" : ""),
				onMouseEnter: () => setMenuActive(index),
				onClick: () => selectCommand(command)
			}, command.title))), (0, react.createElement)("div", { className: "dsh-qa-menu-foot" }, (0, react.createElement)("span", { className: "dsh-qa-meta-text" }, "左键插入正文 · 右键录入/编辑"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: openCommandDialog
			}, "管理"))) : null, commandDialogOpen ? (0, react.createElement)("div", {
				key: "command-mask",
				className: "dsh-qa-mask",
				onClick: requestCloseDialog
			}) : null, commandDialogOpen && dialogPlacement !== null ? (0, react.createElement)("div", {
				key: "command-dialog",
				ref: dialogLayerRef,
				className: "dsh-qa-popover dsh-qa-dialog",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": COMMAND_LABEL,
				style: layerStyleOf(dialogPlacement, 380, DIALOG_MAX_HEIGHT)
			}, (0, react.createElement)("div", { className: "dsh-qa-head" }, (0, react.createElement)("span", { className: "dsh-qa-head-title" }, COMMAND_LABEL), (0, react.createElement)("span", { className: "dsh-qa-head-count" }, String(commandList.length) + " 条")), (0, react.createElement)("div", { className: "dsh-qa-body" }, commandList.length === 0 ? (0, react.createElement)("div", { className: "dsh-qa-empty" }, "还没有预存命令：填好下面的标题与正文，点「新增」") : (0, react.createElement)("div", { className: "dsh-qa-cmd-list" }, commandList.map((command) => {
				const armed = isDeleteConfirmActive(deleteConfirm, command.id, Date.now());
				return (0, react.createElement)("div", {
					key: command.id,
					className: "dsh-qa-cmd-row" + (command.id === editingCommandId ? " on" : "")
				}, (0, react.createElement)("span", {
					className: "dsh-qa-cmd-title",
					title: command.title
				}, command.title), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-qa-btn",
					onClick: () => beginEditCommand(command)
				}, "编辑"), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-qa-btn" + (armed ? " dsh-qa-btn-danger" : ""),
					onClick: () => requestDeleteCommand(command.id)
				}, armed ? "确认删除" : "删除"));
			})), (0, react.createElement)("div", { className: "dsh-qa-form" }, (0, react.createElement)("div", { className: "dsh-qa-field" }, (0, react.createElement)("div", { className: "dsh-qa-label" }, "标题（菜单里显示）", (0, react.createElement)("span", { className: "dsh-qa-head-count" }, "≤ " + String(50) + " 字")), (0, react.createElement)("input", {
				className: "dsh-qa-input",
				type: "text",
				value: commandDraft.title,
				onChange: (event) => setCommandDraft((prev) => ({
					title: event.target.value,
					content: prev.content
				}))
			})), (0, react.createElement)("div", { className: "dsh-qa-field" }, (0, react.createElement)("div", { className: "dsh-qa-label" }, "正文（选中后插入对话框）", (0, react.createElement)("span", { className: "dsh-qa-head-count" }, "≤ " + String(COMMAND_CONTENT_MAX) + " 字")), (0, react.createElement)("textarea", {
				className: "dsh-qa-textarea",
				value: commandDraft.content,
				onChange: (event) => setCommandDraft((prev) => ({
					title: prev.title,
					content: event.target.value
				}))
			})), commandError === null ? null : (0, react.createElement)("div", { className: "dsh-qa-err" }, commandError)), discardConfirm ? (0, react.createElement)("div", { className: "dsh-qa-confirm" }, (0, react.createElement)("span", { className: "dsh-qa-meta-text" }, "有未保存的修改，确定放弃？"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: () => setDiscardConfirm(false)
			}, "继续编辑"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn dsh-qa-btn-danger",
				onClick: confirmDiscard
			}, "放弃")) : null), (0, react.createElement)("div", { className: "dsh-qa-footer" }, (0, react.createElement)("span", { className: "dsh-qa-meta-text" }, editingCommandId === null ? "新增指令" : "正在编辑"), (0, react.createElement)("div", { className: "dsh-qa-actions" }, editingCommandId === null ? null : (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: requestCancelEdit
			}, "取消编辑"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn dsh-qa-btn-primary",
				onClick: saveCommandDraft
			}, editingCommandId === null ? "新增" : "保存修改"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-qa-btn",
				onClick: requestCloseDialog
			}, "关闭")))) : null), layerHost));
		}
		function apply(ctx) {
			try {
				ensureSkinStyle();
				conversationService = ctx.get?.("conversation") ?? void 0;
				ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "dsh-quick-append",
					order: 10
				}, QuickAppendButton));
			} catch (error) {
				console.error("[dsh-quick-append] apply crashed:", String(error));
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map