#!/bin/bash
# Wait for the emulator to finish booting, install the APK, launch it, screenshot.
source /Users/cornna/project/AA/scripts/android-env.sh
ADB="$ANDROID_HOME/platform-tools/adb"
APK=/Users/cornna/project/AA/apps/app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
SHOT=/tmp/android-app.png

echo ">>> waiting for device…"
"$ADB" wait-for-device
echo ">>> waiting for boot_completed…"
for i in $(seq 1 120); do
  b=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$b" = "1" ] && break
  sleep 3
done
echo ">>> boot_completed=$("$ADB" shell getprop sys.boot_completed | tr -d '\r') after ~$((i*3))s"
"$ADB" shell input keyevent 82 >/dev/null 2>&1 || true   # dismiss keyguard

echo ">>> installing APK…"
"$ADB" install -r "$APK" 2>&1 | tail -3

echo ">>> launching com.aa.expense/.MainActivity"
"$ADB" shell am start -n com.aa.expense/.MainActivity 2>&1 | tail -2
echo ">>> letting webview settle…"; sleep 12

echo ">>> top activity:"; "$ADB" shell dumpsys activity activities 2>/dev/null | grep -iE "ResumedActivity|mResumedActivity|topResumedActivity" | head -2
echo ">>> screenshotting → $SHOT"
"$ADB" exec-out screencap -p > "$SHOT"
ls -la "$SHOT"
echo ">>> SMOKE DONE"
