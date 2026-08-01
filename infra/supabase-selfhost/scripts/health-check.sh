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
curl --fail --silent --show-error --max-time 5 \
  "$origin/auth/v1/health" -H "apikey: $ANON_KEY" >/dev/null
curl --fail --silent --show-error --max-time 5 \
  "$origin/rest/v1/profiles?select=id&limit=1" -H "apikey: $ANON_KEY" >/dev/null
printf '%s stack is healthy on its loopback gateway.\n' "$AA_ENVIRONMENT"
