#!/bin/bash
# Boot an iOS simulator, install the freshly built .app, launch it, screenshot.
# Assumes `tauri ios build --target aarch64-sim` already produced the .app.
set -e
BUNDLE=com.aa.expense
SIM_NAME="${1:-iPhone 16 Pro}"
APP=$(find /Users/cornna/project/AA/apps/app/src-tauri/gen/apple/build -name "*.app" -type d 2>/dev/null | grep -iE "sim|debug" | head -1)
[ -z "$APP" ] && APP=$(find /Users/cornna/project/AA/apps/app/src-tauri/gen/apple -name "*.app" -type d 2>/dev/null | head -1)
echo ">>> app bundle: ${APP:-NOT FOUND}"
[ -z "$APP" ] && { echo ">>> no .app built"; exit 1; }

UDID=$(xcrun simctl list devices available 2>/dev/null | grep -E "$SIM_NAME \(" | head -1 | grep -oE "[0-9A-F-]{36}")
[ -z "$UDID" ] && UDID=$(xcrun simctl list devices available 2>/dev/null | grep -oE "[0-9A-F-]{36}" | head -1)
echo ">>> simulator UDID: $UDID"

xcrun simctl boot "$UDID" 2>/dev/null || echo ">>> (already booted)"
xcrun simctl bootstatus "$UDID" -b 2>/dev/null || true
echo ">>> installing app"
xcrun simctl install "$UDID" "$APP"
echo ">>> launching $BUNDLE"
xcrun simctl launch "$UDID" "$BUNDLE" 2>&1 | head -1
echo ">>> letting webview settle…"; sleep 10
xcrun simctl io "$UDID" screenshot /tmp/ios-app.png
echo ">>> screenshot: $(ls -la /tmp/ios-app.png | awk '{print $5}')B"
echo ">>> IOS SMOKE DONE (udid=$UDID)"
