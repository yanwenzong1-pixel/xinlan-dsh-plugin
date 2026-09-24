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
		* usage overview in the exact format: 对话: N，当日: X.XX元，余额: Y.YY元
		* (tabular-nums; '--' while unknown/failed). The collapsed icon button keeps
		* its original behavior. No other plugin is involved (v0.2.1).
		*/
		const inject = ["slots"];
		const STATUS_URL = "/@dsh-external/dsh-dialogue-alert-message/api/status";
		const USAGE_URL = "/@dsh-external/dsh-dialogue-alert-message/api/usage";
		const ALARM_URL = "/@dsh-external/dsh-dialogue-alert-message/api/alarm";
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
		function RunningIcon() {
			return (0, react.createElement)("svg", {
				width: 18,
				height: 18,
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
			return (0, react.createElement)("div", { style: {
				padding: "6px 10px",
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--al-text2, #9AA3B2)",
				fontFamily: "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
				fontVariantNumeric: "tabular-nums",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			} }, usage === null ? "对话: --，当日: --元，余额: --元" : `对话: ${fmtCount(usage.dialogueCount)}，当日: ${fmtMoney2(usage.todayCost)}元，余额: ${fmtMoney2(usage.balance)}元`);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map