# Development

```bash
npm test        # full suite (node --test tests/**/*.test.js) — stdlib only, no deps
```

Set `"mock": true` in `config.json` (or run `collect.js` with `--mock`) to
render canned sample data from `claude-usage.widget/lib/mock.json` without
touching real logs or Keychain — handy for iterating on layouts. `--no-mock`
forces real data collection even if `config.json` has `"mock": true`.

Preview the raw JSON payload the widget renders from:

```bash
./claude-usage.widget/lib/run.sh | python3 -m json.tool
```

Every module in the repo-root `lib/` is vendored into each widget. After editing
one, run `npm run sync:shared` — `npm test` fails if the copies drift. See
[theming.md](theming.md).

`npm run check:bundle` runs esbuild over every widget's `index.jsx` to catch
JSX that Übersicht's older Babel would reject. Needs network on first run.

Environment variables for test/dev isolation (never needed in normal use):

| Variable | Effect |
|---|---|
| `CLAUDE_USAGE_WIDGET_HOME` | Overrides the home directory `logs.js` scans for `.claude*/projects`. |
| `CLAUDE_USAGE_WIDGET_CACHE` | Overrides the logs-layer cache file path (default `~/.cache/claude-usage-widget/daily.json`). |
| `CLAUDE_USAGE_WIDGET_CACHE_DIR` | Overrides the cache *directory* used by the limits layer (`limits.json` lives here). |
| `CLAUDE_USAGE_WIDGET_NO_KEYCHAIN` | Set to `1` to force the limits layer to `unavailable` without touching Keychain or network. |
| `UBERSICHT_WIDGETS_THEME_DIR` | Overrides the `themes/` directory the theme resolver reads (default: nearest `themes/` walking up from the widget). |

JSX gotchas for Übersicht's older Babel: no `<>` fragment shorthand (use
`<span style={{display:"contents"}}>`), avoid `??` / `?.`. Verify bundling
with `npx esbuild claude-usage.widget/index.jsx --bundle --external:uebersicht --outfile=/dev/null`.

Related docs: [adding-a-provider.md](adding-a-provider.md) ·
[publishing.md](publishing.md)
