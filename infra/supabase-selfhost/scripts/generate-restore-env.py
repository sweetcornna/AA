#!/usr/bin/env python3
import argparse
import os
import re
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("--drill-id", required=True)
args = parser.parse_args()
if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{4,29}[a-z0-9])", args.drill_id):
    raise SystemExit("drill ID must be 6-31 lowercase alphanumeric/hyphen characters and cannot end with a hyphen")
if args.output.exists():
    raise SystemExit("refusing to overwrite an existing restore environment file")
values = {
    "AA_ENVIRONMENT": "restore",
    "AA_STACK_ID": f"aa-restore-{args.drill_id}-{secrets.token_hex(8)}",
    "AA_UPSTREAM_DIR": "/srv/aa/restore/runtime/upstream/0e5c073b464b76a1046ff3e9a8467ebbb41a376d",
    "POSTGRES_PASSWORD": secrets.token_urlsafe(48),
    "JWT_SECRET": secrets.token_urlsafe(64),
}
args.output.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    for key, value in values.items():
        stream.write(f"{key}={value}\n")
print(f"Wrote isolated restore environment {values['AA_STACK_ID']}.")
