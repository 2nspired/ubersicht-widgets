# dimmer.widget

A full-screen wash that darkens your wallpaper by a small amount — desktop
icons, other widgets, and application windows are unaffected.

## ⚠️ Required step — read this first

**This widget does nothing correct until it's in Übersicht's background
layer.** In the default (foreground) layer, the overlay renders *above*
Finder's desktop icons and dims them along with the wallpaper — the one
outcome this widget exists to avoid. Left in the foreground layer it also
renders above the other Übersicht widgets themselves, not just the desktop
icons — confirmed visually — so leaving this step undone dims everything on
screen, not only the wallpaper.

There are two verified ways to do it.

### Option A — menu bar (one-off)

1. Click the Übersicht icon in the menu bar.
2. Find the **dimmer** entry in the widget list.
3. Click it, then choose **"Send to background."**

Do it once per Übersicht relaunch policy change (it should stick across
normal restarts, but re-check it after any Übersicht update).

### Option B — edit `WidgetSettings.json` (scriptable)

Übersicht persists per-widget settings, including an `inBackground` boolean,
to `~/Library/Application Support/tracesOf.Uebersicht/WidgetSettings.json`.
This widget's entry key is `dimmer-widget-index-jsx`. Editing that key
**does** work — confirmed via Übersicht's own live `/state/` endpoint (its
local HTTP server) after a genuine restart, with the widget landing in the
background layer with no menu click involved:

```json
{
  "dimmer-widget-index-jsx": {
    "hidden": false,
    "inBackground": true
  }
}
```

Two things make this route easy to get wrong:

- **Ordering: kill → edit → launch, in that order.** Übersicht writes its
  in-memory widget state back to `WidgetSettings.json` when it quits, so an
  edit made while Übersicht is running is pointless — the next quit
  (including a relaunch) overwrites it with the old in-memory value. Edit
  the file only while the process is not running.
- **Quitting it is the hard part.** `osascript -e 'tell application
  "Übersicht" to quit'` returns success but does **not** terminate the
  app — confirmed by finding the process still running, with its original
  start time, eight hours after "successfully" quitting it. `pkill -x
  "Übersicht"` and `killall "Übersicht"` also silently fail to match it,
  almost certainly because of the umlaut in the process name. The one
  method that reliably works is killing it by PID:

  ```bash
  ps -axo pid=,comm= | grep "MacOS/Übersicht"   # find the pid
  kill <pid>                                     # terminate it — by pid, not by name
  # edit WidgetSettings.json here, while the process is confirmed dead
  open -a Übersicht                              # relaunch
  ```

  This one fact — that the standard quit commands silently no-op on this
  app — cost the most time in verifying this route works at all. If an edit
  to `WidgetSettings.json` doesn't seem to take effect, check that Übersicht
  actually restarted before concluding the file isn't read back.

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
overlay visibly tinted a folder icon and its label — with the widget in the
background layer, the same comparison (widget enabled vs. hidden, luminance
sampled at fixed points) showed the macOS Weather desktop widget at a 1.000
ratio: pixel-identical, completely unaffected. That widget sits at layer
−2147483601, above the dimmer, and stands in here as the proxy for "a
desktop element above the dimmer's layer" — desktop icons themselves weren't
in the capture region used for this measurement, so they weren't
independently confirmed this way; the layer numbers above (icons sit above
the dimmer too) are the basis for expecting them to behave the same.

## What it does

A single fixed, full-viewport, `pointer-events: none` element painted with a
flat `rgba(<color>, <amount>)` wash, sitting at `z-index: 0`. All Übersicht
widgets render into one shared document, so what actually keeps
`claude-usage`, `dev-servers`, and `system` unaffected is this widget's own
*window layer* — it must be the one sitting in Übersicht's background window,
below the shared document those widgets render into — not `z-index`, which
only orders elements within a single layer. That's why the required step
above is not optional: skip it and this widget stays in the same
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

Then complete the **required step** above (either option) — the widget will
visibly dim desktop icons until you do.

## Configuration

Edit `dimmer.widget/config.json`. All fields are optional; invalid or
out-of-range values fall back to the defaults below rather than throwing.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `amount` | number, 0–1 | `0.35` | Wash opacity, clamped to `[0, 1]`. See "Opacity calibration" below for measured results at this default, and why you may want lower once the widget is in the background layer. |
| `color` | `"r, g, b"` string | `"0, 0, 0"` | Wash color as an RGB triple. Each channel is clamped to a valid byte. |
| `filter` | CSS filter string \| `null` | `null` | Optional `backdrop-filter` (e.g. `"blur(2px)"`, `"saturate(0.8)"`), layered on top of the flat wash — set only if you want blur/desaturate in addition to darkening. |

Übersicht re-reads `config.json` every 10 seconds (`refreshFrequency` in
`index.jsx`), so edits apply without restarting anything.

### Opacity calibration (measured)

With the widget correctly placed in Übersicht's **background** layer (see
above) and `amount: 0.35`, luminance was measured by comparing screen
captures with the widget enabled vs. hidden, sampled at fixed points:

| Surface | measured luminance ratio | result |
|---|---|---|
| Wallpaper | 0.650 / 0.653 / 0.657 / 0.660 (four points) | dimmed |
| macOS Weather desktop widget | 1.000 (pixel-identical) | unaffected — see above |
| Übersicht widget cards | ~0.857 | expected: cards are 92% opaque, so the dimmed wallpaper shows through the remaining 8% |

An earlier measurement of `amount: 0.35` in the *foreground* layer (before
this widget was correctly placed) had shown a ~0.81 luminance ratio rather
than ~0.65. The two numbers aren't a contradiction — the background layer
composites differently than the foreground layer — but it means dialing in
`amount` in the foreground layer and then sending the widget to the
background afterward will land noticeably darker than expected. **Calibrate
`amount` after** completing the background-layer step above, not before. If
`0.35` reads too strong once the widget is correctly placed, try something
in the `0.15`–`0.2` range.

The relationship is **not** linear in alpha either way — `1 − amount` would
predict ~0.65 at `0.35`, which happens to land close to the background-layer
number above but not the foreground-layer one measured earlier. Treat that
as coincidence, not a formula: eyeball the result at whichever layer the
widget actually ends up in rather than computing it.

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
  during research to be reachable from `osascript`, separately from the
  `WidgetSettings.json` route documented above for the background/foreground
  layer. That makes it possible to wire a Raycast script or Shortcuts action
  to toggle `dimmer.widget` without opening the menu — wrap whatever
  `osascript` invocation you use for other Übersicht automation around this
  widget's folder name, the same way you'd script hiding any other widget.
  Note this is a different code path from quitting the app: the `hidden`
  toggle via `osascript` was verified to work, unlike `tell application
  "Übersicht" to quit`, which silently no-ops (see above).

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
