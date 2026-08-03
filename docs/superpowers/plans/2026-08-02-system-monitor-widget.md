# System Monitor Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third Übersicht widget that answers "why is my machine struggling?" by naming the culprit — top CPU and memory consumers grouped by application, device-level GPU, and 5 minutes of history.

**Architecture:** A Node collector emits one JSON payload; `index.jsx` renders it in one of two layouts (`ghost`, `ticker`) using `--ub-*` CSS custom properties from the existing theme system. CPU percentages come from diffing cached `ps` CPU-time samples, not `ps %cpu`. A prerequisite task promotes `findProjectRoot`/`parseCwds` out of `dev-servers` into a vendored shared module.

**Tech Stack:** Node ≥ 18 (stdlib only, zero dependencies), `node --test`, Übersicht 1.6 / React 16.12, emotion via `import { css } from "uebersicht"`, hand-rolled SVG.

**Spec:** `docs/superpowers/specs/2026-08-02-system-monitor-widget-design.md`

## Global Constraints

- **Zero runtime dependencies.** Node stdlib only. Never add to `package.json` `dependencies` or `devDependencies`.
- **Node ≥ 18**, CommonJS. All `lib/*.js` start with `"use strict";`.
- **`index.jsx` runs through Übersicht's OLDER Babel.** Forbidden in `.jsx`: object spread (`{...x}`), `??`, `?.`, `<>` fragments. Use `Object.assign` and explicit ternaries. `lib/*.js` runs in real Node and has no such limit.
- **The collector must never crash the widget.** Every path emits valid JSON on stdout and exits 0. A watchdog covers hangs.
- **Every payload emit site carries `theme` and `themeError`** from `resolveTheme({ widgetDir: __dirname, config })`.
- **No new theme tokens.** The 13 existing ones suffice: `text, sub, muted, accent, ok, warn, danger, surface, border, shadow, divider, track, radius`.
- **CSS custom properties go on the widget's own root element**, never `:root` — Übersicht renders all widgets into one document.
- **Units:** headline CPU normalised 0–100% across `hw.logicalcpu` (12 here). Per-process/group CPU is per-core and may exceed 100%.
- **Widgets stay self-contained** so `scripts/package.sh` single-folder zips work. Shared code is vendored, never cross-folder `require`d.
- **Run `npm test` before every commit.** The suite is **90** tests at the start of this plan and must never go red.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/project.js` | **Create.** Canonical `findProjectRoot` + `parseCwds`, moved out of dev-servers. |
| `scripts/sync-shared.sh` | **Create** (replaces `sync-themes.sh`). Copies every `lib/*.js` into each widget. |
| `scripts/sync-themes.sh` | **Delete.** |
| `dev-servers.widget/lib/enrich.js` | **Modify.** Re-export from vendored `./project`. |
| `*.widget/lib/project.js` | **Create** (vendored ×3). |
| `system.widget/lib/cpu.js` | **Create.** `ps` parse, CPU-time parse, delta maths, grouping, top-N. |
| `system.widget/lib/memory.js` | **Create.** `vm_stat` + `sysctl` parse, segments, pressure. |
| `system.widget/lib/gpu.js` | **Create.** `ioreg` parse. |
| `system.widget/lib/history.js` | **Create.** Ring buffer, discontinuity, spike detection. |
| `system.widget/lib/collect.js` | **Create.** Orchestrator → one JSON payload. |
| `system.widget/lib/run.sh` | **Create.** Übersicht entry point. |
| `system.widget/index.jsx` | **Create.** Both layouts. |
| `system.widget/config.json`, `README.md`, `lib/mock.json` | **Create.** |
| `tests/project.test.js`, `system-cpu.test.js`, `system-memory.test.js`, `system-gpu.test.js`, `system-history.test.js`, `system-collect.test.js` | **Create.** |
| `tests/theme.test.js` | **Modify.** Generalise drift test to all shared modules. |
| `package.json`, `docs/theming.md`, `docs/development.md`, `README.md` | **Modify.** |

---

## Task 1: Extract the shared project module

**Files:**
- Create: `lib/project.js`, `scripts/sync-shared.sh`
- Delete: `scripts/sync-themes.sh`
- Modify: `dev-servers.widget/lib/enrich.js`, `package.json`, `tests/theme.test.js`, `docs/theming.md:96`, `docs/development.md:19`
- Create (generated): `claude-usage.widget/lib/project.js`, `dev-servers.widget/lib/project.js`
- Test: `tests/project.test.js`

**Interfaces:**
- Consumes: the existing vendoring machinery (`lib/theme.js`, `discoverWidgets()` already in `tests/theme.test.js`).
- Produces:
  - `findProjectRoot(cwd, opts)` → `string|null`. `opts` = `{ exists = fs.existsSync, home = os.homedir() }`.
  - `parseCwds(text)` → `Map<number, string>` from `lsof -Fpn` output.
  - `scripts/sync-shared.sh` copying **every** `lib/*.js`.

`dev-servers` must keep working unchanged — `tests/dev-servers-enrich.test.js` imports both functions from `enrich.js` and those tests must stay green untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/project.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { findProjectRoot, parseCwds } = require("../lib/project.js");

test("findProjectRoot walks up to the nearest .git or package.json", () => {
  const home = "/Users/me";
  const exists = (p) => p === "/Users/me/Projects/acme/.git";
  assert.equal(findProjectRoot("/Users/me/Projects/acme/src/deep", { exists, home }),
    "/Users/me/Projects/acme");
});

test("findProjectRoot stops at HOME and at /", () => {
  const home = "/Users/me";
  const exists = () => false;
  assert.equal(findProjectRoot("/Users/me/Downloads", { exists, home }), null);
  assert.equal(findProjectRoot("/opt/nowhere", { exists, home }), null);
});

test("findProjectRoot tolerates empty or null input", () => {
  const exists = () => false;
  assert.equal(findProjectRoot("", { exists, home: "/Users/me" }), null);
  assert.equal(findProjectRoot(null, { exists, home: "/Users/me" }), null);
});

test("parseCwds maps pids to working directories", () => {
  // lsof -Fpn emits alternating p<pid> / n<path> records.
  const out = "p111\nn/Users/me/Projects/acme\np222\nn/Users/me/Projects/beta\n";
  const map = parseCwds(out);
  assert.equal(map.get(111), "/Users/me/Projects/acme");
  assert.equal(map.get(222), "/Users/me/Projects/beta");
  assert.equal(map.size, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/project.test.js`
Expected: FAIL — `Cannot find module '../lib/project.js'`

- [ ] **Step 3: Read the source being moved**

Read `dev-servers.widget/lib/enrich.js`. Copy the **exact current bodies** of `findProjectRoot` and `parseCwds` — do not rewrite them. They are already dependency-injected and tested.

- [ ] **Step 4: Create `lib/project.js`**

```js
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// Walk up from a working directory to the project it belongs to. Stops at the
// user's home and at the filesystem root so a stray process never resolves to
// something absurd. `exists`/`home` are injectable purely for testing.
function findProjectRoot(cwd, { exists = fs.existsSync, home = os.homedir() } = {}) {
  let dir = String(cwd || "");
  while (dir && dir !== "/" && dir !== home) {
    if (exists(path.join(dir, ".git")) || exists(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Parses `lsof -a -p <pids> -d cwd -Fpn`, which emits alternating p<pid>/n<path>
// records rather than columns.
function parseCwds(text) {
  const out = new Map();
  let pid = null;
  for (const line of String(text || "").split("\n")) {
    if (line.startsWith("p")) {
      const n = parseInt(line.slice(1), 10);
      pid = Number.isInteger(n) ? n : null;
    } else if (line.startsWith("n") && pid != null) {
      out.set(pid, line.slice(1));
      pid = null;
    }
  }
  return out;
}

module.exports = { findProjectRoot, parseCwds };
```

If the bodies you read in Step 3 differ from these, **the source of truth is the existing file** — use its version so dev-servers' behaviour is unchanged.

- [ ] **Step 5: Re-export from enrich.js**

In `dev-servers.widget/lib/enrich.js`, delete the two function bodies and add near the top:

```js
// Shared with system.widget; canonical copy lives at repo-root lib/project.js
// and is vendored here by scripts/sync-shared.sh.
const { findProjectRoot, parseCwds } = require("./project");
```

Leave the `module.exports` list exactly as it is — both names must still be exported so `tests/dev-servers-enrich.test.js` is untouched.

- [ ] **Step 6: Replace the sync script**

```bash
git mv scripts/sync-themes.sh scripts/sync-shared.sh
```

Then rewrite `scripts/sync-shared.sh`:

```bash
#!/bin/bash
# Copy every canonical shared module into each widget. Widgets must stay
# self-contained: scripts/package.sh zips a single widget folder from HEAD,
# so a cross-folder require would break every gallery install.
# tests/theme.test.js fails if a copy drifts.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for WIDGET in *.widget; do
  [ -d "$WIDGET/lib" ] || continue
  for MODULE in lib/*.js; do
    cp "$MODULE" "$WIDGET/lib/$(basename "$MODULE")"
    echo "synced -> $WIDGET/lib/$(basename "$MODULE")"
  done
done
```

Confirm the executable bit survived: `git ls-files -s scripts/sync-shared.sh` must show `100755`.

- [ ] **Step 7: Rename the npm script**

In `package.json`, change `"sync:themes"` to:

```json
    "sync:shared": "scripts/sync-shared.sh",
```

Leave `test` and `check:bundle` alone.

- [ ] **Step 8: Generalise the vendor-drift test**

`tests/theme.test.js` already has a `discoverWidgets(root)` helper. Replace the body of the test named `"vendored resolvers are byte-identical to the canonical one"` with:

```js
test("vendored resolvers are byte-identical to the canonical one", () => {
  const root = path.join(__dirname, "..");
  const widgets = discoverWidgets(root);
  assert.ok(widgets.length > 0, "no widgets discovered");

  const modules = fs.readdirSync(path.join(root, "lib")).filter((f) => f.endsWith(".js"));
  assert.ok(modules.length > 0, "no shared modules found in lib/");

  for (const mod of modules) {
    const canonical = fs.readFileSync(path.join(root, "lib", mod));
    for (const widget of widgets) {
      const vendored = fs.readFileSync(path.join(root, widget, "lib", mod));
      assert.ok(
        canonical.equals(vendored),
        `${widget}/lib/${mod} has drifted — run: npm run sync:shared`
      );
    }
  }
});
```

- [ ] **Step 9: Run the sync and the suite**

```bash
chmod +x scripts/sync-shared.sh
npm run sync:shared
npm test
```

Expected: `synced ->` lines for `project.js` and `theme.js` in both widgets; **94 tests pass** (90 existing + 4 new).

- [ ] **Step 10: Update the two stale doc references**

`docs/theming.md` line ~96 and `docs/development.md` line ~19 both instruct readers to run `npm run sync:themes`, which no longer exists. Change both to `npm run sync:shared`.

In `docs/development.md`, also widen the surrounding sentence — it currently says only `lib/theme.js` is vendored:

```markdown
Every module in the repo-root `lib/` is vendored into each widget. After editing
one, run `npm run sync:shared` — `npm test` fails if the copies drift. See
[theming.md](theming.md).
```

- [ ] **Step 11: Commit**

```bash
git add lib/project.js scripts/ package.json tests/ dev-servers.widget/ claude-usage.widget/ docs/
git commit -m "$(cat <<'EOF'
refactor: promote findProjectRoot to a shared vendored module

system.widget needs the same cwd->project mapping dev-servers has.
Rather than duplicating it, lib/project.js joins lib/theme.js as a
vendored shared module; sync-themes.sh generalises to sync-shared.sh
copying all of lib/*.js, and the drift test iterates modules x widgets.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scaffold the widget, then CPU sampling and delta maths

**Files:**
- Create: `system.widget/config.json`, `system.widget/index.jsx`, `system.widget/lib/cpu.js`
- Create (generated): `system.widget/lib/theme.js`, `system.widget/lib/project.js`
- Test: `tests/system-cpu.test.js`
- Create: `tests/fixtures/ps-sample.txt`

**Why the scaffold lands here and not later:** `discoverWidgets()` in
`tests/theme.test.js` finds *any* `*.widget` directory containing `lib/`. The
instant this task creates `system.widget/lib/cpu.js`, both drift tests begin
asserting against the new widget — one demanding vendored shared modules, the
other demanding a `TOKENS` array in `index.jsx`. Creating the folder without
also scaffolding those two things leaves the suite red for every task up to
Task 7. Scaffold first, in Step 1.

**Interfaces:**
- Consumes: `scripts/sync-shared.sh` from Task 1.
- Produces:
  - `parseCpuTime(str)` → seconds as `number`, or `null` if unparseable.
  - `parsePsSample(text)` → `Map<number, {cpuSeconds:number, rssKb:number, comm:string}>`.
  - `computeDeltas(prev, curr, elapsedSeconds)` → `Map<number, number>` of per-core percentages.
  - `DISCONTINUITY_SECONDS = 30`.

- [ ] **Step 1: Scaffold the widget so the drift tests stay green**

```bash
mkdir -p system.widget/lib
```

Create `system.widget/config.json`:

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

Create a minimal `system.widget/index.jsx`. Task 7 replaces the rendering; the
`TOKENS` array and `themeVars` must be present **now** because the token-list
drift test compares them against `lib/theme.js`:

```jsx
import { css } from "uebersicht";

export const command = "system.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 3000;

const TOKENS = [
  "text", "sub", "muted", "accent", "ok", "warn", "danger",
  "surface", "border", "shadow", "divider", "track", "radius",
];

// Object.assign, not spread — Übersicht's Babel does not support object spread.
const themeVars = (theme) => {
  const vars = {};
  if (!theme) return vars;
  for (let i = 0; i < TOKENS.length; i++) {
    const key = TOKENS[i];
    if (typeof theme[key] === "string") vars["--ub-" + key] = theme[key];
  }
  return vars;
};

// Placeholder until Task 7 — renders nothing rather than empty chrome.
export const render = () => null;
```

Then vendor the shared modules into it:

```bash
npm run sync:shared
```

Expected: `synced -> system.widget/lib/project.js` and
`synced -> system.widget/lib/theme.js`.

Run `npm test` now and confirm it is still **94** — the drift tests should pass
against three widgets. If either fails, fix it before continuing; every
subsequent task depends on this being green.

- [ ] **Step 2: Capture the fixture**

```bash
ps -axo pid=,time=,rss=,comm= | head -40 > tests/fixtures/ps-sample.txt
```

Then hand-append these three lines so the fixture covers the cases the tests need (real output may not contain all of them):

```
  357   2:06.04  83440 /Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)
90238   6:25.17  78624 /Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/Frameworks/Docker Desktop Helper (GPU).app/Contents/MacOS/Docker Desktop Helper (GPU)
59491   0:00.51  82848 /Users/me/.local/share/fnm/node-versions/v22.22.2/installation/bin/node
```

- [ ] **Step 3: Write the failing test**

Create `tests/system-cpu.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cpu = require("../system.widget/lib/cpu.js");

test("parseCpuTime handles macOS unbounded-minutes format", () => {
  // macOS ps emits MINUTES:SECONDS.HUNDREDTHS with minutes unbounded —
  // WindowServer really does read 896:38.07, not 14:56:38.
  assert.equal(cpu.parseCpuTime("896:38.07"), 896 * 60 + 38.07);
  assert.equal(cpu.parseCpuTime("0:00.50"), 0.5);
  assert.equal(cpu.parseCpuTime("2:06.04"), 126.04);
});

test("parseCpuTime defensively accepts a three-field form", () => {
  assert.equal(cpu.parseCpuTime("1:02:03"), 3723);
});

test("parseCpuTime returns null on garbage", () => {
  assert.equal(cpu.parseCpuTime("nonsense"), null);
  assert.equal(cpu.parseCpuTime(""), null);
  assert.equal(cpu.parseCpuTime(null), null);
});

test("parsePsSample reads pid, cpu time, rss and full command path", () => {
  const text = fs.readFileSync(
    path.join(__dirname, "fixtures", "ps-sample.txt"), "utf8");
  const map = cpu.parsePsSample(text);
  assert.ok(map.size > 5);
  const obsidian = map.get(357);
  assert.equal(obsidian.cpuSeconds, 126.04);
  assert.equal(obsidian.rssKb, 83440);
  assert.ok(obsidian.comm.endsWith("Obsidian Helper (GPU)"));
});

test("parsePsSample keeps spaces in command paths", () => {
  const map = cpu.parsePsSample("  357   2:06.04  83440 /App/Some App.app/Contents/MacOS/Some App\n");
  assert.equal(map.get(357).comm, "/App/Some App.app/Contents/MacOS/Some App");
});

test("computeDeltas converts cpu-second growth into per-core percent", () => {
  const prev = new Map([[1, { cpuSeconds: 100, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 103, comm: "/bin/a" }]]);
  // 3 cpu-seconds over 3 wall-seconds = one core fully busy = 100%
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 100);
});

test("computeDeltas reports above 100% for multi-threaded processes", () => {
  const prev = new Map([[1, { cpuSeconds: 0, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 6, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).get(1), 200);
});

test("computeDeltas drops negative deltas from recycled pids", () => {
  const prev = new Map([[1, { cpuSeconds: 500, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas drops a pid whose comm changed — pid reuse", () => {
  const prev = new Map([[1, { cpuSeconds: 10, comm: "/bin/old" }]]);
  const curr = new Map([[1, { cpuSeconds: 12, comm: "/bin/new" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).has(1), false);
});

test("computeDeltas omits pids absent from the previous sample", () => {
  const prev = new Map();
  const curr = new Map([[1, { cpuSeconds: 5, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 3).size, 0);
});

test("computeDeltas returns empty for a non-positive window", () => {
  const prev = new Map([[1, { cpuSeconds: 1, comm: "/bin/a" }]]);
  const curr = new Map([[1, { cpuSeconds: 2, comm: "/bin/a" }]]);
  assert.equal(cpu.computeDeltas(prev, curr, 0).size, 0);
  assert.equal(cpu.computeDeltas(prev, curr, -5).size, 0);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/system-cpu.test.js`
Expected: FAIL — `Cannot find module '../system.widget/lib/cpu.js'`

- [ ] **Step 5: Create `system.widget/lib/cpu.js`**

```js
"use strict";

// A wall-clock gap larger than this means the machine slept or refreshes were
// missed. Deltas across such a gap are meaningless, so the caller skips them.
const DISCONTINUITY_SECONDS = 30;

// macOS `ps -o time=` emits MINUTES:SECONDS.HUNDREDTHS with UNBOUNDED minutes
// (WindowServer reads "896:38.07"), not HH:MM:SS. The three-field branch is
// defensive only.
function parseCpuTime(str) {
  const s = String(str == null ? "" : str).trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.length === 2
    ? nums[0] * 60 + nums[1]
    : nums[0] * 3600 + nums[1] * 60 + nums[2];
}

// Parses `ps -axo pid=,time=,rss=,comm=`. Only the first three columns are
// whitespace-delimited; the command path is the rest of the line and may
// contain spaces ("Some App.app"), so it is never split.
function parsePsSample(text) {
  const out = new Map();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const cpuSeconds = parseCpuTime(m[2]);
    const rssKb = parseInt(m[3], 10);
    if (!Number.isInteger(pid) || cpuSeconds == null) continue;
    out.set(pid, { cpuSeconds, rssKb: Number.isInteger(rssKb) ? rssKb : 0, comm: m[4] });
  }
  return out;
}

// Per-core percentage, matching Activity Monitor's convention: a process using
// two cores fully reads 200%.
function computeDeltas(prev, curr, elapsedSeconds) {
  const out = new Map();
  if (!(elapsedSeconds > 0)) return out;
  for (const [pid, now] of curr) {
    const before = prev.get(pid);
    if (!before) continue;
    // A recycled pid can carry a different executable, or a lower cpu time
    // than the process that held the pid before it.
    if (before.comm !== now.comm) continue;
    const delta = now.cpuSeconds - before.cpuSeconds;
    if (!(delta >= 0)) continue;
    out.set(pid, (delta / elapsedSeconds) * 100);
  }
  return out;
}

module.exports = { parseCpuTime, parsePsSample, computeDeltas, DISCONTINUITY_SECONDS };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/system-cpu.test.js`
Expected: PASS, 11 tests

- [ ] **Step 7: Run the suite and commit**

Run: `npm test` — expected PASS, 105 tests

```bash
git add system.widget/lib/cpu.js tests/system-cpu.test.js tests/fixtures/ps-sample.txt
git commit -m "$(cat <<'EOF'
feat(system): cpu sampling and delta maths

ps %cpu is a decaying average that inverted the true ranking in testing,
so percentages come from diffing cached cpu-time samples instead.
Guards both pid-reuse signatures: negative delta and changed comm.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Process grouping and project labels

**Files:**
- Modify: `system.widget/lib/cpu.js`
- Modify: `tests/system-cpu.test.js` (append)

**Interfaces:**
- Consumes: `parsePsSample`, `computeDeltas` from Task 2; `findProjectRoot` from Task 1.
- Produces:
  - `bundleName(commPath)` → `string|null` — the **first** `.app` component's name.
  - `DEV_BINARIES` → `Set<string>`.
  - `classify(comm)` → `{ kind: "app"|"dev"|"exe", label: string }`.
  - `groupProcesses(samples, percents, projectByPid)` → `Array<{label, kind, percent, rssKb, count}>`, sorted by `percent` descending.
  - `topBy(groups, field, n)` → first `n` sorted by `field` descending.

Measured on the target machine: **57 Chrome processes**, **13 node processes**. Ungrouped, all three CPU rows were Chrome.

- [ ] **Step 1: Write the failing test**

Append to `tests/system-cpu.test.js`:

```js
test("bundleName takes the FIRST .app in a nested path", () => {
  // Helper processes live in nested bundles. Taking the last would yield
  // "Obsidian Helper (GPU)" and defeat the entire point of grouping.
  assert.equal(
    cpu.bundleName("/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)"),
    "Obsidian");
  // Docker nests three deep.
  assert.equal(
    cpu.bundleName("/Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/Frameworks/Docker Desktop Helper (GPU).app/Contents/MacOS/Docker Desktop Helper (GPU)"),
    "Docker");
  assert.equal(cpu.bundleName("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "Google Chrome");
});

test("bundleName returns null for non-bundle executables", () => {
  assert.equal(cpu.bundleName("/usr/bin/ssh"), null);
  assert.equal(cpu.bundleName("/Users/me/.local/share/fnm/node-versions/v22/installation/bin/node"), null);
  assert.equal(cpu.bundleName(""), null);
});

test("classify identifies app bundles, dev binaries and plain executables", () => {
  assert.deepEqual(
    cpu.classify("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    { kind: "app", label: "Google Chrome" });
  assert.deepEqual(
    cpu.classify("/Users/me/.local/share/fnm/node-versions/v22/installation/bin/node"),
    { kind: "dev", label: "node" });
  assert.deepEqual(
    cpu.classify("/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer"),
    { kind: "exe", label: "WindowServer" });
  assert.deepEqual(cpu.classify("/usr/bin/python3.12"), { kind: "dev", label: "python3.12" });
});

test("groupProcesses collapses an app family into one row", () => {
  const samples = new Map([
    [1, { comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", rssKb: 100, cpuSeconds: 0 }],
    [2, { comm: "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper", rssKb: 200, cpuSeconds: 0 }],
    [3, { comm: "/System/Library/X/WindowServer", rssKb: 50, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[1, 78], [2, 83], [3, 29]]);
  const groups = cpu.groupProcesses(samples, percents, new Map());

  const chrome = groups.find((g) => g.label === "Google Chrome");
  assert.equal(chrome.percent, 161);
  assert.equal(chrome.rssKb, 300);
  assert.equal(chrome.count, 2);
  assert.equal(groups[0].label, "Google Chrome", "sorted by percent desc");
});

test("groupProcesses labels dev processes by project, keeping them separate", () => {
  const samples = new Map([
    [10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }],
    [11, { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[10, 38], [11, 12]]);
  const projects = new Map([[10, "abra-abr"], [11, "project-tracker"]]);
  const groups = cpu.groupProcesses(samples, percents, projects);

  assert.equal(groups.length, 2, "different projects must not merge");
  assert.equal(groups[0].label, "node · abra-abr");
  assert.equal(groups[0].percent, 38);
});

test("groupProcesses merges dev processes sharing one project", () => {
  const samples = new Map([
    [10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }],
    [11, { comm: "/usr/local/bin/node", rssKb: 200, cpuSeconds: 0 }],
  ]);
  const percents = new Map([[10, 10], [11, 20]]);
  const projects = new Map([[10, "acme"], [11, "acme"]]);
  const groups = cpu.groupProcesses(samples, percents, projects);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].percent, 30);
  assert.equal(groups[0].count, 2);
});

test("groupProcesses falls back to the bare binary when no project resolves", () => {
  const samples = new Map([[10, { comm: "/usr/local/bin/node", rssKb: 100, cpuSeconds: 0 }]]);
  const groups = cpu.groupProcesses(samples, new Map([[10, 5]]), new Map());
  assert.equal(groups[0].label, "node");
});

test("groupProcesses treats a missing percentage as zero, keeping rss usable", () => {
  const samples = new Map([[10, { comm: "/usr/bin/foo", rssKb: 400, cpuSeconds: 0 }]]);
  const groups = cpu.groupProcesses(samples, new Map(), new Map());
  assert.equal(groups[0].percent, 0);
  assert.equal(groups[0].rssKb, 400);
});

test("topBy returns the n largest by the requested field", () => {
  const groups = [
    { label: "a", percent: 5, rssKb: 900 },
    { label: "b", percent: 80, rssKb: 100 },
    { label: "c", percent: 40, rssKb: 500 },
  ];
  assert.deepEqual(cpu.topBy(groups, "percent", 2).map((g) => g.label), ["b", "c"]);
  assert.deepEqual(cpu.topBy(groups, "rssKb", 2).map((g) => g.label), ["a", "c"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/system-cpu.test.js`
Expected: FAIL — `cpu.bundleName is not a function`

- [ ] **Step 3: Add the grouping code to `system.widget/lib/cpu.js`**

Insert before `module.exports`:

```js
// Executables that are worth labelling by project rather than collapsing:
// "node 71%" is useless on a machine running thirteen of them.
const DEV_BINARIES = new Set([
  "node", "deno", "bun", "ruby", "go", "cargo", "rustc", "java",
]);

function isDevBinary(base) {
  return DEV_BINARIES.has(base) || /^python[\d.]*$/.test(base);
}

// macOS helper processes live in NESTED .app bundles, e.g.
//   /Applications/Obsidian.app/.../Obsidian Helper (GPU).app/Contents/MacOS/...
// The first bundle is the owning application; the last is the helper.
function bundleName(commPath) {
  const parts = String(commPath || "").split("/");
  for (const part of parts) {
    if (part.endsWith(".app")) return part.slice(0, -4);
  }
  return null;
}

function classify(comm) {
  const app = bundleName(comm);
  if (app) return { kind: "app", label: app };
  const base = String(comm || "").split("/").pop() || "";
  if (isDevBinary(base)) return { kind: "dev", label: base };
  return { kind: "exe", label: base };
}

// projectByPid maps a pid to a project name; only dev-kind processes consult it.
function groupProcesses(samples, percents, projectByPid) {
  const byLabel = new Map();
  for (const [pid, sample] of samples) {
    const { kind, label: base } = classify(sample.comm);
    const project = kind === "dev" ? projectByPid.get(pid) : null;
    const label = project ? `${base} · ${project}` : base;
    if (!label) continue;

    let row = byLabel.get(label);
    if (!row) {
      row = { label, kind, percent: 0, rssKb: 0, count: 0 };
      byLabel.set(label, row);
    }
    row.percent += percents.get(pid) || 0;
    row.rssKb += sample.rssKb || 0;
    row.count += 1;
  }
  return [...byLabel.values()].sort((a, b) => b.percent - a.percent);
}

function topBy(groups, field, n) {
  return [...groups].sort((a, b) => b[field] - a[field]).slice(0, n);
}
```

Extend the export line to:

```js
module.exports = {
  parseCpuTime, parsePsSample, computeDeltas, DISCONTINUITY_SECONDS,
  DEV_BINARIES, bundleName, classify, groupProcesses, topBy,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/system-cpu.test.js`
Expected: PASS, 20 tests

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — expected PASS, 114 tests

```bash
git add system.widget/lib/cpu.js tests/system-cpu.test.js
git commit -m "$(cat <<'EOF'
feat(system): group processes by app bundle, label dev work by project

Measured 57 Chrome processes on the target machine — ungrouped, every
top-3 row was Chrome. Bundle grouping takes the FIRST .app in the path
because helpers nest (Docker nests three deep). node/python are labelled
by project instead, since collapsing 13 node processes hides the answer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Memory and GPU parsers

**Files:**
- Create: `system.widget/lib/memory.js`, `system.widget/lib/gpu.js`
- Test: `tests/system-memory.test.js`, `tests/system-gpu.test.js`
- Create: `tests/fixtures/vm-stat.txt`, `tests/fixtures/ioreg-accel.txt`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `memory.parseVmStat(text)` → `{pageSize, free, active, inactive, speculative, wired, compressor}` (page **counts**, except `pageSize` in bytes).
  - `memory.parseSwapUsed(text)` → bytes.
  - `memory.buildMemory({vmStat, totalBytes, pressureLevel, swapUsedBytes})` → `{totalBytes, wiredBytes, activeBytes, compressedBytes, availableBytes, usedBytes, usedPercent, pressure, swapUsedBytes}` where `pressure` is `"normal"|"warning"|"critical"|"unknown"`.
  - `gpu.parseIoreg(text)` → `{utilization: number|null, allocBytes: number|null, inUseBytes: number|null}`.

- [ ] **Step 1: Capture fixtures**

```bash
vm_stat > tests/fixtures/vm-stat.txt
ioreg -r -d 1 -w 0 -c IOAccelerator > tests/fixtures/ioreg-accel.txt
```

- [ ] **Step 2: Write the failing memory test**

Create `tests/system-memory.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const mem = require("../system.widget/lib/memory.js");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "vm-stat.txt"), "utf8");

test("parseVmStat reads the page size from the header, never hardcoded", () => {
  const v = mem.parseVmStat(FIXTURE);
  assert.equal(v.pageSize, 16384);
  // A machine with 4096-byte pages must parse as 4096.
  const alt = mem.parseVmStat("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 10.\n");
  assert.equal(alt.pageSize, 4096);
});

test("parseVmStat extracts every segment counter", () => {
  const v = mem.parseVmStat(FIXTURE);
  for (const k of ["free", "active", "inactive", "speculative", "wired", "compressor"]) {
    assert.equal(typeof v[k], "number", `${k} missing`);
    assert.ok(v[k] >= 0, `${k} negative`);
  }
  assert.ok(v.active > 0);
});

test("parseVmStat tolerates missing lines without throwing", () => {
  const v = mem.parseVmStat("Mach Virtual Memory Statistics: (page size of 16384 bytes)\n");
  assert.equal(v.active, 0);
  assert.equal(v.pageSize, 16384);
});

test("buildMemory sums the four segments to the machine total", () => {
  const vmStat = { pageSize: 16384, free: 100, active: 200, inactive: 300,
                   speculative: 50, wired: 80, compressor: 40 };
  const totalBytes = (100 + 200 + 300 + 50 + 80 + 40) * 16384;
  const m = mem.buildMemory({ vmStat, totalBytes, pressureLevel: 1, swapUsedBytes: 0 });

  assert.equal(m.wiredBytes, 80 * 16384);
  assert.equal(m.activeBytes, 200 * 16384);
  assert.equal(m.compressedBytes, 40 * 16384);
  // available = free + inactive + speculative, the pages macOS can reclaim
  assert.equal(m.availableBytes, (100 + 300 + 50) * 16384);
  assert.equal(m.wiredBytes + m.activeBytes + m.compressedBytes + m.availableBytes, totalBytes);
});

test("buildMemory maps pressure levels to names", () => {
  const vmStat = { pageSize: 16384, free: 1, active: 1, inactive: 1, speculative: 1, wired: 1, compressor: 1 };
  const at = (lvl) => mem.buildMemory({ vmStat, totalBytes: 6 * 16384, pressureLevel: lvl, swapUsedBytes: 0 }).pressure;
  assert.equal(at(1), "normal");
  assert.equal(at(2), "warning");
  assert.equal(at(4), "critical");
  assert.equal(at(null), "unknown");
  assert.equal(at(99), "unknown");
});

test("buildMemory computes usedPercent excluding reclaimable pages", () => {
  const vmStat = { pageSize: 16384, free: 500, active: 300, inactive: 0,
                   speculative: 0, wired: 100, compressor: 100 };
  const m = mem.buildMemory({ vmStat, totalBytes: 1000 * 16384, pressureLevel: 1, swapUsedBytes: 0 });
  assert.equal(m.usedPercent, 50); // (300+100+100)/1000
});

test("parseSwapUsed reads megabytes from vm.swapusage", () => {
  assert.equal(mem.parseSwapUsed("total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)"),
    Math.round(512.5 * 1024 * 1024));
  assert.equal(mem.parseSwapUsed("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), 0);
  assert.equal(mem.parseSwapUsed("garbage"), 0);
});
```

- [ ] **Step 3: Write the failing GPU test**

Create `tests/system-gpu.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const gpu = require("../system.widget/lib/gpu.js");

test("parseIoreg reads Device Utilization from real ioreg output", () => {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "ioreg-accel.txt"), "utf8");
  const g = gpu.parseIoreg(text);
  assert.equal(typeof g.utilization, "number");
  assert.ok(g.utilization >= 0 && g.utilization <= 100);
});

test("parseIoreg takes the maximum across multiple accelerators", () => {
  const text = '"Device Utilization %"=11\nsomething\n"Device Utilization %"=64\n';
  assert.equal(gpu.parseIoreg(text).utilization, 64);
});

test("parseIoreg reports unified-memory footprint when present", () => {
  const text = '"Alloc system memory"=4959191040,"Device Utilization %"=11,"In use system memory"=671350784';
  const g = gpu.parseIoreg(text);
  assert.equal(g.allocBytes, 4959191040);
  assert.equal(g.inUseBytes, 671350784);
});

test("parseIoreg returns nulls rather than throwing when ioreg gives nothing", () => {
  const g = gpu.parseIoreg("");
  assert.equal(g.utilization, null);
  assert.equal(g.allocBytes, null);
  assert.equal(gpu.parseIoreg(null).utilization, null);
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `node --test tests/system-memory.test.js tests/system-gpu.test.js`
Expected: FAIL — modules not found

- [ ] **Step 5: Create `system.widget/lib/memory.js`**

```js
"use strict";

// kern.memorystatus_vm_pressure_level. Pressure — not percentage full — is the
// honest signal: this machine sits at 60% "used" while entirely healthy.
const PRESSURE = { 1: "normal", 2: "warning", 4: "critical" };

const COUNTERS = {
  free: /^Pages free:\s+(\d+)/m,
  active: /^Pages active:\s+(\d+)/m,
  inactive: /^Pages inactive:\s+(\d+)/m,
  speculative: /^Pages speculative:\s+(\d+)/m,
  wired: /^Pages wired down:\s+(\d+)/m,
  compressor: /^Pages occupied by compressor:\s+(\d+)/m,
};

function parseVmStat(text) {
  const s = String(text || "");
  const pageMatch = s.match(/page size of (\d+) bytes/);
  const out = { pageSize: pageMatch ? parseInt(pageMatch[1], 10) : 4096 };
  for (const key of Object.keys(COUNTERS)) {
    const m = s.match(COUNTERS[key]);
    out[key] = m ? parseInt(m[1], 10) : 0;
  }
  return out;
}

// `sysctl -n vm.swapusage` -> "total = 2048.00M  used = 512.50M  free = ..."
function parseSwapUsed(text) {
  const m = String(text || "").match(/used\s*=\s*([\d.]+)M/);
  return m ? Math.round(parseFloat(m[1]) * 1024 * 1024) : 0;
}

function buildMemory({ vmStat, totalBytes, pressureLevel, swapUsedBytes }) {
  const p = vmStat.pageSize;
  const wiredBytes = vmStat.wired * p;
  const activeBytes = vmStat.active * p;
  const compressedBytes = vmStat.compressor * p;
  // macOS can reclaim inactive and speculative pages on demand, so they count
  // as available rather than used — this is what Activity Monitor does too.
  const availableBytes = (vmStat.free + vmStat.inactive + vmStat.speculative) * p;
  const usedBytes = wiredBytes + activeBytes + compressedBytes;
  return {
    totalBytes,
    wiredBytes,
    activeBytes,
    compressedBytes,
    availableBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
    pressure: PRESSURE[pressureLevel] || "unknown",
    swapUsedBytes: swapUsedBytes || 0,
  };
}

module.exports = { parseVmStat, parseSwapUsed, buildMemory, PRESSURE };
```

- [ ] **Step 6: Create `system.widget/lib/gpu.js`**

```js
"use strict";

// ioreg -r -d 1 -w 0 -c IOAccelerator exposes a PerformanceStatistics dict:
//   "Device Utilization %"=11,"Alloc system memory"=4959191040,...
// No elevated privileges needed. Per-process GPU is NOT available here —
// powermetrics is the only source and it requires root.
function pick(text, key, { max = false } = {}) {
  const re = new RegExp('"' + key + '"=(\\d+)', "g");
  let m;
  let best = null;
  while ((m = re.exec(text)) !== null) {
    const v = parseInt(m[1], 10);
    if (!Number.isFinite(v)) continue;
    best = best == null ? v : max ? Math.max(best, v) : best;
  }
  return best;
}

function parseIoreg(text) {
  const s = String(text || "");
  return {
    // A machine can expose more than one accelerator; the busiest is the
    // honest answer to "is the GPU working right now".
    utilization: pick(s, "Device Utilization %", { max: true }),
    allocBytes: pick(s, "Alloc system memory"),
    inUseBytes: pick(s, "In use system memory"),
  };
}

module.exports = { parseIoreg };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test tests/system-memory.test.js tests/system-gpu.test.js`
Expected: PASS, 11 tests

- [ ] **Step 8: Run the suite and commit**

Run: `npm test` — expected PASS, 125 tests

```bash
git add system.widget/lib/memory.js system.widget/lib/gpu.js \
  tests/system-memory.test.js tests/system-gpu.test.js \
  tests/fixtures/vm-stat.txt tests/fixtures/ioreg-accel.txt
git commit -m "$(cat <<'EOF'
feat(system): memory and gpu parsers

Memory reports pressure alongside usage — 38/64GB with pressure normal
is healthy, and a bar alone would imply a problem. Page size is read
from vm_stat's header rather than hardcoded. GPU is device-level only;
per-process needs root.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: History ring and spike detection

**Files:**
- Create: `system.widget/lib/history.js`
- Test: `tests/system-history.test.js`

**Interfaces:**
- Consumes: `DISCONTINUITY_SECONDS` from `cpu.js` (Task 2).
- Produces:
  - `trimHistory(entries, nowMs, windowMs)` → filtered array.
  - `appendSample(entries, sample, windowMs)` → new array. `sample` = `{t:number(ms), cpu:number, mem:number, gpu:number|null}`.
  - `isDiscontinuity(prevMs, nowMs)` → `boolean` (gap > 30 s).
  - `detectSpike(entries, {percent, seconds}, nowMs)` → `{peak, aboveSeconds, endedSecondsAgo, active}` or `null`.

`cpu` in a history entry is the **normalised** 0–100 headline, not a per-core figure.

- [ ] **Step 1: Write the failing test**

Create `tests/system-history.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const h = require("../system.widget/lib/history.js");

const S = (t, cpu) => ({ t, cpu, mem: 50, gpu: 0 });

test("trimHistory drops entries older than the window", () => {
  const now = 1000000;
  const entries = [S(now - 400000, 10), S(now - 100000, 20), S(now, 30)];
  const kept = h.trimHistory(entries, now, 300000); // 5-minute window
  assert.equal(kept.length, 2);
  assert.equal(kept[0].cpu, 20);
});

test("trimHistory trims by timestamp, not by count", () => {
  // A machine that slept has few entries but they are ancient — a count-based
  // cap would keep them and draw a line across the gap.
  const now = 1000000;
  const entries = [S(now - 999999, 90), S(now, 10)];
  assert.deepEqual(h.trimHistory(entries, now, 300000).map((e) => e.cpu), [10]);
});

test("trimHistory handles an empty or absent ring", () => {
  assert.deepEqual(h.trimHistory([], 1000, 300000), []);
  assert.deepEqual(h.trimHistory(null, 1000, 300000), []);
});

test("appendSample adds and trims in one step", () => {
  const now = 1000000;
  const entries = [S(now - 400000, 90)];
  const out = h.appendSample(entries, S(now, 12), 300000);
  assert.deepEqual(out.map((e) => e.cpu), [12]);
});

test("isDiscontinuity flags gaps over 30 seconds", () => {
  assert.equal(h.isDiscontinuity(1000, 1000 + 3000), false);
  assert.equal(h.isDiscontinuity(1000, 1000 + 31000), true);
  assert.equal(h.isDiscontinuity(null, 5000), true, "no previous sample is a discontinuity");
});

test("detectSpike returns null when nothing crossed the threshold", () => {
  const now = 300000;
  const entries = [S(now - 6000, 20), S(now - 3000, 30), S(now, 25)];
  assert.equal(h.detectSpike(entries, { percent: 70, seconds: 15 }, now), null);
});

test("detectSpike ignores a burst shorter than the required duration", () => {
  const now = 300000;
  // 2 samples x 3s = 6s above threshold, under the 15s requirement
  const entries = [S(now - 9000, 20), S(now - 6000, 95), S(now - 3000, 92), S(now, 20)];
  assert.equal(h.detectSpike(entries, { percent: 70, seconds: 15 }, now), null);
});

test("detectSpike reports peak, duration and how long ago it ended", () => {
  const now = 300000;
  const entries = [
    S(now - 30000, 20), S(now - 27000, 95), S(now - 24000, 98),
    S(now - 21000, 91), S(now - 18000, 88), S(now - 15000, 90),
    S(now - 12000, 22), S(now - 9000, 20), S(now - 6000, 21), S(now, 22),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 15 }, now);
  assert.ok(spike, "expected a spike");
  assert.equal(spike.peak, 98);
  assert.equal(spike.aboveSeconds, 15); // 5 samples x 3s
  assert.equal(spike.active, false);
  assert.equal(spike.endedSecondsAgo, 12);
});

test("detectSpike marks an in-progress spike active with endedSecondsAgo 0", () => {
  const now = 300000;
  const entries = [
    S(now - 18000, 20), S(now - 15000, 95), S(now - 12000, 96),
    S(now - 9000, 97), S(now - 6000, 93), S(now - 3000, 91), S(now, 94),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 15 }, now);
  assert.ok(spike);
  assert.equal(spike.active, true);
  assert.equal(spike.endedSecondsAgo, 0);
  assert.equal(spike.peak, 97);
});

test("detectSpike sums non-contiguous time above the threshold", () => {
  const now = 300000;
  const entries = [
    S(now - 30000, 95), S(now - 27000, 95), S(now - 24000, 20),
    S(now - 21000, 95), S(now - 18000, 95), S(now - 15000, 95), S(now, 20),
  ];
  const spike = h.detectSpike(entries, { percent: 70, seconds: 15 }, now);
  assert.ok(spike, "cumulative 15s should qualify even when interrupted");
  assert.equal(spike.aboveSeconds, 15);
});

test("detectSpike copes with fewer than two samples", () => {
  assert.equal(h.detectSpike([], { percent: 70, seconds: 15 }, 1000), null);
  assert.equal(h.detectSpike([S(1000, 99)], { percent: 70, seconds: 15 }, 1000), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/system-history.test.js`
Expected: FAIL — `Cannot find module '../system.widget/lib/history.js'`

- [ ] **Step 3: Create `system.widget/lib/history.js`**

```js
"use strict";
const { DISCONTINUITY_SECONDS } = require("./cpu");

// Trim by timestamp rather than by count. After the machine sleeps, a
// count-based cap would retain ancient samples and draw a line across the gap.
function trimHistory(entries, nowMs, windowMs) {
  if (!Array.isArray(entries)) return [];
  const cutoff = nowMs - windowMs;
  return entries.filter((e) => e && typeof e.t === "number" && e.t > cutoff);
}

function appendSample(entries, sample, windowMs) {
  const next = Array.isArray(entries) ? entries.concat([sample]) : [sample];
  return trimHistory(next, sample.t, windowMs);
}

function isDiscontinuity(prevMs, nowMs) {
  if (prevMs == null) return true;
  return nowMs - prevMs > DISCONTINUITY_SECONDS * 1000;
}

// A spike is cumulative time at or above `percent` reaching `seconds` within
// the window. Each sample represents the interval since the previous one, so
// duration is measured from timestamps rather than assuming a fixed cadence —
// refreshes are not perfectly spaced.
function detectSpike(entries, { percent, seconds }, nowMs) {
  if (!Array.isArray(entries) || entries.length < 2) return null;

  let aboveMs = 0;
  let peak = 0;
  let lastAboveT = null;

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (typeof cur.cpu !== "number") continue;
    if (cur.cpu > peak) peak = cur.cpu;
    if (cur.cpu >= percent) {
      const gap = cur.t - prev.t;
      // Don't credit a sleep gap as time spent under load.
      if (gap > 0 && gap <= DISCONTINUITY_SECONDS * 1000) aboveMs += gap;
      lastAboveT = cur.t;
    }
  }

  if (aboveMs < seconds * 1000) return null;

  const last = entries[entries.length - 1];
  const active = typeof last.cpu === "number" && last.cpu >= percent;
  return {
    peak: Math.round(peak),
    aboveSeconds: Math.round(aboveMs / 1000),
    active,
    endedSecondsAgo: active ? 0 : Math.max(0, Math.round((nowMs - lastAboveT) / 1000)),
  };
}

module.exports = { trimHistory, appendSample, isDiscontinuity, detectSpike };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/system-history.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — expected PASS, 136 tests

```bash
git add system.widget/lib/history.js tests/system-history.test.js
git commit -m "$(cat <<'EOF'
feat(system): history ring and spike detection

Trims by timestamp so waking from sleep doesn't render as a fake spike,
and measures spike duration from real timestamps rather than assuming a
fixed cadence. Sleep gaps are never credited as time under load.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Collector, scaffold and first live payload

**Files:**
- Create: `system.widget/lib/collect.js`, `system.widget/lib/run.sh`, `system.widget/config.json`, `system.widget/lib/mock.json`
- Create (generated): `system.widget/lib/theme.js`, `system.widget/lib/project.js`
- Test: `tests/system-collect.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: the payload every layout renders:

```js
{
  generatedAt: "ISO string",
  status: "ok" | "error",
  config: { ... },
  theme: { /* 13 string tokens */ },
  themeError: null | "string",
  cpuEstimated: false,      // true only on the very first run
  cpu: { percent: 0..100, cores: 12, top: [ {label, kind, percent, count} ] },
  memory: { totalBytes, wiredBytes, activeBytes, compressedBytes,
            availableBytes, usedBytes, usedPercent, pressure, swapUsedBytes,
            top: [ {label, kind, rssKb, count} ] },
  gpu: { utilization: number|null, allocBytes, inUseBytes, visible: boolean },
  history: [ {t, cpu, mem, gpu} ],
  spike: null | { peak, aboveSeconds, active, endedSecondsAgo }
}
```

The widget directory, `config.json`, the placeholder `index.jsx` and the vendored
shared modules all already exist — Task 2 created them so the drift tests would
stay green. This task adds the entry point and the collector.

- [ ] **Step 1: Create `system.widget/lib/run.sh`** (copy the pattern from `dev-servers.widget/lib/run.sh`):

```bash
#!/bin/bash
# Übersicht runs commands with a minimal PATH; find node in the usual homes.
DIR="$(cd "$(dirname "$0")" && pwd)"
for NODE in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$NODE" >/dev/null 2>&1; then
    exec "$NODE" "$DIR/collect.js" "$@"
  fi
done
echo '{"status":"error","message":"system-widget needs Node.js — install from https://nodejs.org or brew install node","cpu":null}'
```

`chmod +x system.widget/lib/run.sh` and confirm `git ls-files -s` shows `100755` after adding.

- [ ] **Step 2: Write the failing test**

Create `tests/system-collect.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const COLLECT = path.join(__dirname, "..", "system.widget", "lib", "collect.js");

// Each run gets its own cache so the two runs below are genuinely
// first-run and second-run, independent of the developer's real cache.
function run(args, cacheDir) {
  const out = execFileSync(process.execPath, [COLLECT].concat(args || []), {
    encoding: "utf8",
    env: Object.assign({}, process.env, { UBERSICHT_SYSTEM_WIDGET_CACHE: cacheDir }),
  });
  return JSON.parse(out);
}

function tmpCache() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sysw-")), "history.json");
}

test("collector emits valid JSON with the full payload shape", () => {
  const d = run([], tmpCache());
  assert.equal(d.status, "ok");
  assert.equal(typeof d.generatedAt, "string");
  assert.ok(d.cpu && typeof d.cpu.percent === "number");
  assert.ok(d.cpu.percent >= 0 && d.cpu.percent <= 100, "headline CPU is normalised 0-100");
  assert.ok(Array.isArray(d.cpu.top));
  assert.ok(d.memory && d.memory.totalBytes > 0);
  assert.ok(["normal", "warning", "critical", "unknown"].includes(d.memory.pressure));
  assert.ok(Array.isArray(d.memory.top));
  assert.ok(d.gpu && typeof d.gpu.visible === "boolean");
  assert.ok(Array.isArray(d.history));
});

test("collector emits a full 13-token theme on the success path", () => {
  const d = run([], tmpCache());
  assert.equal(Object.keys(d.theme).length, 13);
  for (const v of Object.values(d.theme)) assert.equal(typeof v, "string");
  assert.ok("themeError" in d);
});

test("first run flags cpuEstimated, second run does not", () => {
  const cache = tmpCache();
  const first = run([], cache);
  assert.equal(first.cpuEstimated, true, "no prior sample means no delta is possible");
  const second = run([], cache);
  assert.equal(second.cpuEstimated, false);
  assert.ok(second.history.length >= 1);
});

test("mock mode renders without touching the live system", () => {
  const d = run(["--mock"], tmpCache());
  assert.equal(d.status, "ok");
  assert.ok(d.cpu.top.length > 0);
  assert.equal(Object.keys(d.theme).length, 13);
});

test("group percentages are per-core and may exceed the headline", () => {
  const d = run(["--mock"], tmpCache());
  // Documented unit split: headline normalised, per-group per-core.
  assert.ok(d.cpu.top.every((g) => typeof g.percent === "number"));
  assert.equal(typeof d.cpu.cores, "number");
  assert.ok(d.cpu.cores > 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/system-collect.test.js`
Expected: FAIL — collect.js does not exist

- [ ] **Step 4: Create `system.widget/lib/mock.json`**

```json
{
  "cpu": {
    "percent": 47,
    "cores": 12,
    "top": [
      { "label": "Google Chrome", "kind": "app", "percent": 202, "count": 57 },
      { "label": "node · abra-abr", "kind": "dev", "percent": 38, "count": 2 },
      { "label": "WindowServer", "kind": "exe", "percent": 29, "count": 1 }
    ]
  },
  "memory": {
    "totalBytes": 68719476736, "wiredBytes": 3758096384, "activeBytes": 25446842368,
    "compressedBytes": 4831838208, "availableBytes": 34682699776,
    "usedBytes": 34036776960, "usedPercent": 50, "pressure": "normal", "swapUsedBytes": 0,
    "top": [
      { "label": "Google Chrome", "kind": "app", "rssKb": 8808038, "count": 57 },
      { "label": "node · project-tracker", "kind": "dev", "rssKb": 624640, "count": 1 },
      { "label": "Code Helper", "kind": "app", "rssKb": 491520, "count": 4 }
    ]
  },
  "gpu": { "utilization": 34, "allocBytes": 4959191040, "inUseBytes": 671350784, "visible": true },
  "history": [
    { "t": 1, "cpu": 20, "mem": 48, "gpu": 4 }, { "t": 3001, "cpu": 95, "mem": 52, "gpu": 30 },
    { "t": 6001, "cpu": 98, "mem": 55, "gpu": 34 }, { "t": 9001, "cpu": 91, "mem": 58, "gpu": 31 },
    { "t": 12001, "cpu": 88, "mem": 60, "gpu": 28 }, { "t": 15001, "cpu": 90, "mem": 62, "gpu": 33 },
    { "t": 18001, "cpu": 22, "mem": 61, "gpu": 6 }, { "t": 21001, "cpu": 20, "mem": 60, "gpu": 3 }
  ],
  "spike": { "peak": 98, "aboveSeconds": 92, "active": false, "endedSecondsAgo": 15 }
}
```

- [ ] **Step 5: Create `system.widget/lib/collect.js`**

```js
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

const cpuLib = require("./cpu");
const memLib = require("./memory");
const gpuLib = require("./gpu");
const hist = require("./history");
const { findProjectRoot, parseCwds } = require("./project");
const { resolveTheme } = require("./theme");

const DEFAULTS = {
  theme: null,
  layout: "ghost",
  position: { corner: "top-right" },
  refreshSeconds: 3,
  historyMinutes: 5,
  topN: 3,
  gpuThreshold: 10,
  spike: { percent: 70, seconds: 15 },
  show: { gpu: true, memory: true, history: true, spike: true },
  scale: 1.5,
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    const user = JSON.parse(raw);
    return {
      ...DEFAULTS, ...user,
      show: { ...DEFAULTS.show, ...(user.show || {}) },
      spike: { ...DEFAULTS.spike, ...(user.spike || {}) },
    };
  } catch {
    return { ...DEFAULTS, show: { ...DEFAULTS.show }, spike: { ...DEFAULTS.spike } };
  }
}

// Module level so the watchdog and main().catch — which run outside main()'s
// scope — can still emit a themed payload.
const CONFIG = readConfig();
const THEME = resolveTheme({ widgetDir: __dirname, config: CONFIG });

const CACHE = process.env.UBERSICHT_SYSTEM_WIDGET_CACHE ||
  path.join(os.homedir(), ".cache", "ubersicht-system-widget", "history.json");

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return { sample: null, at: null, history: [] };
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(data));
  } catch {
    // A read-only cache must degrade to "no history", never crash the widget.
  }
}

function run(cmd, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(String(stdout || ""));
    });
  });
}

function sysctl(key) {
  try {
    return execFileSync("sysctl", ["-n", key], { encoding: "utf8", timeout: 1000 }).trim();
  } catch {
    return "";
  }
}

function emit(extra) {
  const base = {
    generatedAt: new Date().toISOString(),
    config: CONFIG,
    theme: THEME.theme,
    themeError: THEME.themeError,
  };
  process.stdout.write(JSON.stringify(Object.assign(base, extra)));
}

async function main() {
  const useMock = process.argv.includes("--no-mock")
    ? false
    : CONFIG.mock || process.argv.includes("--mock");

  if (useMock) {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8"));
    emit(Object.assign({ status: "ok", cpuEstimated: false }, mock));
    return;
  }

  const nowMs = Date.now();
  const cache = readCache();
  const cores = parseInt(sysctl("hw.logicalcpu"), 10) || 1;

  const [psOut, ioregOut, vmOut] = await Promise.all([
    run("ps", ["-axo", "pid=,time=,rss=,comm="]),
    CONFIG.show.gpu ? run("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]) : Promise.resolve(""),
    run("vm_stat", []),
  ]);

  const samples = cpuLib.parsePsSample(psOut);
  const elapsed = cache.at ? (nowMs - cache.at) / 1000 : 0;
  const discontinuous = hist.isDiscontinuity(cache.at, nowMs);

  let percents;
  let cpuEstimated = false;
  if (!discontinuous && cache.sample) {
    const prev = new Map(cache.sample.map((e) => [e[0], { cpuSeconds: e[1], comm: e[2] }]));
    percents = cpuLib.computeDeltas(prev, samples, elapsed);
  } else {
    // First run (or post-sleep): no delta is possible. Fall back to ps's
    // decaying average for this one cycle rather than showing blanks.
    percents = new Map();
    const fallback = await run("ps", ["-axo", "pid=,pcpu="]);
    for (const line of fallback.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+([\d.]+)/);
      if (m) percents.set(parseInt(m[1], 10), parseFloat(m[2]));
    }
    cpuEstimated = true;
  }

  // Resolve projects for dev processes only, and only for the shortlist —
  // one lsof call on a handful of pids, the same approach dev-servers uses.
  const devPids = [...samples.entries()]
    .filter(([, s]) => cpuLib.classify(s.comm).kind === "dev")
    .map(([pid]) => pid);
  const projectByPid = new Map();
  if (devPids.length) {
    const cwdOut = await run("lsof", ["-a", "-p", devPids.join(","), "-d", "cwd", "-Fpn"]);
    for (const [pid, cwd] of parseCwds(cwdOut)) {
      const root = findProjectRoot(cwd);
      if (root) projectByPid.set(pid, path.basename(root));
    }
  }

  const groups = cpuLib.groupProcesses(samples, percents, projectByPid);
  // The widget must not rank itself: on an idle machine its own ~3% would
  // otherwise take the top slot. dev-servers filters Übersicht the same way.
  const selfLabels = new Set(["node", "Übersicht", "Uebersicht"]);
  const visible = groups.filter((g) => !(g.kind !== "dev" && selfLabels.has(g.label)));

  const totalPercent = [...percents.values()].reduce((a, b) => a + b, 0);
  const headline = Math.max(0, Math.min(100, Math.round(totalPercent / cores)));

  const vmStat = memLib.parseVmStat(vmOut);
  const memory = memLib.buildMemory({
    vmStat,
    totalBytes: parseInt(sysctl("hw.memsize"), 10) || 0,
    pressureLevel: parseInt(sysctl("kern.memorystatus_vm_pressure_level"), 10),
    swapUsedBytes: memLib.parseSwapUsed(sysctl("vm.swapusage")),
  });

  const gpu = gpuLib.parseIoreg(ioregOut);
  gpu.visible = CONFIG.show.gpu && typeof gpu.utilization === "number" &&
    gpu.utilization >= CONFIG.gpuThreshold;

  let history = [];
  let spike = null;
  if (CONFIG.show.history) {
    const windowMs = CONFIG.historyMinutes * 60 * 1000;
    const sample = { t: nowMs, cpu: headline, mem: memory.usedPercent, gpu: gpu.utilization };
    history = discontinuous
      ? [sample]
      : hist.appendSample(cache.history, sample, windowMs);
    if (CONFIG.show.spike) spike = hist.detectSpike(history, CONFIG.spike, nowMs);
  }

  // The previous ps sample is cached even when show.history is false: accurate
  // CPU percentages are computed by diffing against it, so dropping it would
  // permanently degrade the widget to ps's decaying average. Only the ring is
  // suppressed in that mode.
  writeCache({
    at: nowMs,
    sample: [...samples.entries()].map(([pid, s]) => [pid, s.cpuSeconds, s.comm]),
    history,
  });

  emit({
    status: "ok",
    cpuEstimated,
    cpu: { percent: headline, cores, top: cpuLib.topBy(visible, "percent", CONFIG.topN) },
    memory: Object.assign(memory, { top: cpuLib.topBy(visible, "rssKb", CONFIG.topN) }),
    gpu,
    history,
    spike,
  });
}

// A hung ps/ioreg must not pile up collectors across refreshes.
const watchdog = setTimeout(() => {
  emit({ status: "error", message: "collector timed out", cpu: null, history: [] });
  process.exit(0);
}, 4000);

main()
  .then(() => clearTimeout(watchdog))
  .catch((err) => {
    clearTimeout(watchdog);
    emit({
      status: "error",
      message: String((err && err.message) || err),
      cpu: null,
      history: [],
    });
    process.exitCode = 0; // never crash the widget
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/system-collect.test.js`
Expected: PASS, 5 tests

- [ ] **Step 7: Inspect a real payload by eye**

```bash
system.widget/lib/run.sh | python3 -m json.tool | head -40
```

Confirm: `cpu.percent` is a sane 0–100, `cpu.top` names real applications with **grouped** labels (a single `Google Chrome` row, not three helpers), and `memory.pressure` reads `normal`.

- [ ] **Step 8: Run the suite and commit**

Run: `npm test` — expected PASS, 141 tests

```bash
git add system.widget/ tests/system-collect.test.js
git commit -m "$(cat <<'EOF'
feat(system): collector, scaffold and first live payload

One ps call feeds both top-3 lists. Projects resolve via a single lsof
on dev pids only. The widget filters itself from its own ranking, since
its ~3% would otherwise lead on an idle machine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: The `ghost` layout

**Files:**
- Create: `system.widget/index.jsx`

**Interfaces:**
- Consumes: the payload from Task 6.
- Produces: `export const render`, plus `themeVars`, `TOKENS`, `fmtBytes`, `fmtPercent`, `Stream`, `Rows`, `MemoryBar` used again by Task 8.

Read `dev-servers.widget/index.jsx` first for the established `TOKENS`/`themeVars` pattern — the token-list drift test in `tests/theme.test.js` requires this widget's array to match exactly.

- [ ] **Step 1: Create `system.widget/index.jsx`**

```jsx
import { css } from "uebersicht";

export const command = "system.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 3000;

export const className = `
  top: 0; left: 0; right: 0; bottom: 0;
  pointer-events: none;
`;

const TOKENS = [
  "text", "sub", "muted", "accent", "ok", "warn", "danger",
  "surface", "border", "shadow", "divider", "track", "radius",
];

// Object.assign, not spread — Übersicht's Babel does not support object spread.
const themeVars = (theme) => {
  const vars = {};
  if (!theme) return vars;
  for (let i = 0; i < TOKENS.length; i++) {
    const key = TOKENS[i];
    if (typeof theme[key] === "string") vars["--ub-" + key] = theme[key];
  }
  return vars;
};

const card = css`
  position: absolute;
  width: 300px;
  padding: 11px 14px;
  border-radius: var(--ub-radius, 12px);
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.55;
  overflow: hidden;
`;

const label = css`
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ub-muted, #8b90a0); font-weight: 600;
`;
const sub = css` color: var(--ub-sub, #9aa0b0); `;
const strong = css` color: var(--ub-text, #e8eaf0); font-weight: 600; `;
const rowCss = css`
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; position: relative;
`;
const nameCss = css` overflow: hidden; text-overflow: ellipsis; flex: 1; `;

export const fmtPercent = (n) => `${Math.round(n)}%`;
export const fmtBytes = (b) => {
  const gb = b / 1073741824;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(b / 1048576)} MB`;
};

// Severity uses the same thresholds as claude-usage's gauges.
const loadColor = (pct) =>
  pct >= 80 ? "var(--ub-danger, #d97757)"
    : pct >= 50 ? "var(--ub-warn, #d9a557)"
      : "var(--ub-ok, #5ba97f)";

// Builds an SVG area path from history. Points are spread across the full
// width regardless of how many samples exist, so a partly-filled ring still
// draws edge to edge instead of bunching on the left.
export const streamPath = (history, w, h) => {
  if (!history || history.length < 2) return null;
  const step = w / (history.length - 1);
  let line = "";
  for (let i = 0; i < history.length; i++) {
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((h - (Math.max(0, Math.min(100, history[i].cpu)) / 100) * h) * 10) / 10;
    line += (i === 0 ? "M" : " L") + x + "," + y;
  }
  return { line, area: line + ` L${w},${h} L0,${h} Z` };
};

const Stream = ({ history, width, height }) => {
  const p = streamPath(history, width, height);
  if (!p) return null;
  return (
    <svg
      width={width} height={height}
      style={{ position: "absolute", left: 0, bottom: 0, opacity: 0.5 }}
    >
      <path d={p.area} fill="var(--ub-accent, #d97757)" opacity="0.22" />
      <path d={p.line} fill="none" stroke="var(--ub-accent, #d97757)" strokeWidth="1.4" opacity="0.75" />
    </svg>
  );
};

const Rows = ({ items, render }) => (
  <span style={{ display: "contents" }}>
    {items.map((g, i) => (
      <div className={rowCss} key={`${g.label}-${i}`}>{render(g)}</div>
    ))}
  </span>
);

const MemoryBar = ({ memory }) => {
  const t = memory.totalBytes || 1;
  const seg = (bytes, color) => (
    <span style={{ width: `${(bytes / t) * 100}%`, background: color, display: "block", height: "100%" }} />
  );
  return (
    <span style={{ display: "flex", height: 7, borderRadius: 3, overflow: "hidden", flex: 1 }}>
      {seg(memory.wiredBytes, "var(--ub-sub, #9aa0b0)")}
      {seg(memory.activeBytes, "var(--ub-ok, #5ba97f)")}
      {seg(memory.compressedBytes, "var(--ub-warn, #d9a557)")}
      {seg(memory.availableBytes, "var(--ub-track, rgba(255,255,255,0.12))")}
    </span>
  );
};

const SpikeLine = ({ spike }) => {
  if (!spike) return null;
  const when = spike.active ? "ongoing" : `ended ${spike.endedSecondsAgo}s ago`;
  return (
    <div className={sub} style={{ fontSize: 9.5, marginBottom: 3 }}>
      peak <span className={strong} style={{ color: "var(--ub-warn, #d9a557)" }}>{spike.peak}%</span>
      {" · high for "}<span className={strong}>{spike.aboveSeconds}s</span>
      {" · "}{when}
    </div>
  );
};

const Ghost = ({ d }) => (
  <span style={{ display: "contents" }}>
    <Stream history={d.history} width={300} height={112} />
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span className={label}>System</span>
        <span className={sub}>
          CPU <span className={strong} style={{ color: loadColor(d.cpu.percent) }}>{fmtPercent(d.cpu.percent)}</span>
          {" · MEM "}<span className={strong}>{fmtPercent(d.memory.usedPercent)}</span>
        </span>
      </div>
      <SpikeLine spike={d.spike} />
      <Rows
        items={d.cpu.top}
        render={(g) => (
          <span style={{ display: "contents" }}>
            <span style={{ color: loadColor(g.percent), fontSize: 8 }}>●</span>
            <span className={`${strong} ${nameCss}`}>{g.label}</span>
            {g.count > 1 && <span className={sub} style={{ fontSize: 9 }}>{g.count}</span>}
            <span className={sub}>{fmtPercent(g.percent)}</span>
          </span>
        )}
      />
      {d.gpu.visible && (
        <div className={rowCss} style={{ marginTop: 4 }}>
          <span className={label} style={{ flex: 1 }}>GPU</span>
          <span className={strong}>{fmtPercent(d.gpu.utilization)}</span>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
        <span className={label}>Mem</span>
        <MemoryBar memory={d.memory} />
        <span className={sub}>
          <span className={strong}>{fmtBytes(d.memory.usedBytes)}</span>
          {"/"}{fmtBytes(d.memory.totalBytes)}
        </span>
      </div>
      {d.memory.pressure !== "normal" && (
        <span style={{ display: "contents" }}>
          <div className={label} style={{ marginTop: 5 }}>Top memory · {d.memory.pressure}</div>
          <Rows
            items={d.memory.top}
            render={(g) => (
              <span style={{ display: "contents" }}>
                <span className={`${strong} ${nameCss}`}>{g.label}</span>
                <span className={sub}>{fmtBytes(g.rssKb * 1024)}</span>
              </span>
            )}
          />
        </span>
      )}
    </div>
  </span>
);

const cornerStyle = (corner, scale) => {
  const [v, h] = String(corner || "top-right").split("-");
  return {
    [v === "bottom" ? "bottom" : "top"]: 8 / scale,
    [h === "left" ? "left" : "right"]: 12 / scale,
  };
};

const LAYOUTS = { ghost: Ghost };

export const render = ({ output }) => {
  let d;
  try {
    d = JSON.parse(output);
  } catch {
    return null; // no empty chrome on the desktop
  }
  const config = d.config || {};
  const scale = typeof config.scale === "number" ? config.scale : 1;
  const style = cornerStyle(config.position && config.position.corner, scale);
  style.zoom = scale;
  Object.assign(style, themeVars(d.theme));

  if (d.status === "error" || !d.cpu) {
    return <div className={card} style={style}><span className={sub}>system: unavailable</span></div>;
  }
  const Layout = LAYOUTS[config.layout] || Ghost;
  return <div className={card} style={style}><Layout d={d} /></div>;
};
```

- [ ] **Step 2: Verify the bundle compiles**

```bash
npx --yes esbuild system.widget/index.jsx --bundle --external:uebersicht --outfile=/dev/null
```

Expected: no output, exit 0. This is what catches forbidden Babel syntax.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS, 141 tests — including the token-list drift test, which now checks three widgets.

- [ ] **Step 4: Install and verify visually**

```bash
ln -sfn "$PWD/system.widget" "$HOME/Library/Application Support/Übersicht/widgets/system.widget"
```

Set `"mock": true` in `system.widget/config.json` to force the spike state, confirm the card renders with the ghost stream behind the rows, then set it back to `false` and confirm live data.

- [ ] **Step 5: Commit**

```bash
git add system.widget/index.jsx
git commit -m "$(cat <<'EOF'
feat(system): ghost layout

History renders as a low-opacity background fill rather than a panel, so
it costs no rows when idle and is unmistakable after a spike. Memory
top-3 appears only when pressure leaves normal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The `ticker` layout

**Files:**
- Modify: `system.widget/index.jsx`

**Interfaces:**
- Consumes: `themeVars`, `fmtBytes`, `fmtPercent`, `loadColor`, `MemoryBar`, `streamPath` from Task 7.
- Produces: `LAYOUTS.ticker`.

The ticker caps its list at **`Math.min(config.topN, 2)`** regardless of `topN` — a single-line pill has no room for a third without wrapping, and wrapping would break the visual pairing with `claude-usage`'s ticker.

- [ ] **Step 1: Add the pill style and Sparkline**

In `system.widget/index.jsx`, after the `card` definition add:

```jsx
const pill = css`
  position: absolute;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;
const divider = css`
  width: 1px; align-self: stretch;
  background: var(--ub-divider, rgba(255, 255, 255, 0.1));
`;

const Sparkline = ({ history, width, height }) => {
  const p = streamPath(history, width, height);
  if (!p) return null;
  return (
    <svg width={width} height={height} style={{ flexShrink: 0 }}>
      <path d={p.line} fill="none" stroke="var(--ub-accent, #d97757)" strokeWidth="1.5" />
    </svg>
  );
};
```

- [ ] **Step 2: Add the Ticker component**

Add before the `cornerStyle` definition:

```jsx
const Ticker = ({ d }) => {
  const config = d.config || {};
  const n = Math.min(typeof config.topN === "number" ? config.topN : 3, 2);
  const top = d.cpu.top.slice(0, n);
  return (
    <span style={{ display: "contents" }}>
      {d.history && d.history.length > 1 && (
        <Sparkline history={d.history} width={46} height={16} />
      )}
      <span className={sub}>
        CPU <span className={strong} style={{ color: loadColor(d.cpu.percent) }}>{fmtPercent(d.cpu.percent)}</span>
      </span>
      {d.spike && (
        <span className={sub} style={{ fontSize: 9.5 }}>
          peak <span className={strong} style={{ color: "var(--ub-warn, #d9a557)" }}>{d.spike.peak}%</span>
          {" · "}{d.spike.aboveSeconds}s
        </span>
      )}
      <span className={divider} />
      {top.map((g, i) => (
        <span className={sub} key={`${g.label}-${i}`}>
          <span style={{ color: loadColor(g.percent) }}>●</span>{" "}
          <span className={strong}>{g.label}</span> {fmtPercent(g.percent)}
        </span>
      ))}
      {d.gpu.visible && (
        <span style={{ display: "contents" }}>
          <span className={divider} />
          <span className={sub}>GPU <span className={strong}>{fmtPercent(d.gpu.utilization)}</span></span>
        </span>
      )}
      <span className={divider} />
      <span className={sub} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        MEM <span className={strong}>{fmtBytes(d.memory.usedBytes)}</span>
        <span style={{ display: "flex", width: 44 }}><MemoryBar memory={d.memory} /></span>
      </span>
    </span>
  );
};
```

- [ ] **Step 3: Register the layout and give it the pill container**

Replace the `LAYOUTS` constant:

```jsx
const LAYOUTS = { ghost: Ghost, ticker: Ticker };
// The ticker is a pill, not a card; the container differs per layout.
const CONTAINERS = { ghost: card, ticker: pill };
```

In `render`, replace the final return with:

```jsx
  const name = LAYOUTS[config.layout] ? config.layout : "ghost";
  const Layout = LAYOUTS[name];
  return <div className={CONTAINERS[name]} style={style}><Layout d={d} /></div>;
```

The error branch above it keeps using `card` unchanged.

- [ ] **Step 4: Verify the bundle compiles**

```bash
npx --yes esbuild system.widget/index.jsx --bundle --external:uebersicht --outfile=/dev/null
```

Expected: no output, exit 0.

- [ ] **Step 5: Run the suite**

Run: `npm test` — expected PASS, 141 tests

- [ ] **Step 6: Verify both layouts visually**

Set `"layout": "ticker"` and `"position": {"corner": "bottom-left"}` in `config.json`, plus `"mock": true`. Confirm the pill renders on one line with the spike annotation and matches `claude-usage`'s ticker in height and radius. Then set `"layout": "ghost"` and `"mock": false` and confirm live data.

- [ ] **Step 7: Commit**

```bash
git add system.widget/index.jsx
git commit -m "$(cat <<'EOF'
feat(system): ticker layout

Single-line pill matching claude-usage's ticker so the two pair along
the screen edge. Caps its list at 2 groups regardless of topN, since a
third would wrap and break that pairing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Documentation

**Files:**
- Create: `system.widget/README.md`
- Modify: `README.md`, `docs/theming.md`

**Interfaces:** consumes everything; produces nothing code depends on.

- [ ] **Step 1: Create `system.widget/README.md`**

Follow the structure of `dev-servers.widget/README.md` (read it first). It must contain:

- A one-paragraph description: answers "why is my machine struggling" by naming the culprit.
- Install steps, matching the sibling widgets' `ln -sfn` form.
- A layouts section describing `ghost` and `ticker`.
- The full configuration table with every key from `config.json`: `theme`, `layout`, `position.corner`, `refreshSeconds`, `historyMinutes`, `topN`, `gpuThreshold`, `spike.percent`, `spike.seconds`, `show.gpu`, `show.memory`, `show.history`, `show.spike`, `scale`, `mock`. The `theme` row must match the wording used in the other two widget READMEs.
- **A "Reading the numbers" section** containing these three explanations verbatim in substance:
  - *Units.* The headline CPU figure is a share of all cores (0–100%). Per-process figures are per-core, following Activity Monitor, so a browser using two cores fully reads 200%. This is why the headline can read 47% while a row reads 202%.
  - *Grouping.* Processes are grouped by owning application — Chrome's 57 processes become one row. Development processes (`node`, `python`, `deno`, `bun`, `ruby`, `go`, `cargo`, `rustc`, `java`) are labelled by project instead, because collapsing thirteen `node` processes into one row hides the useful part.
  - *Memory figures are RSS, and grouped RSS overstates real usage,* because shared pages are counted once per process. Activity Monitor's "Memory" column uses a different metric with no cheap CLI equivalent. Treat the numbers as a ranking, not an audit.
- A note that GPU is device-level only, hidden below `gpuThreshold`, and that per-process GPU attribution requires root (`powermetrics`) and is therefore unavailable.
- A note that history is cached at `~/.cache/ubersicht-system-widget/history.json`, and that `"show": {"history": false}` does **not** make the widget fully stateless: the collector still writes the cache every refresh, because the previous `ps` sample it holds is what CPU percentages are diffed against — only the sample ring is suppressed.

- [ ] **Step 2: Add the widget to the root README**

In `README.md`, after the `dev-servers.widget` entry in "The widgets", add:

```markdown
### [system.widget](system.widget/) — why is my machine struggling?

Top CPU and memory consumers **grouped by application** (Chrome's 57
processes are one row, not three), device-level GPU when it's actually busy,
memory by kind with real pressure, and five minutes of history so you can
see whether a spike is ongoing or already over. Two layouts.

→ [Install & docs](system.widget/README.md)
```

- [ ] **Step 3: Note the third consumer in the theming docs**

In `docs/theming.md`, in the token table's introduction, mention that three widgets now consume these tokens. Verify while you are there that the "For contributors" section says `npm run sync:shared` — Task 1 changed it, and a stale `sync:themes` there would be actively wrong.

- [ ] **Step 4: Verify and commit**

Run: `npm test` — expected PASS, 141 tests

```bash
git add system.widget/README.md README.md docs/theming.md
git commit -m "$(cat <<'EOF'
docs: document the system monitor widget

Covers both layouts, the full config surface, and three things that
would otherwise confuse: the deliberate units split, the grouping rules,
and that grouped RSS overstates real memory because shared pages are
counted per process.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `npm test` — 150 tests, all passing
- [ ] `npm run check:bundle` — all three widgets compile
- [ ] `npm run sync:shared` followed by `git status` — clean, proving vendored copies are in sync
- [ ] `git status` — clean
- [ ] `system.widget/lib/run.sh | python3 -m json.tool` — `cpu.top` shows grouped application names, not three helper rows of the same app
- [ ] Both layouts verified live in Übersicht under `midnight`
- [ ] `theme.json` → `daylight` recolours all three widgets within one refresh
- [ ] `theme.json` restored to `{ "active": "midnight" }`
- [ ] `system.widget/config.json` restored to `"layout": "ghost"`, `"mock": false`
- [ ] The widget does not appear in its own top-3 on an idle machine
