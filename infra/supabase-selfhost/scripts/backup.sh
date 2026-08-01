#!/usr/bin/env bash
set -euo pipefail
umask 077

ENV_FILE="${1:?Usage: backup.sh <env-file>}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/supabase-selfhost/compose.base.yml"
python3 "$ROOT_DIR/infra/supabase-selfhost/scripts/validate-env.py" "$ENV_FILE" --require-root-owner
# shellcheck disable=SC1091
source "$ROOT_DIR/infra/supabase-selfhost/scripts/env-utils.sh"
aa_load_env "$ENV_FILE"

for command in age azcopy docker flock ln mkfifo python3 sha256sum tee; do
  command -v "$command" >/dev/null || { printf '%s is required.\n' "$command" >&2; exit 1; }
done
python3 - "$BACKUP_DIR" <<'PY'
import stat
import sys
from pathlib import Path
path = Path(sys.argv[1])
info = path.lstat()
if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
    raise SystemExit("backup directory must be a non-symlink directory")
if info.st_uid != 0 or info.st_mode & 0o077:
    raise SystemExit("backup directory must be root-owned with mode 0700 or stricter")
PY
lock_file="$BACKUP_DIR/.${AA_STACK_ID}.backup.lock"
exec 9>"$lock_file"
flock 9
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="aa-${AA_ENVIRONMENT}-${stamp}.dump"
encrypted="$BACKUP_DIR/${base}.age"
checksum="$encrypted.sha256"
work="$(mktemp -d "$BACKUP_DIR/.backup.XXXXXX")"
partial="$work/${base}.age.partial"
checksum_partial="$work/${base}.age.sha256.partial"
toc_fifo="$work/archive.fifo"
readback="$work/readback"
toc_pid=""
cleanup() {
  if [[ -n "$toc_pid" ]]; then
    kill "$toc_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir "$readback"
mkfifo "$toc_fifo"

docker compose --project-name "$AA_STACK_ID" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_restore --list < "$toc_fifo" >/dev/null &
toc_pid="$!"
docker compose --project-name "$AA_STACK_ID" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U postgres -d postgres --format=custom | \
  tee "$toc_fifo" | \
  age --recipient "$BACKUP_AGE_RECIPIENT" --output "$partial"
wait "$toc_pid"
toc_pid=""
test -s "$partial"
ciphertext_hash="$(sha256sum -- "$partial" | cut -d ' ' -f 1)"
printf '%s  %s\n' "$ciphertext_hash" "$(basename "$encrypted")" > "$checksum_partial"
ln -- "$partial" "$encrypted" || { printf 'Backup ciphertext already exists.\n' >&2; exit 1; }
if ! ln -- "$checksum_partial" "$checksum"; then
  rm -f -- "$encrypted"
  printf 'Backup checksum already exists.\n' >&2
  exit 1
fi

export AZCOPY_AUTO_LOGIN_TYPE=MSI
remote="https://${AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${AZURE_STORAGE_CONTAINER}/$AA_ENVIRONMENT"
azcopy copy "$encrypted" "$remote/$base.age" --from-to LocalBlob --overwrite=false --output-type text
azcopy copy "$checksum" "$remote/$base.age.sha256" --from-to LocalBlob --overwrite=false --output-type text
azcopy copy "$remote/$base.age" "$readback/$base.age" --from-to BlobLocal --overwrite=false --output-type text
azcopy copy "$remote/$base.age.sha256" "$readback/$base.age.sha256" --from-to BlobLocal --overwrite=false --output-type text
(
  cd "$readback"
  sha256sum --check -- "$base.age.sha256"
)
local_hash="$(sha256sum -- "$encrypted" | cut -d ' ' -f 1)"
remote_hash="$(sha256sum -- "$readback/$base.age" | cut -d ' ' -f 1)"
[[ "$local_hash" == "$remote_hash" ]] || { printf 'Azure Blob read-back hash mismatch.\n' >&2; exit 1; }

while IFS= read -r -d '' expired; do
  rm -f -- "$expired" "$expired.sha256"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "aa-${AA_ENVIRONMENT}-*.dump.age" -mtime +30 -print0)
printf 'Created, checksummed, uploaded, and read-back checked encrypted backup %s.\n' "$base.age"
