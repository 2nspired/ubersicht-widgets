# dimmer.widget

A full-screen wash that darkens your wallpaper by a small amount — desktop
icons, other widgets, and application windows are unaffected.

## ⚠️ Required setup step — read this first

**This widget does nothing correct until you send it to Übersicht's
background layer.** In the default (foreground) layer, the overlay renders
*above* Finder's desktop icons and dims them along with the wallpaper — the
one outcome this widget exists to avoid.

There are two ways to set it — pick one after installing (below).

### Option A: menu bar (simplest)

1. Click the Übersicht icon in the menu bar.
2. Find the **dimmer** entry in the widget list.
3. Click it, then choose **"Send to background."**

This is a one-time click; it should stick across normal restarts, but
re-check it after any Übersicht update.

### Option B: edit `WidgetSettings.json` (scriptable)

Übersicht persists per-widget settings, including the background/foreground
layer, to:

```
~/Library/Application Support/tracesOf.Uebersicht/WidgetSettings.json
```

Each widget has an entry keyed by its path with non-alphanumerics replaced
by hyphens — for this widget, `dimmer-widget-index-jsx`. The background
layer is the boolean `inBackground` in that entry. A full working entry,
confirmed to survive an Übersicht quit/relaunch:

```json
"dimmer-widget-index-jsx": {
  "showOnAllScreens": true,
  "showOnMainScreen": false,
  "showOnSelectedScreens": false,
  "hidden": false,
  "screens": [],
  "inBackground": true
}
```

Two caveats:

- The entry generally only exists once Übersicht has seen the widget at
  least once, so the practical order is: symlink the widget, let Übersicht
  load it, *then* edit the file.
- Übersicht owns this file and rewrites it. Quit Übersicht before editing,
  then relaunch — editing it while Übersicht is running risks your change
  being overwritten.

This makes the background-layer step automatable (a setup script, a
dotfiles bootstrap, a Raycast action) — the menu click is just the simplest
route for a person doing this once.

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
flat `rgba(<color>, <amount>)` wash, sitting at `z-index: -1`. All Übersicht
widgets render into one shared document, which is what keeps `claude-usage`,
`dev-servers`, and `system` painting above this widget regardless of its own
window layer — the background-layer step above is about the desktop, not
about the other widgets.

Interaction safety is by construction, not by CSS: Finder's desktop window
sits physically above Übersicht's background layer, so desktop clicks can't
reach the overlay either way. `pointer-events: none` is set anyway as
defence in depth.

## Install

```bash
git clone https://github.com/2nspired/ubersicht-widgets.git
cd ubersicht-widgets
ln -sfn "$PWD/dimmer.widget" "$HOME/Library/Application Support/Übersicht/widgets/dimmer.widget"
```

Then complete the **required step** above (menu click or config edit) — the
widget will visibly dim desktop icons until you do.

## Configuration

Edit `dimmer.widget/config.json`. All fields are optional; invalid or
out-of-range values fall back to the defaults below rather than throwing.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `amount` | number, 0–1 | `0.2` | Wash opacity, clamped to `[0, 1]`. `0.1` is arithmetically an exact ×0.9 luminance multiplier — literally "10%" — but visually near-invisible on a bright wallpaper. `0.2` is the useful default; expect a good range of `0.18`–`0.22`. |
| `color` | `"r, g, b"` string | `"0, 0, 0"` | Wash color as an RGB triple. Each channel is clamped to a valid byte. |
| `filter` | CSS filter string \| `null` | `null` | Optional `backdrop-filter` (e.g. `"blur(2px)"`, `"saturate(0.8)"`), layered on top of the flat wash — set only if you want blur/desaturate in addition to darkening. |

Übersicht re-reads `config.json` every 10 seconds (`refreshFrequency` in
`index.jsx`), so edits apply without restarting anything.

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
- **Scripted / hotkey**: a widget's per-widget `hidden` state was verified
  during research to be reachable from `osascript`, the same way
  `inBackground` is reachable via `WidgetSettings.json` (see above). That
  makes it possible to wire a Raycast script or Shortcuts action to toggle
  `dimmer.widget` without opening the menu — wrap whatever `osascript`
  invocation you use for other Übersicht automation around this widget's
  folder name, the same way you'd script hiding any other widget.

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
