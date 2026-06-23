#!/bin/bash
# Full E2E on the emulator: install fresh, launch, type dev credentials into the
# WebView login form, tap 登录, and screenshot before + after.
source /Users/cornna/project/AA/scripts/android-env.sh
ADB="$ANDROID_HOME/platform-tools/adb"
APK=/Users/cornna/project/AA/apps/app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

"$ADB" wait-for-device
for i in $(seq 1 120); do [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
echo ">>> booted after ~$((i*3))s"
"$ADB" shell input keyevent 82 >/dev/null 2>&1 || true

echo ">>> fresh install"
"$ADB" uninstall com.aa.expense >/dev/null 2>&1 || true
"$ADB" install -r "$APK" 2>&1 | tail -1
"$ADB" shell am start -n com.aa.expense/.MainActivity >/dev/null 2>&1
echo ">>> waiting for login screen…"; sleep 10
"$ADB" exec-out screencap -p > /tmp/and-e2e-1.png; echo "shot1 (login) $(ls -la /tmp/and-e2e-1.png | awk '{print $5}')B"

# Screen is 1080x2400 (Pixel 6). Tap email → type, password → type, hide kb, login.
echo ">>> filling form"
"$ADB" shell input tap 540 1345; sleep 1
"$ADB" shell input text "demo@aa.local"; sleep 1
"$ADB" shell input tap 540 1490; sleep 1
"$ADB" shell input text "Password123\!"; sleep 1
"$ADB" shell input keyevent 4 >/dev/null 2>&1   # hide soft keyboard
sleep 1
"$ADB" exec-out screencap -p > /tmp/and-e2e-2.png; echo "shot2 (filled) captured"
echo ">>> tapping 登录"
"$ADB" shell input tap 540 1730
echo ">>> waiting for auth + circles to load…"; sleep 12
"$ADB" exec-out screencap -p > /tmp/and-e2e-3.png; echo "shot3 (post-login) captured"
echo ">>> top activity:"; "$ADB" shell dumpsys activity activities 2>/dev/null | grep -iE "topResumedActivity" | head -1
echo ">>> E2E DONE"
