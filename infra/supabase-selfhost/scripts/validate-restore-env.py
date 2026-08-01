#!/usr/bin/env python3
import argparse
import re
import stat
from pathlib import Path

REQUIRED = {"AA_ENVIRONMENT", "AA_STACK_ID", "AA_UPSTREAM_DIR", "POSTGRES_PASSWORD", "JWT_SECRET"}
STACK_ID = re.compile(r"aa-restore-[a-z0-9](?:[a-z0-9-]{4,29}[a-z0-9])-[0-9a-f]{16}")


def validate_file(path: Path, require_root: bool, label: str) -> None:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit(f"{label} must be a non-symlink regular file")
    if info.st_mode & 0o077:
        raise SystemExit(f"{label} must have mode 0600 or stricter")
    if require_root and info.st_uid != 0:
        raise SystemExit(f"{label} must be owned by root")


def parse(path: Path) -> dict[str, str]:
    values = {}
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        if not raw or raw.startswith("#"):
            continue
        if "=" not in raw:
            raise SystemExit(f"line {number} is not KEY=VALUE")
        key, value = raw.split("=", 1)
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise SystemExit(f"line {number} has an invalid or duplicate key")
        values[key] = value
    return values


parser = argparse.ArgumentParser()
parser.add_argument("env_file", type=Path)
parser.add_argument("--require-root-owner", action="store_true")
parser.add_argument("--disjoint-from", action="append", type=Path, default=[])
args = parser.parse_args()
validate_file(args.env_file, args.require_root_owner, "restore environment")
values = parse(args.env_file)
if set(values) != REQUIRED:
    raise SystemExit(f"restore environment keys mismatch: {sorted(values)}")
if values["AA_ENVIRONMENT"] != "restore":
    raise SystemExit("AA_ENVIRONMENT must be restore")
if not STACK_ID.fullmatch(values["AA_STACK_ID"]):
    raise SystemExit("restore stack ID is invalid")
if values["AA_UPSTREAM_DIR"] != "/srv/aa/restore/runtime/upstream/0e5c073b464b76a1046ff3e9a8467ebbb41a376d":
    raise SystemExit("restore upstream path is invalid")
if len(values["POSTGRES_PASSWORD"]) < 40 or len(values["JWT_SECRET"]) < 64:
    raise SystemExit("restore secrets are too short")
if not all(re.fullmatch(r"[A-Za-z0-9._-]+", values[key]) for key in ("POSTGRES_PASSWORD", "JWT_SECRET")):
    raise SystemExit("restore secrets contain unsafe characters")
if values["POSTGRES_PASSWORD"] == values["JWT_SECRET"]:
    raise SystemExit("restore secrets must be distinct")

seen_environments = set()
for comparison in args.disjoint_from:
    validate_file(comparison, args.require_root_owner, "comparison environment")
    deployed = parse(comparison)
    environment = deployed.get("AA_ENVIRONMENT")
    if environment not in {"staging", "production"}:
        raise SystemExit("comparison environment must be staging or production")
    if environment in seen_environments:
        raise SystemExit(f"duplicate comparison environment: {environment}")
    seen_environments.add(environment)
    for key in ("AA_STACK_ID", "POSTGRES_PASSWORD", "JWT_SECRET"):
        if values[key] == deployed.get(key):
            raise SystemExit(f"restore environment reuses {key} from {environment}")
if args.disjoint_from and seen_environments != {"staging", "production"}:
    raise SystemExit("restore environment must be compared with staging and production")
print(f"Validated isolated restore environment {values['AA_STACK_ID']}.")
