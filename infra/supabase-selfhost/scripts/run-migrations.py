#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
import stat
from pathlib import Path

MIGRATION_NAME = re.compile(r"^[0-9]{4}_[a-z0-9_]+\.sql$")
LOCK_KEY = "584379251642045998"
ROOT = Path(__file__).resolve().parents[3]
INFRA = ROOT / "infra/supabase-selfhost"
APPROVED_COMPOSE = INFRA / "compose.base.yml"
APPROVED_MIGRATIONS = ROOT / "supabase/migrations"


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def approved_path(path: Path, expected: Path, kind: str) -> Path:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        raise SystemExit(f"{kind} must not be a symlink")
    if kind == "Compose file" and not stat.S_ISREG(info.st_mode):
        raise SystemExit("Compose file must be a regular file")
    if kind == "migration directory" and not stat.S_ISDIR(info.st_mode):
        raise SystemExit("migration directory must be a directory")
    resolved = path.resolve(strict=True)
    if resolved != expected.resolve(strict=True):
        raise SystemExit(f"{kind} is not the repository-approved path")
    return resolved


def parse_env(path: Path) -> dict[str, str]:
    return dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if line and not line.startswith("#")
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-environment", required=True, choices=("staging", "production"))
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--compose-file", required=True, type=Path)
    parser.add_argument("--migrations", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    compose_file = approved_path(args.compose_file, APPROVED_COMPOSE, "Compose file")
    migrations = approved_path(args.migrations, APPROVED_MIGRATIONS, "migration directory")
    validator = ["python3", str(INFRA / "scripts/validate-env.py"), str(args.env_file)]
    if not args.dry_run:
        validator.append("--require-root-owner")
    subprocess.run(validator, check=True)
    environment = parse_env(args.env_file)
    if environment["AA_ENVIRONMENT"] != args.expected_environment:
        raise SystemExit("environment file does not match --expected-environment")

    fingerprint_result = subprocess.run(
        ["node", str(ROOT / "scripts/hosted-deployment.mjs"), "fingerprint"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    current_fingerprint = json.loads(fingerprint_result.stdout).get("bundleSha256")
    if current_fingerprint != environment["AA_SOURCE_FINGERPRINT"]:
        raise SystemExit("current hosted-deployment fingerprint does not match AA_SOURCE_FINGERPRINT")

    files = sorted(path for path in migrations.iterdir() if path.is_file())
    if not files or any(not MIGRATION_NAME.fullmatch(path.name) for path in files):
        raise SystemExit("migration directory contains no migrations or invalid filenames")
    if len({path.name[:4] for path in files}) != len(files):
        raise SystemExit("migration numeric prefixes must be unique")

    expected_filenames = ", ".join(quote(path.name) for path in files)
    sql = [
        "\\set ON_ERROR_STOP on",
        f"select pg_advisory_lock({LOCK_KEY});",
        "create schema if not exists aa_deploy;",
        "create table if not exists aa_deploy.schema_migrations (filename text primary key, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), applied_at timestamptz not null default now());",
        f"select not exists (select 1 from aa_deploy.schema_migrations where filename not in ({expected_filenames})) as ledger_known \\gset",
        "\\if :ledger_known",
        "\\else",
        "\\echo Applied migration ledger contains a file absent from the source directory",
        "\\quit 1",
        "\\endif",
        "create temporary table aa_expected_migration_order (position integer primary key, filename text unique not null);",
    ]
    for position, path in enumerate(files, 1):
        sql.append(f"insert into aa_expected_migration_order(position, filename) values ({position}, {quote(path.name)});")
    sql.extend([
        "select not exists (select 1 from aa_deploy.schema_migrations applied join aa_expected_migration_order expected using (filename) where exists (select 1 from aa_expected_migration_order earlier where earlier.position < expected.position and not exists (select 1 from aa_deploy.schema_migrations prior where prior.filename = earlier.filename))) as ledger_prefix \\gset",
        "\\if :ledger_prefix",
        "\\else",
        "\\echo Applied migration ledger is not a continuous source prefix",
        "\\quit 1",
        "\\endif",
    ])
    for path in files:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        filename = quote(path.name)
        checksum = quote(digest)
        migration_sql = path.read_text()
        sql.extend([
            f"select not exists (select 1 from aa_deploy.schema_migrations where filename = {filename} and sha256 <> {checksum}) as hash_matches \\gset",
            "\\if :hash_matches",
            "\\else",
            f"\\echo Applied migration hash changed: {path.name}",
            "\\quit 1",
            "\\endif",
            f"select not exists (select 1 from aa_deploy.schema_migrations where filename = {filename}) as apply_migration \\gset",
            "\\if :apply_migration",
            "begin;",
            migration_sql,
            f"insert into aa_deploy.schema_migrations(filename, sha256) values ({filename}, {checksum});",
            "commit;",
            "\\endif",
        ])
    sql.extend([f"select pg_advisory_unlock({LOCK_KEY});", "select filename, sha256, applied_at from aa_deploy.schema_migrations order by filename;"])

    if args.dry_run:
        print("Validated migration ordering and generated a locked migration program.")
        return

    subprocess.run([
        "docker", "compose", "--project-name", environment["AA_STACK_ID"],
        "--env-file", str(args.env_file), "-f", str(compose_file),
        "exec", "-T", "db", "psql", "-U", "postgres", "-d", "postgres",
    ], input="\n".join(sql) + "\n", text=True, check=True)


if __name__ == "__main__":
    main()
