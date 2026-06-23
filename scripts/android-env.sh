# Source this before any Android/Tauri-Android command.
# Toolchain installed via Homebrew (no sudo): OpenJDK 17 + android-commandlinetools.
# Force the stable Rust toolchain (>= 1.85, has edition2024). The Gradle rust
# task invokes cargo from a cwd where src-tauri/rust-toolchain.toml is NOT an
# ancestor, so without this it falls back to the global default (1.82) and fails
# with "feature edition2024 not stabilized". RUSTUP_TOOLCHAIN wins everywhere.
export RUSTUP_TOOLCHAIN="stable"
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# NDK_HOME: prefer a pinned stable NDK (r27) over any beta that may also be present.
# Falls back to the newest installed NDK if the pinned one is absent.
# Uses `find` (not shell globs) so it is safe under zsh nullglob.
if [ -d "$ANDROID_HOME/ndk" ]; then
  _pin="$(find "$ANDROID_HOME/ndk" -maxdepth 1 -type d -name '27.*' 2>/dev/null | sort -V | tail -1)"
  if [ -z "$_pin" ]; then
    _pin="$(find "$ANDROID_HOME/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
  fi
  [ -n "$_pin" ] && export NDK_HOME="$_pin"
  unset _pin
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
