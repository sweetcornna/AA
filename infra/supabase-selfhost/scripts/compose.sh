#!/usr/bin/env bash
set -euo pipefail

PROFILE=dual-stack
if [[ "${1:-}" == "--profile" ]]; then
  [[ "$#" -ge 3 ]] || { printf '%s\n' 'Usage: compose.sh [--profile dual-stack|single-stack] <env-file> <compose-args...>' >&2; exit 2; }
  PROFILE="$2"
  shift 2
fi
case "$PROFILE" in
  dual-stack|single-stack) ;;
  *) printf 'Unknown deployment profile: %s.\n' "$PROFILE" >&2; exit 2 ;;
esac

ENV_FILE="${1:?Usage: compose.sh [--profile dual-stack|single-stack] <env-file> <compose-args...>}"
shift
[[ "$#" -gt 0 ]] || { printf 'At least one Compose argument is required.\n' >&2; exit 1; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra/supabase-selfhost"
python3 "$INFRA_DIR/scripts/validate-env.py" "$ENV_FILE" --profile "$PROFILE" --require-root-owner
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

compose_files=(-f "$INFRA_DIR/compose.base.yml")
if [[ "$PROFILE" == "single-stack" ]]; then
  compose_files+=(-f "$INFRA_DIR/compose.single-stack.yml")
fi

# Run a real capacity gate before even the read-only DockerRootDir query. Once
# Docker identifies its data root, repeat the gate against both filesystems.
"$INFRA_DIR/scripts/capacity-check.sh" --profile "$PROFILE" /srv/aa
docker_root="$(docker info --format '{{.DockerRootDir}}')"
[[ -n "$docker_root" && "$docker_root" == /* ]] || { printf 'Docker data root is invalid.\n' >&2; exit 1; }
"$INFRA_DIR/scripts/capacity-check.sh" --profile "$PROFILE" /srv/aa "$docker_root"
exec docker compose --env-file "$ENV_FILE" "${compose_files[@]}" "$@"
