#!/bin/bash
# Install emulator + an arm64 system image (Apple Silicon), with retries.
# JAVA_TOOL_OPTIONS disables the AES/GHASH intrinsics so sdkmanager's large
# JVM downloads don't hit the bad_record_mac corruption (see memory note).
source /Users/cornna/project/AA/scripts/android-env.sh
export JAVA_TOOL_OPTIONS="-XX:+UnlockDiagnosticVMOptions -XX:-UseAESIntrinsics -XX:-UseGHASHIntrinsics"
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
IMG="system-images;android-34;google_apis;arm64-v8a"

yes | "$SDKM" --licenses >/dev/null 2>&1 || true
for attempt in 1 2 3 4 5; do
  echo ">>> ===== emulator+image install attempt $attempt $(date) ====="
  "$SDKM" "emulator" "$IMG" 2>&1 | tr '\r' '\n' | grep -iE "100%|done|error|fail|warning|exception|bad_record" | tail -8
  if [ -x "$ANDROID_HOME/emulator/emulator" ] && [ -d "$ANDROID_HOME/system-images/android-34/google_apis/arm64-v8a" ]; then
    echo ">>> emulator: $("$ANDROID_HOME/emulator/emulator" -version 2>/dev/null | head -1)"
    echo ">>> image dir: $(du -sh "$ANDROID_HOME/system-images/android-34/google_apis/arm64-v8a" | cut -f1)"
    echo ">>> EMULATOR INSTALL DONE"
    exit 0
  fi
  echo ">>> attempt $attempt incomplete, retrying…"; sleep 3
done
echo ">>> EMULATOR INSTALL FAILED"; exit 1
