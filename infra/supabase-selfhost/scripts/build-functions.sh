#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra/supabase-selfhost"
RUNTIME_ROOT="${1:?Usage: build-functions.sh <runtime-root>}"

# shellcheck disable=SC1091
source "$INFRA_DIR/upstream.lock"
DENO_VERSION="$(NO_COLOR=1 deno eval 'console.log(Deno.version.deno)')"
[[ "$DENO_VERSION" == "2.9.1" ]] || {
  printf 'Deno 2.9.1 is required to build immutable function artifacts.\n' >&2
  exit 1
}
UPSTREAM_DIR="$RUNTIME_ROOT/upstream/$SUPABASE_COMMIT"
python3 "$INFRA_DIR/scripts/verify-upstream.py" "$UPSTREAM_DIR" \
  --expected-commit "$SUPABASE_COMMIT" \
  --expected-archive-sha256 "$SUPABASE_ARCHIVE_SHA256"

FINGERPRINT_JSON="$(node "$ROOT_DIR/scripts/hosted-deployment.mjs" fingerprint)"
FINGERPRINT="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.bundleSha256)' "$FINGERPRINT_JSON")"
FUNCTION_DEST="$RUNTIME_ROOT/functions/$FINGERPRINT"
TEMPLATE_DEST="$RUNTIME_ROOT/templates/$FINGERPRINT"

if [[ -e "$FUNCTION_DEST" ]] && [[ -e "$TEMPLATE_DEST" ]]; then
  python3 "$INFRA_DIR/scripts/verify-artifact.py" "$FUNCTION_DEST" \
    --template "$TEMPLATE_DEST/confirmation.html" \
    --expected-fingerprint "$FINGERPRINT" \
    --expected-upstream-commit "$SUPABASE_COMMIT"
  printf 'Function artifact %s is already prepared.\n' "$FINGERPRINT"
  exit 0
fi
if [[ -e "$FUNCTION_DEST" ]] || [[ -e "$TEMPLATE_DEST" ]]; then
  printf 'Refusing to replace an incomplete immutable artifact.\n' >&2
  exit 1
fi

mkdir -p "$RUNTIME_ROOT/functions" "$RUNTIME_ROOT/templates"
WORK_DIR="$(mktemp -d "$RUNTIME_ROOT/.functions.XXXXXX")"
trap 'chmod -R u+w "$WORK_DIR" 2>/dev/null || true; rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/functions/main"

for name in agent-query asr-transcribe parse-expense; do
  mkdir -p "$WORK_DIR/functions/$name"
  deno bundle \
    --config "$ROOT_DIR/supabase/functions/deno.json" \
    --lock "$ROOT_DIR/supabase/functions/deno.lock" \
    --frozen --platform deno \
    "$ROOT_DIR/supabase/functions/$name/index.ts" \
    --output "$WORK_DIR/functions/$name/index.ts"
done

(
  cd "$UPSTREAM_DIR/functions"
  deno bundle \
    --no-config \
    --lock "$INFRA_DIR/edge-router.lock" \
    --frozen --platform deno \
    main/index.ts \
    --output "$WORK_DIR/functions/main/index.ts"
)

printf '%s\n' "$FINGERPRINT_JSON" > "$WORK_DIR/functions/fingerprint.json"
python3 - "$WORK_DIR/functions" "$FINGERPRINT" "$SUPABASE_COMMIT" "$DENO_VERSION" <<'PY'
import hashlib
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
entries = []
for path in sorted(root.glob("*/index.ts")):
    entries.append({"path": path.relative_to(root).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
canonical = "".join(f"{entry['sha256']}  {entry['path']}\n" for entry in entries).encode()
manifest = {
    "schemaVersion": 1,
    "sourceFingerprint": sys.argv[2],
    "upstreamCommit": sys.argv[3],
    "denoVersion": sys.argv[4],
    "artifactSha256": hashlib.sha256(canonical).hexdigest(),
    "files": entries,
}
(root / "artifact-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
PY
mkdir "$WORK_DIR/templates"
install -m 0444 "$ROOT_DIR/supabase/templates/confirmation.html" "$WORK_DIR/templates/confirmation.html"
mv "$WORK_DIR/functions" "$FUNCTION_DEST"
mv "$WORK_DIR/templates" "$TEMPLATE_DEST"
chmod -R a-w "$FUNCTION_DEST" "$TEMPLATE_DEST"
python3 "$INFRA_DIR/scripts/verify-artifact.py" "$FUNCTION_DEST" \
  --template "$TEMPLATE_DEST/confirmation.html" \
  --expected-fingerprint "$FINGERPRINT" \
  --expected-upstream-commit "$SUPABASE_COMMIT"
printf 'Built immutable function artifact %s.\n' "$FINGERPRINT"
