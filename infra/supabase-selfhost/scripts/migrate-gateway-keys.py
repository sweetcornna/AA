#!/usr/bin/env python3
import argparse
import os
import re
import secrets
import stat
from pathlib import Path

PUBLISHABLE_KEY = re.compile(r"sb_publishable_[A-Za-z0-9_-]{16,}")
FINGERPRINT = re.compile(r"[0-9a-f]{64}")


def read_existing(path: Path) -> list[str]:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit("existing environment must be a non-symlink regular file")
    if info.st_mode & 0o077:
        raise SystemExit("existing environment must have mode 0600 or stricter")

    lines = path.read_text().splitlines()
    keys: set[str] = set()
    for number, line in enumerate(lines, 1):
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"line {number} is not KEY=VALUE")
        key, _ = line.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in keys:
            raise SystemExit(f"line {number} has an invalid or duplicate key")
        keys.add(key)
    for required in (
        "AA_RUNTIME_ROOT", "AA_SOURCE_FINGERPRINT", "AA_FUNCTIONS_DIR", "AA_TEMPLATE_DIR",
        "ANON_KEY", "SERVICE_ROLE_KEY",
    ):
        if required not in keys:
            raise SystemExit(f"existing environment is missing {required}")
    if "SUPABASE_PUBLISHABLE_KEY" in keys or "SUPABASE_SECRET_KEY" in keys:
        raise SystemExit("existing environment already contains opaque gateway keys")
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("existing", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--fingerprint", required=True)
    parser.add_argument("--publishable-key", required=True)
    args = parser.parse_args()

    if not FINGERPRINT.fullmatch(args.fingerprint):
        raise SystemExit("fingerprint must be a lowercase SHA-256")
    if not PUBLISHABLE_KEY.fullmatch(args.publishable_key):
        raise SystemExit("publishable key must be a non-placeholder sb_publishable_ key")
    if args.output.exists():
        raise SystemExit("refusing to overwrite the output environment file")

    lines = read_existing(args.existing)
    values = dict(line.split("=", 1) for line in lines if line and not line.startswith("#"))
    runtime_root = values["AA_RUNTIME_ROOT"].rstrip("/")
    replacements = {
        "AA_SOURCE_FINGERPRINT": args.fingerprint,
        "AA_FUNCTIONS_DIR": f"{runtime_root}/functions/{args.fingerprint}",
        "AA_TEMPLATE_DIR": f"{runtime_root}/templates/{args.fingerprint}",
    }
    secret_key = f"sb_secret_{secrets.token_urlsafe(48)}"
    migrated: list[str] = []
    inserted = False
    for line in lines:
        key = line.split("=", 1)[0] if "=" in line else ""
        migrated.append(f"{key}={replacements[key]}" if key in replacements else line)
        if line.startswith("SERVICE_ROLE_KEY="):
            migrated.extend([
                f"SUPABASE_PUBLISHABLE_KEY={args.publishable_key}",
                f"SUPABASE_SECRET_KEY={secret_key}",
            ])
            inserted = True
    if not inserted:
        raise SystemExit("existing environment is missing SERVICE_ROLE_KEY")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write("\n".join(migrated) + "\n")
    print("Wrote a root-only migrated environment; existing credentials were preserved.")


if __name__ == "__main__":
    main()
