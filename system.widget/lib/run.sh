#!/bin/bash
# Übersicht runs commands with a minimal PATH; find node in the usual homes.
DIR="$(cd "$(dirname "$0")" && pwd)"
for NODE in node /opt/homebrew/bin/node /usr/local/bin/node; do
  if command -v "$NODE" >/dev/null 2>&1; then
    exec "$NODE" "$DIR/collect.js" "$@"
  fi
done
echo '{"status":"error","message":"system-widget needs Node.js — install from https://nodejs.org or brew install node","cpu":null}'
