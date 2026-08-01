#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import stat
from pathlib import Path
from urllib.parse import urlparse

TARGETS = {
    "staging": ("aa-staging-primary", "https://staging-api.cornna.xyz", "18100", "/srv/aa/staging"),
    "production": ("aa-production-primary", "https://api.cornna.xyz", "18101", "/srv/aa/production"),
}
REQUIRED = {
    "AA_ENVIRONMENT", "AA_STACK_ID", "AA_SOURCE_FINGERPRINT", "AA_RUNTIME_ROOT", "AA_UPSTREAM_DIR",
    "AA_FUNCTIONS_DIR", "AA_TEMPLATE_DIR", "AA_KONG_BIND_HOST", "AA_KONG_HTTP_PORT",
    "SUPABASE_PUBLIC_URL", "API_EXTERNAL_URL", "SITE_URL", "POSTGRES_PASSWORD", "JWT_SECRET",
    "ANON_KEY", "SERVICE_ROLE_KEY", "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY", "SMTP_HOST",
    "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL", "SMTP_SENDER_NAME", "OPENAI_API_KEY",
    "BACKUP_DIR", "BACKUP_AGE_RECIPIENT", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER",
}
PLACEHOLDER = re.compile(r"placeholder|change.?me|<[^>]+>|your[-_]|example\.com", re.I)
SAFE_SECRET = re.compile(r"^[A-Za-z0-9._-]+$")


def parse(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        if not raw or raw.startswith("#"):
            continue
        if "=" not in raw:
            raise ValueError(f"line {number} is not KEY=VALUE")
        key, value = raw.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise ValueError(f"line {number} has an invalid or duplicate key")
        if "\x00" in value or "\n" in value or "\r" in value:
            raise ValueError(f"line {number} has an invalid value")
        values[key] = value
    return values


def decode_part(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def validate_jwt(token: str, secret: str, role: str) -> None:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError(f"{role} key is not a JWT")
    header = json.loads(decode_part(parts[0]))
    payload = json.loads(decode_part(parts[1]))
    if header != {"alg": "HS256", "typ": "JWT"} or payload.get("role") != role:
        raise ValueError(f"{role} JWT claims are invalid")
    expected = hmac.new(secret.encode(), f"{parts[0]}.{parts[1]}".encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, decode_part(parts[2])):
        raise ValueError(f"{role} JWT signature is invalid")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("env_file", type=Path)
    parser.add_argument("--profile", choices=("dual-stack", "single-stack"), default="dual-stack")
    parser.add_argument("--require-root-owner", action="store_true")
    args = parser.parse_args()

    info = args.env_file.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit("environment must be a non-symlink regular file")
    if info.st_mode & 0o077:
        raise SystemExit("environment file must have mode 0600 or stricter")
    if args.require_root_owner and info.st_uid != 0:
        raise SystemExit("deployed environment file must be owned by root")
    values = parse(args.env_file)
    missing = sorted(REQUIRED - values.keys())
    unknown = sorted(values.keys() - REQUIRED)
    if missing or unknown:
        raise SystemExit(f"environment keys mismatch: missing={missing}, unknown={unknown}")
    if any(not value or PLACEHOLDER.search(value) for value in values.values()):
        raise SystemExit("environment contains an empty value or placeholder")

    environment = values["AA_ENVIRONMENT"]
    if environment not in TARGETS:
        raise SystemExit("AA_ENVIRONMENT must be staging or production")
    if args.profile == "single-stack" and environment != "production":
        raise SystemExit("single-stack profile only permits a production environment")
    stack, origin, port, root = TARGETS[environment]
    expected = {
        "AA_STACK_ID": stack,
        "AA_RUNTIME_ROOT": f"{root}/runtime",
        "AA_UPSTREAM_DIR": f"{root}/runtime/upstream/0e5c073b464b76a1046ff3e9a8467ebbb41a376d",
        "AA_FUNCTIONS_DIR": f"{root}/runtime/functions/{values['AA_SOURCE_FINGERPRINT']}",
        "AA_TEMPLATE_DIR": f"{root}/runtime/templates/{values['AA_SOURCE_FINGERPRINT']}",
        "AA_KONG_BIND_HOST": "127.0.0.1",
        "AA_KONG_HTTP_PORT": port,
        "SUPABASE_PUBLIC_URL": origin,
        "API_EXTERNAL_URL": f"{origin}/auth/v1",
        "SITE_URL": origin,
        "SMTP_HOST": "smtp.resend.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "resend",
        "BACKUP_DIR": f"/srv/aa/backups/{environment}",
    }
    for key, expected_value in expected.items():
        if values[key] != expected_value:
            raise SystemExit(f"{key} does not match the approved {environment} contract")
    if not re.fullmatch(r"[0-9a-f]{64}", values["AA_SOURCE_FINGERPRINT"]):
        raise SystemExit("AA_SOURCE_FINGERPRINT is invalid")
    if len(values["POSTGRES_PASSWORD"]) < 40 or len(values["JWT_SECRET"]) < 64:
        raise SystemExit("database or JWT secret is too short")
    if len(values["SECRET_KEY_BASE"]) < 64 or len(values["REALTIME_DB_ENC_KEY"]) != 16:
        raise SystemExit("Realtime encryption material has an invalid length")
    for key in ("POSTGRES_PASSWORD", "JWT_SECRET", "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY", "SMTP_PASS", "OPENAI_API_KEY"):
        if not SAFE_SECRET.fullmatch(values[key]):
            raise SystemExit(f"{key} contains characters unsafe for the Compose env contract")
    if len(values["SMTP_PASS"]) < 20 or len(values["OPENAI_API_KEY"]) < 20:
        raise SystemExit("provider secret is too short")
    validate_jwt(values["ANON_KEY"], values["JWT_SECRET"], "anon")
    validate_jwt(values["SERVICE_ROLE_KEY"], values["JWT_SECRET"], "service_role")
    if not re.fullmatch(r"age1[0-9a-z]{40,}", values["BACKUP_AGE_RECIPIENT"]):
        raise SystemExit("BACKUP_AGE_RECIPIENT is invalid")
    if not re.fullmatch(r"[a-z0-9]{3,24}", values["AZURE_STORAGE_ACCOUNT"]):
        raise SystemExit("AZURE_STORAGE_ACCOUNT is invalid")
    if not re.fullmatch(r"[a-z0-9-]{3,63}", values["AZURE_STORAGE_CONTAINER"]):
        raise SystemExit("AZURE_STORAGE_CONTAINER is invalid")
    for key in ("SUPABASE_PUBLIC_URL", "API_EXTERNAL_URL", "SITE_URL"):
        parsed = urlparse(values[key])
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port:
            raise SystemExit(f"{key} is not a canonical HTTPS URL")
    print(f"Validated secret-safe {environment} environment contract for {args.profile}.")


if __name__ == "__main__":
    main()
