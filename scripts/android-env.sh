#!/usr/bin/env bash
# Source this before any Android/Tauri-Android command.

export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-stable}"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  fi
  if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@17 ]]; then
    JAVA_HOME="/opt/homebrew/opt/openjdk@17"
  fi
  export JAVA_HOME
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
  for candidate in \
    "${ANDROID_SDK_ROOT:-}" \
    "/opt/homebrew/share/android-commandlinetools" \
    "$HOME/Library/Android/sdk"; do
    if [[ -n "$candidate" && -d "$candidate/platform-tools" && -d "$candidate/build-tools" ]]; then
      export ANDROID_HOME="$candidate"
      break
    fi
  done
fi

if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
  echo "Android SDK not found. Set ANDROID_HOME to an installed SDK." >&2
  return 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  echo "JDK 17 not found. Set JAVA_HOME to an installed JDK 17." >&2
  return 1
fi

pinned_ndk="$ANDROID_HOME/ndk/27.3.13750724"
if [[ -d "$pinned_ndk" ]]; then
  export NDK_HOME="$pinned_ndk"
elif [[ -z "${NDK_HOME:-}" ]]; then
  echo "Pinned Android NDK 27.3.13750724 is not installed under $ANDROID_HOME/ndk." >&2
  return 1
fi
unset pinned_ndk

path_entries=("$JAVA_HOME/bin" "$ANDROID_HOME/cmdline-tools/latest/bin" "$ANDROID_HOME/platform-tools")
for path_entry in "${path_entries[@]}"; do
  if [[ -d "$path_entry" && ":$PATH:" != *":$path_entry:"* ]]; then
    PATH="$path_entry:$PATH"
  fi
done
unset path_entry path_entries
export PATH
