# Global Theming — Design

**Date:** 2026-08-02
**Status:** Approved design, pending implementation plan

## Purpose

Give every widget in this repo a shared, swappable visual theme. Today
`claude-usage.widget` and `dev-servers.widget` each hardcode the same palette
and card surface independently; changing the look means editing both files by
hand, and there is no way to try a different one.

After this change, `theme.json` at the repo root names an active theme, every
widget follows it within one refresh cycle, and authoring a new theme means
writing one small JSON file.

This is the first of two related projects. The system-monitor widget
(CPU / GPU / memory) is deliberately **not** in this spec; it will be
brainstormed separately and built theme-native from the start, against the
schema this project validates.

## Non-goals

- **Typography.** Font family, size, weight, and letter-spacing stay
  hardcoded and identical across themes.
- **Density.** Padding, gaps, and line-height stay hardcoded. `config.scale`
  already provides a size axis and is unaffected.
- **A theme picker UI.** Switching themes means editing `theme.json`.
- **Themes outside the repo.** No `~/.config` lookup. Themes live in the
  checkout and are version-controlled with it.
- **Retrofitting the gallery zip** into a theme-aware distribution. Standalone
  zip installs get the default theme; see "Degradation" below.

## Token schema

Thirteen tokens, covering every hardcoded visual value currently in either
widget. Values are raw CSS strings so a theme can substitute a flat color for
a gradient, or change a shadow's geometry, without a schema change.

| Token | `midnight` value | Consumers |
|---|---|---|
| `text` | `#e8eaf0` | `strong`; card `color` (both widgets) |
| `sub` | `#9aa0b0` | `sub`; dev-servers `title`; `Dot` gray/unknown |
| `muted` | `#8b90a0` | claude-usage `label` |
| `accent` | `#d97757` | `logo` ✳; sparkline bars |
| `ok` | `#5ba97f` | gauge < 50%; health dot `up` |
| `warn` | `#d9a557` | gauge 50–80%; stale uptime; ⚡ bolt; health `down` |
| `danger` | `#d97757` | gauge ≥ 80% |
| `surface` | `linear-gradient(180deg, rgba(26,29,36,.92), rgba(18,20,26,.92))` | card / pill background |
| `border` | `rgba(255,255,255,0.09)` | card border |
| `shadow` | `0 8px 30px rgba(0,0,0,0.45)` | card shadow |
| `divider` | `rgba(255,255,255,0.1)` | vertical rules |
| `track` | `rgba(255,255,255,0.12)` | gauge / bar track |
| `radius` | `12px` | card corners |

### Schema decisions

**`divider` and `track` are distinct tokens, not derived from `border`.** All
three are white-alpha under `midnight`, which makes them look redundant. They
are not: under a light theme each must become black-alpha, at different
alphas, to read correctly. Collapsing them would make `daylight` unauthorable
— precisely the failure the proof themes exist to surface.

**`danger` duplicates `accent` today** (both `#d97757`). They stay separate so
a theme can make an at-limit gauge red without recoloring the ✳ logo.

**`radius` is one token despite three current values.** dev-servers uses
`12px`, claude-usage's corner card `14px`, its 2-line ticker `16px`. These
become `var(--ub-radius)`, `calc(var(--ub-radius) + 2px)` and
`calc(var(--ub-radius) + 4px)` — pixel-identical under `midnight`, and still
responsive to a theme wanting sharper corners.

**The ticker pill's `999px` stays hardcoded.** That is layout identity, not
theme. A `radius: 0` theme yields square cards and a still-round ticker,
deliberately.

**Two label greys are preserved.** dev-servers' `title` (`#9aa0b0`) and
claude-usage's `label` (`#8b90a0`) do the same job at different values —
pre-existing drift. Both map to tokens (`sub` and `muted`) so `midnight` is
provably pixel-exact; a theme author may now set them equal in one line.

## Architecture

```
ubersicht-widgets/
├── theme.json                  # { "active": "midnight" }
├── lib/
│   └── theme.js                # canonical resolver (source of truth)
├── themes/
│   ├── midnight.json           # today's look, exact
│   ├── daylight.json           # light proof theme
│   ├── synthwave.json          # saturated dark proof theme
│   └── README.md               # token reference + authoring guide
├── scripts/
│   └── sync-themes.sh          # vendors lib/theme.js into each widget
├── claude-usage.widget/
│   ├── config.json             # optional "theme": "<name>" override
│   └── lib/theme.js            # vendored, byte-identical copy
└── dev-servers.widget/
    ├── config.json
    └── lib/theme.js            # vendored, byte-identical copy
```

### Why the resolver is vendored, not shared

`index.jsx` runs in a browser context with no `fs`, so only the collector
(Node) can read theme files. That much is forced. The remaining question is
how two collectors in sibling folders share one resolver.

A cross-folder `require("../../lib/theme.js")` would work in a checkout but
breaks the two things the repo already promises: the README's "each widget is
a self-contained folder", and `scripts/package.sh`, which ships single-folder
zips to the Übersicht gallery. A zip has no repo root above it.

So `lib/theme.js` is copied byte-identically into each widget by
`npm run sync:themes`, and a test asserts the copies have not drifted from the
canonical root file. Self-containment is preserved; drift is caught
mechanically rather than by discipline.

`themes/midnight.json` is the **single source of truth** for default values.
`lib/theme.js` embeds them as a plain object so it can stand alone inside a
zip, and a test asserts the two are deep-equal. Nothing is code-generated —
the sync script only copies files, and the defaults are kept honest by
assertion rather than by a script rewriting a JS literal.

`scripts/package.sh` archives a single widget folder from HEAD, so the
vendored `lib/theme.js` and its embedded defaults travel with the zip
automatically; no packaging change is needed.

## Resolution

`resolveTheme({ widgetDir, config })` in `lib/theme.js`, pure Node, no I/O
beyond synchronous reads:

1. **Name.** Widget `config.json` `"theme"` → repo-root `theme.json`
   `"active"` → `"midnight"`.
2. **Locate `themes/`.** Walk up from `widgetDir` (which each collector passes
   as its own `__dirname`), bounded at 3 levels. Node resolves `__dirname` to
   the realpath, so a symlinked install in
   `~/Library/Application Support/Übersicht/widgets/` correctly finds the
   checkout it points into. `UBERSICHT_WIDGETS_THEME_DIR` overrides, matching
   the existing `CLAUDE_USAGE_WIDGET_*` test-isolation convention documented
   in `docs/development.md`. Passing `widgetDir` explicitly (rather than
   reading `__dirname` inside the resolver) is what makes the resolver
   testable from `tests/` without fixture symlinks.
3. **Merge.** Shallow-merge the theme file over the embedded `midnight`
   defaults, so a partial theme declares only what it changes.
4. **Never throw.** Missing `themes/` dir, unknown name, unreadable file, or
   malformed JSON all return `midnight` and set `themeError` on the result.
   This matches the collectors' existing posture — a watchdog and a
   `main().catch` that both emit valid JSON rather than crashing the widget.

### Live switching

Both collectors re-read theme files on every run, so editing `theme.json`
takes effect within one refresh cycle — 10s for dev-servers, 60s for
claude-usage — with no Übersicht restart. This falls out of the existing
architecture at no cost.

### Degradation

| Situation | Result |
|---|---|
| Checkout, no `theme.json` | `midnight`, no error |
| Checkout, typo'd theme name | `midnight` + `themeError` |
| Malformed theme JSON | `midnight` + `themeError` |
| Standalone gallery zip (no repo root) | `midnight`, no error, no switching |

`themeError` is **payload-only and renders nothing.** The repo's stated
aesthetic is that widgets add no chrome to the desktop
(`return null; // no empty chrome on the desktop`), and a bad theme name must
not become a permanent badge. Diagnosis is documented instead:

```bash
dev-servers.widget/lib/run.sh | python3 -m json.tool | grep themeError
```

## Data flow

Each collector adds a top-level `theme` key (and `themeError` when set)
alongside its existing keys — `config` / `servers` for dev-servers,
`config` / `providers` for claude-usage. Mock payloads gain the same key so
`"mock": true` renders themed.

`index.jsx` gains one helper:

```js
const themeVars = (t) => ({
  "--ub-text": t.text,
  "--ub-sub": t.sub,
  // …13 total
});
```

applied to the widget's outermost element with `Object.assign`, and the
existing module-level ``css`…` `` constants swap literals for `var(--ub-*)`:

```js
const card = css`
  background: var(--ub-surface);
  border: 1px solid var(--ub-border);
  box-shadow: var(--ub-shadow);
  border-radius: var(--ub-radius);
  color: var(--ub-text);
`;
```

The `css` blocks stay static and module-level. Emotion generates each class
once for the process lifetime rather than a new class per render, and nested
components (`Row`, `Dot`, `Gauge`, `Sparkline`, and all four claude-usage
layouts) need no `theme` prop — they inherit through the cascade.

### Implementation constraints

- **Übersicht renders every widget into one shared document.** Custom
  properties must be set on each widget's own root element, never `:root`.
  This is what makes the per-widget `"theme"` override work; two widgets on
  the same desktop can run different themes simultaneously.
- **`index.jsx` runs through Übersicht's older Babel.** No object spread
  (hence `Object.assign`), no `??`, no `?.`, no `<>` fragments — constraints
  already documented in `docs/development.md` and observed in both files. The
  Node-side `lib/` has no such limits and already uses `??` and spread freely.
- **`var()` is not substituted inside SVG presentation attributes.** The ⚡
  bolt's `fill="#d9a557"` must become `style={{ fill: "var(--ub-warn)" }}`,
  a CSS property rather than an attribute.
- **React 16.12** (verified in Übersicht 1.6's bundle) passes `--`-prefixed
  style keys through to `setProperty`, so custom properties in the `style`
  object work as written.
- `config.scale`'s `zoom` and the existing corner/align positioning are
  untouched; theme vars sit on the same element without interaction.

## Themes shipped

Three. `midnight` alone would let an under-specified token set hide until the
first real theme needed something that was not a token.

- **`midnight`** — today's look, exact. Its purpose is to make the retrofit a
  provable no-op.
- **`daylight`** — light background. Stresses every white-alpha token
  (`border`, `divider`, `track`, `shadow`), which is where a dark-only schema
  breaks first.
- **`synthwave`** — saturated dark. Stresses `accent` / `danger` separation
  and a non-neutral `surface` gradient.

## Testing

`tests/theme.test.js`, stdlib `node --test`, matching the existing suite:

| Test | Asserts |
|---|---|
| Name precedence | widget config > root `theme.json` > `midnight` |
| Partial merge | a theme declaring only `accent` inherits the other 12 |
| Missing dir | returns `midnight`, no throw |
| Unknown name | returns `midnight` + `themeError` |
| Malformed JSON | returns `midnight` + `themeError` |
| Schema conformance | every file in `themes/` has exactly the 13 keys — no extras (catches typos), no omissions |
| Vendor drift | each widget's `lib/theme.js` is byte-identical to the root copy |
| Defaults drift | the defaults embedded in `lib/theme.js` deep-equal `themes/midnight.json` |
| **Midnight fidelity** | all 13 values equal the literals at today's HEAD |

The fidelity test pins the expected values as constants captured from the
current source, since the literals themselves disappear in the retrofit. It is
the regression anchor for "this change altered nothing visually."

`npm run check:bundle` runs esbuild over both `index.jsx` files, per the
existing guidance in `docs/development.md`:

```bash
npx esbuild <widget>/index.jsx --bundle --external:uebersicht --outfile=/dev/null
```

Manual verification: install both widgets, confirm `midnight` is
indistinguishable from HEAD, then switch `theme.json` to `daylight` and
confirm both widgets change within one refresh without a restart.

## Documentation

- `docs/theming.md` — the one canonical write-up: token reference, authoring
  a theme, per-widget override, `themeError` diagnosis.
- `themes/README.md` — a short pointer to `docs/theming.md` plus the list of
  shipped themes. Deliberately not a second copy of the token table; a
  duplicated table is a table that goes stale.
- Root `README.md` — a Theming section between "Installing a widget" and
  "Development".
- Both widget READMEs — a `theme` row in the configuration table.
- `docs/development.md` — `UBERSICHT_WIDGETS_THEME_DIR` added to the
  environment-variable table; `npm run sync:themes` noted.
