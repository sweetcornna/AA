#!/bin/bash
# Install the stable r27 NDK with retries — the "SeekableByteChannel" zip error
# from sdkmanager is transient (partial download); retrying clears it.
source /Users/cornna/project/AA/scripts/android-env.sh
SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
PKG="ndk;27.3.13750724"
DIR="$ANDROID_HOME/ndk/27.3.13750724"

for attempt in 1 2 3 4; do
  echo ">>> NDK install attempt $attempt"
  rm -rf "$ANDROID_HOME/ndk/27.3.13750724" 2>/dev/null
  "$SDKM" "$PKG" 2>&1 | tr '\r' '\n' | grep -iE "100%|done|error|fail|warning|exception" | tail -6
  if [ -d "$DIR/toolchains" ]; then
    echo ">>> NDK OK: $(du -sh "$DIR" | cut -f1) at $DIR"
    echo ">>> NDK INSTALL DONE"
    exit 0
  fi
  echo ">>> attempt $attempt failed (no toolchains/), retrying…"
  sleep 3
done
echo ">>> NDK INSTALL FAILED after retries"
exit 1
