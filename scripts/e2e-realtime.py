"""Run two-account real UI regression, including live ledger and membership sync."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
sys.exit(subprocess.call([
    "npx", "playwright", "test", "--config", "apps/app/playwright.config.ts",
    "--project=chromium", "--grep", "three split modes",
], cwd=root))
