# Claude Usage Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `claude-usage-widget` — an Übersicht macOS widget showing Claude cost/token usage (from local Claude Code JSONL logs) and subscription limit gauges (session / weekly / Fable, with reset times) as a minimalist bottom-of-screen ticker.

**Architecture:** Self-contained `claude-usage.widget/` folder. `index.jsx` (Übersicht JSX) runs `lib/run.sh` → `lib/collect.js` (Node, stdlib-only) each refresh; collect.js merges three layers (mock / local-log aggregation / limits endpoint) into one JSON payload the widget renders. Per-layer graceful degradation. Mock-data-first.

**Tech Stack:** Übersicht (JSX + emotion `css`), Node.js stdlib only at runtime, `node --test` + `assert` for dev tests. No npm runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-claude-usage-widget-design.md` — read it before starting.

## Global Constraints

- Runtime code (`claude-usage.widget/**`) uses **only Node stdlib** — no `npm install` for users. Dev tests use only `node:test` + `node:assert`.
- Node ≥ 18 (built-in `fetch` not assumed; use `https`), CommonJS in `lib/` (Übersicht only requires JSX in `index.jsx`).
- Payload schema is exactly the spec's "Data payload contract"; `mock.json` must conform to it.
- Layer `status` values: `"ok" | "unavailable" | "error"`.
- Gauge colors: green `#5ba97f`, amber `#d9a557` at ≥50%, red `#d97757` at ≥80%.
- Widget default: layout `ticker`, bottom-center, refresh 60 s.
- The limits endpoint is **unofficial**: all knowledge of it stays inside `lib/limits.js`.
- Commit after every task (frequent, small commits).

---

### Task 1: Repo wipe, scaffold, rename

**Files:**
- Delete: `crypto/`, `net/`, `surf/`, `time/`, `twitch/`, `tests/`, `tests-examples/`, `node_modules/`, `surfData.json`, `package-lock.json`, `example.png`, `fr0zair-pageload-screenshot.png`, `image.png`, `.vscode/`
- Modify: `package.json`, `README.md`
- Create: `claude-usage.widget/` (empty dir placeholder via first files in Task 2), `docs/adding-a-provider.md` placeholder is NOT created here (Task 12)

**Interfaces:**
- Consumes: nothing
- Produces: clean repo named `claude-usage-widget` with dev-test tooling (`npm test` → `node --test tests/`)

- [ ] **Step 1: Confirm clean-ish state and delete old widget code**

```bash
cd /Users/thomastrudzinski/Projects/2nspired/ubersicht-mac
git rm -r --cached . -q 2>/dev/null || true   # skip — instead use plain git rm below
```

Actually run exactly:

```bash
git rm -r crypto net surf time twitch tests tests-examples surfData.json package-lock.json example.png fr0zair-pageload-screenshot.png image.png
git rm -r .vscode 2>/dev/null || rm -rf .vscode
rm -rf node_modules
```

Note: `surf/` and `surfData.json` may be untracked (check `git status`) — if untracked, use `rm -rf` instead of `git rm`.

- [ ] **Step 2: Rewrite package.json (dev tooling only)**

```json
{
  "name": "claude-usage-widget",
  "version": "0.1.0",
  "description": "Übersicht widget showing your Claude usage: cost & tokens from local Claude Code logs, plus subscription limit gauges with reset times.",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test tests/"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Stub README.md**

```markdown
# claude-usage-widget

An [Übersicht](http://tracesof.net/uebersicht/) widget that shows your Claude
usage on your desktop: today's estimated cost and tokens (from local Claude
Code logs) plus subscription limit gauges (session / weekly / Fable) with
reset countdowns.

**Status: under construction.** See `docs/superpowers/specs/` for the design.
```

- [ ] **Step 4: Verify tests runner works with no tests**

Run: `mkdir -p tests && npm test`
Expected: exits 0 (no test files is fine) or "no tests found" without error. If `node --test tests/` errors on empty dir, add `tests/.gitkeep`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: wipe legacy widgets, scaffold claude-usage-widget"
```

- [ ] **Step 6: Rename the GitHub repo**

Run: `gh repo rename claude-usage-widget --yes`
Expected: remote renamed; `git remote -v` now shows `2nspired/claude-usage-widget.git` (GitHub redirects the old URL). Local folder name may stay `ubersicht-mac`; renaming the local dir is the user's optional choice later.

---

### Task 2: Mock payload + collect.js + run.sh

**Files:**
- Create: `claude-usage.widget/lib/mock.json`
- Create: `claude-usage.widget/lib/collect.js`
- Create: `claude-usage.widget/lib/run.sh` (chmod +x)
- Create: `claude-usage.widget/config.json`
- Test: `tests/collect.test.js`

**Interfaces:**
- Consumes: nothing (logs.js / limits.js don't exist yet; collect.js guards their absence)
- Produces:
  - CLI: `node claude-usage.widget/lib/collect.js [--mock]` → prints one JSON payload to stdout
  - Payload shape (spec contract): `{ generatedAt, config, providers: { claude: { logs: {status,...}, limits: {status,...} } } }`
  - `config` object merged with defaults: `{ layout, position, refreshSeconds, showCost, showFable, mock }`
  - `run.sh`: locates node (`PATH`, `/opt/homebrew/bin`, `/usr/local/bin`) or prints `{"error":"node-missing",...}`

- [ ] **Step 1: Write failing test**

```js
// tests/collect.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const COLLECT = path.join(__dirname, "..", "claude-usage.widget", "lib", "collect.js");

test("collect --mock prints a schema-conformant payload", () => {
  const out = execFileSync(process.execPath, [COLLECT, "--mock"], { encoding: "utf8" });
  const payload = JSON.parse(out);
  assert.ok(payload.generatedAt);
  assert.equal(payload.config.layout, "ticker");
  const claude = payload.providers.claude;
  assert.equal(claude.logs.status, "ok");
  assert.ok(claude.logs.today.costUsd > 0);
  assert.ok(Array.isArray(claude.logs.week.days) && claude.logs.week.days.length === 7);
  assert.ok(Array.isArray(claude.logs.models));
  assert.equal(claude.limits.status, "ok");
  const ids = claude.limits.buckets.map((b) => b.id);
  assert.deepEqual(ids, ["session", "week_all", "week_fable"]);
  for (const b of claude.limits.buckets) {
    assert.equal(typeof b.pctUsed, "number");
    assert.ok(b.resetsAt);
  }
});

test("collect without mock degrades gracefully (no layers yet)", () => {
  const out = execFileSync(process.execPath, [COLLECT], { encoding: "utf8" });
  const payload = JSON.parse(out);
  assert.ok(["ok", "unavailable", "error"].includes(payload.providers.claude.logs.status));
  assert.ok(["ok", "unavailable", "error"].includes(payload.providers.claude.limits.status));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (collect.js does not exist)

- [ ] **Step 3: Write config.json, mock.json, collect.js, run.sh**

`claude-usage.widget/config.json`:

```json
{
  "layout": "ticker",
  "position": { "bottom": 8, "align": "center" },
  "refreshSeconds": 60,
  "showCost": true,
  "showFable": "auto",
  "mock": true
}
```

(`mock: true` is the initial default so the widget works out of the box during Phase 1; Task 8 flips it.)

`claude-usage.widget/lib/mock.json` — dates are static; the widget only formats them:

```json
{
  "providers": {
    "claude": {
      "logs": {
        "status": "ok",
        "today": { "costUsd": 4.82, "tokens": 2100000, "sessions": 14 },
        "week": {
          "costUsd": 21.4,
          "days": [
            { "date": "2026-07-13", "costUsd": 2.1, "tokens": 900000 },
            { "date": "2026-07-14", "costUsd": 3.85, "tokens": 1650000 },
            { "date": "2026-07-15", "costUsd": 2.8, "tokens": 1200000 },
            { "date": "2026-07-16", "costUsd": 5.6, "tokens": 2400000 },
            { "date": "2026-07-17", "costUsd": 1.75, "tokens": 750000 },
            { "date": "2026-07-18", "costUsd": 4.55, "tokens": 1950000 },
            { "date": "2026-07-19", "costUsd": 4.82, "tokens": 2100000 }
          ]
        },
        "models": [
          { "model": "claude-fable-5", "tokens": 1600000, "costUsd": 3.9 },
          { "model": "claude-haiku-4-5", "tokens": 500000, "costUsd": 0.92 }
        ]
      },
      "limits": {
        "status": "ok",
        "buckets": [
          { "id": "session", "label": "Session", "pctUsed": 22, "resetsAt": "2026-07-19T16:30:00-07:00" },
          { "id": "week_all", "label": "Week", "pctUsed": 13, "resetsAt": "2026-07-20T18:00:00-07:00" },
          { "id": "week_fable", "label": "Fable", "pctUsed": 24, "resetsAt": "2026-07-20T18:00:00-07:00" }
        ]
      }
    }
  }
}
```

`claude-usage.widget/lib/collect.js`:

```js
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  layout: "ticker",
  position: { bottom: 8, align: "center" },
  refreshSeconds: 60,
  showCost: true,
  showFable: "auto",
  mock: false,
};

function readConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

async function layer(loader) {
  try {
    return await loader();
  } catch (err) {
    return { status: "error", message: String(err && err.message ? err.message : err) };
  }
}

async function main() {
  const config = readConfig();
  const useMock = config.mock || process.argv.includes("--mock");
  let providers;

  if (useMock) {
    providers = JSON.parse(fs.readFileSync(path.join(__dirname, "mock.json"), "utf8")).providers;
  } else {
    const logs = await layer(() => {
      const { collectLogs } = require("./logs");
      return collectLogs();
    });
    const limits = await layer(() => {
      const { collectLimits } = require("./limits");
      return collectLimits();
    });
    providers = { claude: { logs, limits } };
  }

  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), config, providers })
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: "collect-failed", message: String(err) }));
  process.exitCode = 0; // never crash the widget
});
```

Note: while `logs.js` / `limits.js` don't exist, `require` throws → `layer()` returns `status: "error"` with a MODULE_NOT_FOUND message. That satisfies the degradation test; Tasks 8/10 replace it with real data.

`claude-usage.widget/lib/run.sh`:

```bash
#!/bin/bash
# Übersicht runs commands with a minimal PATH; find node in the usual homes.
DIR="$(cd "$(dirname "$0")" && pwd)"
for NODE in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$NODE" >/dev/null 2>&1; then
    exec "$NODE" "$DIR/collect.js" "$@"
  fi
done
echo '{"error":"node-missing","message":"claude-usage-widget needs Node.js — install from https://nodejs.org or brew install node"}'
```

Run: `chmod +x claude-usage.widget/lib/run.sh`

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: 2 pass. Also spot-check: `./claude-usage.widget/lib/run.sh --mock | head -c 200` prints JSON.

- [ ] **Step 5: Commit**

```bash
git add claude-usage.widget tests/collect.test.js
git commit -m "feat: collect.js with mock payload layer and node-locating run.sh"
```

---

### Task 3: index.jsx — ticker layout (A1) on mock data

**Files:**
- Create: `claude-usage.widget/index.jsx`

**Interfaces:**
- Consumes: `run.sh` stdout payload (Task 2): `payload.config.layout`, `payload.providers.claude.logs`, `.limits`, or `{error, message}`
- Produces: Übersicht exports `command`, `refreshFrequency`, `className`, `render({output})`; helper fns reused by later layouts: `fmtCost(n)`, `fmtTokens(n)`, `fmtReset(iso, now)`, `barColor(pct)`, `Gauge({label, pctUsed, resetsAt})`

- [ ] **Step 1: Write index.jsx**

```jsx
import { css } from "uebersicht";

export const command = "claude-usage.widget/lib/run.sh";
// Übersicht requires a static export; keep in sync with config.json refreshSeconds.
export const refreshFrequency = 60000;

export const className = `
  bottom: 8px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
`;

const GREEN = "#5ba97f", AMBER = "#d9a557", RED = "#d97757";

const pill = css`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 20px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92));
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  color: #e8eaf0;
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
`;

const sub = css` color: #9aa0b0; `;
const strong = css` color: #e8eaf0; font-weight: 600; `;
const divider = css` width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.1); `;
const barOuter = css`
  display: inline-block;
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  vertical-align: middle;
  margin: 0 5px 1px 6px;
  overflow: hidden;
`;

export const barColor = (pct) => (pct >= 80 ? RED : pct >= 50 ? AMBER : GREEN);
export const fmtCost = (n) => `$${n.toFixed(2)}`;
export const fmtTokens = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`;

export const fmtReset = (iso, now = new Date()) => {
  if (!iso) return "";
  const t = new Date(iso), ms = t - now;
  if (ms <= 0) return "now";
  if (ms < 24 * 3600e3) {
    const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  const day = t.toLocaleDateString(undefined, { weekday: "short" });
  const hr = t.toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase();
  return `${day} ${hr}`;
};

const Gauge = ({ label, pctUsed, resetsAt }) => (
  <span className={sub}>
    {label} <span className={strong}>{pctUsed}%</span>
    <span className={barOuter}>
      <span
        style={{
          display: "block", height: "100%", borderRadius: 2,
          width: `${Math.min(pctUsed, 100)}%`, background: barColor(pctUsed),
        }}
      />
    </span>
    {fmtReset(resetsAt)}
  </span>
);

const Ticker = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill}>
      <span className={strong}>✳</span>
      {logs.status === "ok" && (
        <span className={sub}>
          {config.showCost && <span className={strong}>{fmtCost(logs.today.costUsd)} </span>}
          · {fmtTokens(logs.today.tokens)}
        </span>
      )}
      {logs.status === "ok" && buckets.length > 0 && <span className={divider} />}
      {buckets.map((b) => (
        <Gauge key={b.id} label={b.label} pctUsed={b.pctUsed} resetsAt={b.resetsAt} />
      ))}
      {logs.status !== "ok" && limits.status !== "ok" && (
        <span className={sub}>claude-usage: no data ({logs.status}/{limits.status})</span>
      )}
    </div>
  );
};

export const render = ({ output }) => {
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    return <div className={pill}><span className={sub}>claude-usage: loading…</span></div>;
  }
  if (payload.error === "node-missing")
    return <div className={pill}><span className={sub}>{payload.message}</span></div>;
  if (payload.error)
    return <div className={pill}><span className={sub}>claude-usage error: {payload.message}</span></div>;

  const { config } = payload;
  const { logs, limits } = payload.providers.claude;
  // layout dispatch — more layouts added in Tasks 4 and 11
  return <Ticker logs={logs} limits={limits} config={config} />;
};
```

- [ ] **Step 2: Install into Übersicht via symlink and verify visually**

```bash
ln -sfn "$PWD/claude-usage.widget" "$HOME/Library/Application Support/Übersicht/widgets/claude-usage.widget"
open -a "Übersicht" 2>/dev/null || true
```

Expected: bottom-center pill appears with mock data: `✳ $4.82 · 2.1M │ Session 22% [bar] <countdown or "now"> │ Week 13% … │ Fable 24% …`. (Mock reset dates are in the past relative to run date → they render "now"; that's fine for mock.) If Übersicht isn't installed: `brew install --cask ubersicht`. **This step requires the user to look at the screen — pause and ask.**

- [ ] **Step 3: Commit**

```bash
git add claude-usage.widget/index.jsx
git commit -m "feat: ticker (A1) layout rendering mock payload in Übersicht"
```

---

### Task 4: ticker-2line layout (A2)

**Files:**
- Modify: `claude-usage.widget/index.jsx`

**Interfaces:**
- Consumes: same payload; `Gauge`, `fmtCost`, `fmtTokens`, `fmtReset`, styles from Task 3
- Produces: `layout: "ticker-2line"` renders two-row pill; dispatch map `LAYOUTS = { ticker, "ticker-2line" }`

- [ ] **Step 1: Add the layout and dispatch**

In `index.jsx`, add below `Ticker`:

```jsx
const label = css`
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #8b90a0;
`;

const Ticker2Line = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 7, borderRadius: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span className={strong}>✳</span>
        {logs.status === "ok" && (
          <span className={sub}>
            Today {config.showCost && <span className={strong}>{fmtCost(logs.today.costUsd)}</span>} ·{" "}
            {fmtTokens(logs.today.tokens)} tok · {logs.today.sessions} sessions
          </span>
        )}
        {logs.status === "ok" && config.showCost && (
          <span className={sub}>7d <span className={strong}>{fmtCost(logs.week.costUsd)}</span></span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {buckets.map((b) => (
          <span key={b.id} className={sub}>
            <span className={label}>{b.label}</span> <span className={strong}>{b.pctUsed}%</span>
            <span className={barOuter} style={{ width: 64 }}>
              <span style={{ display: "block", height: "100%", borderRadius: 2,
                width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
            </span>
            {fmtReset(b.resetsAt)}
          </span>
        ))}
      </div>
    </div>
  );
};
```

Replace the final return in `render` with:

```jsx
  const LAYOUTS = { ticker: Ticker, "ticker-2line": Ticker2Line };
  const Layout = LAYOUTS[config.layout] || Ticker;
  return <Layout logs={logs} limits={limits} config={config} />;
```

- [ ] **Step 2: Verify visually**

Set `"layout": "ticker-2line"` in `config.json`, wait for refresh (or touch `index.jsx`). Expected: two-line pill. Set back to `"ticker"` after checking. **Pause for user confirmation.**

- [ ] **Step 3: Commit**

```bash
git add claude-usage.widget/index.jsx
git commit -m "feat: ticker-2line (A2) layout with layout dispatch"
```

---

### Task 5: logs.js — JSONL parsing and per-file summaries

**Files:**
- Create: `claude-usage.widget/lib/logs.js`
- Create: `tests/fixtures/session-a.jsonl`, `tests/fixtures/session-b.jsonl`
- Test: `tests/logs.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (exported from `logs.js`):
  - `parseLine(line: string) -> {ts: Date, model: string, input, output, cacheRead, cacheWrite5m, cacheWrite1h} | null`
  - `summarizeFile(filePath: string) -> { days: { "YYYY-MM-DD": { models: { [model]: {input, output, cacheRead, cacheWrite5m, cacheWrite1h} } } } }` (day key = **local** date of entry)
  - `findProjectDirs(home?: string) -> string[]` (every `~/.claude*/projects` that exists)
  - `listJsonlFiles(projectsDir: string) -> string[]`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/session-a.jsonl` (note line 3 is malformed on purpose, line 4 has no usage):

```
{"timestamp":"2026-07-19T10:00:00.000Z","message":{"model":"claude-fable-5","usage":{"input_tokens":100,"output_tokens":200,"cache_read_input_tokens":1000,"cache_creation_input_tokens":500,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":500}}}}
{"timestamp":"2026-07-19T11:00:00.000Z","message":{"model":"claude-haiku-4-5","usage":{"input_tokens":50,"output_tokens":80,"cache_read_input_tokens":0,"cache_creation_input_tokens":300}}}
{not json at all
{"timestamp":"2026-07-19T11:05:00.000Z","type":"user","message":{"role":"user"}}
{"timestamp":"2026-07-18T09:00:00.000Z","message":{"model":"claude-fable-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
```

`tests/fixtures/session-b.jsonl`:

```
{"timestamp":"2026-07-19T12:00:00.000Z","message":{"model":"claude-fable-5","usage":{"input_tokens":5,"output_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}
```

- [ ] **Step 2: Write failing tests**

```js
// tests/logs.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { parseLine, summarizeFile } = require("../claude-usage.widget/lib/logs");

const FIX = (f) => path.join(__dirname, "fixtures", f);

test("parseLine extracts usage; cache_creation split wins over legacy field", () => {
  const line = JSON.stringify({
    timestamp: "2026-07-19T10:00:00.000Z",
    message: { model: "claude-fable-5", usage: {
      input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3,
      cache_creation_input_tokens: 500,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 400 },
    }},
  });
  const e = parseLine(line);
  assert.equal(e.model, "claude-fable-5");
  assert.equal(e.cacheWrite5m, 100);
  assert.equal(e.cacheWrite1h, 400);
});

test("parseLine without cache_creation treats legacy total as 5m", () => {
  const line = JSON.stringify({
    timestamp: "2026-07-19T10:00:00.000Z",
    message: { model: "m", usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 300 } },
  });
  const e = parseLine(line);
  assert.equal(e.cacheWrite5m, 300);
  assert.equal(e.cacheWrite1h, 0);
});

test("parseLine returns null for malformed or non-usage lines", () => {
  assert.equal(parseLine("{not json"), null);
  assert.equal(parseLine(JSON.stringify({ timestamp: "2026-07-19T00:00:00Z", message: { role: "user" } })), null);
});

test("summarizeFile groups by local day and model, skipping bad lines", () => {
  const s = summarizeFile(FIX("session-a.jsonl"));
  const day19 = Object.keys(s.days).find((d) => d.endsWith("-19") || d.endsWith("-18"));
  assert.ok(day19, "has at least one day bucket");
  const allModels = Object.values(s.days).flatMap((d) => Object.keys(d.models));
  assert.ok(allModels.includes("claude-fable-5"));
  assert.ok(allModels.includes("claude-haiku-4-5"));
  const fableTotals = Object.values(s.days)
    .map((d) => d.models["claude-fable-5"])
    .filter(Boolean)
    .reduce((a, m) => a + m.input, 0);
  assert.equal(fableTotals, 110); // 100 (day 19 UTC) + 10 (day 18 UTC)
});
```

- [ ] **Step 3: Run tests to verify fail**

Run: `npm test`
Expected: FAIL (`logs.js` not found)

- [ ] **Step 4: Implement logs.js (parsing half)**

```js
// claude-usage.widget/lib/logs.js
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

function parseLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return null; }
  const u = obj && obj.message && obj.message.usage;
  if (!u || !obj.timestamp) return null;
  const split = u.cache_creation || null;
  return {
    ts: new Date(obj.timestamp),
    model: obj.message.model || "unknown",
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite5m: split ? split.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
    cacheWrite1h: split ? split.ephemeral_1h_input_tokens || 0 : 0,
  };
}

function localDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ZERO = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });

function summarizeFile(filePath) {
  const days = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const e = parseLine(line);
    if (!e || isNaN(e.ts)) continue;
    const key = localDayKey(e.ts);
    const day = (days[key] = days[key] || { models: {} });
    const m = (day.models[e.model] = day.models[e.model] || ZERO());
    m.input += e.input;
    m.output += e.output;
    m.cacheRead += e.cacheRead;
    m.cacheWrite5m += e.cacheWrite5m;
    m.cacheWrite1h += e.cacheWrite1h;
  }
  return { days };
}

function findProjectDirs(home = os.homedir()) {
  let entries;
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isDirectory() && d.name.startsWith(".claude"))
    .map((d) => path.join(home, d.name, "projects"))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

function listJsonlFiles(projectsDir) {
  const out = [];
  let projects;
  try { projects = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return out; }
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    const dir = path.join(projectsDir, proj.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) if (f.endsWith(".jsonl")) out.push(path.join(dir, f));
  }
  return out;
}

module.exports = { parseLine, summarizeFile, findProjectDirs, listJsonlFiles, localDayKey, ZERO };
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: all pass. (Fixture day assertions use flexible keys because local-day grouping depends on the machine's timezone — that's intentional.)

- [ ] **Step 6: Commit**

```bash
git add claude-usage.widget/lib/logs.js tests/fixtures tests/logs.test.js
git commit -m "feat: JSONL parsing and per-file daily summaries"
```

---

### Task 6: pricing + logs section builder

**Files:**
- Create: `claude-usage.widget/lib/pricing.json`
- Modify: `claude-usage.widget/lib/logs.js`
- Test: `tests/pricing.test.js`

**Interfaces:**
- Consumes: `summarizeFile` day/model sums shape (Task 5)
- Produces:
  - `pricing.json`: `{ [modelId]: { input, output, cacheRead, cacheWrite5m, cacheWrite1h } }` — **$ per million tokens**
  - `costUsd(model, sums, pricing) -> number | null` (null when model unknown)
  - `buildLogsSection(fileSummaries: Array<{days}>, now: Date, pricing) -> logs payload section` (spec shape: `{status:"ok", today, week:{costUsd, days[7]}, models}`; `models` = today's per-model split sorted desc by tokens; `sessions` = count of fileSummaries with a today bucket; unknown-model cost contributes 0 and sets no flag — cost is "estimated")

- [ ] **Step 1: Write pricing.json**

```json
{
  "claude-fable-5": { "input": 10, "output": 50, "cacheRead": 1, "cacheWrite5m": 12.5, "cacheWrite1h": 20 },
  "claude-opus-4-8": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite5m": 6.25, "cacheWrite1h": 10 },
  "claude-opus-4-7": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite5m": 6.25, "cacheWrite1h": 10 },
  "claude-opus-4-6": { "input": 5, "output": 25, "cacheRead": 0.5, "cacheWrite5m": 6.25, "cacheWrite1h": 10 },
  "claude-sonnet-5": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite5m": 3.75, "cacheWrite1h": 6 },
  "claude-sonnet-4-6": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite5m": 3.75, "cacheWrite1h": 6 },
  "claude-haiku-4-5": { "input": 1, "output": 5, "cacheRead": 0.1, "cacheWrite5m": 1.25, "cacheWrite1h": 2 }
}
```

- [ ] **Step 2: Write failing tests**

```js
// tests/pricing.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { costUsd, buildLogsSection, localDayKey } = require("../claude-usage.widget/lib/logs");
const pricing = require("../claude-usage.widget/lib/pricing.json");

test("costUsd prices each token class per MTok", () => {
  const sums = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite5m: 0, cacheWrite1h: 1e6 };
  // fable: 10 + 50 + 1 + 20 = 81
  assert.equal(costUsd("claude-fable-5", sums, pricing), 81);
});

test("costUsd returns null for unknown models", () => {
  assert.equal(costUsd("mystery-model", { input: 1e6, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }, pricing), null);
});

test("buildLogsSection aggregates today, week, models, sessions", () => {
  const now = new Date("2026-07-19T15:00:00");
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date("2026-07-18T15:00:00"));
  const mk = (input) => ({ input, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
  const fileA = { days: { [today]: { models: { "claude-fable-5": mk(1e6) } }, [yesterday]: { models: { "claude-fable-5": mk(2e6) } } } };
  const fileB = { days: { [yesterday]: { models: { "claude-haiku-4-5": mk(1e6) } } } };
  const s = buildLogsSection([fileA, fileB], now, pricing);
  assert.equal(s.status, "ok");
  assert.equal(s.today.tokens, 1e6);
  assert.equal(s.today.costUsd, 10);
  assert.equal(s.today.sessions, 1); // only fileA has activity today
  assert.equal(s.week.days.length, 7);
  assert.equal(s.week.days[6].date, today);
  assert.equal(s.week.costUsd, 10 + 20 + 1); // today fable 10 + yest fable 20 + yest haiku 1
  assert.deepEqual(s.models.map((m) => m.model), ["claude-fable-5"]); // today only
});
```

- [ ] **Step 3: Run tests to verify fail**

Run: `npm test` — Expected: FAIL (`costUsd` not exported)

- [ ] **Step 4: Implement in logs.js**

Append to `logs.js` (before `module.exports`) and extend exports:

```js
function costUsd(model, sums, pricing) {
  const r = pricing[model];
  if (!r) return null;
  return (
    (sums.input * r.input +
      sums.output * r.output +
      sums.cacheRead * r.cacheRead +
      sums.cacheWrite5m * r.cacheWrite5m +
      sums.cacheWrite1h * r.cacheWrite1h) / 1e6
  );
}

const totalTokens = (s) => s.input + s.output + s.cacheRead + s.cacheWrite5m + s.cacheWrite1h;

function buildLogsSection(fileSummaries, now, pricing) {
  const dayKeys = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dayKeys.push(localDayKey(d));
  }
  const todayKey = dayKeys[6];

  const perDay = {}; // key -> {tokens, costUsd}
  const todayModels = {}; // model -> {tokens, costUsd}
  let sessions = 0;

  for (const file of fileSummaries) {
    if (file.days[todayKey]) sessions++;
    for (const [dayKey, day] of Object.entries(file.days)) {
      if (!dayKeys.includes(dayKey)) continue;
      const slot = (perDay[dayKey] = perDay[dayKey] || { tokens: 0, costUsd: 0 });
      for (const [model, sums] of Object.entries(day.models)) {
        slot.tokens += totalTokens(sums);
        slot.costUsd += costUsd(model, sums, pricing) || 0;
        if (dayKey === todayKey) {
          const tm = (todayModels[model] = todayModels[model] || { tokens: 0, costUsd: 0 });
          tm.tokens += totalTokens(sums);
          tm.costUsd += costUsd(model, sums, pricing) || 0;
        }
      }
    }
  }

  const days = dayKeys.map((date) => ({
    date,
    costUsd: round2((perDay[date] || {}).costUsd || 0),
    tokens: (perDay[date] || {}).tokens || 0,
  }));
  const today = days[6];

  return {
    status: "ok",
    today: { costUsd: today.costUsd, tokens: today.tokens, sessions },
    week: { costUsd: round2(days.reduce((a, d) => a + d.costUsd, 0)), days },
    models: Object.entries(todayModels)
      .map(([model, v]) => ({ model, tokens: v.tokens, costUsd: round2(v.costUsd) }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
```

Add `costUsd, buildLogsSection, totalTokens` to `module.exports`.

- [ ] **Step 5: Run tests to verify pass** — `npm test` → all pass

- [ ] **Step 6: Commit**

```bash
git add claude-usage.widget/lib/pricing.json claude-usage.widget/lib/logs.js tests/pricing.test.js
git commit -m "feat: pricing table and logs payload aggregation"
```

---

### Task 7: mtime-keyed daily cache + collectLogs()

**Files:**
- Modify: `claude-usage.widget/lib/logs.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: `summarizeFile`, `findProjectDirs`, `listJsonlFiles`, `buildLogsSection` (Tasks 5–6)
- Produces:
  - `summarizeFileCached(filePath, cache) -> summary` — `cache` is a plain object `{ [filePath]: { mtimeMs, summary } }`; files whose mtime is **before today's local midnight** and unchanged are served from cache; files modified today are always re-read (and not cached)
  - `collectLogs(opts?: {home, cachePath, now}) -> logs section` — orchestrates: load cache JSON (default `~/.cache/claude-usage-widget/daily.json`), scan all project dirs, build section, save cache, return section; returns `{status:"unavailable", message:"no claude logs found"}` when no files
- [ ] **Step 1: Write failing tests**

```js
// tests/cache.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { summarizeFileCached, collectLogs } = require("../claude-usage.widget/lib/logs");

function tmpFile(content, mtime) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cuw-")), "s.jsonl");
  fs.writeFileSync(p, content);
  if (mtime) fs.utimesSync(p, mtime, mtime);
  return p;
}

const LINE = JSON.stringify({
  timestamp: "2026-01-01T10:00:00.000Z",
  message: { model: "claude-haiku-4-5", usage: { input_tokens: 7, output_tokens: 0 } },
}) + "\n";

test("summarizeFileCached caches old files by mtime and skips re-read", () => {
  const old = new Date(Date.now() - 3 * 86400e3);
  const p = tmpFile(LINE, old);
  const cache = {};
  const s1 = summarizeFileCached(p, cache);
  assert.ok(cache[p], "cached");
  // mutate the file CONTENT but keep the old mtime — cache should win
  fs.writeFileSync(p, "");
  fs.utimesSync(p, old, old);
  const s2 = summarizeFileCached(p, cache);
  assert.deepEqual(s2, s1);
});

test("summarizeFileCached re-reads files modified today", () => {
  const p = tmpFile(LINE); // mtime = now = today
  const cache = {};
  summarizeFileCached(p, cache);
  assert.equal(cache[p], undefined, "today's files are not cached");
});

test("collectLogs returns unavailable when no dirs exist", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-home-"));
  const s = await collectLogs({ home, cachePath: path.join(home, "cache.json") });
  assert.equal(s.status, "unavailable");
});

test("collectLogs aggregates a fake home tree", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cuw-home-"));
  const dir = path.join(home, ".claude", "projects", "proj-x");
  fs.mkdirSync(dir, { recursive: true });
  const nowLine = JSON.stringify({
    timestamp: new Date().toISOString(),
    message: { model: "claude-haiku-4-5", usage: { input_tokens: 1000000, output_tokens: 0 } },
  }) + "\n";
  fs.writeFileSync(path.join(dir, "a.jsonl"), nowLine);
  const s = await collectLogs({ home, cachePath: path.join(home, "cache.json") });
  assert.equal(s.status, "ok");
  assert.equal(s.today.tokens, 1000000);
  assert.equal(s.today.costUsd, 1); // haiku input $1/MTok
  assert.equal(s.today.sessions, 1);
});
```

- [ ] **Step 2: Run tests to verify fail** — `npm test` → FAIL (not exported)

- [ ] **Step 3: Implement in logs.js**

```js
const PRICING = require("./pricing.json");

function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function summarizeFileCached(filePath, cache, now = new Date()) {
  const mtimeMs = fs.statSync(filePath).mtimeMs;
  const cached = cache[filePath];
  if (cached && cached.mtimeMs === mtimeMs) return cached.summary;
  const summary = summarizeFile(filePath);
  if (mtimeMs < startOfToday(now)) cache[filePath] = { mtimeMs, summary };
  return summary;
}

async function collectLogs(opts = {}) {
  const home = opts.home || os.homedir();
  const now = opts.now || new Date();
  const cachePath =
    opts.cachePath || path.join(home, ".cache", "claude-usage-widget", "daily.json");

  const dirs = findProjectDirs(home);
  const files = dirs.flatMap(listJsonlFiles);
  if (files.length === 0) return { status: "unavailable", message: "no claude logs found" };

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch {}

  const summaries = [];
  for (const f of files) {
    try { summaries.push(summarizeFileCached(f, cache, now)); } catch {}
  }

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  } catch {}

  return buildLogsSection(summaries, now, PRICING);
}
```

Add `summarizeFileCached, collectLogs` to `module.exports`.

- [ ] **Step 4: Run tests to verify pass** — `npm test` → all pass

- [ ] **Step 5: Integration check against real logs on this machine**

Run: `node -e 'require("./claude-usage.widget/lib/logs").collectLogs().then(s => console.log(JSON.stringify(s, null, 2)))' | head -40`
Expected: `status: "ok"` with plausible real numbers (non-zero today tokens if Claude Code ran today).

- [ ] **Step 6: Commit**

```bash
git add claude-usage.widget/lib/logs.js tests/cache.test.js
git commit -m "feat: mtime-keyed daily cache and collectLogs orchestration"
```

---

### Task 8: Wire logs layer into the live widget

**Files:**
- Modify: `claude-usage.widget/config.json` (`"mock": false`)

**Interfaces:**
- Consumes: `collectLogs` (Task 7), collect.js layer guard (Task 2)
- Produces: live widget shows real cost/tokens; limits section shows `status:"error"` (module missing) which the ticker already hides gracefully

- [ ] **Step 1: Flip mock off**

In `claude-usage.widget/config.json` set `"mock": false`.

- [ ] **Step 2: Verify CLI output**

Run: `./claude-usage.widget/lib/run.sh | python3 -m json.tool | head -30`
Expected: real `logs` section (`status: "ok"`), `limits.status: "error"` (limits.js doesn't exist yet).

- [ ] **Step 3: Verify on screen**

Übersicht refreshes within 60 s. Expected: ticker shows real `$ · tokens` and **no gauges** (limits unavailable → hidden). **Pause for user confirmation.**

- [ ] **Step 4: Commit**

```bash
git add claude-usage.widget/config.json
git commit -m "feat: live local-log usage in the widget (mock off)"
```

---

### Task 9: limits.js — credentials + endpoint fetch + response fixture

**Files:**
- Create: `claude-usage.widget/lib/limits.js`
- Create: `tests/fixtures/usage-response.json` (captured in Step 3)

**Interfaces:**
- Consumes: nothing
- Produces (exported from `limits.js`):
  - `readAccessToken() -> string | null` — tries macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w`), then `~/.claude*/.credentials.json` files; parses `{claudeAiOauth:{accessToken}}`
  - `fetchUsageRaw(token) -> Promise<object>` — GET `https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer` + `anthropic-beta: oauth-2025-04-20`
  - `normalizeBuckets(raw) -> Array<{id,label,pctUsed,resetsAt}>` (Task 10 implements; declared here)
  - `collectLimits() -> Promise<limits section>`

- [ ] **Step 1: Implement credential + fetch half**

```js
// claude-usage.widget/lib/limits.js
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

function readAccessToken(home = os.homedir()) {
  // 1. macOS Keychain (Claude Code's storage on macOS)
  try {
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const token = extractToken(raw);
    if (token) return token;
  } catch {}
  // 2. File-based fallback (older versions / non-default setups)
  for (const dir of fs.readdirSync(home).filter((n) => n.startsWith(".claude"))) {
    try {
      const raw = fs.readFileSync(path.join(home, dir, ".credentials.json"), "utf8");
      const token = extractToken(raw);
      if (token) return token;
    } catch {}
  }
  return null;
}

function extractToken(raw) {
  try {
    const creds = JSON.parse(raw);
    return (creds.claudeAiOauth && creds.claudeAiOauth.accessToken) || null;
  } catch { return null; }
}

function fetchUsageRaw(token) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-usage-widget",
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error(`usage endpoint HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("usage endpoint timeout")));
    req.on("error", reject);
  });
}

module.exports = { readAccessToken, fetchUsageRaw, extractToken };
```

- [ ] **Step 2: Verify token retrieval on this machine**

Run: `node -e 'const {readAccessToken}=require("./claude-usage.widget/lib/limits"); console.log(readAccessToken() ? "token found" : "NO TOKEN")'`
Expected: `token found` (first run may show a macOS Keychain prompt — click **Always Allow**). If `NO TOKEN`: inspect `security find-generic-password -s "Claude Code-credentials"` (without `-w`) — if the service name differs on this machine, adjust the constant and note it in the README.

- [ ] **Step 3: Capture a real response as fixture (discovery step — shape is unofficial)**

Run:

```bash
node -e '
const l = require("./claude-usage.widget/lib/limits");
l.fetchUsageRaw(l.readAccessToken()).then(r => console.log(JSON.stringify(r, null, 2)))
' > tests/fixtures/usage-response.json
cat tests/fixtures/usage-response.json
```

Expected: JSON containing session + weekly buckets with utilization/reset fields (names may differ from assumptions — e.g. `five_hour`, `seven_day`, `seven_day_fable`, or a `buckets` array). **Review the file: it must contain only utilization data — no tokens/secrets — before committing.** If the endpoint 404s, try the fallback path `https://api.anthropic.com/api/oauth/usage` vs `.../api/claude_code/usage` — record what works in a code comment. Task 10's normalization is written against THIS captured fixture, adapting key names to reality.

- [ ] **Step 4: Commit**

```bash
git add claude-usage.widget/lib/limits.js tests/fixtures/usage-response.json
git commit -m "feat: limits credentials + usage endpoint fetch with captured fixture"
```

---

### Task 10: normalizeBuckets + collectLimits + live gauges

**Files:**
- Modify: `claude-usage.widget/lib/limits.js`
- Test: `tests/limits.test.js`

**Interfaces:**
- Consumes: `tests/fixtures/usage-response.json` (Task 9 — **adapt field names below to the captured reality**), `readAccessToken`, `fetchUsageRaw`
- Produces:
  - `normalizeBuckets(raw) -> [{id:"session"|"week_all"|<other>, label, pctUsed:int, resetsAt:string|null}]` — session first, then week_all, then model buckets; unknown extra buckets pass through with a capitalized label
  - `collectLimits() -> {status:"ok", buckets} | {status:"unavailable", message}` — no token → `unavailable`; fetch/normalize errors propagate to collect.js's `layer()` guard → `error`

- [ ] **Step 1: Write failing tests against the captured fixture**

```js
// tests/limits.test.js — ADAPT field names to tests/fixtures/usage-response.json
const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeBuckets } = require("../claude-usage.widget/lib/limits");
const fixture = require("./fixtures/usage-response.json");

test("normalizeBuckets maps the real captured response", () => {
  const buckets = normalizeBuckets(fixture);
  assert.ok(buckets.length >= 2, "at least session + weekly");
  assert.equal(buckets[0].id, "session");
  const week = buckets.find((b) => b.id === "week_all");
  assert.ok(week);
  for (const b of buckets) {
    assert.ok(Number.isInteger(b.pctUsed) && b.pctUsed >= 0 && b.pctUsed <= 100);
    assert.ok("resetsAt" in b);
  }
});

test("normalizeBuckets includes a fable bucket when present", () => {
  const fable = normalizeBuckets(fixture).find((b) => /fable/i.test(b.id) || /fable/i.test(b.label));
  assert.ok(fable, "this account has a Fable bucket (per console screenshot)");
});

test("normalizeBuckets tolerates missing sections", () => {
  assert.deepEqual(normalizeBuckets({}), []);
});
```

- [ ] **Step 2: Run tests to verify fail** — `npm test` → FAIL (`normalizeBuckets` not exported)

- [ ] **Step 3: Implement (baseline for the assumed shape; adapt to fixture)**

```js
function pctOf(bucket) {
  if (typeof bucket.utilization === "number") return Math.round(bucket.utilization);
  if (typeof bucket.used_percent === "number") return Math.round(bucket.used_percent);
  return null;
}

function normalizeBuckets(raw) {
  if (!raw || typeof raw !== "object") return [];
  const out = [];
  const push = (id, label, b) => {
    if (!b || typeof b !== "object") return;
    const pct = pctOf(b);
    if (pct === null) return;
    out.push({ id, label, pctUsed: pct, resetsAt: b.resets_at || b.resetsAt || null });
  };
  push("session", "Session", raw.five_hour);
  push("week_all", "Week", raw.seven_day);
  for (const [key, val] of Object.entries(raw)) {
    if (key === "five_hour" || key === "seven_day") continue;
    if (!key.startsWith("seven_day_")) continue;
    const name = key.slice("seven_day_".length);
    push(key, name.charAt(0).toUpperCase() + name.slice(1), val);
  }
  return out;
}

async function collectLimits() {
  const token = readAccessToken();
  if (!token) return { status: "unavailable", message: "no Claude Code credentials" };
  const raw = await fetchUsageRaw(token);
  const buckets = normalizeBuckets(raw);
  if (buckets.length === 0) return { status: "unavailable", message: "unrecognized usage response" };
  return { status: "ok", buckets };
}
```

Add `normalizeBuckets, collectLimits` to `module.exports`. **If the captured fixture uses different key names, rewrite the `push(...)` mapping accordingly — the tests against the fixture are the source of truth.**

- [ ] **Step 4: Run tests to verify pass** — `npm test` → all pass

- [ ] **Step 5: Verify live end-to-end**

Run: `./claude-usage.widget/lib/run.sh | python3 -m json.tool`
Expected: `limits.status: "ok"` with session/week/fable buckets matching the Claude console numbers. On screen within 60 s: full ticker with real gauges. **Pause for user confirmation — compare against `/usage` output.**

- [ ] **Step 6: Commit**

```bash
git add claude-usage.widget/lib/limits.js tests/limits.test.js
git commit -m "feat: live limit gauges from usage endpoint with normalization tests"
```

---

### Task 11: bar and corner layouts

**Files:**
- Modify: `claude-usage.widget/index.jsx`

**Interfaces:**
- Consumes: payload + helpers (`fmtCost`, `fmtTokens`, `fmtReset`, `barColor`, `Gauge`, `label` style)
- Produces: `layout: "bar"` (sectioned bar: today · 7-day sparkline · model split · gauges) and `layout: "corner"` (bottom-right card, sparkline + stacked full-width gauges); LAYOUTS map gains both; `className` positioning honors `config.position.align` = `"center" | "right"` via payload (bar/ticker centered; corner uses right-align inside the flex row)

- [ ] **Step 1: Add Sparkline helper + Bar layout + Corner layout**

```jsx
const Sparkline = ({ days, width = 7 * 9 }) => {
  const max = Math.max(...days.map((d) => d.tokens), 1);
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, height: 22, width }}>
      {days.map((d) => (
        <span key={d.date} style={{
          flex: 1, borderRadius: "1.5px 1.5px 0 0",
          background: "rgba(217,119,87,0.75)",
          height: `${Math.max(8, (d.tokens / max) * 100)}%`,
        }} />
      ))}
    </span>
  );
};

const BarLayout = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill} style={{ borderRadius: 14, gap: 0 }}>
      {logs.status === "ok" && (
        <>
          <span>
            <div className={label}>Today</div>
            <span className={strong} style={{ fontSize: 16 }}>{config.showCost ? fmtCost(logs.today.costUsd) : fmtTokens(logs.today.tokens)}</span>{" "}
            <span className={sub}>{fmtTokens(logs.today.tokens)} tok · {logs.today.sessions} sess</span>
          </span>
          <span className={divider} style={{ margin: "0 16px" }} />
          <span>
            <div className={label}>7-day{config.showCost ? ` · ${fmtCost(logs.week.costUsd)}` : ""}</div>
            <Sparkline days={logs.week.days} />
          </span>
          <span className={divider} style={{ margin: "0 16px" }} />
          <span>
            <div className={label}>Models</div>
            <span className={sub}>
              {logs.models.slice(0, 2).map((m, i) => {
                const total = logs.models.reduce((a, x) => a + x.tokens, 0) || 1;
                return (
                  <span key={m.model}>{i > 0 && " · "}{m.model.replace("claude-", "")}{" "}
                    <span className={strong}>{Math.round((m.tokens / total) * 100)}%</span>
                  </span>
                );
              })}
            </span>
          </span>
          {buckets.length > 0 && <span className={divider} style={{ margin: "0 16px" }} />}
        </>
      )}
      <span style={{ display: "flex", gap: 14 }}>
        {buckets.map((b) => (
          <span key={b.id}>
            <div className={label}>{b.label} · {fmtReset(b.resetsAt)}</div>
            <span className={barOuter} style={{ width: 90, margin: 0 }}>
              <span style={{ display: "block", height: "100%", borderRadius: 2,
                width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
            </span>
          </span>
        ))}
      </span>
    </div>
  );
};

const CornerCard = ({ logs, limits, config }) => {
  const buckets = (limits.status === "ok" ? limits.buckets : []).filter(
    (b) => config.showFable !== false || b.id !== "week_fable"
  );
  return (
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 6, borderRadius: 14, width: 210, padding: "12px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className={label}>Claude · Today</span>
        <span className={sub}>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
      {logs.status === "ok" && (
        <>
          <div>
            {config.showCost && <span className={strong} style={{ fontSize: 20 }}>{fmtCost(logs.today.costUsd)} </span>}
            <span className={sub}>{fmtTokens(logs.today.tokens)} tok</span>
          </div>
          <Sparkline days={logs.week.days} width={178} />
        </>
      )}
      {buckets.map((b) => (
        <div key={b.id}>
          <div className={label}>{b.label} {b.pctUsed}% · {fmtReset(b.resetsAt)}</div>
          <span className={barOuter} style={{ width: "100%", margin: 0 }}>
            <span style={{ display: "block", height: "100%", borderRadius: 2,
              width: `${Math.min(b.pctUsed, 100)}%`, background: barColor(b.pctUsed) }} />
          </span>
        </div>
      ))}
    </div>
  );
};
```

Update the dispatch map and the outer flex alignment in `render`:

```jsx
  const LAYOUTS = { ticker: Ticker, "ticker-2line": Ticker2Line, bar: BarLayout, corner: CornerCard };
  const Layout = LAYOUTS[config.layout] || Ticker;
  const justify = config.layout === "corner" ? "flex-end" : "center";
  return (
    <div style={{ display: "flex", justifyContent: justify, width: "100%", paddingRight: config.layout === "corner" ? 12 : 0 }}>
      <Layout logs={logs} limits={limits} config={config} />
    </div>
  );
```

- [ ] **Step 2: Verify all four layouts visually**

Cycle `config.layout` through `ticker`, `ticker-2line`, `bar`, `corner` (widget refreshes each minute; touch `index.jsx` to force). Expected: matches approved mockups. Return to `"ticker"`. **Pause for user confirmation.**

- [ ] **Step 3: Commit**

```bash
git add claude-usage.widget/index.jsx
git commit -m "feat: bar and corner layouts"
```

---

### Task 12: README, provider guide, store prep

**Files:**
- Modify: `README.md`
- Create: `docs/adding-a-provider.md`
- Create: `docs/screenshots/` (user captures; committed)

**Interfaces:**
- Consumes: everything shipped
- Produces: install/config documentation; provider extension contract; widget-store submission checklist

- [ ] **Step 1: Write README.md**

Sections (write fully, not stubs): What it is (with screenshot), Requirements (macOS, Übersicht, Node ≥18, Claude Code), Install (git clone + symlink or drag `claude-usage.widget` into the widgets folder), Configuration (full `config.json` reference table incl. layouts and the `refreshSeconds`/`refreshFrequency` sync caveat), How it works (local logs read-only; Keychain "Always Allow" prompt explanation; unofficial-endpoint disclaimer + graceful degradation), Privacy (nothing leaves the machine except the usage-endpoint call to Anthropic with your existing token), Troubleshooting (no gauges → not logged into Claude Code / Keychain denied; no cost → unknown model in pricing.json; nothing at all → node missing), Development (`npm test`, `--mock` mode).

- [ ] **Step 2: Write docs/adding-a-provider.md**

Document the contract: a provider module exports `collect<Name>() -> { logs?, limits? }` sections matching the payload schema; register under `providers.<name>` in `collect.js`; add pricing entries; add rendering as a second pill/section (out of scope for now — describe the intended pattern and the OpenAI/Gemini data sources to investigate: OpenAI usage dashboard API (official, API-key), Gemini AI Studio quotas).

- [ ] **Step 3: Capture screenshots**

User captures each layout on a clean desktop → `docs/screenshots/{ticker,ticker-2line,bar,corner}.png`; reference the ticker one at the top of README. **Requires user.**

- [ ] **Step 4: Widget store submission checklist**

Fetch current submission instructions from https://github.com/felixhageloh/uebersicht-widgets (the widgets gallery repo) at execution time; typical requirements: a zipped `.widget`, `screenshot.png`, entry in the gallery repo via PR. Write the checklist into README under "Publishing" and prepare the zip:

```bash
cd claude-usage.widget && zip -r ../claude-usage.widget.zip . -x "*.DS_Store" && cd ..
```

Submission itself is a manual PR by the user (their GitHub account) — prepare everything, then hand off.

- [ ] **Step 5: Final full check + commit**

Run: `npm test` (all pass) and `./claude-usage.widget/lib/run.sh | python3 -m json.tool >/dev/null && echo OK`
Expected: `OK`.

```bash
git add README.md docs claude-usage.widget
git commit -m "docs: README, provider guide, store submission prep"
git push -u origin tt/main-work
```

---

## Self-Review Notes (completed)

- **Spec coverage:** repo wipe/rename (T1), mock-first (T2), ticker A1 default + A2 (T3–4), logs aggregation + pricing + cache (T5–7), live wiring + degradation (T8), Keychain + endpoint + fixture-driven normalization + Fable bucket (T9–10), bar/corner (T11), README/provider-doc/store (T12). Payload contract enforced by tests in T2.
- **Known unknowns made explicit:** exact usage-endpoint response shape (T9 Step 3 captures reality; T10 adapts) and Keychain service name (T9 Step 2 verifies).
- **Type consistency:** `buildLogsSection(fileSummaries, now, pricing)`, `summarizeFileCached(filePath, cache, now)`, `collectLogs(opts)`, `collectLimits()`, bucket shape `{id,label,pctUsed,resetsAt}` used identically across tasks and tests.
- **Spec deviation (documented):** `refreshSeconds` in config.json cannot drive Übersicht's static `refreshFrequency` export; README documents the manual sync (T12 Step 1).
