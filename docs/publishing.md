# Publishing to the Übersicht widget gallery

The [gallery](https://github.com/felixhageloh/uebersicht-widgets) doesn't host
widget code; it links to independent repos. Submission is issue-based (no PR):
open an issue on the gallery repo linking your public repo.

## Submissions from this repo

| Widget | Status |
|---|---|
| `claude-usage.widget` | **Submitted** — [felixhageloh/uebersicht-widgets#716](https://github.com/felixhageloh/uebersicht-widgets/issues/716) |
| `dev-servers.widget` | Not submitted yet |

> **Repo rename:** this repo was `claude-usage-widget` when #716 was opened;
> it is now `ubersicht-widgets`. GitHub redirects the old URLs (web, git, and
> raw downloads), so the submission keeps working — but if the issue is still
> unprocessed, updating it to the new URL is polite.

## The root-artifact contract (do not move these)

The gallery serves the claude-usage listing from files at this repo's **root**:

- `widget.json` — manifest with `name`, `description`, `author`, `email`
- `claude-usage.widget.zip` — the zipped widget folder, **committed** (the
  gallery serves downloads from it)
- `screenshot.png` — exactly 258×160 px, or 516×320 for retina

They stay at root even though this is now a multi-widget repo — moving them
breaks the live listing.

## Updating a release

When a widget changes, rebuild its zip and commit it:

```bash
scripts/package.sh claude-usage.widget
git add claude-usage.widget.zip && git commit -m "chore: rebuild gallery zip"
```

The script builds from **committed (HEAD) content only** via `git archive`, so
whatever `config.json` is committed is what ships — keep committed configs at
neutral defaults, never personal settings.

## Submitting a second widget

The gallery convention is one submission per widget. When `dev-servers.widget`
(or a future widget) is ready:

1. `scripts/package.sh dev-servers.widget` and commit the resulting
   `dev-servers.widget.zip` at the repo root.
2. Add a screenshot for the gallery (258×160 or 516×320) — since `screenshot.png`
   at root belongs to claude-usage, link the new widget's issue to a distinct
   file (e.g. `docs/screenshots/dev-servers-gallery.png`) and mention it in
   the issue.
3. Open a new issue on the gallery repo pointing at this repo and the new zip.
