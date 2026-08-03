# dimmer.widget

A full-screen wash that darkens your wallpaper by a small amount — desktop
icons, other widgets, and application windows are unaffected.

## ⚠️ Required manual step — read this first

**This widget does nothing correct until you send it to Übersicht's
background layer.** In the default (foreground) layer, the overlay renders
*above* Finder's desktop icons and dims them along with the wallpaper — the
one outcome this widget exists to avoid. Left in the foreground layer it also
renders above the other Übersicht widgets themselves, not just the desktop
icons — confirmed visually — so leaving this step undone dims everything on
screen, not only the wallpaper.

After installing (below):

1. Click the Übersicht icon in the menu bar.
2. Find the **dimmer** entry in the widget list.
3. Click it, then choose **"Send to background."**

There is no way around this click. Übersicht's per-widget window layer is
not settable from `config.json` and is not scriptable via AppleScript —
"Send to background" only exists as a manual menu action. Do it once per
Übersicht relaunch policy change (it should stick across normal restarts,
but re-check it after any Übersicht update).

Note: Übersicht persists per-widget settings, including a boolean-looking
`inBackground` key, to
`~/Library/Application Support/tracesOf.Uebersicht/WidgetSettings.json`.
Editing that key does **not** work — verified by comparing the file against
Übersicht's own live `/state/` output (its local HTTP server): Übersicht
does not read `inBackground` back from the file on load. The file is
written *by* Übersicht; it isn't a reliable input *to* it. Don't waste time
on this route — use the menu click above.

### Why this matters (measured window layers)

On this machine, `kCGWindowLayer` for the relevant surfaces measures out as:

| Layer | Value |
|---|---|
| Übersicht **background** | −2147483623 |
| Finder desktop icons | −2147483603 |
| macOS desktop widgets | −2147483601 |
| Übersicht **foreground** (default) | −1 |

A full-viewport overlay only sits *below* desktop icons when it's on
Übersicht's background layer. Left in the default foreground layer, a probe
overlay visibly tinted a folder icon and its label — with "Send to
background" the same probe left icons fully saturated, and left the macOS
Weather widget, application windows, and the sibling `claude-usage` ticker
untouched.

## What it does

A single fixed, full-viewport, `pointer-events: none` element painted with a
flat `rgba(<color>, <amount>)` wash, sitting at `z-index: 0`. All Übersicht
widgets render into one shared document, so what actually keeps
`claude-usage`, `dev-servers`, and `system` unaffected is this widget's own
*window layer* — it must be the one sitting in Übersicht's background window,
below the shared document those widgets render into — not `z-index`, which
only orders elements within a single layer. That's why the required manual
step above is not optional: skip it and this widget stays in the same
(foreground) layer as the other widgets and dims them too.

Interaction safety is by construction, not by CSS: Finder's desktop window
sits physically above Übersicht's background layer, so desktop clicks can't
reach the overlay either way. `pointer-events: none` is set anyway as
defence in depth.

### Why it renders

Two independent bugs kept this widget from painting anything after it was
first merged, both found by installing it and measuring wallpaper pixel
luminance before/after:

- **A negative `z-index` silently prevents rendering.** `z-index: -1` pushed
  the overlay behind the document root; nothing painted, at any `amount`.
  There's no console error or visual clue — the wallpaper just stays
  pixel-identical. Fixed by using `z-index: 0`; see the note above on why 0
  is correct without reopening the sibling-widget problem.
- **A missing `className` export clips the overlay to nothing.** Übersicht
  wraps each widget in a container that is not full-bleed by default, so a
  `100vw`/`100vh` overlay without an exported `className` widening that
  container renders into a zero-size box. The three sibling widgets
  (`claude-usage`, `dev-servers`, `system`) all export a `className` for the
  same reason; `dimmer.widget/index.jsx` now does too.

Both were necessary — removing either fix on its own made the overlay vanish
again. If you're debugging a "widget installed, background layer set, still
nothing dims" report, check these two before anything else.

## Install

```bash
git clone https://github.com/2nspired/ubersicht-widgets.git
cd ubersicht-widgets
ln -sfn "$PWD/dimmer.widget" "$HOME/Library/Application Support/Übersicht/widgets/dimmer.widget"
```

Then complete the **required manual step** above — the widget will visibly
dim desktop icons until you do.

## Configuration

Edit `dimmer.widget/config.json`. All fields are optional; invalid or
out-of-range values fall back to the defaults below rather than throwing.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `amount` | number, 0–1 | `0.35` | Wash opacity, clamped to `[0, 1]`. See "Opacity calibration" below — `0.35` is the lowest value verified to actually render. |
| `color` | `"r, g, b"` string | `"0, 0, 0"` | Wash color as an RGB triple. Each channel is clamped to a valid byte. |
| `filter` | CSS filter string \| `null` | `null` | Optional `backdrop-filter` (e.g. `"blur(2px)"`, `"saturate(0.8)"`), layered on top of the flat wash — set only if you want blur/desaturate in addition to darkening. |

Übersicht re-reads `config.json` every 10 seconds (`refreshFrequency` in
`index.jsx`), so edits apply without restarting anything.

### Opacity calibration (measured)

With both rendering bugs above fixed, wallpaper luminance was measured at
three fixed screen points, compared against a known-undimmed baseline
capture:

| `amount` | measured luminance ratio | result |
|---|---|---|
| 0.2 | 1.000 (pixel-identical) | nothing rendered |
| 0.35 | 0.813 / 0.812 / 0.821 | clean, visible dim |
| 0.6 | 0.495 / 0.504 / 0.513 | heavy dim |
| 1.0 | — | fully opaque black |

Two things worth knowing before you tune this:

- The relationship is **not** linear in alpha. `0.35` yields a ~0.82
  luminance ratio rather than the ~0.65 you'd expect from `1 − amount`, and
  `0.6` yields ~0.50 rather than ~0.40. Colour-space/gamma effects in
  compositing account for the gap.
- **At `0.2`, nothing rendered at all** — reproducibly, even after a
  25-second settle — while `0.35` rendered immediately. This threshold is
  unexplained; it's reported here as an observation, not a theory. Don't
  assume values just below `0.35` are safe: `0.35` is the lowest value
  actually verified to render, and values below roughly `0.3` may render
  nothing.

### `backdrop-filter` works here

Übersicht's widget window is a transparent WKWebView, and `backdrop-filter`
genuinely composites against what's behind it — measured at a 0.499 ratio
for `brightness(0.5)`, i.e. it does what CSS says it should. Set `filter` if
you'd rather blur or desaturate the desktop than just darken it; it's an
additive escape hatch, not a replacement for `amount`/`color` — set `amount`
to `0` if you want blur/desaturate with no darkening at all.

## Toggling

There's no config flag for on/off — use Übersicht's own mechanisms:

- **Menu bar**: click the widget's entry in Übersicht's menu and toggle it
  like any other widget.
- **Scripted / hotkey**: unlike the background/foreground window layer
  (menu-only, see above), a widget's per-widget `hidden` state was verified
  during research to be reachable from `osascript`. That makes it possible
  to wire a Raycast script or Shortcuts action to toggle `dimmer.widget`
  without opening the menu — wrap whatever `osascript` invocation you use
  for other Übersicht automation around this widget's folder name, the same
  way you'd script hiding any other widget.

## Multi-display

Free, by default: Übersicht's `showOnAllScreens` defaults to `true`, and one
instance of this widget covers every attached display regardless of
orientation or resolution — verified across a 3840×2160 landscape and a
2160×3840 portrait display simultaneously.

## Why no theme, no collector

This widget deliberately does not use the repo's shared theme system
(`theme.json` / `themes/*.json`, see [../docs/theming.md](../docs/theming.md)).
That system themes card *surfaces* — background, border, text tokens for a
rendered panel of data. This widget has no data and is not a card; it's a
translucent wash over the wallpaper, and "theming" a flat rgba fill would
just be `color`/`amount`, which are already its two config knobs. Likewise
there's no collector: nothing needs to be gathered on an interval, so
`command` is a plain `cat` of `config.json` rather than a script that would
print the same thing every cycle.

## More

- [Development & testing](../docs/development.md)

## License

MIT — see [LICENSE](../LICENSE).
