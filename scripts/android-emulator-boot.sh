#!/bin/bash
# Create the AVD (if needed) and boot the emulator headless. Stays running.
source /Users/cornna/project/AA/scripts/android-env.sh
AVD=aa_test
IMG="system-images;android-34;google_apis;arm64-v8a"
AVDMAN="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"

if ! "$AVDMAN" list avd 2>/dev/null | grep -q "Name: $AVD"; then
  echo ">>> creating AVD $AVD"
  echo "no" | "$AVDMAN" create avd -n "$AVD" -k "$IMG" -d pixel_6 --force
fi

echo ">>> booting emulator (headless)"
exec "$ANDROID_HOME/emulator/emulator" -avd "$AVD" \
  -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
  -netdelay none -netspeed full -accel auto
