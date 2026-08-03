# Handoff prompt — native macOS desktop widget app

Copy everything below the line into a new chat.

---

I want to design and build a **native macOS app** that replaces my Übersicht widget setup with something better: real native rendering, a proper settings panel, and a unified visual design across all widgets.

Please **brainstorm this properly before any code** — I want a design and spec first. Also **create a project for this in pigeon** and track the plan/backlog there as we go.

## What exists today

Repo: `/Users/thomastrudzinski/Projects/2nspired/ubersicht-mac` (GitHub: `2nspired/ubersicht-widgets`), a collection of Übersicht widgets — zero-dependency Node + JSX, `main` is clean and pushed. Read it before designing; it's the functional spec for what the native app must do at least as well.

**Three working widgets, plus a wallpaper dimmer:**

1. **`claude-usage.widget`** — today's Claude token spend and API-equivalent cost from local Claude Code logs, plus subscription limit gauges (session / weekly / per-model) with reset countdowns. Four layouts: ticker, ticker-2line, bar, corner.
2. **`dev-servers.widget`** — everything listening on a TCP port mapped to its project: port, command, git branch, uptime (amber past 24h), CPU/mem, health dot. Docker containers and tunnels included. Renders nothing when nothing is running.
3. **`system.widget`** — "why is my machine struggling", answered by naming the culprit. Top CPU and memory consumers **grouped by owning application**, device-level GPU shown only when busy, memory by kind with real pressure, 5 minutes of history with spike detection. Two layouts: `ghost` (history as a low-opacity background stream) and `ticker`.
4. **`dimmer.widget`** — full-viewport overlay darkening only the wallpaper.

**A 13-token theme system** shared by all widgets, applied as `--ub-*` CSS custom properties: `text, sub, muted, accent, ok, warn, danger, surface, border, shadow, divider, track, radius`. Three themes ship: `midnight` (default), `daylight`, `synthwave`. Switching `theme.json` recolours everything within one refresh.

167 tests, all stdlib `node --test`. Read `docs/theming.md` and each widget's README.

## What I want from the native app

- **Native, not a web view.** SwiftUI/AppKit, rendering directly.
- **A real control panel** — live adjustment of size, fonts, layout, spacing, colours, per widget. Right now tuning anything means editing JSON and waiting for a refresh.
- **A unifying theme and design system** across all widgets. The web version got a token system late; the native one should be designed around it from the start.
- **Built on Apple-native frameworks throughout**, chosen so future features are easy to add rather than bolted on.

## Please explicitly consider these Apple frameworks

Part of the appeal is doing this the platform's way. At minimum evaluate:

- **SwiftUI** + `MenuBarExtra` for the menubar presence; **AppKit** `NSWindow` where SwiftUI can't reach (window levels).
- **Swift Charts** for the history graphs — replaces hand-rolled SVG entirely.
- **`NSWorkspace`** for application identity: real app icons and display names in the top-consumers lists, instead of parsing executable paths.
- **Mach / `host_statistics64` / `proc_pidinfo`** for CPU and memory instead of shelling out to `ps` and `vm_stat`. The current collector spawns subprocesses every 3 seconds (~95ms each); native APIs should be dramatically cheaper.
- **IOKit** for GPU utilisation (currently scraped from `ioreg` text).
- **`SMAppService`** for launch-at-login.
- **SF Symbols** for iconography.
- **Observation** / `AsyncSequence` for data flow.
- **`NSScreen`** + `didChangeScreenParametersNotification` for multi-display.
- **`UserNotifications`** if alerting is ever wanted.
- Consider **Swift Package Manager** layout and whether it builds without Xcode (`swiftc` + hand-written `Info.plist` works; verify).

## Why not WidgetKit (already investigated — don't re-litigate, but sanity-check me)

macOS 14+ supports desktop widgets via WidgetKit, and it is the wrong tool here:

- **Refresh is system-budgeted, in minutes not seconds.** You supply a *timeline* of pre-rendered entries; the system decides when to display them. A 3-second sampling cadence and a live history graph are not achievable.
- **Size and position are system-controlled** — fixed size classes, snapped grid, user-dragged. The "adjust size, fonts, layout" control panel I want is precisely what WidgetKit does not expose.
- **Rendering is out-of-process and static** — a SwiftUI subset, no timers, no continuous animation.
- **A wallpaper dimmer is impossible** — it requires a full-screen `NSWindow` below the desktop-icon layer, and a widget extension cannot create windows.
- **Sandboxed extension** — continuous per-process sampling would have to live in the host app and pass through a shared container.

So the architecture should be a **custom app owning its own `NSWindow`s** — what Übersicht does, done natively and properly.

**But design the data layer so WidgetKit stays possible later.** A low-frequency summary widget for Notification Center or the desktop grid ("today's Claude spend", "3 servers running"), backed by the same providers via a shared App Group container, is a natural future add. Don't build it now; don't preclude it.

## Hard-won findings — carry these over, they cost hours

**Window layers are documented CoreGraphics constants**, and they're what makes a wallpaper dimmer correct:

| Layer | Value | Constant |
|---|---|---|
| Wallpaper (Dock) | −2147483624 | — |
| Desktop window | −2147483623 | `kCGDesktopWindowLevel` |
| Finder desktop icons | −2147483603 | `kCGDesktopIconWindowLevel` |
| macOS desktop widgets | −2147483601 | — |

An overlay at `kCGDesktopWindowLevel` dims the wallpaper while leaving desktop icons and widgets untouched. In Swift that's one line:
```swift
window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
```
Measured and verified: with the overlay at that level, wallpaper luminance dropped to a 0.65 ratio while the macOS Weather widget measured **pixel-identical** (1.000).

**Data-collection lessons from the widget version:**

- `ps %cpu` is a decaying average and **inverts the true ranking** — measured showing Chrome's browser process at 97% and its busiest renderer at 51% when the truth was 78% and 83%. Real CPU% requires diffing CPU-time samples over a known interval. Native `proc_pidinfo` should make this cleaner.
- **Grouping by application is essential.** This machine runs **57 Chrome processes** and **13 node processes**; ungrouped, the entire top-3 was Chrome. macOS helpers live in *nested* `.app` bundles (Docker nests three deep), so the owning app is the **first** `.app` in the path, not the last. `NSWorkspace` should replace that heuristic entirely.
- Dev processes (`node`, `python`, etc.) should be labelled by **project**, not collapsed by binary name — "node 71%" is useless with thirteen of them.
- Per-process GPU needs root (`powermetrics`); device-level via IOKit does not.
- macOS `ps` CPU time is `MINUTES:SECONDS.HUNDREDTHS` with **unbounded minutes** (`896:38.07`), not `HH:MM:SS`.
- Memory: report **pressure**, not just percentage full. 38/64 GB with pressure `normal` is healthy, and a bar alone implies a problem that doesn't exist.
- Persisted history must be written **atomically** (temp file + `rename`). A non-atomic 96 KB write every 3s produced torn reads that silently reset the ring, and the history feature was dead in production while 156 tests passed.

**Übersicht quirks** (only relevant if the two coexist during migration):
- `osascript -e 'tell application "Übersicht" to quit'` **silently fails**. So do `pkill -x` and `killall` — the umlaut defeats name matching. Only `kill <pid>` works.
- Übersicht rewrites `WidgetSettings.json` on quit, so the order to edit it is **kill → edit → launch**.

## Questions I'd like the design to settle

- Does this **replace** the Übersicht widgets or coexist during a migration?
- Is it one app with multiple widget "panes", or a host app plus a widget model that could take third-party widgets later?
- Where does configuration live, and does the existing `theme.json` / token system carry over or get redesigned?
- How much of the design system is worth formalising up front given "future adds" is an explicit goal?
- Distribution: ad-hoc signed for my own machine, or notarized for sharing?

Start by exploring the repo, then brainstorm with me. Flag early if this is really several projects rather than one — I'd rather decompose than write one enormous spec. And set up the pigeon project as part of getting started.
