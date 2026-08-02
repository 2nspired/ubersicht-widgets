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

test("a theme file containing literal null returns midnight plus themeError", () => {
  const root = fixture({ midnight: MIDNIGHT, voidtheme: "null" }, "voidtheme");
  const out = withThemeDir(root, () =>
    resolveTheme({ widgetDir: root, config: {} })
  );
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.ok(out.themeError);
  assert.match(out.themeError, /voidtheme/);
});

test("a theme file containing an array returns midnight plus themeError", () => {
  const root = fixture({ midnight: MIDNIGHT, arraytheme: "[1,2,3]" }, "arraytheme");
  const out = withThemeDir(root, () =>
    resolveTheme({ widgetDir: root, config: {} })
  );
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.ok(out.themeError);
  assert.match(out.themeError, /arraytheme/);
});

test("a theme file containing a bare number returns midnight plus themeError", () => {
  const root = fixture({ midnight: MIDNIGHT, numtheme: "42" }, "numtheme");
  const out = withThemeDir(root, () =>
    resolveTheme({ widgetDir: root, config: {} })
  );
  assert.deepStrictEqual(out.theme, MIDNIGHT);
  assert.ok(out.themeError);
  assert.match(out.themeError, /numtheme/);
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

// Mirrors scripts/sync-themes.sh's own discovery (`for WIDGET in *.widget; [ -d
// "$WIDGET/lib" ]`), so any widget the sync script would vendor into is also
// drift-checked here — hardcoding the two current widget names would let a
// third widget (e.g. the planned system monitor) go unchecked.
function discoverWidgets(root) {
  return fs
    .readdirSync(root)
    .filter((name) => name.endsWith(".widget"))
    .filter((name) => {
      const libDir = path.join(root, name, "lib");
      return fs.existsSync(libDir) && fs.statSync(libDir).isDirectory();
    });
}

test("vendored resolvers are byte-identical to the canonical one", () => {
  const root = path.join(__dirname, "..");
  const widgets = discoverWidgets(root);
  assert.ok(widgets.length > 0, "expected at least one *.widget with a lib/ dir");
  const canonical = fs.readFileSync(path.join(root, "lib", "theme.js"));
  for (const widget of widgets) {
    const vendored = fs.readFileSync(path.join(root, widget, "lib", "theme.js"));
    assert.ok(
      canonical.equals(vendored),
      `${widget}/lib/theme.js has drifted — run: npm run sync:themes`
    );
  }
});

test("each index.jsx token list matches the resolver's", () => {
  const root = path.join(__dirname, "..");
  const widgets = discoverWidgets(root);
  assert.ok(widgets.length > 0, "expected at least one *.widget with a lib/ dir");
  for (const widget of widgets) {
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

// Scans source text for `var(--ub-<token>, <fallback>)` occurrences. A naive
// regex truncates at the first comma or paren, which breaks on fallbacks like
// the `surface` gradient that contain both nested parens and commas — so this
// walks character-by-character, tracking paren depth from the `var(` that is
// already open, to find the fallback's true end.
function findVarFallbacks(src) {
  const marker = "var(--ub-";
  const results = [];
  let idx = 0;
  while (true) {
    const start = src.indexOf(marker, idx);
    if (start === -1) break;
    const tokenStart = start + marker.length;
    let tokenEnd = tokenStart;
    while (tokenEnd < src.length && src[tokenEnd] !== "," && src[tokenEnd] !== ")") {
      tokenEnd++;
    }
    const token = src.slice(tokenStart, tokenEnd).trim();

    if (src[tokenEnd] === ",") {
      let i = tokenEnd + 1;
      while (i < src.length && /\s/.test(src[i])) i++;
      const fallbackStart = i;
      let depth = 1; // the "var(" above is the open paren we're inside
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      results.push({ token, fallback: src.slice(fallbackStart, i).trim() });
      idx = i + 1;
    } else {
      // No fallback for this occurrence — skip past it and keep scanning.
      idx = tokenEnd + 1;
    }
  }
  return results;
}

test("var(--ub-*, fallback) literals match MIDNIGHT exactly", () => {
  const root = path.join(__dirname, "..");
  const widgets = discoverWidgets(root);
  assert.ok(widgets.length > 0, "expected at least one *.widget with a lib/ dir");
  for (const widget of widgets) {
    const src = fs.readFileSync(path.join(root, widget, "index.jsx"), "utf8");
    const found = findVarFallbacks(src);
    assert.ok(found.length > 0, `${widget}/index.jsx has no var(--ub-*, fallback) sites`);
    for (const { token, fallback } of found) {
      assert.ok(TOKENS.includes(token), `${widget}/index.jsx: unknown token "${token}"`);
      assert.strictEqual(
        fallback, MIDNIGHT[token],
        `${widget}/index.jsx: var(--ub-${token}) fallback "${fallback}" does not match MIDNIGHT.${token} "${MIDNIGHT[token]}"`
      );
    }
  }
});
