#!/bin/bash
# Copy every canonical shared module into each widget. Widgets must stay
# self-contained: scripts/package.sh zips a single widget folder from HEAD,
# so a cross-folder require would break every gallery install.
# tests/theme.test.js fails if a copy drifts.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for WIDGET in *.widget; do
  [ -d "$WIDGET/lib" ] || continue
  for MODULE in lib/*.js; do
    cp "$MODULE" "$WIDGET/lib/$(basename "$MODULE")"
    echo "synced -> $WIDGET/lib/$(basename "$MODULE")"
  done
done
