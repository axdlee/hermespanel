#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${HERMESPANEL_DEV_PORT:-1420}"

LISTEN_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"

if [[ -n "$LISTEN_PID" ]]; then
  COMMAND_LINE="$(ps -p "$LISTEN_PID" -o command= 2>/dev/null || true)"

  if [[ "$COMMAND_LINE" == *"$ROOT_DIR"* && "$COMMAND_LINE" == *"vite"* ]]; then
    echo "复用已存在的 HermesPanel Vite 开发服务: 127.0.0.1:$PORT (pid $LISTEN_PID)"
    while kill -0 "$LISTEN_PID" 2>/dev/null; do
      sleep 2
    done
    exit 0
  fi

  echo "端口 $PORT 已被其他进程占用，无法启动 HermesPanel 开发服务。"
  echo "$COMMAND_LINE"
  exit 1
fi

cd "$ROOT_DIR"
exec npm run dev:vite
