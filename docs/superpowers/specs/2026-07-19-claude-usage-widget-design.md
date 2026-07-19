# Claude Usage Widget — Design Spec

**Date:** 2026-07-19
**Status:** Approved by Thomas (brainstorming session)
**Repo:** `ubersicht-mac` → renamed to `claude-usage-widget`

## Summary

An Übersicht widget for macOS that displays personal Claude usage as a minimalist
bottom-of-screen ticker: today's estimated cost and tokens from local Claude Code
logs, plus subscription limit gauges (session / weekly / Fable) with reset
countdowns. Built mock-data-first; designed for eventual publication to the
Übersicht widget store and extensible to other providers (OpenAI, Gemini).

## Goals

1. Always-visible, glanceable Claude usage on the desktop.
2. All metrics available from local data: cost, tokens, sessions, per-model
   split, daily/weekly trends.
3. Subscription limit percentages with reset times, matching the Claude console
   ("Current session", "All models" weekly, "Fable" weekly buckets).
4. Super clean, minimalist design; multiple layouts selectable via config.
5. Zero-dependency, drag-in install suitable for the widget store.
6. Provider-extensible payload schema; docs for adding OpenAI/Gemini later.

## Non-goals (MVP)

- OpenAI/Gemini data collection (schema + docs only).
- Auth flows: no API keys, no OAuth dance — we reuse Claude Code's existing
  credentials read-only.
- Admin/organization usage (pay-as-you-go API orgs); this is personal-usage only.
- Predicted energy cost and deeper analytics (future sidequest; enabled by the
  daily aggregate cache).

## Verified data sources

### 1. Local Claude Code logs (backbone — verified on this machine)

`~/.claude*/projects/**/*.jsonl` (this machine uses `~/.claude-personal`).
Each assistant message line includes:

```json
{
  "timestamp": "2026-07-19T22:36:10.230Z",
  "message": {
    "model": "claude-fable-5",
    "usage": {
      "input_tokens": 2,
      "cache_creation_input_tokens": 19248,
      "cache_read_input_tokens": 20410,
      "output_tokens": 214,
      "service_tier": "standard"
    }
  }
}
```

No auth required; updates live during sessions.

### 2. Subscription limits endpoint (gauges)

The endpoint behind Claude Code's `/usage` command reports per-bucket
utilization percentage and `resets_at`. Confirmed buckets on Thomas's Max 20x
account (console screenshot 2026-07-19): **Current session** (resets in
hours/minutes), **Weekly all models**, **Weekly Fable** (both reset Mon 6:00 PM).
This endpoint is **undocumented/unofficial** — see Error handling. Auth: Claude
Code's OAuth token from the macOS Keychain (read-only,
`security find-generic-password`, one "Always Allow" prompt).

### 3. Rejected: Anthropic Admin Usage & Cost API

Official but org-admin-key-only and covers pay-as-you-go API usage, not Max/Pro
subscription usage. Not applicable.

## Architecture (chosen: self-contained widget + bundled data script)

Alternatives considered: background launchd agent writing JSON (rejected: two
installables, overkill), shelling to `ccusage` (rejected: uncontrolled external
dependency, cold-start cost, still need our own gauges code).

```
claude-usage-widget/
├── claude-usage.widget/        # installable unit — drag into Übersicht
│   ├── index.jsx               # command + refreshFrequency + render; all layouts
│   ├── config.json             # user settings
│   └── lib/
│       ├── collect.js          # entrypoint the widget runs; merges layers → one JSON payload
│       ├── logs.js             # JSONL aggregation (tokens, cost, sessions, trends)
│       ├── limits.js           # usage-endpoint fetch via Keychain creds
│       ├── pricing.json        # per-model $/MTok incl. cache read/write rates
│       └── mock.json           # canned payload, exact production schema
├── docs/
│   ├── superpowers/specs/      # this spec
│   └── adding-a-provider.md    # provider extension contract
├── README.md
└── package.json                # dev/test tooling only; runtime is dep-free
```

- Runtime requires only Node (any recent LTS) — standard library covers files,
  JSON, HTTPS, and `child_process` for `security`. No npm installs for users.
- Übersicht contract: `command` runs `node lib/collect.js`; `refreshFrequency`
  default 60 000 ms; `render({output})` parses the JSON payload.

## UI & configuration

Layouts (dispatch on `config.layout`):

| Value | Description | Phase |
|---|---|---|
| `ticker` (default) | One-line pill: `✳ $4.82 · 2.1M │ Session 62% ▰▰▱ 2h 14m │ Week 31% ▰▱▱ Mon 6pm │ Fable 24% ▰▱▱ Mon 6pm` | 1 |
| `ticker-2line` | Line 1: today + 7-day cost. Line 2: gauges with longer bars, full reset labels | 1 |
| `bar` | Wide sectioned bar: today · 7-day sparkline · model split · gauges | 4 |
| `corner` | Bottom-corner card, vertical stack with sparkline | 4 |

Visual language (from approved mockups): dark translucent pill
(`rgba(26,29,36,0.92)` gradient), 1 px `rgba(255,255,255,0.09)` border, SF Pro /
system font, tabular numerals, 10–11 px secondary text `#9aa0b0`. Gauge bars
4 px tall: green `#5ba97f` → amber `#d9a557` at ≥50 % → red `#d97757` at ≥80 %.
Positioned bottom-center above the Dock (offset configurable).

`config.json`:

```json
{
  "layout": "ticker",
  "position": { "bottom": 8, "align": "center" },
  "refreshSeconds": 60,
  "showCost": true,
  "showFable": "auto",
  "mock": false
}
```

`showFable: "auto"` renders the Fable gauge only when the account reports that
bucket.

## Data payload contract

`collect.js` prints exactly one JSON object (provider-namespaced from day one):

```json
{
  "generatedAt": "2026-07-19T13:30:00Z",
  "providers": {
    "claude": {
      "logs": {
        "status": "ok",
        "today": { "costUsd": 4.82, "tokens": 2100000, "sessions": 14 },
        "week": { "costUsd": 21.40, "days": [{ "date": "2026-07-13", "costUsd": 2.10, "tokens": 900000 }] },
        "models": [{ "model": "claude-fable-5", "tokens": 1600000, "costUsd": 3.90 }]
      },
      "limits": {
        "status": "ok",
        "buckets": [
          { "id": "session", "label": "Session", "pctUsed": 62, "resetsAt": "2026-07-19T16:30:00Z" },
          { "id": "week_all", "label": "Week", "pctUsed": 31, "resetsAt": "2026-07-20T18:00:00-07:00" },
          { "id": "week_fable", "label": "Fable", "pctUsed": 24, "resetsAt": "2026-07-20T18:00:00-07:00" }
        ]
      }
    }
  }
}
```

Layer `status` values: `ok` | `unavailable` | `error` (with optional `message`).
`mock.json` conforms to this schema exactly.

### Aggregation & performance

- Files with mtime older than today's midnight are parsed once and folded into
  `~/.cache/claude-usage-widget/daily.json` (keyed by path + mtime); refreshes
  re-read only files modified today.
- Cost = per-usage-record tokens × `pricing.json` rates, with distinct rates for
  input, output, cache write (5 m/1 h), and cache read. Pricing table versioned
  in-repo; unknown models fall back to token display without cost.
- "Session count" = distinct JSONL files with activity that day.

## Error handling & degradation

Per-layer, never fatal:

| Failure | Behavior |
|---|---|
| Keychain denied / no Claude Code login / endpoint changed or removed | `limits.status: "unavailable"`; gauges hidden; ticker shows cost/tokens only with a subtle one-time hint |
| No JSONL logs found | `logs.status: "unavailable"`; gauges-only ticker |
| Node missing | Übersicht surfaces our friendly one-line install hint (command wrapper), not a stack trace |
| Malformed JSONL lines | skipped, counted, never crash |

The unofficial-endpoint risk is isolated to `lib/limits.js`; a breakage degrades
gauges without touching the rest of the widget.

## Testing

- Unit tests (dev-only tooling) over `logs.js` pure functions with fixture JSONL
  files: aggregation, cache-invalidation by mtime, pricing math, malformed-line
  handling.
- `limits.js` response-normalization tested against captured fixture responses.
- Visual/manual: `mock: true` mode drives all layouts for on-desktop review.

## Build phases

1. **Mock + UI** — wipe repo (old widgets recoverable from git history),
   scaffold structure, ticker A1 + A2 on `mock.json`, polish on the real desktop.
2. **Local logs** — `logs.js` + cache + pricing + tests.
3. **Limits** — Keychain read, endpoint fetch, normalization, degradation paths.
4. **Layouts + store prep** — `bar` and `corner` layouts, README, screenshots,
   Übersicht widget-store submission.

## Future (explicitly out of MVP)

- OpenAI / Gemini collector modules per `docs/adding-a-provider.md`.
- Token-trend analytics and predicted energy cost from the daily cache.
- Hover-to-expand interactions.
