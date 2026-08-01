#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import time
from pathlib import Path

TARGETS = {
    "staging": {
        "stack": "aa-staging-primary",
        "origin": "https://staging-api.cornna.xyz",
        "port": "18100",
        "root": "/srv/aa/staging",
    },
    "production": {
        "stack": "aa-production-primary",
        "origin": "https://api.cornna.xyz",
        "port": "18101",
        "root": "/srv/aa/production",
    },
}
BACKUP_DESTINATIONS = ("local", "azure-blob")
SAFE_SECRET = re.compile(r"^[A-Za-z0-9._-]+$")


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def jwt(secret: str, role: str) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({"iss": "supabase", "role": role, "iat": now, "exp": now + 315576000}, separators=(",", ":")).encode())
    signature = b64url(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def read_provider_secrets(path: Path) -> dict[str, str]:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit("provider secret file must be a non-symlink regular file")
    mode = info.st_mode & 0o777
    if mode & 0o077:
        raise SystemExit("provider secret file must not be group/world accessible")
    values = json.loads(path.read_text())
    if set(values) != {"SMTP_PASS", "OPENAI_API_KEY"}:
        raise SystemExit("provider secret file must contain only SMTP_PASS and OPENAI_API_KEY")
    for value in values.values():
        if not isinstance(value, str) or len(value) < 20 or not SAFE_SECRET.fullmatch(value):
            raise SystemExit("provider secrets must be at least 20 safe characters")
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=TARGETS)
    parser.add_argument("output", type=Path)
    parser.add_argument("--profile", choices=("dual-stack", "single-stack"), default="dual-stack")
    parser.add_argument("--fingerprint", required=True)
    parser.add_argument("--smtp-admin-email", required=True)
    parser.add_argument("--provider-secrets", required=True, type=Path)
    parser.add_argument("--backup-recipient", required=True)
    parser.add_argument("--destination", choices=BACKUP_DESTINATIONS, default="azure-blob")
    parser.add_argument("--azure-storage-account")
    parser.add_argument("--azure-storage-container")
    args = parser.parse_args()

    if args.profile == "single-stack" and args.environment != "production":
        raise SystemExit("single-stack profile only permits a production environment")
    if not re.fullmatch(r"[0-9a-f]{64}", args.fingerprint):
        raise SystemExit("fingerprint must be a lowercase SHA-256")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", args.smtp_admin_email):
        raise SystemExit("SMTP admin email is invalid")
    if not re.fullmatch(r"age1[0-9a-z]{40,}", args.backup_recipient):
        raise SystemExit("backup recipient must be an age public recipient")
    if args.destination == "azure-blob" and (args.azure_storage_account is None or args.azure_storage_container is None):
        raise SystemExit("Azure storage account and container are required for azure-blob destination")
    if (args.azure_storage_account is None) != (args.azure_storage_container is None):
        raise SystemExit("Azure storage account and container must be provided together")
    if args.azure_storage_account is not None and not re.fullmatch(r"[a-z0-9]{3,24}", args.azure_storage_account):
        raise SystemExit("Azure storage account name is invalid")
    if args.azure_storage_container is not None and not re.fullmatch(r"[a-z0-9-]{3,63}", args.azure_storage_container):
        raise SystemExit("Azure storage container name is invalid")
    if args.output.exists():
        raise SystemExit("refusing to overwrite an existing environment file")

    target = TARGETS[args.environment]
    provider = read_provider_secrets(args.provider_secrets)
    jwt_secret = secrets.token_urlsafe(64)
    runtime = f"{target['root']}/runtime"
    values = {
        "AA_ENVIRONMENT": args.environment,
        "AA_STACK_ID": target["stack"],
        "AA_SOURCE_FINGERPRINT": args.fingerprint,
        "AA_RUNTIME_ROOT": runtime,
        "AA_UPSTREAM_DIR": f"{runtime}/upstream/0e5c073b464b76a1046ff3e9a8467ebbb41a376d",
        "AA_FUNCTIONS_DIR": f"{runtime}/functions/{args.fingerprint}",
        "AA_TEMPLATE_DIR": f"{runtime}/templates/{args.fingerprint}",
        "AA_KONG_BIND_HOST": "127.0.0.1",
        "AA_KONG_HTTP_PORT": target["port"],
        "SUPABASE_PUBLIC_URL": target["origin"],
        "API_EXTERNAL_URL": f"{target['origin']}/auth/v1",
        "SITE_URL": target["origin"],
        "POSTGRES_PASSWORD": secrets.token_urlsafe(48),
        "JWT_SECRET": jwt_secret,
        "ANON_KEY": jwt(jwt_secret, "anon"),
        "SERVICE_ROLE_KEY": jwt(jwt_secret, "service_role"),
        "SECRET_KEY_BASE": secrets.token_urlsafe(72),
        "REALTIME_DB_ENC_KEY": secrets.token_hex(8),
        "SMTP_HOST": "smtp.resend.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "resend",
        "SMTP_PASS": provider["SMTP_PASS"],
        "SMTP_ADMIN_EMAIL": args.smtp_admin_email,
        "SMTP_SENDER_NAME": "AA",
        "OPENAI_API_KEY": provider["OPENAI_API_KEY"],
        "BACKUP_DIR": f"/srv/aa/backups/{args.environment}",
        "BACKUP_AGE_RECIPIENT": args.backup_recipient,
        "BACKUP_DESTINATION": args.destination,
    }
    if args.azure_storage_account is not None and args.azure_storage_container is not None:
        values["AZURE_STORAGE_ACCOUNT"] = args.azure_storage_account
        values["AZURE_STORAGE_CONTAINER"] = args.azure_storage_container
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        for key, value in values.items():
            stream.write(f"{key}={value}\n")
    print(f"Wrote root-only {args.environment} environment configuration for {args.profile}.")


if __name__ == "__main__":
    main()
