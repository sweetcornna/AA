#!/usr/bin/env bash
# Verify and package one signed production arm64-v8a APK.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APK_PATH="${1:-}"
OUTPUT_DIR="${2:-$ROOT_DIR/dist/android}"

if [[ -z "$APK_PATH" || ! -f "$APK_PATH" ]]; then
  echo "Usage: $0 <signed-release.apk> [output-directory]" >&2
  exit 2
fi
: "${AA_ANDROID_CERT_SHA256:?Set AA_ANDROID_CERT_SHA256 to the pinned release certificate SHA-256 fingerprint}"
: "${AA_ANDROID_EXPECTED_VERSION_CODE:?Set AA_ANDROID_EXPECTED_VERSION_CODE to the approved Android versionCode}"
: "${AA_ANDROID_PRODUCTION_ORIGIN:?Set AA_ANDROID_PRODUCTION_ORIGIN to https://aa-api.cornna.xyz}"
: "${AA_ANDROID_STAGING_ORIGIN:?Set AA_ANDROID_STAGING_ORIGIN to https://aa-staging-api.cornna.xyz}"

EXPECTED_CERT="$(printf '%s' "$AA_ANDROID_CERT_SHA256" | tr '[:lower:]' '[:upper:]' | tr -d ':')"
if [[ ! "$EXPECTED_CERT" =~ ^[0-9A-F]{64}$ ]]; then
  echo "AA_ANDROID_CERT_SHA256 must be a 32-byte SHA-256 fingerprint." >&2
  exit 1
fi
if [[ "$AA_ANDROID_PRODUCTION_ORIGIN" != "https://aa-api.cornna.xyz" ]]; then
  echo "AA_ANDROID_PRODUCTION_ORIGIN must be exactly https://aa-api.cornna.xyz." >&2
  exit 1
fi
if [[ "$AA_ANDROID_STAGING_ORIGIN" != "https://aa-staging-api.cornna.xyz" ]]; then
  echo "AA_ANDROID_STAGING_ORIGIN must be exactly https://aa-staging-api.cornna.xyz." >&2
  exit 1
fi
if [[ "$AA_ANDROID_EXPECTED_VERSION_CODE" != "3" ]]; then
  echo "AA_ANDROID_EXPECTED_VERSION_CODE must be exactly 3 for version 0.0.3." >&2
  exit 1
fi

if [[ -z "${NDK_HOME:-}" ]]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/android-env.sh"
fi
ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-}"
if [[ -z "$ANDROID_BUILD_TOOLS" ]]; then
  ANDROID_BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -1)"
fi
AAPT="$ANDROID_BUILD_TOOLS/aapt"
APKSIGNER="$ANDROID_BUILD_TOOLS/apksigner"
READELF="${NDK_HOME:-}/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
if [[ "$(uname -s)" == "Darwin" ]]; then
  READELF="${NDK_HOME:-}/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-readelf"
fi
for tool in "$AAPT" "$APKSIGNER" "$READELF" unzip shasum python3; do
  if [[ "$tool" == */* ]]; then
    [[ -x "$tool" ]] || { echo "Required tool not executable: $tool" >&2; exit 1; }
  else
    command -v "$tool" >/dev/null || { echo "Required tool not found: $tool" >&2; exit 1; }
  fi
done

BADGING="$($AAPT dump badging "$APK_PATH")"
PERMISSIONS="$($AAPT dump permissions "$APK_PATH")"
XMLTREE="$($AAPT dump xmltree "$APK_PATH" AndroidManifest.xml)"
CERT_OUTPUT="$($APKSIGNER verify --verbose --print-certs "$APK_PATH")"

require_text() {
  local haystack="$1" needle="$2" message="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "$message" >&2
    exit 1
  fi
}

require_text "$BADGING" "package: name='com.aa.expense'" "Unexpected Android application ID."
VERSION_NAME="$(printf '%s\n' "$BADGING" | grep -o "versionName='[^']*'" | head -1 | cut -d"'" -f2)"
VERSION_CODE="$(printf '%s\n' "$BADGING" | grep -o "versionCode='[^']*'" | head -1 | cut -d"'" -f2)"
CONFIG_VERSION="$(node -e "const fs = require('node:fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$ROOT_DIR/apps/app/src-tauri/tauri.conf.json")"
CONFIG_VERSION_CODE="$(node -e "const fs = require('node:fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).bundle.android.versionCode)" "$ROOT_DIR/apps/app/src-tauri/tauri.conf.json")"
[[ "$CONFIG_VERSION" == "0.0.3" ]] || { echo "Tauri release version must be exactly 0.0.3." >&2; exit 1; }
[[ "$CONFIG_VERSION_CODE" == "$AA_ANDROID_EXPECTED_VERSION_CODE" ]] || { echo "Tauri Android versionCode $CONFIG_VERSION_CODE does not match expected $AA_ANDROID_EXPECTED_VERSION_CODE." >&2; exit 1; }
[[ "$VERSION_NAME" == "$CONFIG_VERSION" ]] || { echo "APK version $VERSION_NAME does not match Tauri version $CONFIG_VERSION." >&2; exit 1; }
[[ "$VERSION_CODE" == "$AA_ANDROID_EXPECTED_VERSION_CODE" ]] || { echo "APK versionCode $VERSION_CODE does not match expected $AA_ANDROID_EXPECTED_VERSION_CODE." >&2; exit 1; }
require_text "$BADGING" "sdkVersion:'24'" "Android minSdk must be 24."
require_text "$BADGING" "targetSdkVersion:'36'" "Android targetSdk must be 36."

for permission in \
  android.permission.INTERNET \
  android.permission.RECORD_AUDIO \
  android.permission.MODIFY_AUDIO_SETTINGS; do
  require_text "$PERMISSIONS" "uses-permission: name='$permission'" "Missing Android permission: $permission"
done
if printf '%s\n' "$PERMISSIONS" | grep "uses-permission:" | grep -Ev "android.permission.(INTERNET|RECORD_AUDIO|MODIFY_AUDIO_SETTINGS)|com\.aa\.expense\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" >/dev/null; then
  echo "APK contains an unexpected Android permission:" >&2
  printf '%s\n' "$PERMISSIONS" | grep "uses-permission:" | grep -Ev "android.permission.(INTERNET|RECORD_AUDIO|MODIFY_AUDIO_SETTINGS)|com\.aa\.expense\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" >&2
  exit 1
fi

if ! printf '%s\n' "$XMLTREE" | grep -Eq 'A: android:usesCleartextTraffic\(0x010104ec\)=(\(type 0x12\)0x0|false)'; then
  echo "Release APK permits cleartext traffic." >&2
  exit 1
fi
if [[ "$XMLTREE" == *'A: android:debuggable(0x0101000f)=true'* ]]; then
  echo "Release APK is debuggable." >&2
  exit 1
fi
[[ "$(printf '%s\n' "$XMLTREE" | grep -c 'android.intent.action.VIEW')" == "1" ]] || { echo "Expected one Android VIEW deep-link action." >&2; exit 1; }
[[ "$(printf '%s\n' "$XMLTREE" | grep -c 'android.intent.category.BROWSABLE')" == "1" ]] || { echo "Expected one BROWSABLE category." >&2; exit 1; }
[[ "$(printf '%s\n' "$XMLTREE" | grep -c 'A: android:scheme.*="aa"')" == "1" ]] || { echo "Expected one aa:// scheme registration." >&2; exit 1; }

mapfile_compat="$(unzip -Z1 "$APK_PATH" | grep '^lib/[^/]*/.*\.so$' || true)"
[[ -n "$mapfile_compat" ]] || { echo "APK has no native library." >&2; exit 1; }
if printf '%s\n' "$mapfile_compat" | grep -v '^lib/arm64-v8a/' >/dev/null; then
  echo "APK contains a non-arm64 ABI." >&2
  printf '%s\n' "$mapfile_compat" >&2
  exit 1
fi

require_text "$CERT_OUTPUT" "Verified using v2 scheme (APK Signature Scheme v2): true" "APK Signature Scheme v2 verification failed."
[[ "$(printf '%s\n' "$CERT_OUTPUT" | grep -c '^Signer #[0-9][0-9]* certificate DN:')" == "1" ]] || { echo "Expected exactly one APK signer." >&2; exit 1; }
ACTUAL_CERT="$(printf '%s\n' "$CERT_OUTPUT" | grep 'Signer #1 certificate SHA-256 digest:' | head -1 | awk '{print $NF}' | tr '[:lower:]' '[:upper:]' | tr -d ':')"
[[ "$ACTUAL_CERT" == "$EXPECTED_CERT" ]] || { echo "APK certificate does not match the pinned release certificate." >&2; exit 1; }
if printf '%s\n' "$CERT_OUTPUT" | grep -qi 'Android Debug'; then
  echo "APK is signed with an Android debug certificate." >&2
  exit 1
fi

EXTRACTED="$(mktemp -d)"
SCAN_FILE="$(mktemp)"
CODEGEN_DIR="$ROOT_DIR/apps/app/src-tauri/target/aarch64-linux-android/release/build"
trap 'rm -rf "$EXTRACTED" "$SCAN_FILE"' EXIT
unzip -oq "$APK_PATH" -d "$EXTRACTED"
find "$EXTRACTED" -type f ! -path '*/res/*' ! -path '*/lib/*' ! -path '*/META-INF/*' ! -path '*/assets/tauri.conf.json' ! -name 'classes*.dex' ! -name 'resources.arsc' -size -32M -exec grep -a -h -E -o '.{0,160}(supabase\\.co|127\\.0\\.0\\.1|localhost|10\\.0\\.2\\.2|http://|sb_secret_|service_role|BEGIN PRIVATE KEY).{0,160}' {} + > "$SCAN_FILE" || true

if [[ -n "$(find "$EXTRACTED" -type f -name '*.map' -print -quit)" ]]; then
  echo "APK contains source maps." >&2
  exit 1
fi

RUNTIME_BUNDLE="$(find "$CODEGEN_DIR" -path '*/out/tauri-codegen-assets/*' -type f -name '*.js' -size +100000c -size -1000000c -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1 || true)"
if [[ -z "$RUNTIME_BUNDLE" ]]; then
  echo "Could not locate the Tauri runtime bundle used by this local APK build." >&2
  exit 1
fi
NATIVE_LIB="$EXTRACTED/lib/arm64-v8a/libaa_lib.so"
if "$READELF" --sections "$NATIVE_LIB" | grep -Eq '\.(debug_info|debug_line|debug_str)([[:space:]]|$)'; then
  echo "Release native library contains debug sections." >&2
  exit 1
fi
RUNTIME_PREFIX="$(mktemp)"
trap 'rm -rf "$EXTRACTED" "$SCAN_FILE" "$RUNTIME_PREFIX"' EXIT
dd if="$RUNTIME_BUNDLE" of="$RUNTIME_PREFIX" bs=64 count=1 status=none
if ! python3 - "$NATIVE_LIB" "$RUNTIME_PREFIX" <<'PY'
import sys
from pathlib import Path
native = Path(sys.argv[1]).read_bytes()
prefix = Path(sys.argv[2]).read_bytes()
raise SystemExit(0 if prefix in native else 1)
PY
then
  echo "Local Tauri runtime bundle does not match the APK native library." >&2
  exit 1
fi
if command -v brotli >/dev/null; then
  DECOMPRESSED_BUNDLE="$(mktemp)"
  trap 'rm -rf "$EXTRACTED" "$SCAN_FILE" "$RUNTIME_PREFIX" "$DECOMPRESSED_BUNDLE"' EXIT
  brotli -d -c "$RUNTIME_BUNDLE" > "$DECOMPRESSED_BUNDLE"
  require_text "$(<"$DECOMPRESSED_BUNDLE")" "invalid build origin marker" "APK does not contain the production Supabase origin marker."
  require_text "$(<"$DECOMPRESSED_BUNDLE")" "$AA_ANDROID_PRODUCTION_ORIGIN" "APK does not contain the expected production Supabase origin."
  if grep -aF "$AA_ANDROID_STAGING_ORIGIN" "$DECOMPRESSED_BUNDLE" >/dev/null; then
    echo "APK contains the staging Supabase origin." >&2
    exit 1
  fi
else
  echo "brotli is required to verify the Tauri runtime bundle." >&2
  exit 1
fi

if LC_ALL=C grep -a -E "https?://(127\\.0\\.0\\.1|10\\.0\\.2\\.2)([:/]|$)|BEGIN (RSA |EC )?PRIVATE KEY" "$DECOMPRESSED_BUNDLE" >/dev/null; then
  echo "APK contains a forbidden runtime host or private key marker." >&2
  exit 1
fi
if grep -Eai "127\\.0\\.0\\.1|localhost|10\\.0\\.2\\.2|http://[^[:space:]\"']+|sb_secret_|service_role|BEGIN (RSA |EC )?PRIVATE KEY" "$SCAN_FILE" >/dev/null; then
  echo "APK contains a forbidden packaged host, secret marker, or private key marker." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_APK="$OUTPUT_DIR/AA.Ledger_${VERSION_NAME}_android-arm64-v8a.apk"
if [[ -e "$OUTPUT_APK" || -e "$OUTPUT_APK.sha256" ]]; then
  echo "Refusing to overwrite packaged APK or checksum." >&2
  exit 1
fi
cp "$APK_PATH" "$OUTPUT_APK"
APK_SHA256="$(shasum -a 256 "$OUTPUT_APK" | awk '{print $1}')"
printf '%s  %s\n' "$APK_SHA256" "$(basename "$OUTPUT_APK")" > "$OUTPUT_APK.sha256"
printf '%s\n' "$OUTPUT_APK" "$OUTPUT_APK.sha256" "$APK_SHA256"
