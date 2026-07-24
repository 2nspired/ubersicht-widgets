# ubersicht-widgets

A collection of minimalist [Übersicht](http://tracesof.net/uebersicht/)
widgets for macOS. Each widget is a self-contained folder with its own README,
config, and zero dependencies beyond Node ≥ 18.

## The widgets

### [claude-usage.widget](claude-usage.widget/) — Claude usage on your desktop

Today's tokens and API-equivalent cost from your local Claude Code logs, plus
subscription limit gauges (session / weekly / per-model) with reset
countdowns. Four layouts.

![claude-usage ticker](docs/screenshots/ticker.png)

→ [Install & docs](claude-usage.widget/README.md)

### [dev-servers.widget](dev-servers.widget/) — every dev server, at a glance

Everything listening on a port, mapped to its **project**: port, command, git
branch, uptime (amber when stale), CPU/mem, health dot. Docker containers and
tunnels included; hides itself when nothing is running. Built for AI-assisted
development, where servers get left behind.

![dev-servers card](docs/screenshots/dev-servers.png)

→ [Install & docs](dev-servers.widget/README.md)

## Installing a widget

Every widget installs the same way — clone once, symlink the widgets you want:

```bash
git clone https://github.com/2nspired/ubersicht-widgets.git
cd ubersicht-widgets
ln -sfn "$PWD/<widget-folder>" "$HOME/Library/Application Support/Übersicht/widgets/<widget-folder>"
```

The symlink keeps the widget wired to your checkout, so `git pull` picks up
updates. Each widget's README has full install steps (including a
paste-to-your-agent version) and a configuration table.

> **Note:** this repo was previously named `claude-usage-widget`; old URLs
> redirect here.

## Development

```bash
npm test   # node --test; covers all widgets' lib/ modules
```

- [Development & testing](docs/development.md)
- [Adding another provider to claude-usage](docs/adding-a-provider.md)
- [Widget gallery publishing](docs/publishing.md) — `widget.json`,
  `claude-usage.widget.zip`, and `screenshot.png` at the repo root are
  gallery-serving artifacts; build zips with `scripts/package.sh`.

## License

MIT — see [LICENSE](LICENSE).
