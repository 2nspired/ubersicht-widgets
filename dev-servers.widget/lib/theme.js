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
