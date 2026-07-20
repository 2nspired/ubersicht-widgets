# Adding a provider

The widget currently ships one provider, `claude`, backed by
`claude-usage.widget/lib/logs.js` (local usage logs) and
`claude-usage.widget/lib/limits.js` (subscription limit gauges). The payload
shape and rendering pattern were built to generalize to other providers —
OpenAI, Gemini, or anything else with a usage API — without changing the
contract below. This document describes that contract so a second provider
can be added later without reverse-engineering `collect.js`/`index.jsx`
from scratch. **No second provider is wired up yet** — this is a guide for
doing it, not a description of existing behavior.

## The payload contract

`claude-usage.widget/lib/collect.js` produces one JSON payload per refresh:

```json
{
  "generatedAt": "2026-07-19T23:00:00.000Z",
  "config": { "...": "the parsed config.json, with defaults applied" },
  "providers": {
    "claude": { "logs": { "...": "..." }, "limits": { "...": "..." } }
  }
}
```

Each entry under `providers` is keyed by an arbitrary provider name (`claude`
today) and holds up to two sections, both optional:

- **`logs`** — usage/cost data derived from something you can read locally
  or fetch cheaply and often (e.g. log files, a usage-history API).
- **`limits`** — plan/quota gauges: percentage used + reset time, typically
  from an account-level usage/limits endpoint.

A provider can implement either section, both, or (in principle) neither —
`index.jsx` only reads sections that exist. Today both sections are always
present for `claude`; a future provider without a meaningful "limits"
concept (e.g. a pay-as-you-go API key with no quota) could ship `logs` only.

### `logs` section shape

```json
{
  "status": "ok",
  "today": { "costUsd": 4.82, "tokens": 2100000, "sessions": 14 },
  "week": {
    "costUsd": 21.4,
    "days": [{ "date": "2026-07-13", "costUsd": 2.1, "tokens": 900000 }]
  },
  "models": [{ "model": "claude-fable-5", "tokens": 1600000, "costUsd": 3.9 }]
}
```

`week.days` is always exactly 7 entries, oldest to newest, ending in today.
`models` is today's per-model breakdown, sorted by tokens descending.

### `limits` section shape

```json
{
  "status": "ok",
  "buckets": [
    { "id": "session", "label": "Session", "pctUsed": 22, "resetsAt": "2026-07-19T16:30:00-07:00" }
  ],
  "cached": true,
  "stale": false
}
```

`buckets` is an array of `{id, label, pctUsed, resetsAt}` — this exact shape
is what `index.jsx`'s `Gauge`/bar-rendering code consumes across all four
layouts, so any provider's limits section should normalize into it (see
`normalizeBuckets()` in `lib/limits.js` for a worked example of mapping an
arbitrary upstream response onto this shape). `stale` is an optional metadata
flag the UI uses to show a small "cached" indicator (only when `true`,
indicating the endpoint failed and we're showing last-known gauges);
`cached` is informational metadata only. Omit both if your provider doesn't
cache.

### Status semantics

Both sections use the same three-state `status` field:

| `status` | Meaning | Set by |
|---|---|---|
| `"ok"` | Data present and valid — render it. | The provider's collector function. |
| `"unavailable"` | Nothing wrong, just nothing to show (not configured, no credentials, no data yet). Renders as "quietly absent," not an error. | The provider's collector function, on an expected empty/missing-config case. |
| `"error"` | The collector threw. | Automatically, by `collect.js`'s `layer()` wrapper — **provider code should not set this itself**; just let exceptions propagate and `layer()` catches them, turning any thrown error into `{status: "error", message: <err.message>}`. |

`index.jsx` (and any layout component) should treat `"unavailable"` and
`"error"` the same way visually — both mean "don't render this section" —
the distinction exists for logs/troubleshooting, not UI branching.

## Registering a provider

1. **Write a collector module** under `claude-usage.widget/lib/`, e.g.
   `lib/openai.js`, exporting an async function that returns
   `{ logs?, limits? }` matching the shapes above:

   ```js
   // lib/openai.js
   async function collectOpenAI(opts = {}) {
     const logs = await /* fetch + shape into the logs section */;
     const limits = await /* fetch + shape into the limits section */;
     return { logs, limits };
   }
   module.exports = { collectOpenAI };
   ```

   Follow `logs.js`/`limits.js`'s pattern of accepting an `opts` object
   (env-var overrides, injectable `now`/`fetch`/`token` for tests) rather
   than reaching for `process.env` or `Date.now()` directly inside the
   function body — that's what makes the existing test suite able to
   hermetically isolate the `claude` provider without touching the real
   filesystem/Keychain/network, and the same pattern will let you unit-test
   a new provider the same way.

2. **Wire it into `collect.js`**, alongside the existing `claude` block:

   ```js
   const openai = await layer(() => {
     const { collectOpenAI } = require("./openai");
     return collectOpenAI({ /* opts */ });
   });
   providers = { claude: { logs, limits }, openai };
   ```

   `layer()` already exists in `collect.js` and gives you the `"error"`
   handling described above for free — always call your collector through
   it rather than awaiting it directly.

3. **Add pricing entries** if the provider needs cost estimation and prices
   per model differently — either extend `lib/pricing.json` with the new
   provider's model ids (if $/MTok is the right unit) or give the provider
   its own pricing file/lookup if its billing model doesn't fit the
   token-class-rate shape `costUsd()` in `logs.js` assumes.

4. **Render it** — out of scope for the current widget (only `claude` is
   rendered today), but the intended pattern is a second pill/section per
   layout, keyed off `payload.providers.<name>`, reusing the existing
   `Gauge`/`Sparkline`/formatting helpers in `index.jsx` rather than
   duplicating them. Concretely: extend each layout component
   (`Ticker`, `Ticker2Line`, `BarLayout`, `CornerCard`) to also read
   `payload.providers.openai` and render a second `divider`-separated
   cluster next to the Claude one, following the same
   `status === "ok"` gating used throughout `index.jsx` today.

## Data sources to investigate

Two natural next providers, with pointers on where their usage data lives
(neither has been investigated in depth — treat this as a starting point,
not a verified integration plan):

- **OpenAI** — the [usage dashboard
  API](https://platform.openai.com/docs/api-reference/usage) is official
  and requires an API key (a separate credential from a ChatGPT login —
  there's no equivalent of Claude Code's Keychain-stored OAuth token to
  piggyback on, so this provider would need its own config field for the
  key, e.g. `config.providers.openai.apiKey` or an env var). It exposes
  per-model token usage and cost, which should map onto the `logs` section
  fairly directly.
- **Gemini** — quota/usage info is surfaced through [Google AI
  Studio](https://aistudio.google.com/), tied to Google Cloud project
  quotas rather than a single usage endpoint the way Claude/OpenAI expose
  one. This likely maps better onto the `limits` section (rate-limit/quota
  percentages) than `logs` (cost), and would need its own credential
  handling (a GCP API key or service account) investigated before
  implementation.
