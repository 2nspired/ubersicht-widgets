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
