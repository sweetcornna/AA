#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:?Usage: compose.sh <env-file> <compose-args...>}"
shift
[[ "$#" -gt 0 ]] || { printf 'At least one Compose argument is required.\n' >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra/supabase-selfhost"
python3 "$INFRA_DIR/scripts/validate-env.py" "$ENV_FILE" --require-root-owner
# shellcheck disable=SC1091
source "$INFRA_DIR/scripts/env-utils.sh"
aa_load_env "$ENV_FILE"
# shellcheck disable=SC1091
source "$INFRA_DIR/upstream.lock"
python3 "$INFRA_DIR/scripts/verify-upstream.py" "$AA_UPSTREAM_DIR" \
  --expected-commit "$SUPABASE_COMMIT" \
  --expected-archive-sha256 "$SUPABASE_ARCHIVE_SHA256"
python3 "$INFRA_DIR/scripts/verify-artifact.py" "$AA_FUNCTIONS_DIR" \
  --template "$AA_TEMPLATE_DIR/confirmation.html" \
  --expected-fingerprint "$AA_SOURCE_FINGERPRINT" \
  --expected-upstream-commit "$SUPABASE_COMMIT"
for argument in "$@"; do
  case "$argument" in
    down|rm|--volumes|-v)
      printf 'Destructive Compose commands and volume removal are forbidden for staging/production stacks.\n' >&2
      exit 1
      ;;
  esac
done
docker_root="$(docker info --format '{{.DockerRootDir}}')"
[[ -n "$docker_root" && "$docker_root" == /* ]] || { printf 'Docker data root is invalid.\n' >&2; exit 1; }
"$INFRA_DIR/scripts/capacity-check.sh" /srv/aa "$docker_root"
exec docker compose --env-file "$ENV_FILE" -f "$INFRA_DIR/compose.base.yml" "$@"
