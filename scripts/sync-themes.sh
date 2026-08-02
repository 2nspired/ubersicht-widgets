#!/bin/bash
# Copy the canonical theme resolver into each widget. Widgets must stay
# self-contained: scripts/package.sh zips a single widget folder from HEAD,
# so a cross-folder require would break every gallery install.
# tests/theme.test.js fails if a copy drifts.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for WIDGET in *.widget; do
  [ -d "$WIDGET/lib" ] || continue
  cp lib/theme.js "$WIDGET/lib/theme.js"
  echo "synced -> $WIDGET/lib/theme.js"
done
