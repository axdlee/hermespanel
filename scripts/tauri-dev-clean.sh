#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CURRENT_PID="$$"
CURRENT_PPID="$PPID"
DEBUG_BINARY="$ROOT_DIR/src-tauri/target/debug/hermespanel"
DEBUG_APP_BINARY="$ROOT_DIR/src-tauri/target/debug/bundle/macos/HermesPanel.app/Contents/MacOS/hermespanel"
TAURI_NODE_BINARY="$ROOT_DIR/node_modules/.bin/tauri"

while IFS= read -r line; do
  PID="${line%% *}"
  COMMAND="${line#* }"

  if [[ "$PID" == "$CURRENT_PID" || "$PID" == "$CURRENT_PPID" ]]; then
    continue
  fi

  if [[ "$COMMAND" == "$DEBUG_BINARY"* \
    || "$COMMAND" == "$DEBUG_APP_BINARY"* \
    || "$COMMAND" == *"$TAURI_NODE_BINARY dev"* \
    || ( "$COMMAND" == *"cargo  run --no-default-features --color always --"* && "$COMMAND" == *"$ROOT_DIR/src-tauri"* ) ]]; then
    kill "$PID" 2>/dev/null || true
  fi
done < <(ps -axo pid=,command=)

sleep 1

cd "$ROOT_DIR"
exec tauri dev
