# Dev Servers Widget — Design

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan

## Purpose

An Übersicht widget that shows, at a glance, every dev server running on the
machine. AI-assisted development frequently leaves servers running whose
origin and purpose are unclear; the widget answers "what is running, which
project does it belong to, and how long has it been there?"

Display-only — no kill/open actions. Sibling widget to `claude-usage.widget`
in this repo, following the same architecture and visual language.

## Scope of detection

One unified probe plus two supplements:

1. **Port scan (primary):** every process owned by the current user listening
   on a TCP port (`lsof -nP -iTCP -sTCP:LISTEN`). Catches dev servers,
   native databases, tunnels' local UIs, Stripe listeners — anything holding
   a port.
2. **Docker:** `docker ps --format '{{json .}}'` to attribute ports held by
   Docker's proxy process to their actual containers.
3. **Tunnel sweep:** name-based `ps` check for known tunnel binaries
   (`ngrok`, `cloudflared`, `stripe`) that may not hold a meaningful local
   port. Rendered with a ☁ marker when portless.

### Noise filtering

Denylist strategy (show everything user-owned except known noise), so new
tools appear automatically:

- Built-in denylist of macOS/system processes: `rapportd`, `ControlCe`,
  `sharingd`, `mDNSResponder`, AirPlay (ports 5000/7000), browser helpers
  (Chrome/Safari/Arc), media apps (Spotify), etc.
- User-extendable via `ignoreProcesses` and `ignorePorts` in `config.json`.
- Rows are deduped: IPv4+IPv6 double-listings collapse; a process listening
  on multiple ports becomes one row showing its primary port (the lowest
  numbered one).

## Architecture

```
dev-servers.widget/
├── index.jsx          # rendering only (no data logic)
├── config.json        # user toggles
└── lib/
    ├── run.sh         # Übersicht entry point: exec node collect.js
    ├── collect.js     # orchestrator → prints one JSON payload to stdout
    ├── ports.js       # lsof scan + parse + noise filter
    ├── docker.js      # docker ps merge
    ├── enrich.js      # project mapping, uptime, cpu/mem, git branch
    ├── health.js      # parallel liveness probes
    └── mock.json      # fixture for development and tests
```

- `index.jsx` sets `refreshFrequency = 10000` (10s; a full scan costs
  ~100–300ms).
- All lib modules export plain functions (parsers separated from process
  execution) so they are unit-testable with the existing `tests/` setup.

## Enrichment (per row)

| Field | Source | Notes |
|---|---|---|
| Project name | `lsof -p PID -d cwd`, then walk up from cwd to nearest dir containing `.git` or `package.json`; use its basename | The anchor of each row. Falls back to command name when no project root found. |
| Uptime | `ps -o etime=` parsed to `45m` / `2h` / `3d` | Rendered amber when older than `staleHours` (default 24) — the orphan flag. |
| CPU / memory | `ps -o %cpu=,rss=`, one batched call for all PIDs | |
| Git branch | Read `<projectRoot>/.git/HEAD` directly | File read only; no git subprocess. Detached HEAD → short SHA. |
| Health dot | Parallel probe of `127.0.0.1:PORT`, 300ms timeout | See semantics below. |
| Docker fields | Container name, image, `com.docker.compose.project` label | Compose project label used as project name when present. |

### Health dot semantics

- **Green** — any HTTP response, including 4xx/5xx (a 500 still means the
  server is up).
- **Gray** — TCP connects but the service is not HTTP (postgres, redis).
  Normal, not an error. Known DB ports skip the HTTP attempt and go straight
  to TCP connect.
- **Amber** — process exists but the port refuses connections (zombie /
  crashed-but-holding-port).

## Rendering

Corner card, top-right by default (configurable corner). Dark glass styling
reused from `claude-usage.widget` so the two read as a family.

```
● 2nspired      :3000 next dev   main ⎇    2h   1% · 210MB
● acme-api      :8080 node       fix/auth  3d   0% · 96MB
◉ db (docker)   :5432 postgres:16          5h
● ngrok         → ☁                        45m
```

- One row per server: health dot, project name (bold), `:port`, short
  command, branch, uptime, cpu/mem (muted).
- Sorted by project name, then port — related processes cluster.
- **Hidden entirely** when nothing survives filtering (no empty chrome).
- Capped at `maxRows` (default 12) with a `+N more` footer.

## Configuration (`config.json`)

```json
{
  "position": { "corner": "top-right" },
  "refreshSeconds": 10,
  "staleHours": 24,
  "maxRows": 12,
  "ignoreProcesses": [],
  "ignorePorts": [],
  "show": {
    "uptime": true,
    "health": true,
    "cpu": true,
    "mem": true,
    "branch": true
  }
}
```

Every secondary field is individually toggleable. `refreshFrequency` in
`index.jsx` is static (Übersicht requirement) and kept in sync with
`refreshSeconds` by convention, as in `claude-usage.widget`.

## Security

The widget is read-only observation and must stay that way:

- **No shell interpolation of untrusted data.** Process names, container
  names, image names, compose labels, cwd paths, and branch names all
  originate from processes the widget observes and must be treated as
  untrusted. All external commands run via `execFile` (argv arrays), never
  `exec`/string-built shells. Fixed argv only — observed values are never
  passed as command arguments except PIDs, which are validated as integers
  first.
- **No remote traffic.** Health probes connect exclusively to `127.0.0.1`;
  the port comes from the lsof scan, parsed as an integer. Probes never
  follow redirects and read at most the response status line/headers.
- **Output encoding.** Collector output is a single JSON document
  (`JSON.stringify`), so hostile process/branch names cannot break the
  payload. React/JSX rendering escapes by default; no `dangerouslySetInnerHTML`.
- **Least privilege.** Runs as the logged-in user; only user-owned processes
  are scanned. No sudo, no writes anywhere (no cache files, no state).
- **Resource bounds.** Global collector timeout (5s) and per-probe timeout
  (300ms) so a hung `docker ps` or unresponsive port cannot pile up
  processes across refreshes.
- **Path traversal.** The project-root walk reads only `.git/HEAD` and
  checks existence of `.git`/`package.json`; it never follows the walk
  outside the process's own cwd ancestry and stops at `$HOME` or `/`.

## Error handling

- Collector failure → widget shows one small muted line
  (`servers: scan failed`) so "nothing running" is distinguishable from
  "widget broken".
- Per-source failures degrade to missing fields, never a crash: Docker not
  running → zero docker rows, silently; PID vanishes mid-scan → row dropped;
  unreadable `.git/HEAD` → no branch shown.
- Malformed lines from `lsof`/`ps`/`docker` are skipped individually.

## Testing

Unit tests (existing `tests/` setup) over captured fixtures:

- `lsof` output parsing, including IPv6 double-listings and multi-port
  processes.
- `etime` parsing (`mm:ss`, `hh:mm:ss`, `d-hh:mm:ss`).
- `.git/HEAD` parsing (branch ref, detached HEAD).
- `docker ps` JSON parsing and port→container attribution.
- Noise filter (denylist + config ignores).
- Health-dot state mapping.
- `mock.json` drives `index.jsx` rendering during development.

## Out of scope (YAGNI)

- Kill/open/click actions (display-only).
- Background daemon or persistent state/history.
- Non-TCP servers (unix sockets), remote hosts.
- Windows/Linux support.
