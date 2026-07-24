#!/bin/bash
# Build a gallery-ready zip for a widget, from committed (HEAD) content only —
# guarantees no personal/uncommitted config leaks into the published artifact.
# Usage: scripts/package.sh <widget-folder>   e.g. scripts/package.sh claude-usage.widget
set -euo pipefail

WIDGET="${1:?usage: scripts/package.sh <widget-folder>}"
WIDGET="${WIDGET%/}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git cat-file -e "HEAD:$WIDGET" 2>/dev/null || {
  echo "error: '$WIDGET' is not a committed folder at HEAD" >&2
  exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git archive HEAD "$WIDGET" | tar -x -C "$TMP"
(cd "$TMP/$WIDGET" && zip -qr - . -x "*.DS_Store") > "$WIDGET.zip"
echo "wrote $ROOT/$WIDGET.zip (from HEAD)"
