# Publishing to the Übersicht widget gallery

Status: **submitted** — [felixhageloh/uebersicht-widgets#716](https://github.com/felixhageloh/uebersicht-widgets/issues/716).

The [gallery](https://github.com/felixhageloh/uebersicht-widgets) doesn't host
widget code; it links to independent repos. Submission is issue-based (no PR):
open an issue on the gallery repo linking your public repo.

What the gallery expects at this repo's root (all present):

- `widget.json` — manifest with `name`, `description`, `author`, `email`
- `claude-usage.widget.zip` — the zipped widget folder, **committed** (the
  gallery serves downloads from it)
- `screenshot.png` — exactly 258×160 px, or 516×320 for retina

## Updating a release

When `claude-usage.widget/` changes, rebuild the zip with **neutral default
config** (not your personal settings) and commit it:

```bash
rm -rf /tmp/cuw-zip && mkdir -p /tmp/cuw-zip && cp -R claude-usage.widget /tmp/cuw-zip/
# reset /tmp/cuw-zip/claude-usage.widget/config.json to the defaults in README's config table
(cd /tmp/cuw-zip/claude-usage.widget && zip -qr - . -x "*.DS_Store") > claude-usage.widget.zip
```
