# claude-usage-widget

An [Übersicht](http://tracesof.net/uebersicht/) widget that shows your Claude
usage on your desktop: today's estimated cost and tokens (read from your
local Claude Code logs) plus subscription limit gauges (session / weekly /
Fable) with reset countdowns, pulled from the same usage data Claude Code's
own `/usage` command shows.

![ticker layout](docs/screenshots/ticker.png)

*(screenshot added separately — see [Screenshots](#screenshots) below)*

## What it is

Four things, refreshed every minute, in whichever layout you like:

- **Today's usage** — tokens and an API-equivalent dollar estimate for
  everything you've run through Claude Code today, broken down by model.
- **A 7-day trend** — a small sparkline / per-day breakdown depending on
  layout.
- **Subscription limit gauges** — how much of your session/weekly Claude
  usage you've used and when it resets, straight from the same data backing
  Claude Code's `/usage` command.
- **Graceful degradation** — any piece that isn't available (no logs found,
  not logged in, endpoint hiccup) just quietly disappears instead of
  breaking the widget.

## Requirements

- macOS
- [Übersicht](http://tracesof.net/uebersicht/)
- Node.js ≥ 18 (the widget shells out to `node`; see
  [Troubleshooting](#troubleshooting) if nothing renders)
- [Claude Code](https://claude.com/product/claude-code) — this is where the
  usage data comes from. No Claude Code, no data (the widget will say so
  rather than fail silently).

## Install

Clone the repo, then either symlink or drag the widget folder into your
Übersicht widgets directory.

```bash
git clone https://github.com/2nspired/claude-usage-widget.git
cd claude-usage-widget
ln -sfn "$PWD/claude-usage.widget" "$HOME/Library/Application Support/Übersicht/widgets/claude-usage.widget"
```

The symlink keeps the widget wired to your git checkout so `git pull` picks
up updates immediately. If you'd rather not symlink, just drag the
`claude-usage.widget` folder straight into
`~/Library/Application Support/Übersicht/widgets/` in Finder — Übersicht
picks it up automatically either way.

Übersicht should refresh its widget list within a few seconds. If it
doesn't, use Übersicht's menu-bar icon → **Refresh**.

## Configuration

Edit `claude-usage.widget/config.json`. All fields are optional — anything
omitted falls back to the default shown below.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `layout` | `"ticker"` \| `"ticker-2line"` \| `"bar"` \| `"corner"` | `"ticker"` | Which of the four visual layouts to render. `ticker` is a single-line pill; `ticker-2line` splits usage and gauges across two rows; `bar` is a wider horizontal card with a sparkline and model breakdown; `corner` is a compact vertical card meant for a screen corner. |
| `position.bottom` | number (px) | `8` | Distance from the bottom of the screen. |
| `position.align` | `"left"` \| `"center"` \| `"right"` | `"center"` | Horizontal placement. |
| `refreshSeconds` | number | `60` | **Informational only** — see the callout below. |
| `showCost` | boolean | `true` | Show the API-equivalent `$` estimate alongside token counts. Set `false` if you only want token counts. |
| `showFable` | `"auto"` \| `false` | `"auto"` | Whether to show the Fable-specific weekly gauge (`week_fable`), when the usage endpoint reports one. `"auto"` shows it whenever present; `false` always hides it. |
| `scale` | number | `1` | CSS zoom applied to the whole widget — handy for hi-DPI/4K displays where the default size reads small (e.g. `1.5`). |
| `mock` | boolean | `false` | Render canned sample data (`lib/mock.json`) instead of reading real logs/credentials. Useful for previewing layouts without waiting on real usage. |

> **`refreshSeconds` vs. Übersicht's `refreshFrequency`**
>
> Übersicht widgets declare their poll interval as a **static** JS export
> (`export const refreshFrequency = 60000;` in `index.jsx`) — it's read once
> when the widget loads and can't be computed from `config.json` at runtime.
> `refreshSeconds` in `config.json` exists purely as documentation of intent
> and is *not* wired to Übersicht's actual refresh loop. If you change how
> often you want the widget to refresh, edit **both**:
> `config.json`'s `refreshSeconds` *and* `index.jsx`'s
> `refreshFrequency` (in milliseconds) — and keep them in sync yourself.

## How it works

The widget shells out to a small Node script (`claude-usage.widget/lib/run.sh`
→ `collect.js`) on every Übersicht refresh, which gathers two independent
data layers and prints one JSON payload for `index.jsx` to render.

### Layer 1: local usage logs (cost & tokens)

Claude Code writes a JSONL transcript per session under every
`~/.claude*/projects/**/*.jsonl` directory on your machine (there can be more
than one `.claude*` directory if you use multiple accounts or profiles).
`lib/logs.js` reads every line's `message.usage` block, aggregates
input/output/cache-read/cache-write tokens per day and per model, and prices
them against `lib/pricing.json` (API-equivalent $/MTok rates, including
separate 5-minute and 1-hour cache-write rates, with dated model ids like
`claude-sonnet-5-20260115` and bare aliases like `sonnet` both resolving to
the right pricing row).

To avoid re-parsing every log file on every 60-second refresh, finished
files (anything with an mtime before today) are cached by path + mtime in
`~/.cache/claude-usage-widget/daily.json`. Only files that changed — or
today's still-growing session files — get re-read.

**This is entirely local and read-only.** Nothing about your usage logs is
sent anywhere.

> **The `$` figure is an API-equivalent estimate, not money spent.** It's
> computed as if every token had been billed at pay-as-you-go API rates. If
> you're on a Claude Max or Pro subscription, this number is *not* what you
> paid — your subscription is a flat fee. Think of it as a fun/useful gauge
> of how much you're actually using Claude Code (and, frankly, a pretty
> compelling argument for why the subscription is worth it).

### Layer 2: subscription limit gauges

The session/weekly percentage gauges come from the same (unofficial, not
publicly documented) endpoint behind Claude Code's own `/usage` command:
`https://api.anthropic.com/api/oauth/usage`. `lib/limits.js` reads your
existing Claude Code OAuth token — it never asks you to log in separately.

- **Where the token comes from:** primarily the macOS Keychain, under the
  `Claude Code-credentials*` services that `claude login` creates (the
  widget is multi-account aware: it enumerates every matching service and
  picks whichever unexpired token is freshest). If nothing usable is found
  there, it falls back to `~/.claude*/.credentials.json` on disk.
- **The Keychain prompt:** the first time the widget reads a given Keychain
  entry, macOS will show an "Allow access" dialog for the `security` binary.
  Click **Always Allow** so it doesn't ask again. This is a normal, one-time,
  per-entry macOS permission prompt — the widget never sees your Keychain
  password, and the token itself never leaves your machine except in the
  one HTTPS request described below.
- **Caching:** results are cached for 5 minutes in
  `~/.cache/claude-usage-widget/limits.json`. If the endpoint hiccups or
  returns a 429, the widget falls back to the last good cached result
  (marked `stale`) rather than blanking the gauges.
- **This endpoint is unofficial and undocumented.** It's the same one
  Claude Code's CLI uses internally, but Anthropic could change or remove it
  without notice. If it ever breaks, the gauges disappear and the rest of
  the widget (today's cost/tokens from your local logs) keeps working
  exactly as before — nothing else depends on it.

## Privacy

Nothing leaves your machine except **one** HTTPS request: to Anthropic's
usage endpoint, using the OAuth token your own `claude login` already
created. No analytics, no telemetry, no third-party service, no log content
ever transmitted anywhere. Reading your local `~/.claude*` log files and
Keychain entries is entirely local and read-only.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No limit gauges, but cost/tokens show fine | Not logged into Claude Code (`claude login`), or you clicked "Deny" on the Keychain prompt — delete the stale Keychain entry and re-run `claude login` to get a fresh prompt, or set `CLAUDE_USAGE_WIDGET_NO_KEYCHAIN=1` if you're intentionally opting out. |
| Cost shows `$0.00` (or lower than expected) for a model you know you used | That model id isn't in `lib/pricing.json` yet — `costUsd` silently treats unknown models as `$0`. Add a pricing entry (see the table's `input`/`output`/`cacheRead`/`cacheWrite5m`/`cacheWrite1h` columns, all $/MTok) keyed by the model id or a short alias. |
| Nothing renders at all / widget area is blank | Node.js isn't installed, or isn't on Übersicht's minimal `PATH`. `run.sh` checks `node`, `/opt/homebrew/bin/node`, and `/usr/local/bin/node` in order and prints a `node-missing` message if none are found — check Übersicht's console/log for that message, then `brew install node` or install from nodejs.org. |
| Both cost and gauges say "no data" | No Claude Code logs found under any `~/.claude*/projects` — either you haven't used Claude Code yet, or `CLAUDE_USAGE_WIDGET_HOME` is pointed somewhere unexpected. |
| Widget shows stale/old-looking numbers | The limits layer serves a cached result (look for the small "cached" label) for up to 5 minutes, or longer if the endpoint is failing and it's falling back to stale data — this is intentional, not a bug. |

## Development

```bash
npm test        # runs the full suite (node --test tests/**/*.test.js)
```

Set `"mock": true` in `config.json` (or run `collect.js` with `--mock`) to
render canned sample data from `claude-usage.widget/lib/mock.json` without
touching real logs or Keychain — handy for iterating on layouts. `--no-mock`
forces real data collection even if `config.json` has `"mock": true`.

Other environment variables used for testing/dev isolation (none of these
are needed for normal use):

| Variable | Effect |
|---|---|
| `CLAUDE_USAGE_WIDGET_HOME` | Overrides the home directory `logs.js` scans for `.claude*/projects`. |
| `CLAUDE_USAGE_WIDGET_CACHE` | Overrides the logs-layer cache file path (default `~/.cache/claude-usage-widget/daily.json`). |
| `CLAUDE_USAGE_WIDGET_CACHE_DIR` | Overrides the cache *directory* used by the limits layer (`limits.json` lives here). |
| `CLAUDE_USAGE_WIDGET_NO_KEYCHAIN` | Set to `1` to force the limits layer to `unavailable` without ever touching Keychain or the network. |

To preview the raw JSON payload the widget renders from:

```bash
./claude-usage.widget/lib/run.sh | python3 -m json.tool
```

Adding another provider (e.g. OpenAI or Gemini usage) alongside Claude?
See [`docs/adding-a-provider.md`](docs/adding-a-provider.md) for the
contract.

## Screenshots

`docs/screenshots/{ticker,ticker-2line,bar,corner}.png` — one per layout,
captured on a clean desktop. These are added separately (not generated by
this documentation pass); if they're missing, the image link above will be
broken until they're added.

## Publishing to the widget store

The [Übersicht widget gallery](https://github.com/felixhageloh/uebersicht-widgets)
doesn't host widget code directly — it points to independent widget repos.
This is that repo, already laid out the way the gallery expects it. As of
this writing, submission works like this:

1. **Your repo is the source of truth.** The gallery just links to it, so
   `claude-usage-widget` needs to be pushed to a public GitHub repo (e.g.
   `github.com/2nspired/claude-usage-widget`) before submitting.
2. **Repo root must contain** (alongside the unzipped `claude-usage.widget/`
   folder, which already lives here for browsing/PRs):
   - `widget.json` — a small manifest:
     ```json
     {
       "name": "Claude Usage",
       "description": "Shows Claude Code usage: cost/tokens from local logs plus subscription limit gauges.",
       "author": "your name",
       "email": "your email address"
     }
     ```
   - `claude-usage.widget.zip` — the zipped widget folder. Build it with:
     ```bash
     cd claude-usage.widget && zip -r ../claude-usage.widget.zip . -x "*.DS_Store" && cd ..
     ```
     (already run for this pass; the zip is gitignored and rebuilt as
     needed, since it's a derived artifact of `claude-usage.widget/`).
   - `screenshot.png` at the repo root — **must be exactly 258×160px (or
     516×320px for retina)**, or the gallery will scale/squash it. This is
     separate from the per-layout screenshots in `docs/screenshots/` and
     needs to be captured/cropped to that exact size.
3. **Submit** by opening an issue on
   [felixhageloh/uebersicht-widgets](https://github.com/felixhageloh/uebersicht-widgets/issues)
   linking to your repo URL. There's no PR-based submission — a maintainer
   picks it up from the issue.

Everything above is prepared except the two things only the widget's author
should do by hand: pushing to a public repo, capturing a properly-sized
`screenshot.png`, filling in `widget.json`'s `author`/`email`, and opening
the submission issue.

## License

MIT
