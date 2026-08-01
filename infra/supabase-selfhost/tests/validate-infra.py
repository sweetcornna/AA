#!/usr/bin/env python3
import ast
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INFRA = ROOT / "infra/supabase-selfhost"
COMPOSE = INFRA / "compose.base.yml"
SINGLE_COMPOSE = INFRA / "compose.single-stack.yml"
RESTORE_COMPOSE = INFRA / "compose.restore.yml"
SINGLE_RESTORE_COMPOSE = INFRA / "compose.restore.single-stack.yml"
EXPECTED_SERVICES = {"db", "templates", "auth", "rest", "realtime", "functions", "kong"}
EXPECTED_NETWORKS = {
    "db": {"backend"},
    "templates": {"backend"},
    "auth": {"backend", "egress"},
    "rest": {"backend"},
    "realtime": {"backend"},
    "functions": {"backend", "egress"},
    "kong": {"backend", "gateway"},
}
IMAGE_LOCK_KEYS = {
    "db": "POSTGRES_IMAGE",
    "templates": "TEMPLATE_IMAGE",
    "auth": "AUTH_IMAGE",
    "rest": "REST_IMAGE",
    "realtime": "REALTIME_IMAGE",
    "functions": "FUNCTIONS_IMAGE",
    "kong": "KONG_IMAGE",
}
EXPECTED_RETAINED_UPSTREAM_FILES = {
    ".aa-upstream-sha256": "0444",
    "api/kong-entrypoint.sh": "0555",
    "db/_supabase.sql": "0444",
    "db/jwt.sql": "0444",
    "db/realtime.sql": "0444",
    "db/roles.sql": "0444",
    "db/webhooks.sql": "0444",
    "functions/main/index.ts": "0444",
}
EXPECTED_DB_INIT_TARGETS = {
    "db/_supabase.sql": "/docker-entrypoint-initdb.d/migrations/97-_supabase.sql",
    "db/realtime.sql": "/docker-entrypoint-initdb.d/migrations/99-realtime.sql",
    "db/webhooks.sql": "/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql",
    "db/roles.sql": "/docker-entrypoint-initdb.d/init-scripts/99-roles.sql",
    "db/jwt.sql": "/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql",
}


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def parse_lock() -> dict[str, str]:
    values = {}
    for raw in (INFRA / "upstream.lock").read_text().splitlines():
        if raw and not raw.startswith("#"):
            key, value = raw.split("=", 1)
            values[key] = value
    return values


def expect_failure(command: list[str]) -> None:
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    check(result.returncode != 0, f"command unexpectedly succeeded: {command}")


def sha256(value: bytes) -> str:
    import hashlib
    return hashlib.sha256(value).hexdigest()


def db_init_bind_mounts(service: dict) -> dict[str, str]:
    mounts = {}
    for mount in service.get("volumes", []):
        if (
            isinstance(mount, dict)
            and mount.get("type") == "bind"
            and mount.get("target", "").startswith("/docker-entrypoint-initdb.d/")
        ):
            check(mount.get("read_only") is True, "database init bind must be read-only")
            mounts[mount["target"]] = mount["source"]
    return mounts


def assigned_literal(source: str, name: str) -> object:
    module = ast.parse(source)
    for node in module.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise ValueError(f"assignment not found: {name}")


def check_capacity_profiles() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        binaries = root / "bin"
        binaries.mkdir()
        for name, source in {
            "getconf": "#!/bin/sh\nprintf '4\\n'\n",
            "df": "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 60000000 1 52428800 1%% /\\n'\n",
        }.items():
            path = binaries / name
            path.write_text(source)
            path.chmod(0o755)

        os_release = root / "os-release"
        meminfo = root / "meminfo"
        meminfo.write_text("MemTotal:       8388608 kB\n")
        targets = [root / "srv-aa", root / "docker-root"]
        for target in targets:
            target.mkdir()
        capacity = (INFRA / "scripts/capacity-check.sh").read_text()
        capacity = capacity.replace("/etc/os-release", str(os_release)).replace("/proc/meminfo", str(meminfo))
        script = root / "capacity-check.sh"
        script.write_text(capacity)
        script.chmod(0o755)
        environment = {**os.environ, "PATH": f"{binaries}:{os.environ['PATH']}"}

        def run(
            identifier: str,
            version: str,
            cpus: int,
            memory_kib: int,
            *arguments: str,
            extra_environment: dict[str, str] | None = None,
        ) -> subprocess.CompletedProcess[str]:
            os_release.write_text(f'ID={identifier}\nVERSION_ID="{version}"\n')
            (binaries / "getconf").write_text(f"#!/bin/sh\nprintf '{cpus}\\n'\n")
            (binaries / "getconf").chmod(0o755)
            meminfo.write_text(
                f"MemTotal:       {memory_kib} kB\n"
                "MemAvailable:   401408 kB\n"
                "SwapTotal:      4194304 kB\n"
            )
            return subprocess.run(
                ["bash", str(script), *arguments, *(str(target) for target in targets)],
                env={**environment, **(extra_environment or {})},
                text=True,
                capture_output=True,
            )

        for version in ("12", "13"):
            result = run("debian", version, 4, 8388608)
            check(result.returncode == 0, f"Debian {version} must pass the supported OS fixture: {result.stderr}")
        result = run("debian", "11", 4, 8388608)
        check(
            result.returncode != 0 and "Debian version gate failed for dual-stack: 11 < 12" in result.stderr,
            "Debian 11 must fail the supported OS gate",
        )
        result = run("ubuntu", "24", 4, 8388608)
        check(
            result.returncode != 0 and "Only a supported Debian host is approved" in result.stderr,
            "non-Debian hosts must fail the supported OS gate",
        )

        # The target VM's CPU/RAM/disk clear the single-stack floors, but it
        # still runs Debian 11, whose LTS ends 2026-08-31. The OS gate is a
        # security requirement, not a capacity trade-off, so it must reject the
        # host as it exists today and only pass once the OS is upgraded.
        current_vm = run("debian", "11", 2, 935936, "--profile", "single-stack")
        check(
            current_vm.returncode != 0
            and "Debian version gate failed for single-stack: 11 < 12" in current_vm.stderr,
            "the unsupported Debian 11 host must fail even in single-stack mode",
        )

        upgraded_vm = run("debian", "12", 2, 935936, "--profile", "single-stack")
        check(upgraded_vm.returncode == 0, f"upgraded single-stack VM fixture must pass: {upgraded_vm.stderr}")
        check(upgraded_vm.stdout.count("Disk gate passed") == 2, "single-stack fixture must check both filesystems")
        print("Single-stack upgraded-VM fixture output:")
        print(upgraded_vm.stdout.strip())

        below_floor = run("debian", "12", 2, 917503, "--profile", "single-stack")
        check(
            below_floor.returncode != 0 and "RAM gate failed: 917503 KiB < 917504 KiB" in below_floor.stderr,
            "single-stack RAM floor must fail closed",
        )
        print("Single-stack below-floor fixture output:")
        print(below_floor.stderr.strip())

        # Use a supported OS so this exercises the override guard itself rather
        # than tripping the Debian gate first.
        lowered = run(
            "debian", "12", 2, 935936, "--profile", "single-stack",
            extra_environment={"AA_MIN_MEMORY_KIB": "1"},
        )
        check(
            lowered.returncode != 0 and "cannot be lower than the single-stack floor" in lowered.stderr,
            "single-stack environment overrides must not lower the hard floor",
        )
        unknown = run("debian", "12", 4, 8388608, "--profile", "skip")
        check(unknown.returncode != 0 and "Unknown capacity profile" in unknown.stderr, "unknown capacity profiles must fail closed")


def write_artifact_fixture(runtime: Path, fingerprint: dict, upstream_commit: str) -> tuple[Path, Path]:
    artifact = runtime / "functions" / fingerprint["bundleSha256"]
    template = runtime / "templates" / fingerprint["bundleSha256"] / "confirmation.html"
    entries = []
    for relative in (
        "agent-query/index.ts",
        "asr-transcribe/index.ts",
        "main/index.ts",
        "parse-expense/index.ts",
    ):
        path = artifact / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(f"fixture:{relative}\n".encode())
        entries.append({"path": relative, "sha256": sha256(path.read_bytes())})
    canonical = "".join(f"{entry['sha256']}  {entry['path']}\n" for entry in entries).encode()
    manifest = {
        "schemaVersion": 1,
        "sourceFingerprint": fingerprint["bundleSha256"],
        "upstreamCommit": upstream_commit,
        "denoVersion": "2.9.1",
        "artifactSha256": sha256(canonical),
        "files": entries,
    }
    (artifact / "artifact-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (artifact / "fingerprint.json").write_text(json.dumps(fingerprint, indent=2) + "\n")
    template.parent.mkdir(parents=True, exist_ok=True)
    template.write_bytes((ROOT / "supabase/templates/confirmation.html").read_bytes())
    for path in [*artifact.rglob("*") , template]:
        if path.is_file():
            path.chmod(0o444)
    return artifact, template


def main() -> None:
    check_capacity_profiles()
    source = COMPOSE.read_text()
    prerequisites = (INFRA / "templates/db/aa-prerequisites.sql").read_text()
    check("container_name:" not in source, "Compose must not pin container names")
    check("latest" not in source, "Compose must not use latest tags")
    check("VERIFY_JWT: \"true\"" in source, "Edge gateway JWT verification must be enabled")
    check("GOTRUE_EXTERNAL_PHONE_ENABLED: \"false\"" in source, "phone auth must be disabled")
    check("GOTRUE_MFA_TOTP_ENROLL_ENABLED: \"false\"" in source, "TOTP MFA must be disabled")
    check("GOTRUE_MAILER_OTP_LENGTH: \"6\"" in source and "GOTRUE_MAILER_OTP_EXP: \"600\"" in source, "OTP contract mismatch")
    check("/home/deno/functions:ro" in source, "function artifact must be read-only")
    for required in (
        "alter function auth.uid() owner to supabase_auth_admin;",
        "alter function auth.role() owner to supabase_auth_admin;",
        "alter function auth.email() owner to supabase_auth_admin;",
        "create schema if not exists _realtime;",
        "alter schema _realtime owner to supabase_admin;",
        "create schema if not exists extensions;",
        "create extension if not exists pgcrypto with schema extensions;",
        "create publication supabase_realtime",
    ):
        check(required in prerequisites, f"database prerequisite contract missing: {required}")

    canary_migration = (ROOT / "supabase/migrations/0011_production_canary_cleanup.sql").read_text()
    for required in (
        "function public.create_canary_circle(",
        "insert into public.circles (",
        "on conflict (id) do nothing",
        "insert into public.circle_members",
        "on conflict (circle_id, user_id) do nothing",
        "function public.cleanup_canary_circle(",
        "security definer",
        "set search_path = pg_catalog, public",
        "v_uid uuid := auth.uid()",
        "p_run_id !~ '^[0-9a-f]{16}$'",
        "circle.created_by = v_uid",
        "circle.name = 'AA-CANARY-' || p_run_id",
        "circle.description = 'production-canary:' || p_run_id",
        "circle.created_at >= clock_timestamp() - interval '2 hours'",
        "for update",
        "member.role = 'owner'",
        ") not between 1 and 2",
        "member.role <> 'member'",
        "delete from public.circles",
        "from public, anon, authenticated",
        "to authenticated, service_role",
    ):
        check(required in canary_migration, f"production canary cleanup contract missing: {required}")
    for forbidden in ("delete from auth.", "delete from public.profiles", "delete from public.asr_usage"):
        check(forbidden not in canary_migration, f"production canary cleanup contains forbidden deletion: {forbidden}")

    circle_currency_migration = (ROOT / "supabase/migrations/0012_circle_currency_integrity.sql").read_text()
    for required in (
        'drop policy if exists "admins update circles" on public.circles',
        "revoke update, delete on public.circles from anon, authenticated",
        "create or replace function public.update_circle(",
        "p_circle_id uuid",
        "p_name text",
        "p_description text",
        "p_currency char(3)",
        "returns public.circles",
        "security definer",
        "set search_path = pg_catalog, public",
        "v_uid uuid := auth.uid()",
        "private.is_circle_admin(p_circle_id, v_uid)",
        "char_length(btrim(p_name)) < 1",
        "char_length(p_name) > 100",
        "char_length(p_description) > 1000",
        "p_currency::text !~ '^[A-Z]{3}$'",
        "v_circle.default_currency is distinct from p_currency",
        "from public.expenses expense",
        "from public.settlements settlement",
        "circle currency cannot change after expenses or settlements exist",
        "set name = btrim(p_name)",
        "description = coalesce(p_description, '')",
        "default_currency = p_currency",
        "from public, anon, authenticated",
        "to authenticated, service_role",
        "create or replace function public.create_expense(",
        "c.id = p_circle_id and c.default_currency = p_currency",
        "errcode = '22023', message = 'expense currency must match the circle'",
    ):
        check(required in circle_currency_migration, f"circle currency integrity contract missing: {required}")
    check(
        circle_currency_migration.count("create or replace function public.create_expense(") == 1,
        "circle currency migration must replace create_expense exactly once",
    )
    for forbidden in (
        "grant update on public.circles",
        "grant delete on public.circles",
        "to anon",
    ):
        check(forbidden not in circle_currency_migration, f"circle currency integrity contains forbidden grant: {forbidden}")

    canary = (ROOT / "scripts/verify-production-canary.mjs").read_text()
    for required in (
        'readApprovedTarget("production", configuration.targetsFile)',
        "configuration.url !== production.apiOrigin",
        'jwtRole(configuration.publicKey) !== "anon"',
        "AA_SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
        "configuration.otpEmail.trim().toLowerCase() === configuration.passwordEmail.trim().toLowerCase()",
        "ownerId === memberId",
        "shouldCreateUser: false",
        "verifyOtp",
        "signInWithPassword",
        'anonymous.rpc("create_circle"',
        'owner.rpc("create_canary_circle"',
        "circleMayExist = true",
        '"nonmember RLS denial"',
        'owner.rpc("create_invitation"',
        'member.rpc("accept_invitation"',
        'table: "expenses"',
        'owner.rpc("create_expense"',
        'member.from("expenses")',
        'member.rpc("create_settlement"',
        'owner.functions.invoke("parse-expense"',
        'member.functions.invoke("agent-query"',
        'owner.functions.invoke("asr-transcribe"',
        "finally {",
        'owner.rpc("cleanup_canary_circle"',
        "Promise.allSettled([owner.auth.signOut(), member.auth.signOut()])",
    ):
        check(required in canary, f"production canary contract missing: {required}")
    for forbidden in ("service_role", 'from("auth.users")', 'from("asr_usage").delete', "verify-backend.mjs"):
        check(forbidden not in canary, f"production canary contains forbidden behavior: {forbidden}")
    destructive_backend = (ROOT / "scripts/verify-backend.mjs").read_text()
    check('deploymentMode !== "dual-stack"' in destructive_backend, "remote destructive tests must reject single-stack targets")
    check("remote destructive tests require an approved dual-stack target manifest" in destructive_backend, "single-stack destructive-test rejection must be explicit")

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        runtime = root / "runtime"

        source_fingerprint = json.loads(subprocess.run([
            "node", str(ROOT / "scripts/hosted-deployment.mjs"), "fingerprint",
        ], check=True, capture_output=True, text=True).stdout)
        fingerprint = source_fingerprint["bundleSha256"]
        artifact, artifact_template = write_artifact_fixture(
            runtime, source_fingerprint, parse_lock()["SUPABASE_COMMIT"]
        )
        verifier = [
            "python3", str(INFRA / "scripts/verify-artifact.py"), str(artifact),
            "--template", str(artifact_template),
            "--expected-fingerprint", source_fingerprint["bundleSha256"],
        ]
        subprocess.run(verifier, check=True, stdout=subprocess.DEVNULL)
        fingerprint_path = artifact / "fingerprint.json"
        original_fingerprint = fingerprint_path.read_bytes()

        tampered_fingerprint = json.loads(original_fingerprint)
        tampered_fingerprint["files"][0]["sha256"] = "0" * 64
        canonical = "".join(
            f"{entry['sha256']}  {entry['path']}\n"
            for entry in tampered_fingerprint["files"]
        ).encode()
        tampered_fingerprint["bundleSha256"] = sha256(canonical)
        fingerprint_path.chmod(0o644)
        fingerprint_path.write_text(json.dumps(tampered_fingerprint, indent=2) + "\n")
        fingerprint_path.chmod(0o444)
        expect_failure(verifier)

        fingerprint_path.chmod(0o644)
        fingerprint_path.write_bytes(original_fingerprint)
        fingerprint_path.chmod(0o444)
        traversal_fingerprint = json.loads(original_fingerprint)
        traversal_fingerprint["files"][0]["path"] = "../outside-source"
        fingerprint_path.chmod(0o644)
        fingerprint_path.write_text(json.dumps(traversal_fingerprint, indent=2) + "\n")
        fingerprint_path.chmod(0o444)
        expect_failure(verifier)

        fingerprint_path.chmod(0o644)
        fingerprint_path.write_bytes(original_fingerprint)
        fingerprint_path.chmod(0o444)
        extra_field_fingerprint = json.loads(original_fingerprint)
        extra_field_fingerprint["unexpected"] = True
        fingerprint_path.chmod(0o644)
        fingerprint_path.write_text(json.dumps(extra_field_fingerprint, indent=2) + "\n")
        fingerprint_path.chmod(0o444)
        expect_failure(verifier)

        fingerprint_path.chmod(0o644)
        fingerprint_path.write_bytes(original_fingerprint)
        fingerprint_path.chmod(0o444)
        duplicate_field = original_fingerprint.decode().replace(
            '  "schemaVersion": 2,',
            '  "schemaVersion": 2,\n  "schemaVersion": 2,',
            1,
        )
        fingerprint_path.chmod(0o644)
        fingerprint_path.write_text(duplicate_field)
        fingerprint_path.chmod(0o444)
        expect_failure(verifier)

        fingerprint_path.chmod(0o644)
        fingerprint_path.write_bytes(original_fingerprint)
        fingerprint_path.chmod(0o444)
        unexpected_artifact_file = artifact / "unexpected.txt"
        unexpected_artifact_file.write_text("not in manifest\n")
        unexpected_artifact_file.chmod(0o444)
        expect_failure(verifier)
        unexpected_artifact_file.unlink()
        subprocess.run(verifier, check=True, stdout=subprocess.DEVNULL)

        provider_staging = root / "provider-staging.json"
        provider_production = root / "provider-production.json"
        provider_staging.write_text(json.dumps({"SMTP_PASS": "s" * 32, "OPENAI_API_KEY": "o" * 32}))
        provider_production.write_text(json.dumps({"SMTP_PASS": "t" * 32, "OPENAI_API_KEY": "p" * 32}))
        provider_staging.chmod(0o600)
        provider_production.chmod(0o600)
        provider_symlink = root / "provider-symlink.json"
        provider_symlink.symlink_to(provider_staging)
        expect_failure([
            "python3", str(INFRA / "scripts/generate-env.py"), "staging", str(root / "symlink-provider.env"),
            "--fingerprint", fingerprint,
            "--smtp-admin-email", "aa-staging@cornna.xyz",
            "--provider-secrets", str(provider_symlink),
            "--backup-recipient", "age1" + "q" * 58,
            "--azure-storage-account", "aabackupaccount",
            "--azure-storage-container", "aa-staging",
        ])
        check(not (root / "symlink-provider.env").exists(), "provider symlink failure created an environment file")
        envs = {}
        for environment, provider in (("staging", provider_staging), ("production", provider_production)):
            env_path = root / f"{environment}.env"
            subprocess.run([
                "python3", str(INFRA / "scripts/generate-env.py"), environment, str(env_path),
                "--fingerprint", fingerprint,
                "--smtp-admin-email", f"aa-{environment}@cornna.xyz",
                "--provider-secrets", str(provider),
                "--backup-recipient", "age1" + ("q" if environment == "staging" else "r") * 58,
                "--azure-storage-account", "aabackupaccount",
                "--azure-storage-container", f"aa-{environment}",
            ], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["python3", str(INFRA / "scripts/validate-env.py"), str(env_path)], check=True, stdout=subprocess.DEVNULL)
            envs[environment] = env_path
        subprocess.run(["python3", str(INFRA / "scripts/validate-pair.py"), str(envs["staging"]), str(envs["production"])], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-env.py"), str(envs["production"]),
            "--profile", "single-stack",
        ], check=True, stdout=subprocess.DEVNULL)
        expect_failure([
            "python3", str(INFRA / "scripts/validate-env.py"), str(envs["staging"]),
            "--profile", "single-stack",
        ])
        expect_failure([
            "python3", str(INFRA / "scripts/generate-env.py"), "staging", str(root / "single-staging.env"),
            "--profile", "single-stack",
            "--fingerprint", fingerprint,
            "--smtp-admin-email", "aa-staging@cornna.xyz",
            "--provider-secrets", str(provider_staging),
            "--backup-recipient", "age1" + "q" * 58,
            "--azure-storage-account", "aabackupaccount",
            "--azure-storage-container", "aa-staging",
        ])
        missing_azure_env = root / "missing-azure.env"
        expect_failure([
            "python3", str(INFRA / "scripts/generate-env.py"), "production", str(missing_azure_env),
            "--profile", "single-stack",
            "--fingerprint", fingerprint,
            "--smtp-admin-email", "aa-production-local@cornna.xyz",
            "--provider-secrets", str(provider_production),
            "--backup-recipient", "age1" + "s" * 58,
        ])
        check(not missing_azure_env.exists(), "default azure-blob generation succeeded without Azure storage")
        single_production_env = root / "single-production.env"
        subprocess.run([
            "python3", str(INFRA / "scripts/generate-env.py"), "production", str(single_production_env),
            "--profile", "single-stack",
            "--fingerprint", fingerprint,
            "--smtp-admin-email", "aa-production-single@cornna.xyz",
            "--provider-secrets", str(provider_production),
            "--backup-recipient", "age1" + "s" * 58,
            "--azure-storage-account", "aabackupaccount",
            "--azure-storage-container", "aa-production-single",
        ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-env.py"), str(single_production_env),
            "--profile", "single-stack",
        ], check=True, stdout=subprocess.DEVNULL)
        local_production_env = root / "local-production.env"
        subprocess.run([
            "python3", str(INFRA / "scripts/generate-env.py"), "production", str(local_production_env),
            "--profile", "single-stack",
            "--destination", "local",
            "--fingerprint", fingerprint,
            "--smtp-admin-email", "aa-production-local@cornna.xyz",
            "--provider-secrets", str(provider_production),
            "--backup-recipient", "age1" + "t" * 58,
        ], check=True, stdout=subprocess.DEVNULL)
        local_values = dict(line.split("=", 1) for line in local_production_env.read_text().splitlines())
        check(local_values["BACKUP_DESTINATION"] == "local", "local environment destination mismatch")
        check("AZURE_STORAGE_ACCOUNT" not in local_values, "local environment unexpectedly requires an Azure account")
        check("AZURE_STORAGE_CONTAINER" not in local_values, "local environment unexpectedly requires an Azure container")
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-env.py"), str(local_production_env),
            "--profile", "single-stack",
        ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-env.py"), str(local_production_env),
            "--profile", "single-stack", "--destination", "local",
        ], check=True, stdout=subprocess.DEVNULL)
        expect_failure([
            "python3", str(INFRA / "scripts/validate-env.py"), str(local_production_env),
            "--profile", "single-stack", "--destination", "azure-blob",
        ])

        mismatched_fingerprint = root / "mismatched-fingerprint.env"
        mismatched_fingerprint.write_text(envs["production"].read_text().replace(
            f"AA_SOURCE_FINGERPRINT={fingerprint}",
            f"AA_SOURCE_FINGERPRINT={'b' * 64}",
        ))
        mismatched_fingerprint.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-pair.py"), str(envs["staging"]), str(mismatched_fingerprint)])

        reused_sender = root / "reused-sender.env"
        reused_sender.write_text(envs["production"].read_text().replace(
            "SMTP_ADMIN_EMAIL=aa-production@cornna.xyz",
            "SMTP_ADMIN_EMAIL=aa-staging@cornna.xyz",
        ))
        reused_sender.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-pair.py"), str(envs["staging"]), str(reused_sender)])

        reused_recipient = root / "reused-recipient.env"
        reused_recipient.write_text(envs["production"].read_text().replace(
            "BACKUP_AGE_RECIPIENT=age1" + "r" * 58,
            "BACKUP_AGE_RECIPIENT=age1" + "q" * 58,
        ))
        reused_recipient.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-pair.py"), str(envs["staging"]), str(reused_recipient)])

        migration_command = [
            "python3", str(INFRA / "scripts/run-migrations.py"),
            "--expected-environment", "staging",
            "--env-file", str(envs["staging"]),
            "--compose-file", str(COMPOSE),
            "--migrations", str(ROOT / "supabase/migrations"),
            "--dry-run",
        ]
        subprocess.run(migration_command, check=True, stdout=subprocess.DEVNULL)
        wrong_environment_command = migration_command.copy()
        wrong_environment_command[wrong_environment_command.index("staging")] = "production"
        expect_failure(wrong_environment_command)
        unapproved_compose_command = migration_command.copy()
        unapproved_compose_command[unapproved_compose_command.index(str(COMPOSE))] = str(RESTORE_COMPOSE)
        expect_failure(unapproved_compose_command)

        stale_fingerprint_env = root / "stale-fingerprint.env"
        subprocess.run([
            "python3", str(INFRA / "scripts/generate-env.py"), "staging", str(stale_fingerprint_env),
            "--fingerprint", "b" * 64,
            "--smtp-admin-email", "aa-staging@cornna.xyz",
            "--provider-secrets", str(provider_staging),
            "--backup-recipient", "age1" + "q" * 58,
            "--azure-storage-account", "aabackupaccount",
            "--azure-storage-container", "aa-staging",
        ], check=True, stdout=subprocess.DEVNULL)
        stale_command = migration_command.copy()
        stale_command[stale_command.index(str(envs["staging"]))] = str(stale_fingerprint_env)
        expect_failure(stale_command)

        single_migration_command = [
            "python3", str(INFRA / "scripts/run-migrations.py"),
            "--profile", "single-stack",
            "--expected-environment", "production",
            "--env-file", str(envs["production"]),
            "--compose-file", str(COMPOSE),
            "--migrations", str(ROOT / "supabase/migrations"),
            "--dry-run",
        ]
        subprocess.run(single_migration_command, check=True, stdout=subprocess.DEVNULL)
        wrong_single_migration = single_migration_command.copy()
        wrong_single_migration[wrong_single_migration.index("production")] = "staging"
        wrong_single_migration[wrong_single_migration.index(str(envs["production"]))] = str(envs["staging"])
        expect_failure(wrong_single_migration)

        env_symlink = root / "staging-symlink.env"
        env_symlink.symlink_to(envs["staging"])
        expect_failure(["python3", str(INFRA / "scripts/validate-env.py"), str(env_symlink)])

        permissive = root / "permissive.env"
        permissive.write_bytes(envs["staging"].read_bytes())
        permissive.chmod(0o644)
        expect_failure(["python3", str(INFRA / "scripts/validate-env.py"), str(permissive)])

        placeholder = root / "placeholder.env"
        placeholder.write_text(envs["staging"].read_text().replace("SMTP_PASS=" + "s" * 32, "SMTP_PASS=<runtime-secret>"))
        placeholder.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-env.py"), str(placeholder)])

        malformed_jwt = root / "malformed-jwt.env"
        malformed_jwt.write_text(envs["staging"].read_text().replace(
            next(line for line in envs["staging"].read_text().splitlines() if line.startswith("ANON_KEY=")),
            "ANON_KEY=not-a-jwt",
        ))
        malformed_jwt.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-env.py"), str(malformed_jwt)])

        reused = root / "reused-production.env"
        production_text = envs["production"].read_text()
        staging_values = dict(line.split("=", 1) for line in envs["staging"].read_text().splitlines())
        production_values = dict(line.split("=", 1) for line in production_text.splitlines())
        for key in ("POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY", "SMTP_PASS", "OPENAI_API_KEY"):
            production_text = production_text.replace(f"{key}={production_values[key]}", f"{key}={staging_values[key]}")
        reused.write_text(production_text)
        reused.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-pair.py"), str(envs["staging"]), str(reused)])

        restore_env = root / "restore.env"
        subprocess.run([
            "python3", str(INFRA / "scripts/generate-restore-env.py"), str(restore_env),
            "--drill-id", "test-drill",
        ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_env),
        ], check=True, stdout=subprocess.DEVNULL)
        restore_values = {}
        for line in restore_env.read_text().splitlines():
            key, value = line.split("=", 1)
            restore_values[key] = value
        check(set(restore_values) == {"AA_ENVIRONMENT", "AA_STACK_ID", "AA_UPSTREAM_DIR", "POSTGRES_PASSWORD", "JWT_SECRET"}, "restore environment inventory mismatch")
        check(restore_values["AA_ENVIRONMENT"] == "restore", "restore environment marker mismatch")
        check(re.fullmatch(r"aa-restore-test-drill-[0-9a-f]{16}", restore_values["AA_STACK_ID"]) is not None, "restore identity mismatch")
        check(restore_values["POSTGRES_PASSWORD"] != restore_values["JWT_SECRET"], "restore secrets must differ")
        check((restore_env.stat().st_mode & 0o777) == 0o600, "restore environment mode mismatch")

        second_restore_env = root / "restore-second.env"
        subprocess.run([
            "python3", str(INFRA / "scripts/generate-restore-env.py"), str(second_restore_env),
            "--drill-id", "test-drill",
        ], check=True, stdout=subprocess.DEVNULL)
        second_restore_values = dict(line.split("=", 1) for line in second_restore_env.read_text().splitlines())
        check(second_restore_values["AA_STACK_ID"] != restore_values["AA_STACK_ID"], "restore stack suffix must be random")
        check(second_restore_values["POSTGRES_PASSWORD"] != restore_values["POSTGRES_PASSWORD"], "restore passwords must be random")
        original_restore = restore_env.read_bytes()
        expect_failure(["python3", str(INFRA / "scripts/generate-restore-env.py"), str(restore_env), "--drill-id", "test-drill"])
        check(restore_env.read_bytes() == original_restore, "restore generator overwrote an existing file")
        for invalid_id in ("short", "UPPERCASE", "bad_id", "bad/id", "trailing-", "a" * 32):
            expect_failure(["python3", str(INFRA / "scripts/generate-restore-env.py"), str(root / f"invalid-{len(invalid_id)}.env"), "--drill-id", invalid_id])
        for environment in ("staging", "production"):
            stack_values = dict(line.split("=", 1) for line in envs[environment].read_text().splitlines())
            check(restore_values["AA_STACK_ID"] != stack_values["AA_STACK_ID"], "restore stack must be isolated")
            check(restore_values["POSTGRES_PASSWORD"] != stack_values["POSTGRES_PASSWORD"], "restore database password must be isolated")
            check(restore_values["JWT_SECRET"] != stack_values["JWT_SECRET"], "restore JWT secret must be isolated")
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_env),
            "--disjoint-from", str(envs["staging"]), "--disjoint-from", str(envs["production"]),
        ], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_env),
            "--profile", "single-stack", "--disjoint-from", str(envs["production"]),
        ], check=True, stdout=subprocess.DEVNULL)
        expect_failure([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_env),
            "--profile", "single-stack", "--disjoint-from", str(envs["staging"]),
        ])

        equal_restore = root / "equal-restore.env"
        equal_restore.write_text(restore_env.read_text().replace(
            f"POSTGRES_PASSWORD={restore_values['POSTGRES_PASSWORD']}",
            f"POSTGRES_PASSWORD={restore_values['JWT_SECRET']}",
        ))
        equal_restore.chmod(0o600)
        expect_failure(["python3", str(INFRA / "scripts/validate-restore-env.py"), str(equal_restore)])

        reused_restore = root / "reused-restore.env"
        staging_values = dict(line.split("=", 1) for line in envs["staging"].read_text().splitlines())
        reused_restore.write_text(restore_env.read_text().replace(
            f"POSTGRES_PASSWORD={restore_values['POSTGRES_PASSWORD']}",
            f"POSTGRES_PASSWORD={staging_values['POSTGRES_PASSWORD']}",
        ))
        reused_restore.chmod(0o600)
        expect_failure([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(reused_restore),
            "--disjoint-from", str(envs["staging"]), "--disjoint-from", str(envs["production"]),
        ])

        restore_symlink = root / "restore-symlink.env"
        restore_symlink.symlink_to(restore_env)
        expect_failure(["python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_symlink)])
        restore_permissive = root / "restore-permissive.env"
        restore_permissive.write_bytes(restore_env.read_bytes())
        restore_permissive.chmod(0o640)
        expect_failure(["python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_permissive)])

        restore_example = root / "restore-example.env"
        restore_example.write_text((INFRA / "env/restore.env.example").read_text()
            .replace("<new-restore-only-secret>", "p" * 48)
            .replace("<new-restore-only-secret-at-least-64-characters>", "j" * 72))
        restore_example.chmod(0o600)
        subprocess.run([
            "python3", str(INFRA / "scripts/validate-restore-env.py"), str(restore_example),
        ], check=True, stdout=subprocess.DEVNULL)

        restore_values["AA_UPSTREAM_DIR"] = str(runtime / "upstream")
        restore_config = subprocess.run([
            "docker", "compose", "--project-name", restore_values["AA_STACK_ID"],
            "--env-file", str(restore_env), "-f", str(RESTORE_COMPOSE), "config", "--format", "json",
        ], env={**os.environ, **restore_values}, check=True, capture_output=True, text=True)
        restore_parsed = json.loads(restore_config.stdout)

        values = {}
        for line in envs["staging"].read_text().splitlines():
            key, value = line.split("=", 1)
            values[key] = value
        values["AA_UPSTREAM_DIR"] = str(runtime / "upstream")
        values["AA_FUNCTIONS_DIR"] = str(runtime / "functions")
        values["AA_TEMPLATE_DIR"] = str(runtime / "templates")
        values["AA_KONG_BIND_HOST"] = "127.0.0.1"
        config = subprocess.run([
            "docker", "compose", "--env-file", str(envs["staging"]), "-f", str(COMPOSE), "config", "--format", "json",
        ], env={**os.environ, **values}, check=True, capture_output=True, text=True)
        parsed = json.loads(config.stdout)

        single_values = {}
        for line in envs["production"].read_text().splitlines():
            key, value = line.split("=", 1)
            single_values[key] = value
        single_values["AA_UPSTREAM_DIR"] = str(runtime / "upstream")
        single_values["AA_FUNCTIONS_DIR"] = str(runtime / "functions")
        single_values["AA_TEMPLATE_DIR"] = str(runtime / "templates")
        single_config = subprocess.run([
            "docker", "compose", "--env-file", str(envs["production"]),
            "-f", str(COMPOSE), "-f", str(SINGLE_COMPOSE), "config", "--format", "json",
        ], env={**os.environ, **single_values}, check=True, capture_output=True, text=True)
        single_parsed = json.loads(single_config.stdout)

        single_restore_config = subprocess.run([
            "docker", "compose", "--project-name", restore_values["AA_STACK_ID"],
            "--env-file", str(restore_env), "-f", str(RESTORE_COMPOSE),
            "-f", str(SINGLE_RESTORE_COMPOSE), "config", "--format", "json",
        ], env={**os.environ, **restore_values}, check=True, capture_output=True, text=True)
        single_restore_parsed = json.loads(single_restore_config.stdout)

        nginx_template = INFRA / "templates/nginx/aa-api.conf.template"
        nginx_output = root / "production-nginx.conf"
        subprocess.run([
            "python3", str(INFRA / "scripts/render-nginx.py"), "production",
            str(nginx_template), str(nginx_output), "--profile", "single-stack",
        ], check=True, stdout=subprocess.DEVNULL)
        check("aa-api.cornna.xyz" in nginx_output.read_text(), "single-stack Nginx render missed production host")
        expect_failure([
            "python3", str(INFRA / "scripts/render-nginx.py"), "staging",
            str(nginx_template), str(root / "staging-nginx.conf"), "--profile", "single-stack",
        ])

    locks = parse_lock()
    expected_images = {service: locks[key] for service, key in IMAGE_LOCK_KEYS.items()}
    services = parsed["services"]
    check(set(services) == EXPECTED_SERVICES, f"unexpected Compose services: {set(services)}")
    for name, expected in expected_images.items():
        service = services[name]
        check("build" not in service, f"{name} must not build a mutable local image")
        check(re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", service.get("image", "")) is not None, f"{name} image is not digest-pinned")
        check(service["image"] == expected, f"{name} image digest mismatch")
        check(service.get("restart") == "unless-stopped", f"{name} restart policy mismatch")
        check("logging" in service, f"{name} log rotation missing")
        check("mem_limit" in service and "cpus" in service, f"{name} resource limits missing")
    for name, service in services.items():
        check(service.get("privileged") is not True, f"{name} must not be privileged")
        check(service.get("network_mode") != "host", f"{name} must not use host networking")
        for mount in service.get("volumes", []):
            if isinstance(mount, dict) and mount.get("type") == "bind":
                check(mount.get("read_only") is True, f"{name} host bind must be read-only")
        ports = service.get("ports", [])
        if name == "kong":
            check(len(ports) == 1, "Kong must have one host bind")
            check(ports[0].get("host_ip") == "127.0.0.1" and ports[0].get("target") == 8000, "Kong bind must be loopback:8000")
        else:
            check(not ports, f"{name} must not expose host ports")
        check(set(service.get("networks", {})) == EXPECTED_NETWORKS[name], f"{name} network membership mismatch")
    check(services["realtime"]["networks"]["backend"].get("aliases") == ["realtime-dev.supabase-realtime"], "Realtime network alias mismatch")
    expected_db_init_mounts = {
        target: str(Path(values["AA_UPSTREAM_DIR"]) / relative)
        for relative, target in EXPECTED_DB_INIT_TARGETS.items()
    }
    expected_db_init_mounts["/docker-entrypoint-initdb.d/migrations/98-aa-prerequisites.sql"] = str(
        INFRA / "templates/db/aa-prerequisites.sql"
    )
    check(
        db_init_bind_mounts(services["db"]) == expected_db_init_mounts,
        "database init mount set mismatch",
    )
    db_environment = services["db"]["environment"]
    check(
        "POSTGRES_USER" not in db_environment,
        "database bootstrap must inherit the pinned image's supabase_admin default",
    )
    check(
        db_environment.get("POSTGRES_PASSWORD") == values["POSTGRES_PASSWORD"]
        and db_environment.get("PGPASSWORD") == values["POSTGRES_PASSWORD"],
        "fresh database bootstrap must give supabase_admin the configured database password",
    )
    check(set(parsed.get("volumes", {})) == {"db-config", "db-data"}, "unexpected persistent volumes")
    networks = parsed.get("networks", {})
    check(set(networks) == {"backend", "egress", "gateway"}, "unexpected Compose networks")
    check(networks["backend"].get("internal") is True, "backend network must be internal")
    check(not networks["egress"].get("internal", False), "egress network must permit provider access")
    check(not networks["gateway"].get("internal", False), "gateway network must support the loopback host bind")

    single_services = single_parsed["services"]
    check(set(single_services) == EXPECTED_SERVICES, "single-stack overlay changed the required service set")
    expected_single_memory_mib = {
        "db": 256,
        "templates": 16,
        "auth": 64,
        "rest": 32,
        "realtime": 96,
        "functions": 144,
        "kong": 80,
    }
    check(sum(expected_single_memory_mib.values()) == 688, "single-stack memory budget must total 688 MiB")
    for name, expected_memory_mib in expected_single_memory_mib.items():
        check(
            single_services[name]["mem_limit"] == str(expected_memory_mib * 1024 * 1024),
            f"single-stack {name} memory limit mismatch: {single_services[name]['mem_limit']!r}",
        )
    db_command = single_services["db"]["command"]
    for setting in (
        "shared_buffers=32MB", "effective_cache_size=128MB", "max_connections=30",
        "work_mem=512kB", "maintenance_work_mem=16MB", "autovacuum_work_mem=8MB", "jit=off",
    ):
        check(setting in db_command, f"single-stack PostgreSQL tuning missing: {setting}")
    check(single_services["auth"]["environment"]["GOTRUE_DB_MAX_POOL_SIZE"] == "5", "single-stack Auth pool mismatch")
    check(single_services["rest"]["environment"]["PGRST_DB_POOL"] == "5", "single-stack REST pool mismatch")
    check(single_services["realtime"]["environment"]["DB_POOL_SIZE"] == "5", "single-stack Realtime pool mismatch")
    check(set(single_services["templates"]["tmpfs"]) == {
        "/var/cache/nginx:size=4m", "/var/run:size=1m", "/tmp:size=4m",
    }, "single-stack template tmpfs budget mismatch")
    single_source = SINGLE_COMPOSE.read_text()
    for rationale in (
        "six application services", "Static nginx", "Five database connections",
        "PostgREST is lightweight", "Realtime/BEAM", "Deno", "proxy buffers",
    ):
        check(rationale in single_source, f"single-stack resource rationale missing: {rationale}")

    restore_source = RESTORE_COMPOSE.read_text()
    check("container_name:" not in restore_source, "restore Compose must not pin container names")
    check("ports:" not in restore_source, "restore Compose must not expose host ports")
    check("restart: \"no\"" in restore_source, "restore database must not restart automatically")
    restore_services = restore_parsed["services"]
    check(set(restore_services) == {"db"}, "restore Compose must contain only the database")
    restore_db = restore_services["db"]
    check("build" not in restore_db and restore_db["image"] == expected_images["db"], "restore database image digest mismatch")
    check(re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", restore_db["image"]) is not None, "restore database image is not digest-pinned")
    check(restore_db.get("privileged") is not True and restore_db.get("network_mode") != "host", "restore database isolation is invalid")
    volume_mounts = {
        mount["target"]: mount["source"]
        for mount in restore_db.get("volumes", [])
        if isinstance(mount, dict) and mount.get("type") == "volume"
    }
    check(volume_mounts == {
        "/var/lib/postgresql/data": "restore-db-data",
        "/etc/postgresql-custom": "restore-db-config",
    }, "restore database named-volume mounts mismatch")
    for mount in restore_db.get("volumes", []):
        if isinstance(mount, dict) and mount.get("type") == "bind":
            check(mount.get("read_only") is True, "restore database host bind must be read-only")
    expected_restore_init_mounts = {
        target: str(Path(restore_values["AA_UPSTREAM_DIR"]) / relative)
        for relative, target in EXPECTED_DB_INIT_TARGETS.items()
    }
    expected_restore_init_mounts["/docker-entrypoint-initdb.d/migrations/98-aa-prerequisites.sql"] = str(
        INFRA / "templates/db/aa-prerequisites.sql"
    )
    check(
        db_init_bind_mounts(restore_db) == expected_restore_init_mounts,
        "restore database init mount set mismatch",
    )
    restore_db_environment = restore_db["environment"]
    check(
        "POSTGRES_USER" not in restore_db_environment,
        "restore bootstrap must inherit the pinned image's supabase_admin default",
    )
    check(
        restore_db_environment.get("POSTGRES_PASSWORD") == restore_values["POSTGRES_PASSWORD"]
        and restore_db_environment.get("PGPASSWORD") == restore_values["POSTGRES_PASSWORD"],
        "fresh restore bootstrap must give supabase_admin the configured database password",
    )
    check(restore_db_environment["PGDATABASE"] == "postgres" and restore_db_environment["POSTGRES_DB"] == "postgres", "restore bootstrap database mismatch")
    check(restore_db["healthcheck"]["test"] == ["CMD", "pg_isready", "-U", "postgres", "-d", "postgres", "-h", "localhost"], "restore healthcheck must target bootstrap postgres")
    check(not restore_db.get("ports"), "restore database must not expose host ports")
    check(set(restore_db.get("networks", {})) == {"restore-internal"}, "restore database network mismatch")
    check(set(restore_parsed.get("volumes", {})) == {"restore-db-config", "restore-db-data"}, "restore volumes mismatch")
    for name, volume in restore_parsed["volumes"].items():
        check(volume.get("name") == f"{restore_values['AA_STACK_ID']}_{name}", f"restore volume {name} is not project-scoped")
        check(volume.get("external") is not True, f"restore volume {name} must not be external")
    check(restore_parsed["networks"]["restore-internal"].get("internal") is True, "restore network must be internal")
    check(restore_parsed["networks"]["restore-internal"].get("name") == f"{restore_values['AA_STACK_ID']}_restore-internal", "restore network is not project-scoped")
    check(set(single_restore_parsed["services"]) == {"db"}, "single-stack restore overlay must remain database-only")
    single_restore_db = single_restore_parsed["services"]["db"]
    check(single_restore_db["mem_limit"] == str(256 * 1024 * 1024), "single-stack restore database memory limit mismatch")
    check(single_restore_db["shm_size"] == str(64 * 1024 * 1024), "single-stack restore shared memory mismatch")
    for setting in ("shared_buffers=32MB", "max_connections=30", "work_mem=512kB"):
        check(setting in single_restore_db["command"], f"single-stack restore PostgreSQL tuning missing: {setting}")
    check(not single_restore_db.get("ports"), "single-stack restore database must not expose host ports")
    check(set(single_restore_db.get("networks", {})) == {"restore-internal"}, "single-stack restore network isolation changed")

    restore_script = (INFRA / "scripts/restore-drill.sh").read_text()
    for required in (
        'PROFILE=dual-stack', 'DESTINATION=azure-blob', '--destination local|azure-blob',
        '--destination "$DESTINATION"', 'restore_validation+=(--disjoint-from "$deployment_env")',
        'capacity-check.sh" --profile "$PROFILE" /srv/aa',
        'compose.restore.single-stack.yml', "Production must be stopped before a single-stack restore drill",
        "Single-stack restore drills only accept production backups",
        "--project-name \"$AA_STACK_ID\"", "createdb -U postgres -T template0 -O postgres aa_restore",
        "pg_restore -U postgres -d aa_restore --single-transaction --exit-on-error",
        "psql -U postgres -d aa_restore", "decrypted backup is not a PostgreSQL custom archive",
        "restored migration ledger contains an unknown filename",
        "restored migration ledger contains a changed hash",
        "restored migration ledger is not a continuous source prefix",
        "select pg_advisory_lock(584379251642045998)", "as apply_migration \\\\gset",
        "insert into aa_deploy.schema_migrations(filename, sha256)",
        "migrated restore ledger does not match repository sources",
        "public.create_canary_circle(uuid,text)",
        "public.cleanup_canary_circle(uuid,text)",
        "public.update_circle(uuid,text,text,character)",
        "down --volumes", "checksum proved ciphertext integrity, not backup provenance",
        "this drill uses a local-only backup that is not protected against loss of this host disk",
    ):
        check(required in restore_script, f"restore drill contract missing: {required}")
    for forbidden in ("pg_restore -U postgres -d postgres", "--clean", "--if-exists", "--no-owner", "--no-acl", "mktemp"):
        check(forbidden not in restore_script, f"restore drill contains forbidden behavior: {forbidden}")
    check('"${compose[@]}" down' not in restore_script, "restore drill must not automatically destroy evidence")

    nginx_renderer = (INFRA / "scripts/render-nginx.py").read_text()
    check(
        '"staging": {"host": "aa-staging-api.cornna.xyz", "kong": "18100", "tls": "18543"}' in nginx_renderer,
        "staging Nginx target identity mismatch",
    )
    check(
        '"production": {"host": "aa-api.cornna.xyz", "kong": "18101", "tls": "18544"}' in nginx_renderer,
        "production Nginx target identity mismatch",
    )
    stream_map = (INFRA / "templates/nginx/site-stream-map.conf.example").read_text()
    check("aa-api.cornna.xyz 127.0.0.1:18544;" in stream_map, "production SNI route mismatch")
    check("aa-staging-api.cornna.xyz 127.0.0.1:18543;" in stream_map, "staging SNI route mismatch")
    check("18443" not in stream_map and "18444" not in stream_map, "AA SNI map reuses existing legacy ports")

    kong = (INFRA / "templates/kong/kong.yml").read_text()
    for forbidden in ("storage-v1", "dashboard", "meta-all", "graphql-v1", "analytics-v1", "mcp"):
        check(forbidden not in kong, f"forbidden Kong route present: {forbidden}")
    for required in ("/auth/v1/", "/rest/v1/", "/realtime/v1/", "/functions/v1/"):
        check(required in kong, f"required Kong route missing: {required}")
    check("read_timeout: 55000" in kong and "write_timeout: 55000" in kong, "function gateway timeout mismatch")

    capacity = (INFRA / "scripts/capacity-check.sh").read_text()
    for unchanged in (
        "APPROVED_MIN_CPUS=4", "APPROVED_MIN_MEMORY_KIB=8388608",
        "APPROVED_MIN_DISK_KIB=41943040", "APPROVED_MIN_DEBIAN_VERSION=12",
    ):
        check(unchanged in capacity, f"dual-stack threshold changed: {unchanged}")
    for single_floor in (
        "SINGLE_STACK_MIN_CPUS=2", "SINGLE_STACK_MIN_MEMORY_KIB=917504",
        "SINGLE_STACK_MIN_DISK_KIB=20971520",
        # The OS floor is a security gate, not a capacity trade-off: both
        # profiles must require the same supported Debian release.
        'SINGLE_STACK_MIN_DEBIAN_VERSION="$APPROVED_MIN_DEBIAN_VERSION"',
    ):
        check(single_floor in capacity, f"single-stack floor missing: {single_floor}")
    for rationale in (
        "observed/planning footprint for one seven-service stack", "about 650-700",
        "db 256 + templates 16 + auth 64 + rest 32", "functions 144 + kong 80 = 688 MiB",
        "130 MiB for the existing", "78 MiB for Debian kernel/daemons",
        "swap is", "20 GiB holds one pinned image set",
    ):
        check(rationale in capacity, f"single-stack capacity rationale missing: {rationale}")
    check("PROFILE=dual-stack" in capacity, "dual-stack must remain the default capacity profile")
    check("dual-stack)" in capacity and "single-stack)" in capacity, "capacity profiles must be explicit and closed")
    check("MIN_CPUS >= PROFILE_MIN_CPUS" in capacity and "MIN_MEMORY_KIB >= PROFILE_MIN_MEMORY_KIB" in capacity and "MIN_DISK_KIB >= PROFILE_MIN_DISK_KIB" in capacity, "selected profile thresholds must not be lowerable")
    check("SKIP" not in capacity.upper() and "BYPASS" not in capacity.upper(), "capacity gate must not expose a skip or bypass path")
    check("APPROVED_MIN_DEBIAN_VERSION=12" in capacity, "capacity gate must reject the Debian 11 host")
    check('[[ "${ID:-}" == "debian"' in capacity, "capacity gate must require an approved Debian host")
    check("VERSION_ID >= PROFILE_MIN_DEBIAN_VERSION" in capacity, "Debian version gate must apply in every profile")
    check('for target_path in "${TARGET_PATHS[@]}"' in capacity, "capacity gate must check every supplied filesystem path")
    compose_wrapper = (INFRA / "scripts/compose.sh").read_text()
    check("PROFILE=dual-stack" in compose_wrapper, "Compose wrapper must default to dual-stack")
    check('validate-env.py" "$ENV_FILE" --profile "$PROFILE"' in compose_wrapper, "Compose wrapper must bind env validation to the selected profile")
    check('compose.single-stack.yml' in compose_wrapper, "Compose wrapper must select the single-stack overlay")
    check("docker info --format '{{.DockerRootDir}}'" in compose_wrapper, "Compose wrapper must resolve Docker data root")
    check(compose_wrapper.count('capacity-check.sh" --profile "$PROFILE"') == 2, "Compose wrapper must gate before Docker and recheck both filesystems")
    check('capacity-check.sh" --profile "$PROFILE" /srv/aa "$docker_root"' in compose_wrapper, "Compose wrapper must enforce both application and Docker disk capacity")
    for required in (
        'verify-upstream.py" "$AA_UPSTREAM_DIR"',
        'verify-artifact.py" "$AA_FUNCTIONS_DIR"',
        '--template "$AA_TEMPLATE_DIR/confirmation.html"',
        '--expected-fingerprint "$AA_SOURCE_FINGERPRINT"',
        '--expected-upstream-commit "$SUPABASE_COMMIT"',
        'down|rm|--volumes|-v)',
    ):
        check(required in compose_wrapper, f"Compose activation contract missing: {required}")
    artifact_index = compose_wrapper.index("verify-artifact.py")
    destructive_index = compose_wrapper.index('down|rm|--volumes|-v)')
    first_capacity_index = compose_wrapper.index('capacity-check.sh" --profile "$PROFILE"')
    docker_info_index = compose_wrapper.index("docker info")
    second_capacity_index = compose_wrapper.rindex('capacity-check.sh" --profile "$PROFILE"')
    exec_index = compose_wrapper.index("exec docker compose")
    check(
        artifact_index < destructive_index < first_capacity_index < docker_info_index < second_capacity_index < exec_index,
        "Compose must verify artifacts, reject destructive arguments, and pass capacity gates before Compose",
    )
    check(
        destructive_index < compose_wrapper.index('if [[ "$PROFILE" == "single-stack" ]]'),
        "destructive-command rejection must apply before either deployment mode diverges",
    )

    runbook = (ROOT / "docs/HOSTED_DEPLOYMENT.md").read_text()
    for required in (
        "deliberate deviation", "--profile single-stack", "917,504 KiB", "20,971,520 KiB",
        "没有 staging validation", "所有变更直接进入 production", "PostgreSQL 在压力下可能触及 swap",
        "host OOM 或单容器 OOM 风险", "Xray、beszel、beszel-agent 和 uptime-kuma",
        "isolation proof **没有执行**", "drill 前 production 必须停止",
        "Single-stack recovery expectations", "RPO 24h、RTO 4h",
        "--destination local", "`azure-blob` 是默认值",
        "磁盘丢失会同时丢失数据库和备份", "off-host copy",
        "不能称为真正的 disaster-recovery plan",
    ):
        check(required in runbook, f"single-stack runbook disclosure missing: {required}")

    prepare_upstream = (INFRA / "scripts/prepare-upstream.sh").read_text()
    build_functions = (INFRA / "scripts/build-functions.sh").read_text()
    upstream_verifier = (INFRA / "scripts/verify-upstream.py").read_text()
    prepare_expected_match = re.search(
        r"expected = (\{.*?\})\nactual = set\(\)", prepare_upstream, flags=re.DOTALL
    )
    check(prepare_expected_match is not None, "upstream preparation allowlist is missing")
    check(
        ast.literal_eval(prepare_expected_match.group(1)) == EXPECTED_RETAINED_UPSTREAM_FILES,
        "upstream preparation retained-file set mismatch",
    )
    check(
        assigned_literal(upstream_verifier, "EXPECTED_FILES") == EXPECTED_RETAINED_UPSTREAM_FILES,
        "upstream verification retained-file set mismatch",
    )
    check(
        'install -m 0444 "$SOURCE/docker/volumes/db/_supabase.sql" "$WORK_DIR/output/db/_supabase.sql"'
        in prepare_upstream,
        "_supabase.sql must be extracted from the verified archive",
    )
    check(
        'install -m 0444 "$SOURCE/docker/volumes/db/webhooks.sql" "$WORK_DIR/output/db/webhooks.sql"'
        in prepare_upstream,
        "webhooks.sql must be extracted from the verified archive",
    )
    check(
        EXPECTED_DB_INIT_TARGETS["db/webhooks.sql"] < EXPECTED_DB_INIT_TARGETS["db/roles.sql"],
        "webhooks init target must sort before roles",
    )
    for compose_source in (source, restore_source):
        check(
            "webhooks.sql creates supabase_functions_admin before roles.sql alters it" in compose_source
            and "logs.sql and pooler.sql remain excluded" in compose_source,
            "database init inclusion and exclusion rationale is missing",
        )
    for required in (
        '"path": relative', '"type": "file"', '"mode": mode', '"sha256": hashlib.sha256',
        'retained upstream contains a symlink', 'retained upstream file inventory mismatch',
        'find "$DESTINATION" -type d -exec chmod a-w {} +',
    ):
        check(required in prepare_upstream, f"upstream preparation manifest contract missing: {required}")
    check('verify-upstream.py" "$DESTINATION"' in prepare_upstream, "prepared upstream reuse must verify the full manifest")
    # Directories must be sealed before verification, and verification must be the
    # last step so the published tree is what was actually checked.
    seal_index = prepare_upstream.index('find "$DESTINATION" -type d -exec chmod a-w {} +')
    move_index = prepare_upstream.index('mv "$WORK_DIR/output" "$DESTINATION"')
    final_verify_index = prepare_upstream.rindex('verify-upstream.py" "$DESTINATION"')
    check(move_index < seal_index < final_verify_index, "upstream must be moved, sealed, then verified in place")
    check('verify-upstream.py" "$UPSTREAM_DIR"' in build_functions, "function bundling must verify the full upstream manifest")
    for required in (
        'ENTRY_KEYS = {"path", "type", "mode", "sha256"}',
        "upstream contains unexpected files or directories",
        "upstream contains a symlink",
        "upstream file metadata mismatch",
        'entry.get("mode") != EXPECTED_FILES.get(relative)',
    ):
        check(required in upstream_verifier, f"upstream verifier contract missing: {required}")

    pair_validator = (INFRA / "scripts/validate-pair.py").read_text()
    check(
        'staging.get("AA_SOURCE_FINGERPRINT") != production.get("AA_SOURCE_FINGERPRINT")' in pair_validator,
        "staging and production fingerprints must be equal",
    )
    check('"SMTP_ADMIN_EMAIL"' in pair_validator, "staging and production SMTP senders must differ")
    check('"BACKUP_AGE_RECIPIENT"' in pair_validator, "staging and production backup recipients must differ")
    for single_path in (
        INFRA / "scripts/compose.sh",
        INFRA / "scripts/generate-env.py",
        INFRA / "scripts/validate-env.py",
        INFRA / "scripts/run-migrations.py",
        INFRA / "scripts/render-nginx.py",
        INFRA / "scripts/restore-drill.sh",
    ):
        check("validate-pair.py" not in single_path.read_text(), f"single-stack path unexpectedly requires pair validation: {single_path.name}")

    hosted = (ROOT / "scripts/hosted-deployment.mjs").read_text()
    for required in (
        'const DEPLOYMENT_MODES = new Set(["dual-stack", "single-stack"])',
        'parsed.schemaVersion === 2', 'parsed.schemaVersion === 3', 'deploymentMode === "single-stack"',
        'single-stack hosted targets must not define staging',
        'target is unavailable in ${targets.deploymentMode} mode',
        'command === "deployment-mode"',
    ):
        check(required in hosted, f"hosted target mode contract missing: {required}")
    hosted_example = json.loads((ROOT / "supabase/hosted-targets.example.json").read_text())
    check(hosted_example.get("schemaVersion") == 3, "hosted target example schema mismatch")
    check(hosted_example.get("deploymentMode") == "single-stack", "hosted target example must opt into single-stack")
    check("staging" not in hosted_example and "production" in hosted_example, "single-stack hosted example must be production-only")

    backup_script = (INFRA / "scripts/backup.sh").read_text()
    for required in (
        "DESTINATION=azure-blob", "--destination local|azure-blob", "validate-env.py",
        '--destination "$DESTINATION"', "--project-name \"$AA_STACK_ID\"", "pg_restore --list",
        "pg_dump -U postgres -d postgres --format=custom",
        "tee \"$toc_fifo\"", "age --recipient", "--from-to BlobLocal", "Azure Blob read-back hash mismatch", "-maxdepth 1",
        'lock_file="$BACKUP_DIR/.${AA_STACK_ID}.backup.lock"', "flock 9",
        'ln -- "$partial" "$encrypted"', 'ln -- "$checksum_partial" "$checksum"',
        'if [[ "$DESTINATION" == "azure-blob" ]]; then\n  required_commands+=(azcopy)',
        "this backup is local-only and is not protected against loss of this host disk",
    ):
        check(required in backup_script, f"backup verification contract missing: {required}")
    azure_upload_index = backup_script.index('if [[ "$DESTINATION" == "azure-blob" ]]; then\n  readback=')
    for unconditional in (
        'lock_file="$BACKUP_DIR/.${AA_STACK_ID}.backup.lock"', "flock 9", 'stamp="$(date -u',
        "pg_restore --list", "pg_dump -U postgres -d postgres --format=custom", 'tee "$toc_fifo"',
        'age --recipient "$BACKUP_AGE_RECIPIENT" --output "$partial"', 'wait "$toc_pid"',
        'test -s "$partial"', 'sha256sum -- "$partial"', 'printf \'%s  %s\\n\'',
        'ln -- "$partial" "$encrypted"', 'ln -- "$checksum_partial" "$checksum"',
    ):
        check(backup_script.index(unconditional) < azure_upload_index, f"local backup can bypass invariant: {unconditional}")
    check(
        '\nfi\n\nwhile IFS= read -r -d \'\' expired; do' in backup_script[azure_upload_index:],
        "local backup retention cleanup is not outside the Azure-only branch",
    )
    for forbidden in (
        "--no-owner", "--no-acl", "plain=", "pg_dump -U postgres -d postgres --format=custom >",
        "--skip-encryption", "--skip-checksum", "--skip-structural-check", "--skip-lock", "--skip-retention",
    ):
        check(forbidden not in backup_script, f"backup contains forbidden behavior: {forbidden}")
    validator_source = (INFRA / "scripts/validate-env.py").read_text()
    generator_source = (INFRA / "scripts/generate-env.py").read_text()
    for source, label in ((validator_source, "validator"), (generator_source, "generator")):
        check('BACKUP_DESTINATIONS = ("local", "azure-blob")' in source, f"backup destination choices missing from {label}")
        check('"BACKUP_DESTINATION"' in source, f"persisted backup destination missing from {label}")
    check('args.destination or configured_destination or "azure-blob"' in validator_source, "environment validation does not default to azure-blob")
    check('AZURE_REQUIRED if destination == "azure-blob" else set()' in validator_source, "Azure environment requirements are not destination-bound")
    check('parser.add_argument("--destination", choices=BACKUP_DESTINATIONS, default="azure-blob")' in generator_source, "environment generation does not default to azure-blob")
    check('args.destination == "azure-blob"' in generator_source, "Azure generation requirements were weakened")

    migration_runner = (INFRA / "scripts/run-migrations.py").read_text()
    check("Applied migration ledger contains a file absent from the source directory" in migration_runner, "migration runner must reject unknown ledger entries")
    check("Applied migration ledger is not a continuous source prefix" in migration_runner, "migration runner must reject non-prefix ledger state")
    for required in (
        'parser.add_argument("--profile", choices=("dual-stack", "single-stack"), default="dual-stack")',
        'parser.add_argument("--expected-environment", required=True',
        'validate-env.py"), str(args.env_file)',
        '"--profile", args.profile',
        'APPROVED_COMPOSE = INFRA / "compose.base.yml"',
        'SINGLE_STACK_COMPOSE = INFRA / "compose.single-stack.yml"',
        'APPROVED_MIGRATIONS = ROOT / "supabase/migrations"',
        "is not the repository-approved path",
        'hosted-deployment.mjs"), "fingerprint"',
        "current hosted-deployment fingerprint does not match AA_SOURCE_FINGERPRINT",
        '"--project-name", environment["AA_STACK_ID"]',
        'compose.extend(["-f", str(SINGLE_STACK_COMPOSE)])',
    ):
        check(required in migration_runner, f"migration target-binding contract missing: {required}")
    print("Self-host infrastructure invariants passed.")


if __name__ == "__main__":
    main()
