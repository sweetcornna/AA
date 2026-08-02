#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:?Usage: health-check.sh <env-file>}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/supabase-selfhost/compose.base.yml"
# shellcheck disable=SC1091
source "$ROOT_DIR/infra/supabase-selfhost/scripts/env-utils.sh"
aa_load_env "$ENV_FILE"

expected=(db templates auth rest realtime functions kong)
json="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json)"
python3 - "$json" "${expected[@]}" <<'PY'
import json
import sys
try:
    rows = json.loads(sys.argv[1])
except json.JSONDecodeError:
    rows = [json.loads(line) for line in sys.argv[1].splitlines() if line]
if isinstance(rows, dict):
    rows = [rows]
expected = set(sys.argv[2:])
seen = set()
failures = []
for row in rows:
    service = row.get("Service")
    if service not in expected:
        continue
    seen.add(service)
    if row.get("State") != "running" or row.get("Health") != "healthy":
        failures.append(f"{service}: state={row.get('State')} health={row.get('Health')}")
missing = sorted(expected - seen)
if missing or failures:
    raise SystemExit(f"stack unhealthy: missing={missing}, failures={failures}")
PY

origin="http://${AA_KONG_BIND_HOST}:${AA_KONG_HTTP_PORT}"
probe_public_key() {
  local label="$1" key="$2"
  curl --fail --silent --show-error --max-time 5 \
    "$origin/auth/v1/health" -H "apikey: $key" >/dev/null || {
      printf '%s Auth health probe failed.\n' "$label" >&2
      return 1
    }
  # 0009_security_hardening.sql revokes every public table privilege from anon,
  # so a correctly translated key still reaches PostgREST and is refused there
  # with 42501. Only a Kong key-auth rejection, which carries no PostgREST error
  # code, means the key itself is unusable.
  local response http_status payload
  response="$(curl --silent --show-error --max-time 5 --write-out '\n%{http_code}' \
    "$origin/rest/v1/profiles?select=id&limit=1" -H "apikey: $key")" || {
      printf '%s REST probe could not reach the gateway.\n' "$label" >&2
      return 1
    }
  http_status="${response##*$'\n'}"
  payload="${response%$'\n'*}"
  if [[ "$http_status" == 2* ]]; then
    return 0
  fi
  if [[ "$payload" == *'"code"'* ]]; then
    return 0
  fi
  printf '%s REST probe was rejected by the gateway with HTTP %s.\n' "$label" "$http_status" >&2
  return 1
}

probe_public_key "legacy public key" "$ANON_KEY"
probe_public_key "publishable key" "$SUPABASE_PUBLISHABLE_KEY"
invalid_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 \
  "$origin/auth/v1/health" -H "apikey: sb_publishable_invalid_health_probe")"
if [[ "$invalid_status" != "401" ]]; then
  printf 'invalid-key rejection probe returned HTTP %s instead of 401.\n' "$invalid_status" >&2
  exit 1
fi
printf '%s stack is healthy for legacy and publishable public keys.\n' "$AA_ENVIRONMENT"
