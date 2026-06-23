#!/bin/bash
# iOS E2E: fresh-install the E2E build, launch (auto-login fires), screenshot.
set -e
BUNDLE=com.aa.expense
SIM_NAME="${1:-iPhone 17 Pro}"
APP=$(find /Users/cornna/project/AA/apps/app/src-tauri/gen/apple/build -name "*.app" -type d 2>/dev/null | grep -iE "sim" | head -1)
[ -z "$APP" ] && APP="/Users/cornna/Library/Developer/Xcode/DerivedData/aa-avdmsroxuklldqhipezrboisdkln/Build/Products/release-iphonesimulator/AA记账.app"
echo ">>> app: $APP"

UDID=$(xcrun simctl list devices available 2>/dev/null | grep -E "$SIM_NAME \(" | head -1 | grep -oE "[0-9A-F-]{36}")
echo ">>> udid: $UDID"
xcrun simctl boot "$UDID" 2>/dev/null || echo "(already booted)"
xcrun simctl bootstatus "$UDID" -b 2>/dev/null || true
xcrun simctl uninstall "$UDID" "$BUNDLE" 2>/dev/null || true
echo ">>> install"; xcrun simctl install "$UDID" "$APP"
echo ">>> launch (auto-login fires)"; xcrun simctl launch "$UDID" "$BUNDLE" 2>&1 | head -1
echo ">>> waiting for auth + circles…"; sleep 16
xcrun simctl io "$UDID" screenshot /tmp/ios-e2e.png
echo ">>> screenshot: $(ls -la /tmp/ios-e2e.png | awk '{print $5}')B"
echo ">>> IOS E2E DONE (udid=$UDID)"
