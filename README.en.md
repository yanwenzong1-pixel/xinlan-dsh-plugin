# DSH Dock

**More ports for DeepSeek Harness (DSH) — three ready-to-use plugins, no build step after cloning.**

[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.1-4f46e5.svg)](#requirements)
[![No build](https://img.shields.io/badge/install-no%20build%20required-brightgreen.svg)](#quick-start-1-minute)
中文 · English

`DSH plugin` · `DeepSeek Harness` · `DSH external plugin` · `cordis patch bundle` · `AI agent tooling` · `subagent task dispatch`

---

## What you get in 30 seconds

| Your daily pain | Plugin | After installing |
| --- | --- | --- |
| Retyping the same prompt or the same command over and over | ⚡ **Quick Append** | One click appends your stored text to the draft; a drop-up menu inserts stored commands. **Isolated per workspace**, right-click to edit |
| Handing a whole job to a subagent, but the intermediate output floods your context | 🧩 **PTC Task** | The subagent runs in PTC (code) mode: it writes one program, keeps the intermediate output inside it, and returns **only the path to the result** |
| Long runs die or overspend, and you notice afterwards | 🔔 **Dialogue Alert** | Forced interruptions ring immediately, by severity; the sidebar also shows DeepSeek conversation count / today's cost / balance |

All three load on the DSH side only: no DSH source edits, no touching your session data.

## Quick start (1 minute)

```bash
git clone https://github.com/yanwenzong1-pixel/xinlan-dsh-plugin.git
cd xinlan-dsh-plugin

dsh plugin --profile web add ./dsh-quick-append
dsh plugin --profile web add ./dsh-ptc-task
dsh plugin --profile web add ./dsh-dialogue-alert-message
```

Restart dsh web (or refresh the page). After Quick Append is installed, the composer gets two extra buttons: ⚡ and 🔧.

- Replace `--profile web` with your own profile name (`web` / `headless` / custom).
- `dsh plugin … add` installs the package into the profile and **automatically registers any package that declares `dsh.bundle.patch` into `dsh.profile.bundles`** — no JSON editing.
- Uninstall: `dsh plugin --profile web remove @dsh-external/dsh-quick-append`.
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
| ⚡ Quick Append | [`dsh-quick-append/`](dsh-quick-append/README.md) | `@dsh-external/dsh-quick-append` | 0.5.2 | Composer "quick append" button plus a stored-command menu and editor dialog |
| 🧩 PTC Task | [`dsh-ptc-task/`](dsh-ptc-task/README.md) | `@dsh-external/dsh-ptc-task` | 0.1.0 | Registers the `ptc_task` tool: hand a whole job to a PTC-scoped subagent |
| 🔔 Dialogue Alert | [`dsh-dialogue-alert-message/`](dsh-dialogue-alert-message/README.md) | `@dsh-external/dsh-dialogue-alert-message` | 0.2.1 | Severity-based interruption alarms plus DeepSeek usage in the sidebar |

### ⚡ Quick Append · [details](dsh-quick-append/README.md)

- Two buttons on the right of the composer: **lightning** appends the current workspace's stored text; **wrench** opens a drop-up menu of stored commands (left-click inserts, right-click manages).
- Stored text is **isolated per workspace** and persisted — switching projects switches your presets, with no cross-contamination.
- With "LLM optimize" on, the left-click first sends your draft to the host-side LLM (images supported) and appends the preset text after the optimised result.
- Shortcut: `Shift+Alt+F` while the composer is focused does what the lightning button does; both buttons are Tab-reachable and `Shift+F10` opens the context menu.

### 🧩 PTC Task · [details](dsh-ptc-task/README.md)

- Registers the `ptc_task` tool: pass `prompt` (a self-contained task description) and `resultPath` (where the subagent must write its output).
- The subagent's tools are presented in **PTC (code) mode**: one program performs many steps, intermediate output stays inside it and never enters your context, while the main session keeps its native tool surface.
- Three guardrails: chain length is always ≤ 1 (a subagent cannot dispatch again), dispatch is **refused** when the recursion guard cannot be installed (fail-closed), and in-flight duplicates are deduplicated with a consecutive-failure circuit breaker.
- Fits jobs whose steps are already known (running a script per item, sweeping, reconciling, aggregating); it does not fit exploratory work where each step depends on the previous result.

### 🔔 Dialogue Alert · [details](dsh-dialogue-alert-message/README.md)

- Plays a chime when a conversation finishes normally, and a severity-graded alarm on **non-user-initiated** interruptions (tool error / forced cancel / session eviction / host restart).
- User-initiated cancels stay silent.
- The sidebar status bar shows DeepSeek account usage: conversation count / today's cost / balance.
- Alarms travel over the plugin's own channel (host queue `/api/alarm` → client WebAudio + ack) and depend on no third-party plugin.

## Read this pitfall first (it can take down the whole dsh-web)

**Contract**: every package listed in a profile's `dsh.profile.bundles` **must** declare `dsh.bundle.patch` in its `package.json`, pointing at an existing `cordis.patch.yml`. If one does not, the host aborts profile loading with
`profile bundle "<pkg>" declares no dsh.bundle in its package.json` — and the blast radius is **the entire dsh-web (all your sessions and panels)**, not "that one plugin stays inactive".

Installing through `dsh plugin … add` satisfies this automatically; hand-editing JSON is where people get burned.

## Repository layout

```
dsh-quick-append/            host half src/index.ts + client half src/client/ + committed lib/ + test/
dsh-dialogue-alert-message/  same shape (plus SPEC.md, integration-check.mjs)
dsh-ptc-task/                host-only plugin: src/index.ts + lib/index.js, no client half
docs/                        design and iteration notes (screenshots, pitfalls)
```

Fixed files inside each plugin directory:

- `cordis.patch.yml` — the bundle patch that inserts the plugin into the profile layer stack
- `scripts/build.ps1` — build entry point (Windows PowerShell)
- `lib/` — committed build output (including `lib/types/*.d.ts` and sourcemaps)

## Requirements

- DSH ≥ `0.1.5-rc.1` (developed and verified on that version; `web` profile)
- Node.js ≥ 20; **loading** a plugin needs no build, editing its source does
- Build scripts are Windows PowerShell (`scripts/build.ps1`, driven by `$env:DSH_CHECKOUT` or a `-Checkout` argument)
- `node_modules/` is not committed; the `lib/` build output **is** committed on purpose

## Development and tests

```powershell
cd dsh-quick-append
$env:DSH_CHECKOUT = "C:\...\deepseek-harness-dsh-v0.1.5-rc.1"   # or pass -Checkout to build.ps1
npm run build     # build.ps1: link junctions → tsc for the host half → tsdown for the client half
npm test          # node --test

# typecheck: no local tsc is installed, use the one from the checkout
& "$env:DSH_CHECKOUT\node_modules\.bin\tsc.cmd" -p tsconfig.json --noEmit
```

> `npm run typecheck` needs `tsc` on PATH (the repo does not install one); use the command above instead.

## Keywords

`DSH` · `DSH plugin` · `DeepSeek Harness` · `DeepSeek Harness plugin` · `DSH external plugin` · `cordis` · `cordis bundle` · `profile bundle` · `prompt preset` · `stored commands` · `subagent dispatch` · `PTC` · `interruption alarm` · `usage monitor` · `AI agent tooling`

## License

BSD-3-Clause — see [LICENSE](LICENSE). Each plugin's `package.json` declares `license: BSD-3-Clause` as well.
