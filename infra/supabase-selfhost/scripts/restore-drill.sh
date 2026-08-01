#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: restore-drill.sh [--profile dual-stack|single-stack] <restore-env-file> <backup.age> <backup.age.sha256> <age-identity> <staging-env> <production-env>' >&2
  printf '%s\n' '       restore-drill.sh --profile single-stack <restore-env-file> <backup.age> <backup.age.sha256> <age-identity> <production-env>' >&2
  exit 2
}

PROFILE=dual-stack
if [[ "${1:-}" == "--profile" ]]; then
  [[ "$#" -ge 2 ]] || usage
  PROFILE="$2"
  shift 2
fi
case "$PROFILE" in
  dual-stack|single-stack) ;;
  *) printf 'Unknown deployment profile: %s.\n' "$PROFILE" >&2; usage ;;
esac

[[ "$#" -ge 4 ]] || usage
ENV_FILE="$1"
BACKUP="$2"
CHECKSUM="$3"
IDENTITY="$4"
shift 4
DEPLOYMENT_ENVS=("$@")
if [[ "$PROFILE" == "dual-stack" ]]; then
  [[ "${#DEPLOYMENT_ENVS[@]}" -eq 2 ]] || usage
else
  [[ "${#DEPLOYMENT_ENVS[@]}" -eq 1 ]] || usage
fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
INFRA_DIR="$ROOT_DIR/infra/supabase-selfhost"
COMPOSE_FILE="$INFRA_DIR/compose.restore.yml"
SINGLE_STACK_COMPOSE_FILE="$INFRA_DIR/compose.restore.single-stack.yml"
VALIDATOR="$INFRA_DIR/scripts/validate-restore-env.py"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

restore_validation=(python3 "$VALIDATOR" "$ENV_FILE" --profile "$PROFILE" --require-root-owner)
for deployment_env in "${DEPLOYMENT_ENVS[@]}"; do
  python3 "$INFRA_DIR/scripts/validate-env.py" "$deployment_env" --profile "$PROFILE" --require-root-owner
  restore_validation+=(--disjoint-from "$deployment_env")
done
"${restore_validation[@]}"
# shellcheck disable=SC1091
source "$INFRA_DIR/scripts/env-utils.sh"
aa_load_env "$ENV_FILE"

for command in age docker flock python3 sha256sum; do
  command -v "$command" >/dev/null || { printf '%s is required.\n' "$command" >&2; exit 1; }
done

python3 - "$BACKUP" "$CHECKSUM" "$IDENTITY" <<'PY'
import os
import stat
import sys
from pathlib import Path
for value, label in zip(sys.argv[1:], ("backup", "checksum", "age identity")):
    path = Path(value)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit(f"{label} must be a non-symlink regular file")
    if info.st_uid != 0 or info.st_mode & 0o077:
        raise SystemExit(f"{label} must be root-owned with mode 0600 or stricter")
PY
backup_name="$(basename "$BACKUP")"
[[ "$backup_name" =~ ^aa-(staging|production)-[0-9]{8}T[0-9]{6}Z\.dump\.age$ ]] || { printf 'Backup filename is invalid.\n' >&2; exit 1; }
if [[ "$PROFILE" == "single-stack" && ! "$backup_name" =~ ^aa-production- ]]; then
  printf 'Single-stack restore drills only accept production backups.\n' >&2
  exit 1
fi
[[ "$(basename "$CHECKSUM")" == "$backup_name.sha256" ]] || { printf 'Checksum filename does not match backup.\n' >&2; exit 1; }
expected_hash="$(python3 - "$CHECKSUM" "$backup_name" <<'PY'
import re
import sys
from pathlib import Path
raw = Path(sys.argv[1]).read_text()
match = re.fullmatch(r"([0-9a-f]{64})  ([^/\\\r\n]+)\n?", raw)
if not match or match.group(2) != sys.argv[2] or ".." in match.group(2):
    raise SystemExit("checksum content is invalid")
print(match.group(1))
PY
)"
actual_hash="$(sha256sum -- "$BACKUP" | cut -d ' ' -f 1)"
[[ "$actual_hash" == "$expected_hash" ]] || { printf 'Backup checksum verification failed.\n' >&2; exit 1; }

# Capacity is checked before any Docker query, then again against Docker's data
# filesystem. The restore stack remains a separate project and volume set.
"$INFRA_DIR/scripts/capacity-check.sh" --profile "$PROFILE" /srv/aa
docker_root="$(docker info --format '{{.DockerRootDir}}')"
[[ -n "$docker_root" && "$docker_root" == /* ]] || { printf 'Docker data root is invalid.\n' >&2; exit 1; }
"$INFRA_DIR/scripts/capacity-check.sh" --profile "$PROFILE" /srv/aa "$docker_root"

if [[ "$PROFILE" == "single-stack" ]]; then
  production_stack_id="$(python3 - "${DEPLOYMENT_ENVS[0]}" <<'PY'
import sys
from pathlib import Path

values = dict(
    line.split("=", 1)
    for line in Path(sys.argv[1]).read_text().splitlines()
    if line and not line.startswith("#")
)
print(values["AA_STACK_ID"])
PY
)"
  if [[ -n "$(docker ps --quiet --filter "label=com.docker.compose.project=$production_stack_id")" ]]; then
    printf 'Production must be stopped before a single-stack restore drill to avoid host OOM.\n' >&2
    exit 1
  fi
fi

lock_file="/run/lock/${AA_STACK_ID}.lock"
exec 9>"$lock_file"
flock --nonblock 9 || { printf 'Another process is using this restore stack identity.\n' >&2; exit 1; }
project_filter="label=com.docker.compose.project=$AA_STACK_ID"
if [[ -n "$(docker ps --all --quiet --filter "$project_filter")" ||
      -n "$(docker volume ls --quiet --filter "$project_filter")" ||
      -n "$(docker network ls --quiet --filter "$project_filter")" ]]; then
  printf 'Restore stack resources already exist; generate a fresh restore environment or inspect the old drill.\n' >&2
  exit 1
fi

compose=(docker compose --project-name "$AA_STACK_ID" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [[ "$PROFILE" == "single-stack" ]]; then
  compose+=(-f "$SINGLE_STACK_COMPOSE_FILE")
fi
cleanup_required=false
print_cleanup() {
  if [[ "$cleanup_required" == true ]]; then
    printf 'After recording evidence, explicitly destroy only this drill with: docker compose --project-name %q --env-file %q -f %q down --volumes\n' \
      "$AA_STACK_ID" "$ENV_FILE" "$COMPOSE_FILE" >&2
  fi
}
trap print_cleanup EXIT

decrypt_archive() {
  age --decrypt --identity "$IDENTITY" "$BACKUP" | python3 -c '
import shutil
import sys
prefix = sys.stdin.buffer.read(5)
if prefix != b"PGDMP":
    raise SystemExit("decrypted backup is not a PostgreSQL custom archive")
sys.stdout.buffer.write(prefix)
shutil.copyfileobj(sys.stdin.buffer, sys.stdout.buffer)
'
}

cleanup_required=true
"${compose[@]}" up -d --wait db
decrypt_archive | "${compose[@]}" exec -T db pg_restore --list | python3 -c '
import sys
value = sys.stdin.read()
required = ("TABLE public profiles", "TABLE auth users")
missing = [item for item in required if item not in value]
if missing:
    raise SystemExit(f"archive TOC lacks required relations: {missing}")
'
"${compose[@]}" exec -T db createdb -U postgres -T template0 -O postgres aa_restore
decrypt_archive | "${compose[@]}" exec -T db \
  pg_restore -U postgres -d aa_restore --single-transaction --exit-on-error

python3 - "$MIGRATIONS_DIR" <<'PY' | "${compose[@]}" exec -T db \
  psql -U postgres -d aa_restore --quiet
import hashlib
import re
import sys
from pathlib import Path

migration_dir = Path(sys.argv[1])
pattern = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")
files = sorted(path for path in migration_dir.iterdir() if path.is_file())
if not files or any(not pattern.fullmatch(path.name) for path in files):
    raise SystemExit("migration directory contains no migrations or invalid filenames")
if len({path.name[:4] for path in files}) != len(files):
    raise SystemExit("migration numeric prefixes must be unique")

print(r"\set ON_ERROR_STOP on")
print("select pg_advisory_lock(584379251642045998);")
print("create temporary table expected_migrations (position integer primary key, filename text unique not null, sha256 text not null);")
for position, path in enumerate(files, 1):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"insert into expected_migrations values ({position}, '{path.name}', '{digest}');")
print(r"""
do $ledger_validation$
begin
  if current_database() <> 'aa_restore' then
    raise exception 'restore validation ran against the wrong database';
  end if;
  if to_regclass('aa_deploy.schema_migrations') is null then
    raise exception 'migration ledger is missing';
  end if;
  if exists (
    select 1
    from aa_deploy.schema_migrations applied
    left join expected_migrations expected using (filename)
    where expected.filename is null
  ) then
    raise exception 'restored migration ledger contains an unknown filename';
  end if;
  if exists (
    select 1
    from aa_deploy.schema_migrations applied
    join expected_migrations expected using (filename)
    where applied.sha256 <> expected.sha256
  ) then
    raise exception 'restored migration ledger contains a changed hash';
  end if;
  if exists (
    select 1
    from aa_deploy.schema_migrations applied
    join expected_migrations expected using (filename)
    where exists (
      select 1
      from expected_migrations earlier
      where earlier.position < expected.position
        and not exists (
          select 1 from aa_deploy.schema_migrations prior
          where prior.filename = earlier.filename
        )
    )
  ) then
    raise exception 'restored migration ledger is not a continuous source prefix';
  end if;
end
$ledger_validation$;
""")
for path in files:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    migration_sql = path.read_text()
    print(f"select not exists (select 1 from aa_deploy.schema_migrations where filename = '{path.name}') as apply_migration \\gset")
    print(r"\if :apply_migration")
    print("begin;")
    sys.stdout.write(migration_sql)
    if not migration_sql.endswith("\n"):
        print()
    print(f"insert into aa_deploy.schema_migrations(filename, sha256) values ('{path.name}', '{digest}');")
    print("commit;")
    print(r"\endif")
print(r"""
do $validation$
declare
  rpc text;
begin
  if exists (
    select 1
    from expected_migrations expected
    full join aa_deploy.schema_migrations applied using (filename)
    where expected.filename is null
       or applied.filename is null
       or expected.sha256 <> applied.sha256
  ) then
    raise exception 'migrated restore ledger does not match repository sources';
  end if;
  if exists (
    with expected(name) as (values
      ('profiles'), ('circles'), ('circle_members'), ('expenses'),
      ('expense_splits'), ('invitations'), ('settlements'), ('ai_settings'), ('asr_usage')
    ), actual(name) as (
      select relation.relname
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relkind = 'r' and relation.relrowsecurity
    )
    select 1 from expected full join actual using (name)
    where expected.name is null or actual.name is null
  ) then
    raise exception 'RLS-enabled application table set is invalid';
  end if;
  if exists (
    with expected(tablename, policyname) as (values
      ('profiles', 'read own or co-member profiles'),
      ('profiles', 'insert own profile'),
      ('profiles', 'update own profile'),
      ('circles', 'members read circles'),
      ('circle_members', 'members read members'),
      ('expenses', 'members read expenses'),
      ('expense_splits', 'members read splits'),
      ('invitations', 'admins read invitations'),
      ('settlements', 'members read settlements'),
      ('ai_settings', 'read global or member ai settings'),
      ('ai_settings', 'admins insert circle ai settings'),
      ('ai_settings', 'admins update circle ai settings'),
      ('ai_settings', 'admins delete circle ai settings')
    ), actual(tablename, policyname) as (
      select tablename, policyname from pg_policies where schemaname = 'public'
    )
    select 1 from expected full join actual using (tablename, policyname)
    where expected.tablename is null or actual.tablename is null
  ) then
    raise exception 'application RLS policy set is invalid';
  end if;
  if exists (
    select 1 from (values
      ('users'), ('identities'), ('sessions'), ('refresh_tokens'), ('audit_log_entries')
    ) required(name)
    where to_regclass('auth.' || required.name) is null
  ) then
    raise exception 'required Auth relation is missing';
  end if;
  if exists (
    select 1 from (values
      ('postgres'), ('authenticator'), ('supabase_auth_admin'), ('supabase_admin'),
      ('anon'), ('authenticated'), ('service_role')
    ) required(name)
    where not exists (select 1 from pg_roles where rolname = required.name)
  ) then
    raise exception 'required database role is missing';
  end if;
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_roles owner on owner.oid = relation.relowner
    where namespace.nspname = 'public'
      and relation.relname in (
        'profiles', 'circles', 'circle_members', 'expenses', 'expense_splits',
        'invitations', 'settlements', 'ai_settings', 'asr_usage', 'circle_balances'
      )
      and owner.rolname <> 'postgres'
  ) or not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_roles owner on owner.oid = relation.relowner
    where namespace.nspname = 'auth' and relation.relname = 'users'
      and owner.rolname = 'supabase_auth_admin'
  ) then
    raise exception 'restored object ownership is invalid';
  end if;
  if exists (
    select 1
    from pg_constraint constraint_record
    join pg_class relation on relation.oid = constraint_record.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('public', 'auth') and not constraint_record.convalidated
  ) then
    raise exception 'restored database contains an unvalidated constraint';
  end if;
  if exists (
    select 1
    from public.expense_splits split
    join public.expenses expense on expense.id = split.expense_id
    where split.circle_id <> expense.circle_id
  ) or exists (
    select 1
    from public.expenses expense
    left join public.expense_splits split on split.expense_id = expense.id
    group by expense.id, expense.amount_minor
    having coalesce(sum(split.owed_minor), 0) <> expense.amount_minor
  ) then
    raise exception 'restored expense split invariants failed';
  end if;
  if exists (
    select 1
    from auth.users users
    left join public.profiles profiles on profiles.id = users.id
    where profiles.id is null
  ) then
    raise exception 'an Auth user is missing its application profile';
  end if;
  if exists (
    select 1 from public.circle_balances
    group by circle_id having coalesce(sum(net_minor), 0) <> 0
  ) then
    raise exception 'restored circle balances are not zero-sum';
  end if;
  if not has_table_privilege('authenticated', 'public.profiles', 'select')
     or not has_table_privilege('authenticated', 'public.ai_settings', 'select')
     or has_table_privilege('authenticated', 'public.circles', 'update')
     or has_table_privilege('authenticated', 'public.circles', 'delete')
     or has_table_privilege('authenticated', 'public.expenses', 'insert')
     or has_table_privilege('authenticated', 'public.expenses', 'update')
     or has_table_privilege('authenticated', 'public.expenses', 'delete')
     or has_table_privilege('authenticated', 'public.expense_splits', 'insert')
     or has_table_privilege('authenticated', 'public.expense_splits', 'update')
     or has_table_privilege('authenticated', 'public.expense_splits', 'delete')
     or has_table_privilege('authenticated', 'public.invitations', 'insert')
     or has_table_privilege('authenticated', 'public.invitations', 'update')
     or has_table_privilege('authenticated', 'public.invitations', 'delete')
     or has_table_privilege('authenticated', 'public.settlements', 'insert')
     or has_table_privilege('authenticated', 'public.settlements', 'update')
     or has_table_privilege('authenticated', 'public.settlements', 'delete')
     or has_table_privilege('anon', 'public.profiles', 'select')
     or has_table_privilege('anon', 'public.profiles', 'insert')
     or has_table_privilege('anon', 'public.profiles', 'update')
     or has_table_privilege('anon', 'public.profiles', 'delete')
     or has_table_privilege('anon', 'public.circles', 'update')
     or has_table_privilege('anon', 'public.circles', 'delete') then
    raise exception 'restored application table grants are invalid';
  end if;
  foreach rpc in array array[
    'public.create_circle(text,text,character)',
    'public.update_circle(uuid,text,text,character)',
    'public.create_invitation(uuid,text,integer,timestamptz)',
    'public.accept_invitation(text)',
    'public.create_expense(uuid,uuid,bigint,character,text,text,date,text,jsonb,text,text,text,text,numeric,jsonb)',
    'public.create_settlement(uuid,uuid,uuid,bigint,character,text)',
    'public.consume_asr_quota()',
    'public.create_canary_circle(uuid,text)',
    'public.cleanup_canary_circle(uuid,text)'
  ] loop
    if to_regprocedure(rpc) is null
       or not has_function_privilege('authenticated', rpc, 'execute')
       or has_function_privilege('anon', rpc, 'execute') then
      raise exception 'required RPC grant is invalid: %', rpc;
    end if;
  end loop;
end
$validation$;
""")
print("select pg_advisory_unlock(584379251642045998);")
PY

printf 'Isolated database-only restore drill completed for %s. The checksum proved ciphertext integrity, not backup provenance; record only approved non-secret evidence.\n' "$AA_STACK_ID"
