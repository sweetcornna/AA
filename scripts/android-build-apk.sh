#!/bin/bash
# Build the arm64 debug APK. Retries up to 4x: Gradle caches every jar that
# downloads cleanly, so even if a flake slips through, each run converges.
cd /Users/cornna/project/AA/apps/app
source /Users/cornna/project/AA/scripts/android-env.sh
GRADLEW=/Users/cornna/project/AA/apps/app/src-tauri/gen/android/gradlew
APK_DIR=/Users/cornna/project/AA/apps/app/src-tauri/gen/android/app/build/outputs/apk

# Restart the daemon so the new -XX intrinsic flags take effect.
"$GRADLEW" --stop 2>/dev/null || true
pkill -f GradleDaemon 2>/dev/null || true

for attempt in 1 2 3 4; do
  echo ">>> ===== APK build attempt $attempt $(date) ====="
  npm run tauri -- android build --debug --apk --target aarch64 2>&1
  rc=$?
  apk=$(find "$APK_DIR" -name "*debug*.apk" 2>/dev/null | head -1)
  if [ -n "$apk" ]; then
    echo ">>> APK BUILT: $apk ($(du -h "$apk" | cut -f1))"
    echo ">>> APK BUILD DONE"
    exit 0
  fi
  echo ">>> attempt $attempt rc=$rc, no APK yet — retrying"
  sleep 4
done
echo ">>> APK BUILD FAILED after retries"
exit 1
