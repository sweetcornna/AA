#!/usr/bin/env bash
# Build one arm64-v8a APK. Release mode requires ignored keystore.properties.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$ROOT_DIR/apps/app"
APK_ROOT="$APP_DIR/src-tauri/gen/android/app/build/outputs/apk"
MODE="${1:-release}"

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" ]]; then
  echo "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the target hosted environment." >&2
  exit 1
fi

case "$MODE" in
  release)
    if [[ ! -f "$APP_DIR/src-tauri/gen/android/keystore.properties" ]]; then
      echo "Missing apps/app/src-tauri/gen/android/keystore.properties; release signing fails closed." >&2
      exit 1
    fi
    build_args=(--ci --apk --target aarch64)
    output_dir="$APK_ROOT/universal/release"
    output_kind="release"
    ;;
  debug)
    build_args=(--debug --ci --apk --target aarch64)
    output_dir="$APK_ROOT/universal/debug"
    output_kind="debug"
    ;;
  *)
    echo "Usage: $0 [release|debug]" >&2
    exit 2
    ;;
esac

# shellcheck disable=SC1091
source "$SCRIPT_DIR/android-env.sh"

rm -rf -- "$output_dir"
cd "$APP_DIR"
npm run tauri -- android build "${build_args[@]}"

apk_count="$(find "$output_dir" -maxdepth 1 -type f -name "*$output_kind*.apk" -print | wc -l | tr -d ' ')"
expected_apk="$output_dir/app-universal-$output_kind.apk"
if [[ "$apk_count" != "1" || ! -f "$expected_apk" ]]; then
  echo "Expected only $expected_apk, found $apk_count matching APK files." >&2
  exit 1
fi
printf '%s\n' "$expected_apk"
