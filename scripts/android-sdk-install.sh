#!/bin/bash
# Waits for android-commandlinetools to land, then installs the SDK packages
# Tauri Android needs: platform-tools, a platform, build-tools, and an NDK.
set -e
source /Users/cornna/project/AA/scripts/android-env.sh
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"

echo ">>> waiting for sdkmanager…"
until [ -x "$SDKM" ]; do sleep 3; done
echo ">>> sdkmanager ready: $("$SDKM" --version 2>/dev/null)"

# Accept all licenses non-interactively.
yes | "$SDKM" --licenses >/dev/null 2>&1 || true

# Pick the newest stable NDK that sdkmanager offers.
NDK_PKG=$("$SDKM" --list 2>/dev/null | grep -oE 'ndk;[0-9.]+' | sort -V | tail -1)
echo ">>> newest NDK package: ${NDK_PKG:-<none found>}"

echo ">>> installing core SDK packages…"
"$SDKM" "platform-tools" "platforms;android-34" "build-tools;34.0.0" "$NDK_PKG"

echo ">>> installed packages:"
"$SDKM" --list_installed 2>/dev/null || true
echo ">>> ANDROID SDK INSTALL DONE"
