# Global Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every widget in this repo a shared, swappable visual theme selected by a single `theme.json` at the repo root.

**Architecture:** Only the Node collector can read files (`index.jsx` runs in a browser context with no `fs`), so theme data rides the collector's JSON payload. `render()` sets thirteen `--ub-*` CSS custom properties on the widget's own root element; the existing module-level ``css`…` `` constants stay static and swap literals for `var(--ub-*)`. The resolver is vendored byte-identically into each widget so single-folder gallery zips keep working, with tests catching drift.

**Tech Stack:** Node ≥ 18 (stdlib only, zero dependencies), `node --test`, Übersicht 1.6 / React 16.12, emotion via `import { css } from "uebersicht"`.

**Spec:** `docs/superpowers/specs/2026-08-02-global-theming-design.md`

## Global Constraints

- **Zero runtime dependencies.** Node stdlib only. Do not add anything to `package.json` `dependencies` or `devDependencies`.
- **Node ≥ 18**, CommonJS (`"type": "commonjs"`). All `lib/*.js` files start with `"use strict";`.
- **`index.jsx` runs through Übersicht's older Babel.** Forbidden in `.jsx` files: object spread (`{...x}`), `??`, `?.`, and `<>` fragment shorthand. Use `Object.assign`, explicit ternaries, and `<span style={{display:"contents"}}>`. These limits do **not** apply to `lib/*.js`, which already uses `??` and spread freely.
- **The collector must never crash the widget.** Every code path emits valid JSON on stdout and exits 0. `resolveTheme` never throws.
- **CSS custom properties go on each widget's own root element, never `:root`.** Übersicht renders every widget into one shared document; per-widget scoping is what makes the per-widget `theme` override work.
- **`var()` is not substituted inside SVG presentation attributes.** Use `style={{ fill: "var(--ub-warn)" }}`, never `fill="var(--ub-warn)"`.
- **The thirteen token names are fixed:** `text`, `sub`, `muted`, `accent`, `ok`, `warn`, `danger`, `surface`, `border`, `shadow`, `divider`, `track`, `radius`. All values are strings.
- **Run `npm test` before every commit.** The suite is 67 tests at the start of this plan and 86 at the end, and must never go red.
- **The thirteen token names appear in four places** — `lib/theme.js`, the two vendored copies, and a literal array in each `index.jsx` (which cannot `require` the resolver, since it imports `fs`). Tests enforce that all four agree; if you add a token, expect four edits.
- **Commit messages** end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/theme.js` | **Create.** Canonical resolver: embedded midnight defaults, repo-root discovery, name precedence, merge, error handling. |
| `themes/midnight.json` | **Create.** Source of truth for default token values; reproduces today's look exactly. |
| `themes/daylight.json` | **Create.** Light proof theme. |
| `themes/synthwave.json` | **Create.** Saturated dark proof theme. |
| `themes/README.md` | **Create.** Pointer to `docs/theming.md` + list of shipped themes. |
| `theme.json` | **Create.** `{ "active": "midnight" }`. |
| `scripts/sync-themes.sh` | **Create.** Copies `lib/theme.js` into each widget's `lib/`. |
| `tests/theme.test.js` | **Create.** Resolver behaviour, schema conformance, drift, midnight fidelity. |
| `claude-usage.widget/lib/theme.js` | **Create** (vendored copy). |
| `dev-servers.widget/lib/theme.js` | **Create** (vendored copy). |
| `claude-usage.widget/lib/collect.js` | **Modify.** Hoist config to module level, resolve theme, add `theme`/`themeError` to both emit sites. |
| `dev-servers.widget/lib/collect.js` | **Modify.** Resolve theme at module level, add `theme`/`themeError` to all four emit sites. |
| `claude-usage.widget/index.jsx` | **Modify.** `themeVars` helper; `var(--ub-*)` in all `css` blocks; `barColor`, `Bolt`, `Sparkline`, per-layout radii. |
| `dev-servers.widget/index.jsx` | **Modify.** `themeVars` helper; `var(--ub-*)` in all `css` blocks; `DOT_COLOR`, stale-amber. |
| `docs/theming.md` | **Create.** Canonical theming documentation. |
| `package.json` | **Modify.** Add `sync:themes` and `check:bundle` scripts. |
| `README.md`, `docs/development.md`, both widget READMEs | **Modify.** Documentation. |

---

## Task 1: Theme resolver

**Files:**
- Create: `lib/theme.js`
- Create: `themes/midnight.json`
- Create: `theme.json`
- Test: `tests/theme.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveTheme({ widgetDir, config })` → `{ theme: Object, themeError: string|null }`. `theme` always has all thirteen string keys. Never throws.
  - `MIDNIGHT` — frozen-by-convention object of the thirteen default values.
  - `TOKENS` — `string[]` of the thirteen token names, in schema order.

- [ ] **Step 1: Write the failing test**

Create `tests/theme.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveTheme, MIDNIGHT, TOKENS } = require("../lib/theme.js");

// Each fixture is a throwaway repo root: <tmp>/themes/*.json + <tmp>/theme.json
function fixture(themes, active) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ubw-theme-"));
  fs.mkdirSync(path.join(root, "themes"));
  for (const name of Object.keys(themes)) {
    const body = themes[name];
    fs.writeFileSync(
      path.join(root, "themes", `${name}.json`),
      typeof body === "string" ? body : JSON.stringify(body)
    );
  }
  if (active !== undefined) {
    fs.writeFileSync(path.join(root, "theme.json"), JSON.stringify({ active }));
  }
  return root;
}

// resolveTheme reads UBERSICHT_WIDGETS_THEME_DIR, so point it at the fixture
// and always restore — a leaked env var would silently poison later tests.
function withThemeDir(root, fn) {
  const prev = process.env.UBERSICHT_WIDGETS_THEME_DIR;
  process.env.UBERSICHT_WIDGETS_THEME_DIR = path.join(root, "themes");
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.UBERSICHT_WIDGETS_THEME_DIR;
    else process.env.UBERSICHT_WIDGETS_THEME_DIR = prev;
  }
}

test("TOKENS lists exactly the thirteen schema keys", () => {
  assert.deepStrictEqual(TOKENS, [
    "text", "sub", "muted", "accent", "ok", "warn", "danger",
    "surface", "border", "shadow", "divider", "track", "radius",
  ]);
  assert.deepStrictEqual(Object.keys(MIDNIGHT).sort(), TOKENS.slice().sort());
});

test("widget config.theme wins over root theme.json", () => {
  const root = fixture(
    { midnight: MIDNIGHT, nord: { accent: "#88c0d0" }, gruv: { accent: "#fabd2f" } },
    "gruv"
  );
  const out = withThemeDir(root, () =>
    resolveTheme({ widgetDir: root, config: { theme: "nord" } })
  );
  assert.strictEqual(out.theme.accent, "#88c0d0");
  assert.strictEqual(out.themeError, null);
});

test("root theme.json active wins over the midnight fallback", () => {
  const root = fixture({ midnight: MIDNIGHT, gruv: { accent: "#fabd2f" } }, "gruv");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.strictEqual(out.theme.accent, "#fabd2f");
  assert.strictEqual(out.themeError, null);
});

test("falls back to midnight when nothing selects a theme", () => {
  const root = fixture({ midnight: MIDNIGHT });
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.strictEqual(out.themeError, null);
});

test("a partial theme inherits the other twelve tokens", () => {
  const root = fixture({ midnight: MIDNIGHT, sparse: { accent: "#ff0000" } }, "sparse");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.strictEqual(out.theme.accent, "#ff0000");
  assert.strictEqual(out.theme.text, MIDNIGHT.text);
  assert.strictEqual(out.theme.radius, MIDNIGHT.radius);
  assert.strictEqual(Object.keys(out.theme).length, 13);
});

test("unknown keys in a theme file are ignored at runtime", () => {
  const root = fixture({ midnight: MIDNIGHT, odd: { accent: "#ff0000", bogus: "#123" } }, "odd");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.strictEqual(out.theme.bogus, undefined);
  assert.strictEqual(Object.keys(out.theme).length, 13);
});

test("non-string token values are ignored rather than trusted", () => {
  const root = fixture({ midnight: MIDNIGHT, bad: { radius: 12, accent: "#ff0000" } }, "bad");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.strictEqual(out.theme.radius, MIDNIGHT.radius);
  assert.strictEqual(out.theme.accent, "#ff0000");
});

test("unknown theme name returns midnight plus themeError", () => {
  const root = fixture({ midnight: MIDNIGHT }, "nope");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.match(out.themeError, /nope/);
});

test("malformed theme JSON returns midnight plus themeError", () => {
  const root = fixture({ midnight: MIDNIGHT, broken: "{ not json" }, "broken");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.match(out.themeError, /broken/);
});

test("a theme name that escapes the themes dir is rejected", () => {
  const root = fixture({ midnight: MIDNIGHT });
  const out = withThemeDir(root, () =>
    resolveTheme({ widgetDir: root, config: { theme: "../../etc/passwd" } })
  );
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.match(out.themeError, /invalid theme name/);
});

test("no themes dir anywhere is silent midnight, not an error", () => {
  // The gallery-zip case: a widget folder with no repo root above it.
  const lonely = fs.mkdtempSync(path.join(os.tmpdir(), "ubw-lonely-"));
  const out = resolveTheme({ widgetDir: lonely, config: {} });
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.strictEqual(out.themeError, null);
});

test("malformed root theme.json degrades to midnight without an error", () => {
  const root = fixture({ midnight: MIDNIGHT });
  fs.writeFileSync(path.join(root, "theme.json"), "{ not json");
  const out = withThemeDir(root, () => resolveTheme({ widgetDir: root, config: {} }));
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.strictEqual(out.themeError, null);
});

test("themes dir is found by walking up from a widget lib dir", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ubw-walk-"));
  fs.mkdirSync(path.join(root, "themes"));
  fs.writeFileSync(
    path.join(root, "themes", "midnight.json"), JSON.stringify(MIDNIGHT));
  fs.writeFileSync(
    path.join(root, "themes", "nord.json"), JSON.stringify({ accent: "#88c0d0" }));
  fs.writeFileSync(path.join(root, "theme.json"), JSON.stringify({ active: "nord" }));
  const libDir = path.join(root, "demo.widget", "lib");
  fs.mkdirSync(libDir, { recursive: true });

  // No env override here — this exercises findRepoRoot's real two-level walk.
  const out = resolveTheme({ widgetDir: libDir, config: {} });
  assert.strictEqual(out.theme.accent, "#88c0d0");
});

test("embedded defaults stay in sync with themes/midnight.json", () => {
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "themes", "midnight.json"), "utf8"));
  assert.deepStrictEqual(onDisk, MIDNIGHT);
});

test("midnight reproduces the pre-theming literals exactly", () => {
  // Regression anchor: these are the values hardcoded in both index.jsx files
  // at commit fb1e48f, before theming. If this test fails, the retrofit
  // changed how the widgets look.
  assert.deepStrictEqual(MIDNIGHT, {
    text: "#e8eaf0",
    sub: "#9aa0b0",
    muted: "#8b90a0",
    accent: "#d97757",
    ok: "#5ba97f",
    warn: "#d9a557",
    danger: "#d97757",
    surface:
      "linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92))",
    border: "rgba(255, 255, 255, 0.09)",
    shadow: "0 8px 30px rgba(0, 0, 0, 0.45)",
    divider: "rgba(255, 255, 255, 0.1)",
    track: "rgba(255, 255, 255, 0.12)",
    radius: "12px",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme.test.js`
Expected: FAIL — `Cannot find module '../lib/theme.js'`

- [ ] **Step 3: Create `themes/midnight.json`**

```json
{
  "text": "#e8eaf0",
  "sub": "#9aa0b0",
  "muted": "#8b90a0",
  "accent": "#d97757",
  "ok": "#5ba97f",
  "warn": "#d9a557",
  "danger": "#d97757",
  "surface": "linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92))",
  "border": "rgba(255, 255, 255, 0.09)",
  "shadow": "0 8px 30px rgba(0, 0, 0, 0.45)",
  "divider": "rgba(255, 255, 255, 0.1)",
  "track": "rgba(255, 255, 255, 0.12)",
  "radius": "12px"
}
```

- [ ] **Step 4: Create `theme.json`**

```json
{ "active": "midnight" }
```

- [ ] **Step 5: Write `lib/theme.js`**

```js
"use strict";
const fs = require("fs");
const path = require("path");

// themes/midnight.json is the source of truth for these values; they are
// embedded here so a widget zipped for the Übersicht gallery — which has no
// repo root above it — still renders. tests/theme.test.js asserts the two
// stay identical.
const MIDNIGHT = {
  text: "#e8eaf0",
  sub: "#9aa0b0",
  muted: "#8b90a0",
  accent: "#d97757",
  ok: "#5ba97f",
  warn: "#d9a557",
  danger: "#d97757",
  surface: "linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92))",
  border: "rgba(255, 255, 255, 0.09)",
  shadow: "0 8px 30px rgba(0, 0, 0, 0.45)",
  divider: "rgba(255, 255, 255, 0.1)",
  track: "rgba(255, 255, 255, 0.12)",
  radius: "12px",
};

const TOKENS = Object.keys(MIDNIGHT);

// A theme name becomes a filename, so keep it to a safe alphabet — a config
// value like "../../etc/passwd" must not escape the themes directory.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/i;

// Bounded walk: <widget>.widget/lib -> <widget>.widget -> repo root.
// __dirname is a realpath, so a symlinked Übersicht install resolves into the
// checkout it points at.
function findThemesDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(dir, "themes");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(message) {
  return { theme: { ...MIDNIGHT }, themeError: message };
}

function resolveTheme(options) {
  const opts = options || {};
  const widgetDir = opts.widgetDir || __dirname;
  const config = opts.config || {};

  const themesDir =
    process.env.UBERSICHT_WIDGETS_THEME_DIR || findThemesDir(widgetDir);

  // Standalone install (gallery zip): no themes directory at all. Expected,
  // not an error — the widget simply uses its embedded defaults.
  if (!themesDir || !fs.existsSync(themesDir)) {
    return { theme: { ...MIDNIGHT }, themeError: null };
  }

  let name = config.theme;
  if (!name) {
    // Repo-root theme.json is optional; missing or malformed just means
    // "use the default", which is why this swallows rather than reports.
    try {
      name = readJson(path.join(path.dirname(themesDir), "theme.json")).active;
    } catch {
      name = null;
    }
  }
  name = name || "midnight";

  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return fail(`invalid theme name ${JSON.stringify(name)}`);
  }

  let loaded;
  try {
    loaded = readJson(path.join(themesDir, `${name}.json`));
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    return fail(`theme "${name}" could not be loaded: ${detail}`);
  }

  // Merge over the defaults so a partial theme declares only what it changes,
  // and ignore anything that isn't a known token with a string value.
  const theme = { ...MIDNIGHT };
  for (const key of TOKENS) {
    if (typeof loaded[key] === "string") theme[key] = loaded[key];
  }
  return { theme, themeError: null };
}

module.exports = { resolveTheme, MIDNIGHT, TOKENS };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/theme.test.js`
Expected: PASS, 15 tests

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, 82 tests (67 existing + 15 new)

- [ ] **Step 8: Commit**

```bash
git add lib/theme.js themes/midnight.json theme.json tests/theme.test.js
git commit -m "$(cat <<'EOF'
feat(theme): add theme resolver with midnight default

Thirteen-token schema; name precedence is widget config > root
theme.json > midnight. Never throws — missing themes dir, unknown
name, and malformed JSON all degrade to midnight, the last two with
a themeError for debugging.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Proof themes and schema conformance

**Files:**
- Create: `themes/daylight.json`
- Create: `themes/synthwave.json`
- Modify: `tests/theme.test.js` (append)

**Interfaces:**
- Consumes: `TOKENS` and `MIDNIGHT` from `lib/theme.js` (Task 1).
- Produces: two theme files that later manual verification switches between.

The point of these two is to prove the thirteen tokens are *sufficient*. `daylight` inverts every white-alpha token; `synthwave` uses a non-neutral surface and a `radius` that differs from the default. If either needed a value that isn't a token, the schema is wrong and we want to find that out now, not after a third widget exists.

- [ ] **Step 1: Write the failing test**

Append to `tests/theme.test.js`:

```js
test("every shipped theme declares only known tokens with string values", () => {
  const dir = path.join(__dirname, "..", "themes");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3, `expected at least 3 themes, found ${files.length}`);

  for (const file of files) {
    const theme = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const keys = Object.keys(theme);

    const unknown = keys.filter((k) => !TOKENS.includes(k));
    assert.deepStrictEqual(unknown, [], `${file} declares unknown token(s)`);

    // Shipped themes are complete, unlike user themes which may be partial —
    // a missing token here means the schema grew and a theme was forgotten.
    const missing = TOKENS.filter((t) => !keys.includes(t));
    assert.deepStrictEqual(missing, [], `${file} is missing token(s)`);

    for (const key of keys) {
      assert.strictEqual(
        typeof theme[key], "string", `${file}.${key} must be a string`);
      assert.ok(theme[key].length > 0, `${file}.${key} must not be empty`);
    }
  }
});

test("shipped themes are visually distinct from midnight", () => {
  const dir = path.join(__dirname, "..", "themes");
  for (const name of ["daylight", "synthwave"]) {
    const theme = JSON.parse(
      fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    const shared = TOKENS.filter((t) => theme[t] === MIDNIGHT[t]);
    assert.ok(
      shared.length <= 1,
      `${name} shares ${shared.length} values with midnight (${shared}) — ` +
        `it is not exercising the schema`
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme.test.js`
Expected: FAIL — `expected at least 3 themes, found 1`

- [ ] **Step 3: Create `themes/daylight.json`**

```json
{
  "text": "#1c1f26",
  "sub": "#5c6270",
  "muted": "#666c78",
  "accent": "#c2562f",
  "ok": "#2f7d51",
  "warn": "#8a5f0f",
  "danger": "#b03a24",
  "surface": "linear-gradient(180deg, rgba(252, 252, 253, 0.94), rgba(241, 242, 246, 0.94))",
  "border": "rgba(0, 0, 0, 0.10)",
  "shadow": "0 8px 30px rgba(0, 0, 0, 0.18)",
  "divider": "rgba(0, 0, 0, 0.12)",
  "track": "rgba(0, 0, 0, 0.14)",
  "radius": "12px"
}
```

Every white-alpha value from midnight is now black-alpha, at a higher alpha because dark-on-light needs more to read. `warn` is darkened well past midnight's `#d9a557`, which is illegible on a light surface.

- [ ] **Step 4: Create `themes/synthwave.json`**

```json
{
  "text": "#f6e9ff",
  "sub": "#a78bc4",
  "muted": "#8f74ad",
  "accent": "#ff5fa2",
  "ok": "#4ce0b3",
  "warn": "#ffc857",
  "danger": "#ff3864",
  "surface": "linear-gradient(180deg, rgba(45, 21, 66, 0.93), rgba(24, 12, 40, 0.93))",
  "border": "rgba(255, 95, 162, 0.28)",
  "shadow": "0 8px 30px rgba(12, 4, 24, 0.60)",
  "divider": "rgba(255, 255, 255, 0.14)",
  "track": "rgba(255, 255, 255, 0.16)",
  "radius": "10px"
}
```

`accent` (`#ff5fa2`) and `danger` (`#ff3864`) differ here, which is the case midnight cannot exercise since it uses `#d97757` for both. `radius` is `10px` so the `calc()` offsets get tested against a non-default base.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/theme.test.js`
Expected: PASS, 17 tests

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, 84 tests

- [ ] **Step 7: Commit**

```bash
git add themes/daylight.json themes/synthwave.json tests/theme.test.js
git commit -m "$(cat <<'EOF'
feat(theme): add daylight and synthwave proof themes

Two themes that stress the schema differently — daylight inverts every
white-alpha token, synthwave separates accent from danger and uses a
non-default radius. Conformance test asserts every shipped theme
declares exactly the thirteen tokens.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Vendor the resolver into both widgets

**Files:**
- Create: `scripts/sync-themes.sh`
- Create: `claude-usage.widget/lib/theme.js` (generated)
- Create: `dev-servers.widget/lib/theme.js` (generated)
- Modify: `package.json`
- Modify: `tests/theme.test.js` (append)

**Interfaces:**
- Consumes: `lib/theme.js` (Task 1).
- Produces: `<widget>.widget/lib/theme.js`, byte-identical to the root copy, requirable by each collector as `require("./theme")`.

`scripts/package.sh` archives a single widget folder from HEAD, so a cross-folder `require("../../lib/theme.js")` would break every gallery zip. Copying is the price of the repo's self-contained-widget promise; the drift test is what makes it safe.

- [ ] **Step 1: Write the failing test**

Append to `tests/theme.test.js`:

```js
test("vendored resolvers are byte-identical to the canonical one", () => {
  const root = path.join(__dirname, "..");
  const canonical = fs.readFileSync(path.join(root, "lib", "theme.js"));
  for (const widget of ["claude-usage.widget", "dev-servers.widget"]) {
    const vendored = fs.readFileSync(path.join(root, widget, "lib", "theme.js"));
    assert.ok(
      canonical.equals(vendored),
      `${widget}/lib/theme.js has drifted — run: npm run sync:themes`
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/theme.test.js`
Expected: FAIL — `ENOENT ... claude-usage.widget/lib/theme.js`

- [ ] **Step 3: Create `scripts/sync-themes.sh`**

```bash
#!/bin/bash
# Copy the canonical theme resolver into each widget. Widgets must stay
# self-contained: scripts/package.sh zips a single widget folder from HEAD,
# so a cross-folder require would break every gallery install.
# tests/theme.test.js fails if a copy drifts.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for WIDGET in *.widget; do
  [ -d "$WIDGET/lib" ] || continue
  cp lib/theme.js "$WIDGET/lib/theme.js"
  echo "synced -> $WIDGET/lib/theme.js"
done
```

- [ ] **Step 4: Make it executable and run it**

```bash
chmod +x scripts/sync-themes.sh
./scripts/sync-themes.sh
```

Expected output:
```
synced -> claude-usage.widget/lib/theme.js
synced -> dev-servers.widget/lib/theme.js
```

- [ ] **Step 5: Add npm scripts**

In `package.json`, replace the `"scripts"` block with:

```json
  "scripts": {
    "test": "node --test tests/**/*.test.js",
    "sync:themes": "scripts/sync-themes.sh",
    "check:bundle": "for w in *.widget; do npx --yes esbuild \"$w/index.jsx\" --bundle --external:uebersicht --outfile=/dev/null || exit 1; done"
  },
```

`check:bundle` needs network access the first time (`npx` fetches esbuild). It is a manual pre-release check, not part of `npm test`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/theme.test.js`
Expected: PASS, 18 tests

- [ ] **Step 7: Verify a vendored copy resolves themes from its real location**

```bash
node -e 'const {resolveTheme}=require("./dev-servers.widget/lib/theme.js");
const r=resolveTheme({widgetDir:__dirname+"/dev-servers.widget/lib",config:{}});
console.log(r.themeError, r.theme.accent);'
```

Expected: `null #d97757`

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test` — expected PASS, 85 tests

```bash
git add scripts/sync-themes.sh package.json \
  claude-usage.widget/lib/theme.js dev-servers.widget/lib/theme.js \
  tests/theme.test.js
git commit -m "$(cat <<'EOF'
feat(theme): vendor the resolver into each widget

scripts/package.sh zips a single widget folder, so widgets cannot
require across folders. sync-themes.sh copies the canonical resolver
in and a drift test keeps the copies honest.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Retrofit dev-servers.widget

**Files:**
- Modify: `dev-servers.widget/lib/collect.js`
- Modify: `dev-servers.widget/index.jsx`
- Modify: `dev-servers.widget/config.json`
- Test: `tests/dev-servers-collect.test.js` is untouched; verification is by payload inspection and eye.

**Interfaces:**
- Consumes: `resolveTheme` from `./theme` (Task 3).
- Produces: a collector payload with top-level `theme` (thirteen string keys) and `themeError` (string or `null`) on **all four** emit sites — mock, success, watchdog, and `main().catch`.

This is the smaller widget (126 lines of JSX, one layout), so it goes first and de-risks the pattern before the four-layout widget.

- [ ] **Step 1: Add theme resolution to the collector**

In `dev-servers.widget/lib/collect.js`, immediately after the existing `const CONFIG = readConfig();` and its comment block, add:

```js
const { resolveTheme } = require("./theme");
// Resolved at module level for the same reason CONFIG is: the watchdog and
// main().catch both emit payloads from outside main()'s scope, and an
// unthemed error card would render with no background at all.
const THEME = resolveTheme({ widgetDir: __dirname, config: CONFIG });
```

- [ ] **Step 2: Add theme to all four emit sites**

Mock path — replace:
```js
    process.stdout.write(JSON.stringify({ ...mock, config }));
```
with:
```js
    process.stdout.write(
      JSON.stringify({ ...mock, config, theme: THEME.theme, themeError: THEME.themeError })
    );
```

Success path — replace:
```js
  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), status: "ok", config, servers })
  );
```
with:
```js
  process.stdout.write(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: "ok",
      config,
      theme: THEME.theme,
      themeError: THEME.themeError,
      servers,
    })
  );
```

Watchdog — replace its object literal with:
```js
  const json = JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: "error",
    message: "collector timed out",
    config: CONFIG,
    theme: THEME.theme,
    themeError: THEME.themeError,
    servers: [],
  });
```

`main().catch` — replace its object literal with:
```js
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        status: "error",
        message: String((err && err.message) || err),
        config: CONFIG,
        theme: THEME.theme,
        themeError: THEME.themeError,
        servers: [],
      })
```

- [ ] **Step 3: Verify the payload carries the theme**

```bash
dev-servers.widget/lib/run.sh | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["theme"]), d["theme"]["accent"], d["themeError"])'
```

Expected: `13 #d97757 None`

- [ ] **Step 4: Convert the JSX styles**

In `dev-servers.widget/index.jsx`, replace the colour constants:

```js
const GREEN = "#5ba97f", AMBER = "#d9a557", GRAY = "#9aa0b0";
```

with:

```js
// Theme-driven; the widget root carries the matching --ub-* custom properties.
const OK = "var(--ub-ok)", WARN = "var(--ub-warn)", SUB = "var(--ub-sub)";

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
```

Replace the `card` block:

```js
const card = css`
  position: absolute;
  min-width: 240px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: var(--ub-radius, 12px);
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  line-height: 1.7;
`;
```

The `var(…, fallback)` values matter: `run.sh` emits its `node-missing` JSON from bash, with no theme, and that payload still has to render a legible card.

Replace `title`, `sub`, `strong`:

```js
const title = css`
  color: var(--ub-sub, #9aa0b0);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const sub = css` color: var(--ub-sub, #9aa0b0); `;
const strong = css` color: var(--ub-text, #e8eaf0); font-weight: 600; `;
```

Replace `DOT_COLOR` and the `Dot` fallback:

```js
const DOT_COLOR = { up: OK, tcp: SUB, down: WARN, unknown: SUB };

const Dot = ({ health }) => (
  <span style={{ color: DOT_COLOR[health] || SUB, fontSize: 8 }}>
    {health === "tcp" ? "◉" : "●"}
  </span>
);
```

In `Row`, replace the stale-uptime span:

```js
    {show.uptime && s.age && (
      <span style={{ color: s.stale ? WARN : SUB }}>{s.age}</span>
    )}
```

- [ ] **Step 5: Apply the vars in `render`**

In `render`, after the existing `style.zoom = scale;` line, add:

```js
  Object.assign(style, themeVars(data.theme));
```

- [ ] **Step 6: Add the `theme` config key**

In `dev-servers.widget/config.json`, add `"theme"` as the first key so the override is discoverable:

```json
{
  "theme": null,
  "position": { "corner": "bottom-left" },
  "refreshSeconds": 10,
  "staleHours": 24,
  "maxRows": 12,
  "ignoreProcesses": [],
  "ignorePorts": [],
  "show": { "uptime": true, "health": true, "cpu": true, "mem": true, "branch": true },
  "scale": 1.5,
  "mock": false
}
```

`null` is falsy, so `resolveTheme` falls through to the root `theme.json` — the documented default. Do **not** add `theme` to the `DEFAULTS` object in `collect.js`; absence and `null` must behave identically.

- [ ] **Step 7: Verify the bundle still compiles**

```bash
npx --yes esbuild dev-servers.widget/index.jsx --bundle --external:uebersicht --outfile=/dev/null
```

Expected: no output, exit 0. (Requires network on first run.)

- [ ] **Step 8: Run the suite and verify visually**

Run: `npm test` — expected PASS, 85 tests (unchanged; this task adds no tests)

Then, with the widget installed in Übersicht:
1. Confirm the card looks **identical** to before this task.
2. Set `theme.json` to `{ "active": "synthwave" }`, wait ~10s, confirm the card recolours with no Übersicht restart and its corners are slightly tighter (`radius: 10px`).
3. Set it to `{ "active": "daylight" }`, confirm light surface with dark text and legible amber-free warnings.
4. Restore `{ "active": "midnight" }`.

- [ ] **Step 9: Commit**

```bash
git add dev-servers.widget/
git commit -m "$(cat <<'EOF'
feat(dev-servers): drive colours from the active theme

Collector emits the resolved theme on all four payload paths; index.jsx
maps it to --ub-* custom properties on the card. css blocks stay static
and carry midnight fallbacks so the bash node-missing payload, which has
no theme, still renders.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Retrofit claude-usage.widget

**Files:**
- Modify: `claude-usage.widget/lib/collect.js`
- Modify: `claude-usage.widget/index.jsx`
- Modify: `claude-usage.widget/config.json`

**Interfaces:**
- Consumes: `resolveTheme` from `./theme` (Task 3); the `themeVars`/`TOKENS` pattern established in Task 4.
- Produces: a payload with top-level `theme` and `themeError` on both emit sites.

Four layouts share one set of `css` constants, so the conversion is wider than Task 4 but no deeper. The two extra wrinkles are the SVG bolt and `barColor`.

- [ ] **Step 1: Hoist config and resolve the theme**

In `claude-usage.widget/lib/collect.js`, after the `readConfig` function definition, add:

```js
const { resolveTheme } = require("./theme");

// Hoisted to module level so main().catch — which runs outside main()'s
// scope — can still emit a themed payload. Mirrors dev-servers/collect.js.
const CONFIG = readConfig();
const THEME = resolveTheme({ widgetDir: __dirname, config: CONFIG });
```

Then inside `main()`, replace:
```js
  const config = readConfig();
```
with:
```js
  const config = CONFIG;
```

- [ ] **Step 2: Add theme to both emit sites**

Success path — replace:
```js
  process.stdout.write(
    JSON.stringify({ generatedAt: new Date().toISOString(), config, providers })
  );
```
with:
```js
  process.stdout.write(
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      config,
      theme: THEME.theme,
      themeError: THEME.themeError,
      providers,
    })
  );
```

`main().catch` — replace:
```js
main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: "collect-failed", message: String(err) }));
  process.exitCode = 0; // never crash the widget
});
```
with:
```js
main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      error: "collect-failed",
      message: String(err),
      theme: THEME.theme,
      themeError: THEME.themeError,
    })
  );
  process.exitCode = 0; // never crash the widget
});
```

- [ ] **Step 3: Verify the payload**

```bash
claude-usage.widget/lib/run.sh | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["theme"]), d["theme"]["accent"], d["themeError"])'
```

Expected: `13 #d97757 None`

- [ ] **Step 4: Add `themeVars` and convert the shared css blocks**

In `claude-usage.widget/index.jsx`, replace:

```js
const GREEN = "#5ba97f", AMBER = "#d9a557", RED = "#d97757";
```

with:

```js
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

// Card corners scale with the theme; the ticker's 999px pill is layout
// identity, not theme, and stays hardcoded below.
const RADIUS_PLUS_2 = "calc(var(--ub-radius, 12px) + 2px)";
const RADIUS_PLUS_4 = "calc(var(--ub-radius, 12px) + 4px)";
```

Replace the `pill`, `sub`, `strong`, `logo`, `divider`, `barOuter` blocks:

```js
const pill = css`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 20px;
  border-radius: 999px;
  background: var(--ub-surface, linear-gradient(180deg, rgba(26, 29, 36, 0.92), rgba(18, 20, 26, 0.92)));
  border: 1px solid var(--ub-border, rgba(255, 255, 255, 0.09));
  box-shadow: var(--ub-shadow, 0 8px 30px rgba(0, 0, 0, 0.45));
  color: var(--ub-text, #e8eaf0);
  font-family: -apple-system, "SF Pro Display", Helvetica, sans-serif;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
`;

const sub = css` color: var(--ub-sub, #9aa0b0); `;
const strong = css` color: var(--ub-text, #e8eaf0); font-weight: 600; `;
const logo = css` color: var(--ub-accent, #d97757); font-weight: 600; `;
const divider = css` width: 1px; align-self: stretch; background: var(--ub-divider, rgba(255, 255, 255, 0.1)); `;
const barOuter = css`
  display: inline-block;
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: var(--ub-track, rgba(255, 255, 255, 0.12));
  vertical-align: middle;
  margin: 0 5px 1px 6px;
  overflow: hidden;
`;
```

Replace the `label` block (it appears further down, after `Ticker`):

```js
const label = css`
  font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ub-muted, #8b90a0);
`;
```

- [ ] **Step 5: Convert `barColor`, `Bolt`, and `Sparkline`**

Replace `barColor`:

```js
export const barColor = (pct) =>
  pct >= 80 ? "var(--ub-danger)" : pct >= 50 ? "var(--ub-warn)" : "var(--ub-ok)";
```

Replace `Bolt` — note `style`, not a `fill` attribute, because `var()` is not substituted inside SVG presentation attributes:

```js
const Bolt = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" style={{ verticalAlign: "-1px", marginRight: 2 }}>
    <path
      style={{ fill: "var(--ub-warn, #d9a557)" }}
      d="M13 2 4.7 13.2l5.9.4L9 22l10.3-12.2-6.4-.4L13 2z"
    />
  </svg>
);
```

In `Sparkline`, replace the bar span's style — the old `rgba(217,119,87,0.75)` was `accent` at 75%, so the alpha moves to `opacity` and the colour becomes the token:

```js
        <span key={d.date} style={{
          flex: 1, borderRadius: "1.5px 1.5px 0 0",
          background: "var(--ub-accent)",
          opacity: 0.75,
          height: `${Math.max(8, (d.tokens / max) * 100)}%`,
        }} />
```

- [ ] **Step 6: Convert the per-layout radii**

`Ticker2Line` — replace `borderRadius: 16` in its `pill` style override with `borderRadius: RADIUS_PLUS_4`:

```js
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 7, borderRadius: RADIUS_PLUS_4 }}>
```

`BarLayout` — replace `borderRadius: 14` with `borderRadius: RADIUS_PLUS_2`:

```js
    <div className={pill} style={{ padding: "10px 24px", borderRadius: RADIUS_PLUS_2, gap: 0 }}>
```

`CornerCard` — replace `borderRadius: 14` with `borderRadius: RADIUS_PLUS_2`:

```js
    <div className={pill} style={{ flexDirection: "column", alignItems: "stretch", gap: 6, borderRadius: RADIUS_PLUS_2, width: 210, padding: "12px 16px" }}>
```

Under midnight (`radius: "12px"`) these compute to 16px, 14px and 14px — identical to today.

- [ ] **Step 7: Apply the vars in `Positioned`**

Replace `Positioned`:

```js
const Positioned = ({ align, scale = 1, bottom = 8, theme, children }) => {
  // zoom and the theme vars ride the same element; the card is a descendant
  // and inherits the custom properties through the cascade.
  const inner = { zoom: scale };
  Object.assign(inner, themeVars(theme));
  return (
    <div style={{ display: "flex", width: "100%", justifyContent: alignToJustify(align), padding: "0 12px", marginBottom: bottom - 8 }}>
      <div style={inner}>{children}</div>
    </div>
  );
};
```

The three early-return error paths in `render` call `<Positioned align="center">` with no `theme` prop — they rely on the `var(…, fallback)` values in `pill` and `sub`. Leave them as they are.

In `render`, pass the theme on the success path only:

```js
  return (
    <Positioned align={align} scale={scale} bottom={bottom} theme={payload.theme}>
      <Layout logs={logs} limits={limits} config={config} />
    </Positioned>
  );
```

- [ ] **Step 8: Add the `theme` config key**

In `claude-usage.widget/config.json`, add `"theme": null` as the first key:

```json
{
  "theme": null,
  "layout": "ticker",
  "position": {
    "bottom": 8,
    "align": "right"
  },
  "refreshSeconds": 60,
  "showCost": true,
  "showTokens": true,
  "showEnergy": true,
  "showFable": "auto",
  "mock": false,
  "scale": 1.5
}
```

Do **not** add `theme` to `DEFAULTS` in `collect.js`.

- [ ] **Step 9: Verify the bundle compiles**

```bash
npx --yes esbuild claude-usage.widget/index.jsx --bundle --external:uebersicht --outfile=/dev/null
```

Expected: no output, exit 0.

- [ ] **Step 10: Add the token-list drift test**

`index.jsx` cannot `require("./lib/theme")` — that module imports `fs` and would
break the browser bundle — so each widget carries its own literal copy of the
token list. That is a third and fourth copy of the same names, and it needs the
same protection as the vendored resolver.

Append to `tests/theme.test.js`:

```js
test("each index.jsx token list matches the resolver's", () => {
  const root = path.join(__dirname, "..");
  for (const widget of ["claude-usage.widget", "dev-servers.widget"]) {
    const src = fs.readFileSync(path.join(root, widget, "index.jsx"), "utf8");

    const match = src.match(/const TOKENS = \[([\s\S]*?)\];/);
    assert.ok(match, `${widget}/index.jsx has no TOKENS array`);

    const names = match[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

    assert.deepStrictEqual(
      names, TOKENS,
      `${widget}/index.jsx token list has drifted from lib/theme.js`
    );
  }
});
```

Run: `node --test tests/theme.test.js`
Expected: PASS, 19 tests

- [ ] **Step 11: Run the suite and verify all four layouts**

Run: `npm test` — expected PASS, 86 tests

Then, with `"mock": true` set in `claude-usage.widget/config.json` for fast iteration, step `"layout"` through `ticker`, `ticker-2line`, `bar`, and `corner`. For each:
1. Confirm it is identical to before under midnight.
2. Switch `theme.json` to `daylight` and confirm the gauge bars, sparkline, ⚡ bolt and dividers all recolour — the bolt is the one most likely to be missed, since an unconverted `fill` attribute fails silently by staying amber.
3. Restore `midnight` and set `"mock": false`.

- [ ] **Step 12: Commit**

```bash
git add claude-usage.widget/ tests/theme.test.js
git commit -m "$(cat <<'EOF'
feat(claude-usage): drive colours from the active theme

All four layouts read --ub-* custom properties applied by Positioned.
Per-layout radii become calc() offsets from the radius token; the
ticker pill's 999px stays hardcoded as layout identity. The bolt SVG
uses style.fill since var() is not substituted in SVG presentation
attributes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/theming.md`
- Create: `themes/README.md`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `claude-usage.widget/README.md`
- Modify: `dev-servers.widget/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: nothing code depends on.

- [ ] **Step 1: Create `docs/theming.md`**

```markdown
# Theming

Every widget in this repo reads its colours from one active theme. Switching
themes means editing a single file; the change appears within one refresh
cycle, with no Übersicht restart.

## Switching themes

Edit `theme.json` at the repo root:

```json
{ "active": "synthwave" }
```

Shipped themes: `midnight` (default), `daylight`, `synthwave`.

## Per-widget override

Any widget can opt out of the global choice via its own `config.json`:

```json
{ "theme": "daylight" }
```

`null` or an absent key means "follow `theme.json`". Übersicht renders every
widget into one document, but each widget scopes its custom properties to its
own root element — so two widgets can run different themes side by side.

## Writing a theme

Create `themes/<name>.json`. Declare only what you want to change; anything
omitted inherits from `midnight`.

```json
{
  "accent": "#88c0d0",
  "surface": "#2e3440"
}
```

Values are raw CSS strings, so `surface` accepts a flat colour, a gradient, or
anything else valid for `background`.

### Tokens

| Token | Meaning |
|---|---|
| `text` | Primary text; card foreground |
| `sub` | Secondary text; dev-servers section titles; neutral status dots |
| `muted` | Uppercase section labels |
| `accent` | The ✳ logo and sparkline bars |
| `ok` | Gauges under 50%; healthy port |
| `warn` | Gauges 50–80%; stale uptime; the ⚡ bolt; unresponsive port |
| `danger` | Gauges at or above 80% |
| `surface` | Card background (`background` shorthand) |
| `border` | Card border colour |
| `shadow` | Card shadow (`box-shadow` shorthand) |
| `divider` | Vertical rules between sections |
| `track` | Unfilled portion of gauge and progress bars |
| `radius` | Base card corner radius, e.g. `"12px"` |

Three notes worth knowing before you author one:

- **`border`, `divider` and `track` are separate on purpose.** They are all
  white-alpha under `midnight`, which makes them look redundant — but a light
  theme needs all three to be black-alpha at different strengths. Compare
  `themes/daylight.json` if you are inverting a dark theme.
- **`accent` and `danger` are separate.** `midnight` happens to use `#d97757`
  for both; `synthwave` does not.
- **`radius` sets the base only.** Some layouts sit 2–4px above it, and the
  ticker's pill shape is fixed regardless — that is layout identity, not
  theme. A `radius: 0` theme gets square cards and a still-round ticker.

## When a theme does not load

A bad theme name or malformed JSON never breaks a widget: it falls back to
`midnight` and records why in its payload. Nothing is drawn on the desktop,
so check the payload directly:

```bash
dev-servers.widget/lib/run.sh | python3 -m json.tool | grep themeError
```

`null` means all is well.

## For contributors

`lib/theme.js` is the canonical resolver. Each widget carries a byte-identical
copy at `<widget>.widget/lib/theme.js`, because `scripts/package.sh` zips a
single widget folder for the Übersicht gallery and a cross-folder `require`
would break every gallery install.

After editing `lib/theme.js`:

```bash
npm run sync:themes
npm test
```

`tests/theme.test.js` fails if a copy drifts, if a shipped theme declares an
unknown or missing token, or if the defaults embedded in `lib/theme.js` stop
matching `themes/midnight.json`.

Standalone gallery installs have no repo root above them, so they use the
embedded `midnight` defaults and cannot switch themes. That is expected.
```

- [ ] **Step 2: Create `themes/README.md`**

```markdown
# Themes

| Theme | Look |
|---|---|
| `midnight` | The default — dark neutral, the repo's original palette. |
| `daylight` | Light surface, dark text. |
| `synthwave` | Saturated purple/pink dark. |

Select one in `theme.json` at the repo root, or per widget in its
`config.json`.

See **[docs/theming.md](../docs/theming.md)** for the token reference and a
guide to writing your own. (The table lives there and only there — a
duplicated table is a table that goes stale.)
```

- [ ] **Step 3: Add a Theming section to `README.md`**

Insert between the "Installing a widget" section and "Development":

```markdown
## Theming

All widgets share one palette. Pick it in `theme.json`:

```json
{ "active": "midnight" }
```

`midnight` (default), `daylight`, and `synthwave` ship with the repo. The
change lands within one refresh cycle — no Übersicht restart. Individual
widgets can override with `"theme": "<name>"` in their own `config.json`.

→ [Token reference & writing your own](docs/theming.md)
```

- [ ] **Step 4: Update `docs/development.md`**

Add to the environment-variable table:

```markdown
| `UBERSICHT_WIDGETS_THEME_DIR` | Overrides the `themes/` directory the theme resolver reads (default: nearest `themes/` walking up from the widget). |
```

And after the `npm test` block near the top, add:

```markdown
`lib/theme.js` is vendored into each widget. After editing it, run
`npm run sync:themes` — `npm test` fails if the copies drift. See
[theming.md](theming.md).

`npm run check:bundle` runs esbuild over every widget's `index.jsx` to catch
JSX that Übersicht's older Babel would reject. Needs network on first run.
```

- [ ] **Step 5: Add a `theme` row to both widget READMEs**

In `dev-servers.widget/README.md` and `claude-usage.widget/README.md`, add as the first row of the configuration table:

```markdown
| `theme` | string \| `null` | `null` | Theme name overriding the repo-root `theme.json`. `null` follows the global choice. See [theming](../docs/theming.md). |
```

- [ ] **Step 6: Verify and commit**

Run: `npm test` — expected PASS, 86 tests

```bash
git add docs/theming.md themes/README.md README.md docs/development.md \
  claude-usage.widget/README.md dev-servers.widget/README.md
git commit -m "$(cat <<'EOF'
docs: document theming

Token reference, authoring guide, per-widget override, and themeError
diagnosis in docs/theming.md; pointers from the root README, both widget
READMEs, and the development guide.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rebuild the gallery zip

**Files:**
- Modify: `claude-usage.widget.zip`

**Interfaces:**
- Consumes: committed state from Tasks 1–6.
- Produces: nothing code depends on.

`claude-usage.widget.zip` at the repo root is a gallery-serving artifact built
from HEAD. Tasks 3 and 5 changed the contents of `claude-usage.widget/`, so the
published zip is now stale.

- [ ] **Step 1: Rebuild from HEAD**

```bash
scripts/package.sh claude-usage.widget
```

Expected: `wrote <repo>/claude-usage.widget.zip (from HEAD)`

- [ ] **Step 2: Verify the vendored resolver is inside**

```bash
unzip -l claude-usage.widget.zip | grep -E "theme.js|index.jsx"
```

Expected: both `lib/theme.js` and `index.jsx` listed.

- [ ] **Step 3: Confirm the standalone path degrades correctly**

```bash
TMP=$(mktemp -d) && unzip -q claude-usage.widget.zip -d "$TMP" && \
node -e 'const {resolveTheme}=require(process.argv[1]+"/lib/theme.js");
const r=resolveTheme({widgetDir:process.argv[1]+"/lib",config:{}});
console.log(JSON.stringify(r.themeError), r.theme.accent, Object.keys(r.theme).length);' "$TMP" \
&& rm -rf "$TMP"
```

Expected: `null #d97757 13` — a widget with no repo root above it silently uses the embedded midnight defaults.

Note: run this from a directory outside the repo checkout if `mktemp -d`
resolves inside it, otherwise the upward walk could find the repo's real
`themes/` and the test would prove nothing. On macOS `mktemp -d` returns a
path under `/var/folders`, so this is normally fine.

- [ ] **Step 4: Commit**

```bash
git add claude-usage.widget.zip
git commit -m "$(cat <<'EOF'
chore: rebuild gallery zip from HEAD (now theme-aware)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `npm test` — 86 tests, all passing
- [ ] `npm run check:bundle` — both widgets compile
- [ ] `git status` — clean
- [ ] Both widgets installed and visually identical to `fb1e48f` under `midnight`
- [ ] `theme.json` → `daylight` recolours both widgets within one refresh, no restart
- [ ] `theme.json` → `synthwave` likewise, with visibly tighter corners
- [ ] Setting `"theme": "daylight"` in `dev-servers.widget/config.json` while `theme.json` says `midnight` themes the two widgets differently at the same time
- [ ] Setting `"theme": "nonexistent"` leaves both widgets on midnight and puts a message in `themeError`
- [ ] `theme.json` restored to `{ "active": "midnight" }`
