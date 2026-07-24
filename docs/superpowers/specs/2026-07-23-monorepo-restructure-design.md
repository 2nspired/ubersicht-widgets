# Monorepo Restructure — Design

**Date:** 2026-07-23
**Status:** Approved (user: "just knock it all out")

## Purpose

Formalize this repo as a multi-widget collection. It already contains two
widgets (`claude-usage.widget`, `dev-servers.widget`) but is named, documented,
and structured as if it held one.

## Decisions (user-approved)

- Merge PR #1 (dev-servers widget) first. **Done.**
- Rename the GitHub repo `claude-usage-widget` → `ubersicht-widgets`
  (old URLs auto-redirect; local folder stays `ubersicht-mac` so the
  Übersicht symlinks keep working). **Done.**
- Approach A: per-widget self-containment. Root README becomes a short
  collection index; each `*.widget` folder carries its own full README.
- Theme/shared-CSS scaffolding is **out of scope** (future work).

## Constraint discovered during design

The Übersicht gallery submission
([felixhageloh/uebersicht-widgets#716](https://github.com/felixhageloh/uebersicht-widgets/issues/716))
serves downloads from artifacts at this repo's **root**: `widget.json`,
`claude-usage.widget.zip` (committed), `screenshot.png`. These must stay at
root, unmoved. The original plan to relocate `widget.json` into the widget
folder and delete the zip is dropped.

## Changes

1. **Root `README.md`** — rewritten as a collection index: intro, one section
   per widget (screenshot, one-paragraph description, link to the widget's
   README), shared install pattern, development notes, license.
2. **`claude-usage.widget/README.md`** — new; receives the full former root
   README content (TL;DR agent-install block, install, configuration table,
   how-it-works, troubleshooting, screenshots) with relative paths and the
   renamed repo URL fixed up.
3. **`dev-servers.widget/README.md`** — new; full docs: description,
   screenshot (`docs/screenshots/dev-servers.png`, captured from mock data
   only — no personal environment details), install, configuration table,
   health-dot legend, how-it-works, security/privacy notes, troubleshooting.
4. **`docs/screenshots/dev-servers.png`** — mock-data card screenshot (2x).
5. **`scripts/package.sh <widget-folder>`** — builds a gallery-ready zip from
   committed (HEAD) content via `git archive`, guaranteeing no personal
   uncommitted config leaks into the artifact. Replaces the hand-rolled zip
   instructions in `docs/publishing.md`.
6. **`docs/publishing.md`** — updated: root-artifact contract documented,
   script referenced, repo-rename note (update gallery issue if still open),
   and how a second widget gets its own gallery submission.

## Out of scope

- Shared theme extraction (duplicated palette/card CSS noted for future).
- Gallery submission for dev-servers.widget (user's call, later).
- CI automation for zip builds.
