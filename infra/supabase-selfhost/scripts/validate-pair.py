#!/usr/bin/env python3
import argparse
import importlib.util
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("staging", type=Path)
parser.add_argument("production", type=Path)
args = parser.parse_args()

module_path = Path(__file__).with_name("validate-env.py")
spec = importlib.util.spec_from_file_location("validate_env", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(module)

staging = module.parse(args.staging)
production = module.parse(args.production)
if staging.get("AA_ENVIRONMENT") != "staging" or production.get("AA_ENVIRONMENT") != "production":
    raise SystemExit("expected staging then production environment files")
if staging.get("AA_SOURCE_FINGERPRINT") != production.get("AA_SOURCE_FINGERPRINT"):
    raise SystemExit("staging and production must have the same AA_SOURCE_FINGERPRINT")
for key in (
    "AA_STACK_ID", "AA_RUNTIME_ROOT", "AA_UPSTREAM_DIR", "AA_FUNCTIONS_DIR", "AA_TEMPLATE_DIR",
    "AA_KONG_HTTP_PORT", "SUPABASE_PUBLIC_URL", "API_EXTERNAL_URL", "SITE_URL", "POSTGRES_PASSWORD",
    "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
    "SECRET_KEY_BASE", "REALTIME_DB_ENC_KEY", "SMTP_PASS",
    "SMTP_ADMIN_EMAIL", "OPENAI_API_KEY", "BACKUP_DIR", "BACKUP_AGE_RECIPIENT", "AZURE_STORAGE_CONTAINER",
):
    if staging[key] == production[key]:
        raise SystemExit(f"staging and production must have different {key}")
print("Validated staging/production identity, data, port, provider, and secret separation.")
