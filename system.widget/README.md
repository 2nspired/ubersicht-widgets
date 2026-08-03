# system.widget

An [Übersicht](http://tracesof.net/uebersicht/) widget that answers "why is my
machine struggling" by naming the culprit: CPU and memory grouped by
**application** (Chrome's dozens of helper processes collapse into one row),
device-level GPU when it's actually busy, memory by kind with real pressure,
and a few minutes of history so you can tell whether a spike is ongoing or
already over. Two layouts.

## Install

Requires macOS and [Übersicht](http://tracesof.net/uebersicht/). No other
runtime dependencies — the collector is plain Node ≥ 18 and shells out to
`ps`, `vm_stat`, `ioreg`, `sysctl`, and (for dev-process labelling) `lsof`,
all of which ship with macOS.

```bash
git clone https://github.com/2nspired/ubersicht-widgets.git
cd ubersicht-widgets
ln -sfn "$PWD/system.widget" "$HOME/Library/Application Support/Übersicht/widgets/system.widget"
```

Smoke-test the collector directly:

```bash
system.widget/lib/run.sh | python3 -m json.tool
```

## Layouts

Set `layout` in `config.json`:

- **`ghost`** (default) — a card in a screen corner: a background CPU
  stream, headline CPU/MEM figures, the top-N processes by CPU, GPU when
  busy, a segmented memory bar, and — only while memory pressure isn't
  `normal` — a top-memory list.
- **`ticker`** — a single-line pill: a small sparkline, headline CPU, the
  active spike (if any), up to **two** top processes (the layout caps at 2
  regardless of `topN`), GPU when busy, and a compact memory bar.

## Reading the numbers

**Units.** The headline CPU figure is a share of *all* cores — 0–100%,
`round(sum of every process's per-core % / core count)`. Per-process figures
are **per-core**, the same convention Activity Monitor uses: a process fully
using two cores reads 200%. That's why the headline can read 47% while a row
underneath it reads 202% — they're not the same unit, and that's deliberate,
not a bug.

**Grouping.** Processes are grouped by owning application, keyed off the
nearest enclosing `.app` bundle in their executable path (macOS helper
processes live in nested bundles — e.g. an `Obsidian Helper (GPU).app` inside
`Obsidian.app` — the outer, owning bundle wins). Chrome's ~57 helper
processes become one `Chrome` row with a count badge, not fifty-seven rows.
Development binaries are the exception: instead of collapsing into one
generic row, each is labelled by the project whose working directory it's
running in (e.g. `node · abra-abr`), because folding thirteen unrelated
`node` processes into a single `node 71%` row hides the one thing you
actually want to know. The recognized binaries are `node`, `deno`, `bun`,
`ruby`, `go`, `cargo`, `rustc`, `java`, and any `python` interpreter
(`python`, `python3`, `python3.11`, …, matched by version suffix). A dev
process whose project can't be resolved (no `lsof`-visible cwd, or no
`.git`/`package.json` above it) still shows under its bare binary name.

**Memory figures are RSS, and grouped RSS overstates real usage.** Resident
Set Size counts pages *per process*, so shared libraries and frameworks get
counted once for every process mapping them — summing RSS across Chrome's 57
processes double- (or 57-) counts everything they share. Activity Monitor's
"Memory" column uses a different, proprietary-ish metric with no cheap CLI
equivalent, so this widget doesn't try to reproduce it. Treat the top-memory
list as a **ranking** of who's heaviest, not an audit of how much RAM would
actually be freed by quitting them.

## GPU

GPU usage is **device-level only** — "is the GPU busy right now", not "which
process is using it". Per-process GPU attribution needs `powermetrics`,
which requires root, so it isn't available here. The row is hidden entirely
when `show.gpu` is off, and hidden whenever utilization is below
`gpuThreshold`, so an idle GPU doesn't clutter the card.

## History & the cache

With `show.history` on (the default), the widget keeps a rolling window of
CPU/MEM/GPU samples (`historyMinutes` long) at
`~/.cache/ubersicht-system-widget/history.json`, used for the background
stream/sparkline and for spike detection (`show.spike`).

Setting `"show": {"history": false}` does **not** make the widget fully
stateless: the collector still writes that same cache file every refresh,
because the previous `ps` sample it contains is what CPU percentages are
diffed against — without it, CPU would permanently fall back to `ps`'s
decaying average instead of an accurate delta. What `show.history: false`
actually suppresses is just the sample ring: no history array accumulates,
the stream/sparkline has nothing to draw, and spike detection (which needs
the ring) never fires.

## Configuration

Edit `system.widget/config.json`. Everything is optional; defaults shown.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `theme` | string \| `null` | `null` | Theme name overriding the repo-root `theme.json`. `null` follows the global choice. See [theming](../docs/theming.md). |
| `layout` | `"ghost"` \| `"ticker"` | `"ghost"` | Corner card with stream and lists · single-line pill. |
| `position.corner` | `"top-right"` \| `"top-left"` \| `"bottom-right"` \| `"bottom-left"` | `"top-right"` | Which screen corner the widget sits in. |
| `refreshSeconds` | number | `3` | Documentation of intent only — Übersicht's actual interval is the static `refreshFrequency` export in `index.jsx` (ms); change both to change cadence. |
| `historyMinutes` | number | `5` | Length of the rolling history window kept for the stream/sparkline and spike detection. |
| `topN` | number | `3` | How many processes appear in the top-CPU / top-memory lists (the ticker layout caps at 2 regardless). |
| `gpuThreshold` | number | `10` | GPU utilization (%) below which the GPU row is hidden. |
| `spike.percent` | number | `70` | CPU % a sample must reach to count toward a spike. |
| `spike.seconds` | number | `15` | Cumulative time at or above `spike.percent`, within the history window, required to report a spike. |
| `show.gpu` | boolean | `true` | Query and show device-level GPU utilization. |
| `show.memory` | boolean | `true` | Show the memory section. |
| `show.history` | boolean | `true` | Keep the sample ring (stream/sparkline, spike detection). See [History & the cache](#history--the-cache) — the `ps` cache is still written either way. |
| `show.spike` | boolean | `true` | Run spike detection (only takes effect when `show.history` is also on). |
| `scale` | number | `1.5` | CSS zoom for the whole widget — the shipped default already suits 4K/hi-DPI displays; use `1` on a standard-DPI screen. |
| `mock` | boolean | `false` | Render canned sample data (`lib/mock.json`) instead of scanning the machine. |

## How it works

A Node collector runs on each refresh and prints one JSON payload:

- `ps -axo pid=,time=,rss=,comm=` samples every process's cumulative CPU
  time and RSS; percentages come from diffing against the previous refresh's
  cached sample over the elapsed wall-clock time (falling back to `ps`'s own
  decaying-average `%cpu` for one cycle after startup or a sleep/wake gap,
  where no valid diff exists).
- Processes are classified by their executable path (app bundle, dev
  binary, or bare executable), grouped by label, and — for dev binaries
  only — one batched `lsof -d cwd` call resolves each pid's working
  directory up to the nearest `.git`/`package.json` for project naming.
- `vm_stat` plus `sysctl` (`hw.memsize`,
  `kern.memorystatus_vm_pressure_level`, `vm.swapusage`) build the memory
  breakdown and pressure level.
- `ioreg -r -d 1 -w 0 -c IOAccelerator` (no elevated privileges needed)
  supplies device-level GPU utilization.
- The collector's own process is excluded by PID before grouping, and
  Übersicht's own long-lived app process is filtered by name afterward — so
  the widget never shows up in its own top list on an idle machine.

**Privacy & safety:** read-only observation. External commands run via
`execFile`/`execFileSync` with fixed arguments; nothing leaves the machine;
output is a single JSON document; the whole scan is bounded by a 4-second
watchdog. The only file written to disk is the history cache described
above.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `system: unavailable` | The collector errored or timed out; run `system.widget/lib/run.sh` in a terminal to see the payload. |
| Nothing renders at all | Node.js missing or not on Übersicht's minimal `PATH`. `run.sh` checks `node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`; `brew install node`. |
| GPU row never appears | Either `show.gpu` is off, or utilization is under `gpuThreshold` — expected on an idle GPU. |
| A `node`/`python`/… row isn't labelled with a project | The process's working directory isn't visible to `lsof`, or nothing above it looks like a project root (no `.git` or `package.json`). |
| Headline % and a row's % look inconsistent | They're different units by design — see [Reading the numbers](#reading-the-numbers). |
| Widget code changes don't appear | Übersicht's file-watcher can die silently — quit and relaunch via the menu-bar icon, or `pkill -f "bersicht.app"`. |

## More

- [Development & testing](../docs/development.md)
- [Design spec](../docs/superpowers/specs/2026-08-02-system-monitor-widget-design.md)

## License

MIT — see [LICENSE](../LICENSE).
