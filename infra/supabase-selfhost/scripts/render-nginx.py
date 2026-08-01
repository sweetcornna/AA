#!/usr/bin/env python3
import argparse
import re
from pathlib import Path

TARGETS = {
    "staging": {"host": "staging-api.cornna.xyz", "kong": "18100", "tls": "18543"},
    "production": {"host": "api.cornna.xyz", "kong": "18101", "tls": "18544"},
}

parser = argparse.ArgumentParser()
parser.add_argument("environment", choices=TARGETS)
parser.add_argument("template", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit("refusing to overwrite an existing Nginx configuration")
values = TARGETS[args.environment]
text = args.template.read_text()
for key, value in {
    "AA_API_HOST": values["host"],
    "AA_KONG_HTTP_PORT": values["kong"],
    "AA_TLS_LISTEN_PORT": values["tls"],
}.items():
    text = text.replace("${" + key + "}", value)
if re.search(r"\$\{AA_[A-Z0-9_]+\}", text):
    raise SystemExit("unresolved AA template variables remain")
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(text)
print(f"Rendered {args.environment} loopback TLS virtual host.")
