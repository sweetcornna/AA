#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra/supabase-selfhost"
RUNTIME_ROOT="${1:?Usage: prepare-upstream.sh <runtime-root>}"

# shellcheck disable=SC1091
source "$INFRA_DIR/upstream.lock"
DESTINATION="$RUNTIME_ROOT/upstream/$SUPABASE_COMMIT"

if [[ -d "$DESTINATION" ]]; then
  python3 "$INFRA_DIR/scripts/verify-upstream.py" "$DESTINATION" \
    --expected-commit "$SUPABASE_COMMIT" \
    --expected-archive-sha256 "$SUPABASE_ARCHIVE_SHA256"
  printf 'Pinned Supabase upstream is already prepared.\n'
  exit 0
fi
if [[ -e "$DESTINATION" ]]; then
  printf 'Refusing to replace an unverified upstream directory: %s\n' "$DESTINATION" >&2
  exit 1
fi

mkdir -p "$RUNTIME_ROOT/upstream"
WORK_DIR="$(mktemp -d "$RUNTIME_ROOT/upstream/.prepare.XXXXXX")"
trap 'chmod -R u+w "$WORK_DIR" 2>/dev/null || true; rm -rf "$WORK_DIR"' EXIT
ARCHIVE="$WORK_DIR/upstream.tar.gz"
SOURCE="$WORK_DIR/source"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}
assert_sha256() {
  local expected="$1" path="$2" actual
  actual="$(sha256_file "$path")"
  [[ "$actual" == "$expected" ]] || {
    printf 'SHA-256 mismatch for %s.\n' "$path" >&2
    exit 1
  }
}

curl --fail --location --silent --show-error \
  "https://codeload.github.com/supabase/supabase/tar.gz/$SUPABASE_COMMIT" \
  --output "$ARCHIVE"
assert_sha256 "$SUPABASE_ARCHIVE_SHA256" "$ARCHIVE"
mkdir "$SOURCE"
tar -xzf "$ARCHIVE" -C "$SOURCE" --strip-components=1
assert_sha256 "$DOCKER_COMPOSE_SHA256" "$SOURCE/docker/docker-compose.yml"
assert_sha256 "$ENV_EXAMPLE_SHA256" "$SOURCE/docker/.env.example"

mkdir -p "$WORK_DIR/output/api" "$WORK_DIR/output/db" "$WORK_DIR/output/functions/main"
install -m 0555 "$SOURCE/docker/volumes/api/kong-entrypoint.sh" "$WORK_DIR/output/api/kong-entrypoint.sh"
install -m 0444 "$SOURCE/docker/volumes/db/_supabase.sql" "$WORK_DIR/output/db/_supabase.sql"
install -m 0444 "$SOURCE/docker/volumes/db/realtime.sql" "$WORK_DIR/output/db/realtime.sql"
install -m 0444 "$SOURCE/docker/volumes/db/webhooks.sql" "$WORK_DIR/output/db/webhooks.sql"
install -m 0444 "$SOURCE/docker/volumes/db/roles.sql" "$WORK_DIR/output/db/roles.sql"
install -m 0444 "$SOURCE/docker/volumes/db/jwt.sql" "$WORK_DIR/output/db/jwt.sql"
install -m 0444 "$SOURCE/docker/volumes/functions/main/index.ts" "$WORK_DIR/output/functions/main/index.ts"
printf '%s\n' "$SUPABASE_ARCHIVE_SHA256" > "$WORK_DIR/output/.aa-upstream-sha256"
chmod 0444 "$WORK_DIR/output/.aa-upstream-sha256"
python3 - "$WORK_DIR/output" "$SUPABASE_COMMIT" "$SUPABASE_ARCHIVE_SHA256" <<'PY'
import hashlib
import json
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
expected = {
    ".aa-upstream-sha256": "0444",
    "api/kong-entrypoint.sh": "0555",
    "db/_supabase.sql": "0444",
    "db/jwt.sql": "0444",
    "db/realtime.sql": "0444",
    "db/roles.sql": "0444",
    "db/webhooks.sql": "0444",
    "functions/main/index.ts": "0444",
}
actual = set()
for directory, names, filenames in os.walk(root, followlinks=False):
    directory_path = Path(directory)
    for name in [*names, *filenames]:
        path = directory_path / name
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise SystemExit(f"retained upstream contains a symlink: {path}")
        if name in filenames:
            if not stat.S_ISREG(info.st_mode):
                raise SystemExit(f"retained upstream contains a non-regular file: {path}")
            actual.add(path.relative_to(root).as_posix())
if actual != set(expected):
    raise SystemExit("retained upstream file inventory mismatch")
entries = []
for relative, expected_mode in sorted(expected.items()):
    path = root / relative
    mode = f"{stat.S_IMODE(path.stat().st_mode):04o}"
    if mode != expected_mode:
        raise SystemExit(f"retained upstream mode mismatch: {relative}")
    entries.append({
        "path": relative,
        "type": "file",
        "mode": mode,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    })
manifest = {
    "schemaVersion": 1,
    "upstreamCommit": sys.argv[2],
    "archiveSha256": sys.argv[3],
    "files": entries,
}
manifest_path = root / ".aa-upstream-manifest.json"
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
manifest_path.chmod(0o444)
PY
# Files are already installed read-only. Directories must stay writable until
# after the move: renaming a directory updates its own ".." entry, so a
# read-only source directory makes mv fail with EACCES on Linux. Move first,
# then seal the directories, then verify the sealed result in place.
mv "$WORK_DIR/output" "$DESTINATION"
find "$DESTINATION" -type d -exec chmod a-w {} +
python3 "$INFRA_DIR/scripts/verify-upstream.py" "$DESTINATION" \
  --expected-commit "$SUPABASE_COMMIT" \
  --expected-archive-sha256 "$SUPABASE_ARCHIVE_SHA256"
printf 'Prepared verified Supabase upstream %s.\n' "$SUPABASE_COMMIT"
