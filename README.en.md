# DSH Dock

**More ports for DeepSeek Harness (DSH) — four ready-to-use plugins plus one auto-dispatch workflow spec, no build step after cloning.**

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-4f46e5.svg)](#requirements)
[![No build](https://img.shields.io/badge/install-no%20build%20required-brightgreen.svg)](#quick-start-1-minute)
中文 · English

`DSH plugin` · `DeepSeek Harness` · `DSH external plugin` · `cordis patch bundle` · `AI agent tooling` · `subagent task dispatch` · `auto dispatch` · `multi-agent workflow`

> **Platform note**: the author develops and verifies on the **DeepSeek Harness (DSH) Web client**. If you use the **Desktop app**, you must do the compatibility work yourself (plugin loading, WebServer/routes, asset paths, scheduled tasks/permissions, etc.); this repository does not guarantee out-of-the-box Desktop support.

---

## What you get in 30 seconds

| Your daily pain | Plugin | After installing |
| --- | --- | --- |
| Retyping the same prompt or the same command over and over | ⚡ **Quick Append** | One click appends stored text/commands, **isolated per workspace**; with **LLM optimize** it also reads your project docs + the last 3 turns and turns a rough draft into a precise request |
| Handing a whole job to a subagent, but the intermediate output floods your context | 🧩 **PTC Task** | The subagent runs in PTC (code) mode: it writes one program, keeps the intermediate output inside it, and returns **only the path to the result** |
| Long runs die or overspend, and you notice afterwards | 🔔 **Dialogue Alert** | Forced interruptions ring immediately, by severity; the sidebar also shows DeepSeek conversation count and balance |
| Repeated context, fast token burn, low cache hit rate | 🧭 **Auto Dispatch** | Fixed slots plus receipt/reply discipline reuse context; author's environment measured **99.6% cache hit** and **≈¥5.47 per 100M tokens** |

All four plugins load on the DSH side only: no DSH source edits, no touching your session data. The auto-dispatch workflow spec is included separately.

## Quick start (1 minute)

```bash
git clone https://github.com/yanwenzong1-pixel/xinlan-dsh-plugin.git
cd xinlan-dsh-plugin

dsh plugin --profile web add ./dsh-quick-append
dsh plugin --profile web add ./dsh-ptc-task
dsh plugin --profile web add ./dsh-dialogue-alert-message

# dsh-auto-dispatch-specification (workflow spec package, not a dsh plugin)
# Follow that README to copy skills/ and support/, then initialise slots.
```

Restart dsh web (or refresh the page). After Quick Append is installed, the composer gets two extra buttons: ⚡ and 🔧.

- Replace `--profile web` with your own profile name (`web` / `headless` / custom).
- `dsh plugin … add` installs the package into the profile and **automatically registers any package that declares `dsh.bundle.patch` into `dsh.profile.bundles`** — no JSON editing.
- Uninstall: `dsh plugin --profile web remove @dsh-external/dsh-quick-append`.
- **No build step**: all four plugins ship their `lib/` output (`main` points at `lib/index.js`), so a clone loads directly.
- 🧭 **Auto-dispatch is a spec package, not a `dsh plugin` plugin**: follow [`dsh-auto-dispatch-specification/README.md`](dsh-auto-dispatch-specification/README.md) to copy skills/scripts/config and initialise slots.
- 🐟 The anime desktop pet is for the author's own use and is intentionally not in the quick-start commands; install it with `dsh plugin --profile web add ./dsh-anime-desktop-pet` if you want it.
- **No build required**: each plugin ships its `lib/` output in the repo (`main` points at `lib/index.js`), so a clone is immediately loadable.

<details>
<summary>Prefer editing the profile by hand? (equivalent)</summary>

Edit `<DSH_HOME>/profiles/<name>/package.json`:

```jsonc
{
  "dependencies": {
    "@dsh-external/dsh-quick-append": "link:C:/absolute/path/dsh-quick-append"
  },
  "dsh": {
    "profile": {
      "bundles": [/* built-in bundles… */, "@dsh-external/dsh-quick-append"]
    }
  }
}
```

Then run `pnpm install` once inside that profile directory and restart dsh web.
</details>

## Screenshots

| Stored-command menu (7 rows, fully visible) | Command editor (460px viewport, 20 rows, scrollable) |
| --- | --- |
| ![Command menu](docs/172-quick-append-菜单-7条全可见.png) | ![Command editor](docs/173-quick-append-弹窗-短视口460-20条.png) |

> Since 0.5.2 both the menu and the dialog size themselves to their content, the list has exactly **one** scroll region, and a long list shows a scroll hint instead of silently clipping rows you cannot reach.

## Plugins

| Alias | Directory | Package | Version | One-liner |
| --- | --- | --- | --- | --- |
| ⚡ Quick Append | [`dsh-quick-append/`](dsh-quick-append/README.md) | `@dsh-external/dsh-quick-append` | 0.5.3 | Composer "quick append" button plus a stored-command menu and editor dialog (the dialog is portaled to body, no longer covered by the sidebar) |
| 🧩 PTC Task | [`dsh-ptc-task/`](dsh-ptc-task/README.md) | `@dsh-external/dsh-ptc-task` | 0.1.0 | Registers the `ptc_task` tool: hand a whole job to a PTC-scoped subagent |
| 🔔 Dialogue Alert | [`dsh-dialogue-alert-message/`](dsh-dialogue-alert-message/README.md) | `@dsh-external/dsh-dialogue-alert-message` | 0.2.4 | Severity-based interruption alarms plus conversation count / balance (collapses to an icon when space runs out; long-connection push with a 45s fallback) |
| 🧭 Auto Dispatch | [`dsh-auto-dispatch-specification/`](dsh-auto-dispatch-specification/README.md) | — (workflow spec) | v1 | User decision → todo maintenance → execution slots; author's environment measured 99.6% cache hit and ≈¥5.47 per 100M tokens; monitoring dashboard is BYO |
| 🐟 Anime Desktop Pet (author use) | [`dsh-anime-desktop-pet/`](dsh-anime-desktop-pet/README.md) | `@dsh-external/dsh-anime-desktop-pet` | 0.9.8 | A simple desktop pet + decoration the author uses; no recommendation implied. Hidden by default since v0.9.8; press Ctrl+Shift+F12 to show. |

### ⚡ Quick Append · [details](dsh-quick-append/README.md)

**🔥 Flagship feature: LLM optimize — turns a one-line draft into a request you can start working from**

With "LLM optimize" on, clicking the lightning button is **not "appending a few words"**: the host-side LLM first reads your **project documentation** and the **last 3 conversation turns**, then expands the prompt and fills in the missing detail. Author's own measurement: **much lower effort to get work started; prompt precision improves several-fold and ambiguity drops sharply.**

The optimise context has three parts (each with a code anchor — no black box):

| Context | What goes in | Evidence |
| --- | --- | --- |
| Your draft | Whatever is in the composer (images included, sent as one multimodal message) | Fixed request fields `['draft','context','cwd','images']`, `src/lib/optimize.ts` |
| **Project documentation** | The 5 root specs (`README.md` + 4 SPEC files), every document under `docs/`, and each plugin's `SPEC/README/DESIGN`; non-binding sections (changelog / revision log / acceptance list / roadmap) are stripped by heading; incremental cache, rebuilt only when sources change, **never written into your repo** | `src/index.ts:145` → `loadSpecContext(cwd)`; `src/lib/spec-context.ts:19-41` |
| **Last 3 turns** | The most recent 6 user/assistant messages, so a job already in progress is understood correctly | `src/client/index.ts:915-927` |

![Quick append text dialog: LLM optimize / goal mode toggles](docs/176-quick-append-快速追加文案弹窗-LLM优化.png)

- Two buttons on the right of the composer: **lightning** appends the current workspace's stored text; **wrench** opens a drop-up menu of stored commands (left-click inserts, right-click manages).
- Stored text is **isolated per workspace** and persisted — switching projects switches your presets, with no cross-contamination.
- Right-click the lightning button for the **editor dialog** (screenshot above): write the stored text, tick "LLM optimize" / "goal mode", click "insert default text".
- **goal mode** (on by default): prepends `/goal` to the draft, handing it to DSH as a goal rather than a plain prompt.
- Shortcut: `Shift+Alt+F` while the composer is focused does what the lightning button does; both buttons are Tab-reachable and `Shift+F10` opens the context menu.

### 🧩 PTC Task · [details](dsh-ptc-task/README.md)

- Registers the `ptc_task` tool: pass `prompt` (a self-contained task description) and `resultPath` (where the subagent must write its output).
- The subagent's tools are presented in **PTC (code) mode**: one program performs many steps, intermediate output stays inside it and never enters your context, while the main session keeps its native tool surface.
- Three guardrails: chain length is always ≤ 1 (a subagent cannot dispatch again), dispatch is **refused** when the recursion guard cannot be installed (fail-closed), and in-flight duplicates are deduplicated with a consecutive-failure circuit breaker.
- Fits jobs whose steps are already known (running a script per item, sweeping, reconciling, aggregating); it does not fit exploratory work where each step depends on the previous result.

### 🔔 Dialogue Alert · [details](dsh-dialogue-alert-message/README.md)

- Plays a chime when a conversation finishes normally, and a severity-graded alarm on **non-user-initiated** interruptions (tool error / forced cancel / session eviction / host restart).
- User-initiated cancels stay silent.
- The sidebar status bar shows DeepSeek account usage: conversation count / balance (since v0.2.2 the "today's cost" figure is no longer displayed; it is still returned by `/api/usage`). **Since v0.2.3 it adapts to the available width**: when the footer action row is taken over by a sibling (e.g. the built-in Cordis row) it collapses to a 12px icon with the full data in the tooltip, and expands again when space returns — without squeezing the sibling in turn.
- **v0.2.4 fixes "balance figures vanish after switching http to a long connection"**: when v0.2.3-push replaced 1s polling with push, the host read the uninjected `typertGateway` property inside a loader-isolated fiber; the throw was swallowed by `apply`'s fallback, so the Web API routes and balance timer after it were never registered and the client only saw 404. The gateway is now read lazily through `ctx.get()` (late gateway attach is picked up; failed publishes do not commit their change signature and retry on the next tick), and the push block has its own try/catch — an unavailable push never affects the Web API / balance / alarms; the client retries the first read at 0/1/3/10s.
- Alarms travel over the plugin's own channel (host queue `/api/alarm` → client WebAudio + ack) and depend on no third-party plugin.

### 🧭 Auto-dispatch workflow · [spec package](dsh-auto-dispatch-specification/README.md)

A production-tested automation workflow for DSH: **User decision → Todo maintenance → Execution slots**. This is a **workflow spec package** (skills + rules + dispatch script + slot bootstrap/backup/version-check), not a regular plugin.

**🔥 Measured results (author's environment; not a general guarantee)**

**Token cache hit rate 99.6%**

![cache hit 99.6%](dsh-auto-dispatch-specification/docs/images/cache-hit-99.6.png)

**Last 30 days: 49,320,381,740 tokens / ¥2,698.76**

![last 30 days usage](dsh-auto-dispatch-specification/docs/images/usage-cost-100m-tokens.png)

- **99.6% cache hit rate** measured in the author's DSH status bar after consistently using automated dispatch.
- **≈ ¥5.47 per 100M tokens**: `¥2,698.76 ÷ 493.2038174 ≈ ¥5.47`, i.e. the 5–6 CNY per 100M-token range.
- **Preconditions**: strictly use automated dispatch tasks; the author uses the open-source [Ponytail](https://github.com/DietrichGebert/ponytail) project to save tokens; the author uses **DeepSeek V4.1-Flash** throughout. Single-environment measurement, not a guarantee.

- **7-slot topology**: U (single user entry) → A (single dispatcher) → B/F builders, C release, E crash, G GitHub. One task goes to exactly one execution slot; replies go back through A → U.
- **Receipt means delivered**: writing to `outbox/` is not enough; `state/<name>.done = SENT -> <slot>` is the proof. Same-name files can only be sent once; retries need a new id.
- **Safe dispatch chain**: health check → dry run → confirm → receipt → ledger/reply; role/type guards; required acceptance criteria and boundaries.
- **Two skills**: `y-automation-portable` installs/moves/backs up the chain and follows DSH versions; `y-task-distribution-auto` is the only safe daily dispatch entry.
- **Five round rules**: no in-turn `sleep` waiting; new tasks go to the todo list by default; receipt means delivered; health-check and notify after restarts; consolidate the todo list on every change.
- **Windows-local deployment**: scheduled tasks, PowerShell hidden shells and the DSH profile/slot layout target Windows; Linux/macOS are not promised.
- **Not installed with `dsh plugin add`**: follow the spec README to copy `skills/`, `support/` and the config, then run `node scripts/init-slots.mjs --dry-run` for the seven default slots; use `relay-dispatch.mjs check` for a live health check.

| DSH slot sessions | Self-built monitoring dashboard (**not included**) |
| --- | --- |
| ![slot sessions](dsh-auto-dispatch-specification/docs/images/slots-session-list.png) | ![dashboard example](dsh-auto-dispatch-specification/docs/images/monitor-dashboard-example.png) |

> ⚠️ **The second screenshot (monitoring dashboard) is not part of this repository.** It is a dashboard the author built separately, shown only to illustrate slot relationships/online status/current tasks/replies. This repository open-sources the automation workflow itself (skills, rules, dispatch scripts, slot bootstrap, backup and version-check); it does **not** include the dashboard frontend/backend/data source/deployment. Users must build or connect their own monitoring panel, or use the DSH session list and `relay-dispatch.mjs check/status` text output. Session names, task titles and slot IDs in the screenshots are illustrative.

### 🐟 Anime Desktop Pet (author use)

A simple desktop pet + decoration the author uses; no recommendation implied. See the [plugin README](dsh-anime-desktop-pet/README.md) for maintenance details.


## Read this pitfall first (it can take down the whole dsh-web)

**Contract**: every package listed in a profile's `dsh.profile.bundles` **must** declare `dsh.bundle.patch` in its `package.json`, pointing at an existing `cordis.patch.yml`. If one does not, the host aborts profile loading with
`profile bundle "<pkg>" declares no dsh.bundle in its package.json` — and the blast radius is **the entire dsh-web (all your sessions and panels)**, not "that one plugin stays inactive".

Installing through `dsh plugin … add` satisfies this automatically; hand-editing JSON is where people get burned.

## Repository layout

```
dsh-quick-append/            host half src/index.ts + client half src/client/ + committed lib/ + test/
dsh-dialogue-alert-message/  same shape (plus SPEC.md, integration-check.mjs)
dsh-ptc-task/                host-only plugin: src/index.ts + lib/index.js, no client half
dsh-anime-desktop-pet/  independent overlay: client (Shadow DOM) + host (GIF route) + assets/ + scripts/ + test/
dsh-auto-dispatch-specification/  auto-dispatch workflow spec: skills + rules + dispatch/slot/backup scripts (monitoring dashboard not included)
docs/                        design and iteration notes (screenshots, pitfalls)
```

Fixed files inside each plugin directory:

- `cordis.patch.yml` — the bundle patch that inserts the plugin into the profile layer stack
- `scripts/build.ps1` — build entry point (Windows PowerShell)
- `lib/` — committed build output (including `lib/types/*.d.ts` and sourcemaps)

## Platform compatibility

- The author develops and verifies on the **DeepSeek Harness Web client** (`dsh web` + browser) with a Windows-local profile.
- The plugins, auto-dispatch spec and anime desktop pet in this repo are written and verified for the **Web client**.
- **The Desktop app requires your own compatibility work**: plugin loading, WebServer/static asset routes, paths/permissions and scheduled tasks/restarts may differ; the author has not verified Desktop, and out-of-the-box support is not promised.

## Requirements

- DSH ≥ `0.2.1-rc.2` (developed and verified on that version; `web` profile)
- Node.js ≥ 20; **loading** a plugin needs no build, editing its source does
- Build scripts are Windows PowerShell (`scripts/build.ps1`, driven by `$env:DSH_CHECKOUT` or a `-Checkout` argument)
- `node_modules/` is not committed; the `lib/` build output **is** committed on purpose
- The auto-dispatch spec targets a **Windows-local DSH** (scheduled tasks/PowerShell); the monitoring dashboard is not part of the repo

## Development and tests

```powershell
cd dsh-quick-append
$env:DSH_CHECKOUT = "C:\...\deepseek-harness-dsh-v0.2.1-rc.2"   # or pass -Checkout to build.ps1
npm run build     # build.ps1: link junctions → tsc for the host half → tsdown for the client half
npm test          # node --test

# typecheck: no local tsc is installed, use the one from the checkout
& "$env:DSH_CHECKOUT\node_modules\.bin\tsc.cmd" -p tsconfig.json --noEmit
```

> `npm run typecheck` needs `tsc` on PATH (the repo does not install one); use the command above instead.

## Keywords

`DSH` · `DSH plugin` · `DeepSeek Harness` · `DeepSeek Harness plugin` · `DSH external plugin` · `cordis` · `cordis bundle` · `profile bundle` · `prompt preset` · `stored commands` · `subagent dispatch` · `PTC` · `interruption alarm` · `usage monitor` · `AI agent tooling` · `auto dispatch` · `multi-agent workflow` · `workflow automation`

## License

BSD-3-Clause — see [LICENSE](LICENSE). Each plugin's `package.json` declares `license: BSD-3-Clause` as well.










