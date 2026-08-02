# System Monitor Widget — Design

**Date:** 2026-08-02
**Status:** Approved design, pending implementation plan

## Purpose

A third widget for this repo that answers one question: **"why is my machine
struggling right now?"** — and answers it by *naming the culprit*.

It is diagnostic, not ambient. You look at it when the fan spins up or things
feel slow, and it tells you which application is responsible, whether memory is
genuinely under pressure, and whether the load is a momentary spike or has been
sustained.

Display-only, like its siblings — killing things stays in your terminal.

## Non-goals

- **Per-process GPU attribution.** Impossible without root; see "GPU" below.
- **Alerting, notifications, or history beyond 5 minutes.** This is a glance
  widget, not a profiler.
- **Killing or suspending processes.** Display-only, matching `dev-servers`.
- **Per-core load.** Not established as cheaply obtainable; deliberately absent
  rather than approximated.
- **Charting libraries.** Übersicht bundles with browserify; a library would
  fight the CSS-custom-property theming, bloat the gallery zip, and ship
  dashboard defaults wrong for a desktop ornament. All marks are hand-rolled SVG.

## Measurement

Every source below was measured on the target machine (M2 Max, 12 logical cores
— 8 performance + 4 efficiency — 64 GiB unified memory).

| Source | Command | Cost | Gives |
|---|---|---|---|
| Processes | `ps -axo pid=,time=,rss=,comm=` | 43 ms | CPU-time, RSS, full executable path — **one call feeds both top-3 lists** |
| GPU | `ioreg -r -d 1 -w 0 -c IOAccelerator` | 23 ms | `Device Utilization %` |
| Memory | `vm_stat` | 3 ms | page counts by class |
| Totals | `sysctl hw.memsize kern.memorystatus_vm_pressure_level vm.swapusage` | <1 ms | capacity, pressure level, swap |

**Total ~95 ms per refresh including Node startup.** At the chosen 3-second
interval that is ~3% of one core (0.26% of twelve).

### CPU: delta sampling, not `ps %cpu`

`ps`'s `%cpu` is a decaying average over roughly the last minute, not current
load. Measured side by side, it reported Chrome's browser process at 97% and its
busiest renderer at 51%, when the true instantaneous split was 78% and 83% — it
inverted the ranking.

Instead, the collector caches each `ps` sample and computes:

```
cpuPercent = (cpuSecondsNow − cpuSecondsPrev) / (wallSecondsNow − wallSecondsPrev) × 100
```

This yields true average utilisation over exactly one refresh interval, at the
cost of a single 43 ms call and no in-run sleep. (`top -l 2`, the obvious
alternative, costs **1.9 seconds** — unusable at this cadence.)

**`time` parsing.** macOS `ps` formats CPU time as `MINUTES:SECONDS.HUNDREDTHS`
with **unbounded minutes** — WindowServer reads `896:38.07`, not `14:56:38`.
Parse as two colon-separated fields. Defensively accept a three-field
`H:MM:SS` form, but the two-field form is what macOS emits.

**PID reuse.** A recycled PID can produce a nonsensical delta. Guard twice:
discard any negative delta, and discard a sample whose `comm` differs from the
cached entry for that PID.

**Sleep and missed refreshes.** If the wall-clock gap since the previous sample
exceeds 30 seconds, treat it as a discontinuity: skip the delta entirely for
that cycle and break the history line rather than drawing across the gap. Waking
from sleep must not render as a giant fake spike.

**First run.** With no cached sample there is no delta. Rather than showing
blanks, fall back to `ps`'s decaying-average `%cpu` for that one cycle and set
`cpuEstimated: true` in the payload. That flag is **payload-only and renders
nothing** — the condition lasts a single 3-second cycle, and a badge that
flickers on every Übersicht restart would be worse than silence. It exists for
`run.sh | python3 -m json.tool` debugging, the same treatment `themeError`
already gets.

### Process grouping

Ungrouped, the top-3 list is useless. Measured on the target machine: **57
Chrome processes** (53 of them helpers) and **13 `node` processes**. The raw
top three were *Chrome Helper, Chrome, Chrome Helper* — WindowServer, iTerm2 and
every `node` process were invisible.

Two rules:

**1. Collapse macOS app bundles by their outermost bundle.** `comm` returns the
full path, and helper processes live in **nested** `.app` bundles:

```
/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)
```

Take the **first** `.app` component in the path, not the last. The last yields
"Obsidian Helper (GPU)" and defeats the purpose. Rows report the group's summed
percentage and its process count: `Google Chrome 202% (57 proc)`.

**2. Label development processes by project instead.** Collapsing 13 `node`
processes into one row hides the thing most worth knowing. For executables whose
basename matches `node`, `python*`, `ruby`, `deno`, `bun`, `go`, resolve the
working directory and label by project: `node · abra-abr`.

Resolution reuses the approach already proven in `dev-servers`: one
`lsof -a -p <pids> -d cwd -Fpn` call against **only the shortlisted PIDs**, then
walk up from the cwd for a `.git` or `package.json`. Processes that resolve to
the same project collapse together; unresolvable ones fall back to their
basename.

### Sharing `findProjectRoot`

`dev-servers.widget/lib/enrich.js` already implements exactly this walk, as a
clean dependency-injected function. Duplicating it into a second widget is the
drift the theming project just spent effort eliminating.

**Decision:** promote it to a repo-root `lib/project.js` and vendor it, exactly
as `lib/theme.js` is vendored. Concretely:

- Generalise `scripts/sync-themes.sh` to copy **every** `lib/*.js` into each
  widget's `lib/`, and rename it `scripts/sync-shared.sh` (npm script
  `sync:shared`, replacing `sync:themes`).
- Generalise the existing vendor-drift test to iterate every shared module
  rather than naming `theme.js`.
- `dev-servers/lib/enrich.js` re-exports from the vendored copy so its public
  surface and tests are unchanged.

This is a small, contained improvement to code the new widget depends on, and it
reuses machinery that already exists rather than inventing any.

### Memory

`vm_stat` page counts × page size (16384 bytes on this machine — read it from
`vm_stat`'s header, never hardcode), against `hw.memsize`.

Four segments, which is what the stacked bar renders:

| Segment | Source |
|---|---|
| wired | `Pages wired down` |
| active | `Pages active` |
| compressed | `Pages occupied by compressor` |
| available | `Pages free` + `Pages inactive` + `Pages speculative` |

Plus `kern.memorystatus_vm_pressure_level` (1 normal, 2 warning, 4 critical) and
`vm.swapusage` for swap actually in use. Pressure — not percentage full — is the
honest signal: this machine reads 38.2 / 64 GB with pressure `normal`, and a
"60% full" bar alone would imply a problem that does not exist.

**Honest caveat, to be stated in the widget README:** the memory top-3 sums RSS
per group, and RSS counts shared pages once per process. A 57-process Chrome
group therefore *overstates* real footprint. RSS is the signal available from
the `ps` call we already make; the alternative (`footprint`, as Activity Monitor
uses) has no cheap CLI equivalent. Rows are labelled RSS so the number is not
mistaken for Activity Monitor's figure.

### GPU

`ioreg -r -d 1 -w 0 -c IOAccelerator` exposes `Device Utilization %` with no
elevated privileges. Where multiple accelerator entries exist, take the maximum.

**Per-process GPU is not available.** `powermetrics` — the only source — answers
`powermetrics must be invoked as the superuser`. The widget therefore reports
device-level GPU only and never implies attribution it cannot make.

Because a dev machine sits near-idle on GPU (11% while writing this), the GPU
row is **hidden below a 10% threshold**, matching the repo's existing instinct
that widgets add no chrome when they have nothing to say.

## Units

Follows the Activity Monitor convention, which is what macOS users already read:

- **Headline CPU** is normalised to **0–100% of all 12 cores**.
- **Per-process/group CPU** is **per-core**, so it can exceed 100% — a
  fully-busy Chrome group legitimately reads `202%`.

These differ deliberately. The widget README must state it, because a headline
of 47% beside a row of 202% is otherwise confusing on first read.

## Layouts

Two, selected by `config.json` `layout`, over one shared payload — the pattern
`claude-usage` already established with its four layouts.

### `ghost` (default)

A corner card. The CPU history fills the card's background as a low-opacity area
chart — texture rather than a panel — with content floating above it:

```
SYSTEM                    CPU 22% · MEM 71%
peak 98% · high for 1m 32s · ended 15s ago     ← only after a spike
● Google Chrome      202% (57)
● node · abra-abr     38%
● WindowServer        29%
◈ GPU 34%                                      ← only above 10%
MEM ▓▓░░░░░░░░░░░░░░              45.4/64
```

The ghost treatment is what makes the history affordable: at rest the stream is
faint grain costing **zero rows**, where a hero chart would spend 60–90 px on a
flat wiggle in the ~95% of glances when nothing is wrong. After a spike the
plateau is unmistakable at low opacity, and the card's whole mood changes
without a single row being added.

### `ticker`

A single pill for the screen edge, matching `claude-usage`'s ticker in radius,
dividers and type scale so the two sit as a deliberate pair:

```
[▁▂▃█] CPU 22% · peak 98% · 1m32s │ ● Chrome 202% ● node·abra-abr 38% │ MEM 45.4/64 ▓░░
```

Sparkline instead of the ghost stream; memory as an inline strip. **The ticker
caps its list at 2 groups regardless of `topN`** — a single-line pill has no
room for a third without wrapping, and wrapping would break the pairing with
`claude-usage`'s ticker. `topN` therefore governs the `ghost` layout's two lists;
the ticker takes `min(topN, 2)`.

### Spike annotation

`peak 98% · high for 1m 32s · ended 15s ago` renders in **both** layouts, and
**only when a spike actually occurred** — the same appear-when-relevant rule as
the GPU row.

**A spike is:** normalised CPU ≥ **70%** for a cumulative ≥ **15 seconds**
within the history window. Both figures are configurable.

This is the most precise available answer to "blip or sustained" — more precise
than eyeballing a curve — and it is free once history exists.

## Architecture

```
system.widget/
├── index.jsx          # rendering only; two layouts
├── config.json
├── README.md
└── lib/
    ├── run.sh         # Übersicht entry point (find node, exec collect.js)
    ├── collect.js     # orchestrator → one JSON payload on stdout
    ├── cpu.js         # ps parse, delta maths, grouping, top-N
    ├── memory.js      # vm_stat + sysctl parse, segments, pressure
    ├── gpu.js         # ioreg parse
    ├── history.js     # ring buffer persistence, spike detection
    ├── project.js     # vendored from repo-root lib/
    ├── theme.js       # vendored from repo-root lib/
    └── mock.json
```

Each module is a pure parser plus a thin caller, so every parsing rule above is
unit-testable against a captured fixture without touching the live system —
the pattern both existing widgets already use.

## Data flow

1. `collect.js` reads `config.json`, resolves the theme, loads the history cache.
2. `ps -axo pid=,time=,rss=,comm=` runs **once**; `cpu.js` and `memory.js` both
   parse that output.
3. `cpu.js` diffs against the cached sample → per-PID percentages → grouping →
   shortlist. `project.js` labels dev processes from one `lsof` call on the
   shortlisted PIDs only.
4. `memory.js` and `gpu.js` run their own cheap probes.
5. `history.js` appends `{ t, cpu, mem, gpu }`, trims to the window **by
   timestamp** (not by count, so sleep and missed refreshes behave), and
   computes the spike summary.
6. The cache is rewritten with the new `ps` sample and trimmed ring.
7. One JSON payload is written to stdout, including `theme` and `themeError`.

**Cache:** `~/.cache/ubersicht-system-widget/history.json`, overridable via
`UBERSICHT_SYSTEM_WIDGET_CACHE` for tests — the convention `claude-usage`
already uses. At 3 s over 5 min the ring holds ~100 entries; the ghost stream
downsamples to roughly one point per pixel column when drawing.

## Configuration

```json
{
  "theme": null,
  "layout": "ghost",
  "position": { "corner": "top-right" },
  "refreshSeconds": 3,
  "historyMinutes": 5,
  "topN": 3,
  "gpuThreshold": 10,
  "spike": { "percent": 70, "seconds": 15 },
  "show": { "gpu": true, "memory": true, "history": true, "spike": true },
  "scale": 1.5,
  "mock": false
}
```

`refreshSeconds` documents intent; Übersicht's actual cadence is the static
`refreshFrequency` export in `index.jsx` — both must be changed together, as
already documented for the sibling widgets.

Two keys need their behaviour pinned down explicitly:

- **`topN`** governs **both** top-3 lists (CPU and memory) in the `ghost`
  layout. The `ticker` takes `min(topN, 2)`, per above.
- **`show.history: false`** disables collection *and* rendering of the ring
  buffer: `ghost` drops its background stream, `ticker` drops its sparkline, and
  the spike annotation is suppressed regardless of `show.spike` — a spike cannot
  be detected without history. The widget becomes fully stateless in this mode
  and writes no cache file, which is the supported way to run it without
  on-disk state.

## Theming

The widget is born themed — no retrofit. It consumes the existing 13 tokens as
`--ub-*` custom properties, and **requires no new tokens**. The memory bar's
four segments map onto existing ones:

| Segment | Token |
|---|---|
| wired | `sub` |
| active | `ok` |
| compressed | `warn` |
| available | `track` |

Worth stating explicitly because the theming spec set a deliberately high bar:
adding a token means four synchronised edits and a schema change.

The ghost stream's area fill uses `accent` at low opacity via element `opacity`,
not a pre-multiplied `rgba` — the same technique the `claude-usage` sparkline
uses, so it re-tints correctly under every theme.

## Error handling

The collector must never crash the widget — the standard this repo already holds
itself to:

- A watchdog emits a valid error payload if collection hangs, as in
  `dev-servers`.
- Every emit path — success, mock, watchdog, `main().catch` — carries `theme`
  and `themeError`.
- A missing, unreadable, or malformed cache is treated as a first run, not an
  error: history renders empty and CPU falls back to the estimated path.
- A failing probe degrades that section only. No `ioreg` means no GPU row, not a
  dead widget.
- `index.jsx` renders `null` when the payload is unusable — no empty chrome on
  the desktop.

## Testing

Stdlib `node --test`, matching the existing suite. Pure parsers make this
straightforward:

| Area | Cases |
|---|---|
| `time` parsing | two-field `896:38.07`, `0:00.50`, defensive three-field, garbage |
| Delta maths | normal, negative (PID reuse), `comm` mismatch, >30 s sleep gap, first run |
| Grouping | nested `.app` picks the outer bundle; non-bundle basename; dev processes by project; unresolvable cwd falls back |
| Normalisation | headline 0–100 across 12 cores; group percentages stay per-core |
| `vm_stat` | page size read from header, all four segments, pressure levels 1/2/4 |
| `ioreg` | single entry, multiple entries (max), absent |
| History | trim by timestamp, sleep discontinuity, ring bounded |
| Spike detection | below threshold, brief spike under 15 s, qualifying spike, spike still in progress, spike that just ended |
| Vendor drift | `project.js` and `theme.js` byte-identical across widgets |

Fixtures are captured real output from this machine, stored under
`tests/fixtures/` as the existing widgets do.

## Documentation

- `system.widget/README.md` — install, both layouts, the full config table, the
  units convention, and the RSS caveat.
- Root `README.md` — a third widget entry.
- `docs/development.md` — the `sync:themes` → `sync:shared` rename.
- `docs/theming.md` — **two** edits: note that a third widget now consumes the
  tokens, and correct its "For contributors" section, which currently instructs
  readers to run `npm run sync:themes` after editing `lib/theme.js`. That command
  ceases to exist; leaving it would make the theming docs actively wrong.
