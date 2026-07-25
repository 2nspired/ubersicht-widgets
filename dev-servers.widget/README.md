# dev-servers.widget

An [Übersicht](http://tracesof.net/uebersicht/) widget that shows every dev
server running on your machine, at a glance: which **project** it belongs to,
port, command, git branch, uptime, CPU/memory, and a health dot. Built for
AI-assisted development, where it's easy to lose track of what got started
and never stopped — anything older than a day glows amber.

![dev-servers card](../docs/screenshots/dev-servers.png)

The card hides entirely when nothing is running. Display-only — killing
things stays in your terminal.

## What it detects

- **Local dev servers** — any process of yours listening on a TCP port
  (Node/Vite/Next, Python, native Postgres/Redis, …), found via `lsof`.
- **Docker containers** — published ports are attributed to their actual
  container (name, image, compose project) via `docker ps`.
- **Tunnels** — ngrok / cloudflared / Stripe CLI, shown with a `→ ☁` marker
  when they hold no local port.
- System noise (AirPlay, browsers, media apps, Übersicht itself) is filtered
  by a built-in denylist; extend it with `ignoreProcesses` / `ignorePorts`.

## Health dot

| Dot | Meaning |
|---|---|
| ● green | Port answers HTTP (any status — even a 500 means it's up). |
| ◉ gray | Port accepts TCP but isn't HTTP (databases — normal). |
| ● amber | A process holds the port but refuses connections (zombie). |

## Install

Requires macOS, [Übersicht](http://tracesof.net/uebersicht/), and Node ≥ 18.
Docker is optional — without it, container rows simply don't appear.

```bash
git clone https://github.com/2nspired/ubersicht-widgets.git
cd ubersicht-widgets
ln -sfn "$PWD/dev-servers.widget" "$HOME/Library/Application Support/Übersicht/widgets/dev-servers.widget"
```

Smoke-test the collector directly:

```bash
dev-servers.widget/lib/run.sh | python3 -m json.tool | head -30
```

## Configuration

Edit `dev-servers.widget/config.json`. Everything is optional; defaults shown.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `position.corner` | `"top-right"` \| `"top-left"` \| `"bottom-right"` \| `"bottom-left"` | `"bottom-left"` | Which screen corner the card sits in. |
| `refreshSeconds` | number | `10` | Documentation of intent only — Übersicht's actual interval is the static `refreshFrequency` export in `index.jsx` (ms); change both to change cadence. |
| `staleHours` | number | `24` | Uptime renders amber past this age — the "orphaned by an AI session?" flag. |
| `maxRows` | number | `12` | Row cap; overflow becomes a `+N more` footer. |
| `ignoreProcesses` | string[] | `[]` | Extra processes to hide (case-insensitive prefix match; also matches docker container names). |
| `ignorePorts` | number[] | `[]` | Extra ports to hide (a row hides only when *all* its ports are ignored). |
| `show.uptime` / `.health` / `.cpu` / `.mem` / `.branch` | boolean | all `true` | Toggle individual fields per row. |
| `scale` | number | `1` | CSS zoom for the whole card — use ~`1.5` on 4K/hi-DPI displays. |
| `mock` | boolean | `false` | Render canned sample data (the screenshot above) instead of scanning. |

## How it works

A Node collector runs on each refresh and prints one JSON payload:

- `lsof -iTCP -sTCP:LISTEN` finds every listening process you own; noise is
  filtered by denylist.
- `docker ps` maps published ports back to containers and compose projects.
- Each process's working directory (`lsof -d cwd`) is walked up to the nearest
  `.git`/`package.json` to name the **project**; the branch is read straight
  from `.git/HEAD` (no git subprocess).
- `ps` supplies uptime and CPU/memory in one batched call.
- Health probes hit `127.0.0.1:<port>` in parallel (300 ms timeout; known DB
  ports skip the HTTP attempt).

**Privacy & safety:** read-only observation. External commands run via
`execFile` with fixed arguments; the only network traffic is loopback health
probes; output is a single JSON document; nothing is written to disk; the
whole scan is bounded by a 5-second watchdog.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Card never appears | Nothing is running (that's the design), or Node.js is missing from Übersicht's minimal `PATH` — `run.sh` checks `node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`. |
| `servers: scan failed` line | The collector errored or timed out; run `dev-servers.widget/lib/run.sh` in a terminal to see the payload. |
| A system process shows up | Add it to `ignoreProcesses` (or its port to `ignorePorts`) in `config.json`. |
| Docker containers missing | Docker isn't running — container rows appear only while the daemon is up. |
| Everything shows gray/amber dots | A local firewall may be blocking loopback probes; set `show.health` to `false` if you'd rather not probe. |
| Widget code changes don't appear | Übersicht's file-watcher can die silently — quit and relaunch via the menu-bar icon, or `pkill -f "bersicht.app"`. |

## More

- [Development & testing](../docs/development.md)
- [Design spec](../docs/superpowers/specs/2026-07-23-dev-servers-widget-design.md)

## License

MIT — see [LICENSE](../LICENSE).
