window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-dialogue-alert-message",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/lib/usage-stats.ts
		/** 金额/次数展示：缺失一律 '--'，禁用 undefined/NaN/null 泄漏；金额两位小数。 */
		function fmtMoney2(v) {
			if (typeof v !== "number" || !Number.isFinite(v)) return "--";
			const text = v.toFixed(2);
			return text === "-0.00" ? "0.00" : text;
		}
		function fmtCount(v) {
			if (typeof v !== "number" || !Number.isFinite(v)) return "--";
			return String(Math.trunc(v));
		}
		/**
		* 侧栏状态栏文案（唯一出口，纯函数）：`对话: {N}，余额: {Y.YY}元`。
		* - `usage === null`（首次加载未完成）→ 全部 '--'；
		* - 余额未知/刷新失败 → 仅余额 '--'（`fmtMoney2` 兜底）；
		* - **v0.2.2 起不再上屏「当日: X.XX元」**（用户指令 2026-10-11）：当日消耗仍在 `/api/usage`
		*   与 `stats.json` 中保留，只是不展示。
		*/
		function statusTextOf(usage) {
			if (usage === null) return "对话: --，余额: --元";
			return `对话: ${fmtCount(usage.dialogueCount)}，余额: ${fmtMoney2(usage.balance)}元`;
		}
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
		function availableForText(rowWidth, usedBySiblings) {
			if (!Number.isFinite(rowWidth) || !Number.isFinite(usedBySiblings)) return NaN;
			return rowWidth - usedBySiblings - 12;
		}
		/**
		* 是否应降级为紧凑图标。
		* - 非有限值/负值（量不出来）→ 一律降级：宁可只显示图标，也不显示被裁断的残条；
		* - 已在紧凑态 → 需要 `required + FOOTER_FIT_MARGIN_PX` 才恢复全文（迟滞）；
		* - 正常态 → 空间小于 `required` 即降级。
		*/
		function shouldCompact(input) {
			const free = Number.isFinite(input?.free) ? input.free : NaN;
			const required = Number.isFinite(input?.required) ? input.required : NaN;
			if (!Number.isFinite(free) || !Number.isFinite(required) || free < 0 || required < 0) return true;
			if (input.wasCompact) return free < required + 12;
			return free < required;
		}
		/** 播放判定 + 下一个计数（纯函数）。count 为已播放次数。 */
		function replayDecision(count, max = 3) {
			const safeMax = Number.isFinite(max) && max >= 0 ? Math.floor(max) : 3;
			if (!Number.isFinite(count)) {
				if (count > 0) return {
					play: false,
					next: safeMax + 1
				};
				return {
					play: true,
					next: 1
				};
			}
			const next = (count >= 0 ? Math.floor(count) : 0) + 1;
			return {
				play: next <= safeMax,
				next
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-dialogue-alert-message — client half.
		* A status bar above the Settings button (`sidebar.footer.action`).
		* Polls the host status + usage APIs and plays short sounds when a dialogue
		* completes; plays interruption alarm sounds from the host's self-contained
		* notification service (host-side gate: total switch / mute-all / level filter
		* / DND already applied; client only plays and acks). The wide bar shows the
		* usage overview via the shared pure formatter: 对话: N，余额: Y.YY元
		* (tabular-nums; '--' while unknown/failed; 「当日: X.XX元」已于 v0.2.2 按要求下屏). The collapsed
		* icon button keeps its original behavior. No other plugin is involved (v0.2.1).
		*/
		const inject = ["slots"];
		const STATUS_URL = "/@dsh-external/dsh-dialogue-alert-message/api/status";
		const USAGE_URL = "/@dsh-external/dsh-dialogue-alert-message/api/usage";
		const ALARM_URL = "/@dsh-external/dsh-dialogue-alert-message/api/alarm";
		/** 文本样式：可见文案与「隐藏测量节点」必须逐字一致，量出来的自然宽才可信。 */
		const TEXT_FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
		const TEXT_FONT_SIZE = 12;
		const TEXT_PADDING_X = 10;
		/** 音色映射：single 单音 / double 双脉冲 / triple 三连（本地降级发声按等级区分严重度）。 */
		const SOUND_PATTERNS = {
			single: [660],
			double: [880, 660],
			triple: [
				880,
				660,
				880
			]
		};
		function playTone(frequencies, durationMs, volume = .18) {
			try {
				const AudioContextClass = window.AudioContext || window.webkitAudioContext;
				if (AudioContextClass === void 0) return;
				const context = new AudioContextClass();
				const gain = context.createGain();
				gain.connect(context.destination);
				gain.gain.setValueAtTime(1e-4, context.currentTime);
				gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + .02);
				gain.gain.exponentialRampToValueAtTime(1e-4, context.currentTime + durationMs / 1e3);
				frequencies.forEach((freq, index) => {
					const osc = context.createOscillator();
					osc.type = "sine";
					osc.frequency.value = freq;
					osc.connect(gain);
					const start = context.currentTime + index * (durationMs / frequencies.length / 1e3);
					osc.start(start);
					osc.stop(start + durationMs / frequencies.length / 1e3);
				});
				setTimeout(() => {
					context.close();
				}, durationMs + 50);
			} catch {}
		}
		function playCompleted() {
			playTone([880, 1320], 700);
		}
		function playInternalAlarm(item) {
			playTone(SOUND_PATTERNS[item.soundType] ?? SOUND_PATTERNS.single, item.durationMs, item.volume);
		}
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-dialogue-alert-message",
				order: 10
			}, DialogueAlertBar));
		}
		function RunningIcon(size = 18) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, (0, react.createElement)("path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" }));
		}
		function DialogueAlertBar({ wide, toggleSidebar }) {
			const [counts, setCounts] = (0, react.useState)({
				running: 0,
				error: 0,
				completed: 0
			});
			const [usage, setUsage] = (0, react.useState)(null);
			const lastSeqRef = (0, react.useRef)(0);
			const replayCountRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			(0, react.useEffect)(() => {
				let stop = false;
				const tick = async () => {
					if (stop) return;
					try {
						const [statusRes, usageRes] = await Promise.allSettled([fetch(STATUS_URL), fetch(USAGE_URL)]);
						if (statusRes.status === "fulfilled") {
							const body = await statusRes.value.json();
							if (body.ok) {
								setCounts(body.counts);
								const event = body.lastEvent;
								if (event && event.seq > lastSeqRef.current) {
									lastSeqRef.current = event.seq;
									if (event.type === "completed") playCompleted();
								}
							}
						}
						if (usageRes.status === "fulfilled") {
							const body = await usageRes.value.json();
							if (body.ok && body.data) setUsage(body.data);
						}
						try {
							const alarmBody = await (await fetch(ALARM_URL)).json();
							if (alarmBody.ok && Array.isArray(alarmBody.items) && alarmBody.items.length > 0) {
								const toPlay = [];
								for (const item of alarmBody.items) {
									const decision = replayDecision(replayCountRef.current.get(item.id) ?? 0);
									replayCountRef.current.set(item.id, decision.next);
									if (decision.play) toPlay.push(item);
								}
								if (replayCountRef.current.size > 256) replayCountRef.current.clear();
								for (const item of toPlay) playInternalAlarm(item);
								const ids = alarmBody.items.map((i) => i.id).filter((v) => typeof v === "string" && v !== "");
								if (ids.length > 0) fetch(`${ALARM_URL}/ack`, {
									method: "POST",
									headers: { "content-type": "application/json" },
									body: JSON.stringify({ ids })
								}).catch(() => {});
							}
						} catch {}
					} catch {}
				};
				tick();
				const timer = setInterval(() => {
					tick();
				}, 1e3);
				return () => {
					stop = true;
					clearInterval(timer);
				};
			}, []);
			const rootRef = (0, react.useRef)(null);
			const measureRef = (0, react.useRef)(null);
			const [compact, setCompact] = (0, react.useState)(false);
			const text = statusTextOf(usage);
			(0, react.useEffect)(() => {
				if (!wide) return;
				const rowOf = (el) => {
					let cur = el?.parentElement ?? null;
					while (cur) {
						if (getComputedStyle(cur).display !== "contents") return cur;
						cur = cur.parentElement;
					}
					return null;
				};
				const flexItemsOf = (row) => {
					const out = [];
					const walk = (el) => {
						for (const child of Array.from(el.children)) if (getComputedStyle(child).display === "contents") walk(child);
						else out.push(child);
					};
					walk(row);
					return out;
				};
				const decide = () => {
					const root = rootRef.current;
					const row = rowOf(root);
					if (!root || !row) return;
					const required = (measureRef.current?.offsetWidth ?? 0) + TEXT_PADDING_X * 2;
					let used = 0;
					for (const item of flexItemsOf(row)) if (item !== root) used += item.offsetWidth;
					const free = availableForText(row.clientWidth, used);
					setCompact((prev) => shouldCompact({
						free,
						required,
						wasCompact: prev
					}));
				};
				decide();
				const observer = new ResizeObserver(decide);
				const row = rowOf(rootRef.current);
				if (row) {
					observer.observe(row);
					for (const item of flexItemsOf(row)) observer.observe(item);
				}
				return () => {
					observer.disconnect();
				};
			}, [wide, text]);
			if (!wide) return (0, react.createElement)("button", {
				type: "button",
				title: "对话运行状态：运行中，点击展开侧边栏",
				onClick: () => {
					if (toggleSidebar) toggleSidebar();
				},
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "100%",
					height: 32,
					padding: 0,
					border: "none",
					background: "transparent",
					color: "var(--al-text, #E6E9EF)",
					cursor: "pointer"
				}
			}, RunningIcon());
			const measureNode = (0, react.createElement)("span", {
				ref: measureRef,
				"aria-hidden": true,
				style: {
					position: "absolute",
					left: "-99999px",
					top: 0,
					visibility: "hidden",
					whiteSpace: "nowrap",
					fontSize: TEXT_FONT_SIZE,
					fontFamily: TEXT_FONT_FAMILY,
					fontVariantNumeric: "tabular-nums"
				}
			}, text);
			if (compact) {
				const tone = counts.error > 0 ? "#F87171" : counts.running > 0 ? "#60A5FA" : "var(--al-text2, #9AA3B2)";
				return (0, react.createElement)("div", {
					ref: rootRef,
					title: `对话运行状态：${text}（同行插件占满底部行，已收起为图标；悬停查看完整数据）`,
					"aria-label": `对话运行状态：${text}`,
					style: {
						flex: "0 0 auto",
						minWidth: 0,
						width: 12,
						height: 32,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: tone,
						overflow: "hidden"
					}
				}, RunningIcon(12), measureNode);
			}
			return (0, react.createElement)("div", {
				ref: rootRef,
				title: `对话运行状态：${text}`,
				style: {
					flex: "0 0 auto",
					minWidth: 0,
					padding: `6px ${TEXT_PADDING_X}px`,
					fontSize: TEXT_FONT_SIZE,
					lineHeight: "18px",
					color: "var(--al-text2, #9AA3B2)",
					fontFamily: TEXT_FONT_FAMILY,
					fontVariantNumeric: "tabular-nums",
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis"
				}
			}, text, measureNode);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map