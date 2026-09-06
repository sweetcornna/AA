"""Run the maintained semantic UI regression for natural-language expense entry."""
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
sys.exit(subprocess.call([
    "npx", "playwright", "test", "--config", "apps/app/playwright.config.ts",
    "--project=chromium", "--grep", "natural language prefill",
], cwd=root))
