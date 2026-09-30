#!/usr/bin/env bash
# Install root-owned at /usr/local/sbin/aa-github-backup; SSH must force this
# command with `restrict`. Only ciphertext and non-secret metadata leave stdout.
set -euo pipefail
umask 077

[[ "${SSH_ORIGINAL_COMMAND:-}" == backup ]] || {
  printf 'Only the backup export command is permitted.\n' >&2
  exit 64
}
[[ "$EUID" == 0 ]] || { printf 'The fixed backup exporter requires root.\n' >&2; exit 1; }
export PATH=/usr/local/bin:/usr/bin:/bin
SOURCE=/srv/aa/src
ENV_FILE=/srv/aa/production/stack.env
WORK_ROOT=/srv/aa/backups/github-export
for tool in age docker flock git mkfifo python3 sha256sum tar tee; do
  command -v "$tool" >/dev/null || { printf 'Missing required backup tool: %s\n' "$tool" >&2; exit 1; }
done
[[ -z "$(git -C "$SOURCE" status --porcelain)" ]] || {
  printf 'Refusing to export a dirty deployment source.\n' >&2; exit 1;
}
python3 "$SOURCE/infra/supabase-selfhost/scripts/validate-env.py" "$ENV_FILE" \
  --profile single-stack --destination local --require-root-owner >&2
# shellcheck source=/dev/null
source "$SOURCE/infra/supabase-selfhost/scripts/env-utils.sh"
aa_load_env "$ENV_FILE"
[[ "$AA_ENVIRONMENT" == production && "$AA_STACK_ID" == aa-production-primary ]] || exit 1
install -d -m 0700 "$WORK_ROOT"
exec 9>/run/lock/aa-github-backup.lock
flock -w 30 9
work="$(mktemp -d "$WORK_ROOT/export.XXXXXXXX")"
toc_pid=""
cleanup() {
  if [[ -n "$toc_pid" ]]; then kill "$toc_pid" 2>/dev/null || true; fi
  case "$work" in "$WORK_ROOT"/export.*) rm -rf -- "$work" ;; esac
}
trap cleanup EXIT

commit="$(git -C "$SOURCE" rev-parse HEAD)"
env_checksum="$(sha256sum "$ENV_FILE" | cut -d ' ' -f 1)"
container=aa-production-primary-db-1
mkfifo "$work/archive.fifo"
docker exec -i "$container" pg_restore --list < "$work/archive.fifo" >/dev/null &
toc_pid="$!"
docker exec "$container" pg_dump -U postgres -d postgres --format=custom | \
  tee --output-error=warn-nopipe "$work/archive.fifo" | \
  age --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/database.dump.age"
wait "$toc_pid"
toc_pid=""
test -s "$work/database.dump.age"

# Complete tracked source is included in the encrypted configuration archive.
# Database/JWT/provider values stream straight from the root-only env to age.
# The age identity is deliberately excluded from every archive.
git -C "$SOURCE" archive --format=tar.gz HEAD > "$work/source.tar.gz"
config_files=(-C "$work" source.tar.gz -C /srv/aa production/stack.env)
functions_relative="${AA_FUNCTIONS_DIR#/srv/aa/production/runtime/}"
templates_relative="${AA_TEMPLATE_DIR#/srv/aa/production/runtime/}"
[[ "$functions_relative" == "functions/$AA_SOURCE_FINGERPRINT" ]] || exit 1
[[ "$templates_relative" == "templates/$AA_SOURCE_FINGERPRINT" ]] || exit 1
config_files+=(-C /srv/aa/production/runtime "$functions_relative" "$templates_relative")
for nginx_config in /etc/nginx/conf.d/aa*.conf /etc/nginx/sites-available/aa*; do
  [[ -f "$nginx_config" ]] || continue
  config_files+=(-C / "${nginx_config#/}")
done
tar -czf - "${config_files[@]}" | \
  age --recipient "$BACKUP_AGE_RECIPIENT" --output "$work/configuration.tar.gz.age"
[[ "$commit" == "$(git -C "$SOURCE" rev-parse HEAD)" ]] || {
  printf 'Source changed during backup; refusing the export.\n' >&2; exit 1;
}
[[ "$env_checksum" == "$(sha256sum "$ENV_FILE" | cut -d ' ' -f 1)" ]] || {
  printf 'Runtime configuration changed during backup; refusing the export.\n' >&2; exit 1;
}
python3 - "$work" "$commit" "$AA_SOURCE_FINGERPRINT" <<'PY'
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
root = Path(sys.argv[1])
files = []
for name in ('database.dump.age', 'configuration.tar.gz.age'):
    p = root / name
    digest = hashlib.sha256()
    with p.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    files.append({'name': name, 'size': p.stat().st_size, 'sha256': digest.hexdigest()})
manifest = {'schemaVersion': 1, 'environment': 'production',
            'stackId': 'aa-production-primary', 'sourceCommit': sys.argv[2],
            'sourceFingerprint': sys.argv[3],
            'createdAt': datetime.now(timezone.utc).isoformat(), 'files': files}
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY
tar -czf - -C "$work" manifest.json database.dump.age configuration.tar.gz.age
printf 'Encrypted production database/configuration/source export completed.\n' >&2
