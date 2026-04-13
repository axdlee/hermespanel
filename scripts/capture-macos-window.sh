#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/docs/screenshots/hermespanel-window.png}"
BOUNDS_RAW="$(swift -e 'import Cocoa
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for window in info {
  let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
  if owner.lowercased().contains("hermespanel") {
    let bounds = (window[kCGWindowBounds as String] as? [String: Any]) ?? [:]
    let x = Int((bounds["X"] as? Double) ?? 0)
    let y = Int((bounds["Y"] as? Double) ?? 0)
    let width = Int((bounds["Width"] as? Double) ?? 0)
    let height = Int((bounds["Height"] as? Double) ?? 0)
    print("\\(x),\\(y),\\(width),\\(height)")
    exit(0)
  }
}
exit(1)' 2>/dev/null || true)"

if [[ -z "$BOUNDS_RAW" ]]; then
  echo "未找到 HermesPanel 窗口。请先运行 npm run tauri:dev 并把客户端窗口置于可见状态。"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

if screencapture -x -R"$BOUNDS_RAW" "$OUTPUT_PATH" 2>/dev/null; then
  echo "截图已写入: $OUTPUT_PATH"
  exit 0
fi

echo "截图失败。请在 macOS“系统设置 -> 隐私与安全性 -> 屏幕与系统音频录制”中允许当前终端后重试。"
exit 1
