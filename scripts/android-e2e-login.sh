#!/usr/bin/env bash
# Semantic UI checks against the installed local debug WebView; no coordinate
# assumptions, account uninstall, or fixed test passwords. See UI_REDESIGN_QA.md.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/android-env.sh"
export AA_ADB="$ANDROID_HOME/platform-tools/adb"
node "$script_dir/android-ui-smoke.mjs"
