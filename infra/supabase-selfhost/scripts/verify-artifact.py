#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath

EXPECTED_PATHS = [
    "agent-query/index.ts",
    "asr-transcribe/index.ts",
    "main/index.ts",
    "parse-expense/index.ts",
]
EXPECTED_FUNCTIONS = ["agent-query", "asr-transcribe", "parse-expense"]
SOURCE_PATHS = [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    "docs/HOSTED_DEPLOYMENT.md",
    "infra/supabase-selfhost",
    "apps/app/src/lib/asrClient.ts",
    "apps/app/src/lib/supabaseConfiguration.ts",
    "scripts/hosted-deployment.mjs",
    "scripts/verify-backend.mjs",
    "scripts/verify-production-canary.mjs",
    "scripts/verify-production-public-key.mjs",
    "supabase/config.toml",
    "supabase/functions",
    "supabase/migrations",
    "supabase/templates",
]
FINGERPRINT_KEYS = {"schemaVersion", "deploymentType", "functions", "bundleSha256", "files"}
MANIFEST_KEYS = {"schemaVersion", "sourceFingerprint", "upstreamCommit", "denoVersion", "artifactSha256", "files"}
ENTRY_KEYS = {"path", "sha256"}
INFRA = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = INFRA.parents[1]
SOURCE_TEMPLATE = REPOSITORY_ROOT / "supabase/templates/confirmation.html"


def json_object(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def read_json(path: Path) -> dict:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValueError(f"manifest must be a non-symlink regular file: {path}")
    value = json.loads(path.read_text(), object_pairs_hook=json_object)
    if not isinstance(value, dict):
        raise ValueError(f"manifest must be a JSON object: {path}")
    return value


def valid_entry(entry: object) -> bool:
    if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
        return False
    path = entry.get("path")
    digest = entry.get("sha256")
    if not isinstance(path, str) or not isinstance(digest, str):
        return False
    pure = PurePosixPath(path)
    return (
        path == pure.as_posix()
        and not pure.is_absolute()
        and path not in ("", ".")
        and ".." not in pure.parts
        and re.fullmatch(r"[0-9a-f]{64}", digest) is not None
    )


def collect_source_files(relative: str) -> list[str]:
    absolute = REPOSITORY_ROOT / relative
    info = absolute.lstat()
    if stat.S_ISLNK(info.st_mode):
        raise ValueError(f"source fingerprint input must not be a symlink: {relative}")
    if stat.S_ISREG(info.st_mode):
        return [relative]
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError(f"source fingerprint input is not a regular file or directory: {relative}")

    collected = []
    for entry in sorted(os.scandir(absolute), key=lambda item: item.name):
        if entry.name in ("node_modules", "__pycache__", ".DS_Store") or entry.name.endswith(".pyc"):
            continue
        child = PurePosixPath(relative, entry.name).as_posix()
        if entry.is_symlink():
            raise ValueError(f"source fingerprint input must not be a symlink: {child}")
        if entry.is_dir(follow_symlinks=False):
            collected.extend(collect_source_files(child))
        elif entry.is_file(follow_symlinks=False):
            collected.append(child)
        else:
            raise ValueError(f"source fingerprint input is not a regular file or directory: {child}")
    return collected


def current_source_entries() -> list[dict[str, str]]:
    paths = []
    for source in SOURCE_PATHS:
        paths.extend(collect_source_files(source))
    if len(paths) != len(set(paths)):
        raise ValueError("source fingerprint inputs overlap")
    return [
        {"path": path, "sha256": hashlib.sha256((REPOSITORY_ROOT / path).read_bytes()).hexdigest()}
        for path in sorted(paths)
    ]


def aggregate(entries: list[dict[str, str]]) -> str:
    canonical = "".join(f"{entry['sha256']}  {entry['path']}\n" for entry in entries)
    return hashlib.sha256(canonical.encode()).hexdigest()


def lock_values() -> dict[str, str]:
    values = {}
    for raw in (INFRA / "upstream.lock").read_text().splitlines():
        if raw and not raw.startswith("#"):
            key, value = raw.split("=", 1)
            values[key] = value
    return values


def template_for(root: Path, explicit: Path | None) -> Path:
    if explicit:
        return explicit
    return root.parent.parent / "templates" / root.name / "confirmation.html"


def verify(root: Path, template: Path, expected_fingerprint: str | None, expected_upstream: str) -> dict:
    root_info = root.lstat()
    if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
        raise ValueError(f"artifact root must be a non-symlink directory: {root}")
    manifest = read_json(root / "artifact-manifest.json")
    fingerprint = read_json(root / "fingerprint.json")
    if set(fingerprint) != FINGERPRINT_KEYS:
        raise ValueError(f"source fingerprint fields mismatch in {root}")
    if (
        fingerprint.get("schemaVersion") != 2
        or fingerprint.get("deploymentType") != "self-hosted"
        or fingerprint.get("functions") != EXPECTED_FUNCTIONS
    ):
        raise ValueError(f"invalid source fingerprint manifest in {root}")
    fingerprint_files = fingerprint.get("files")
    if (
        not isinstance(fingerprint_files, list)
        or not all(valid_entry(entry) for entry in fingerprint_files)
        or [entry["path"] for entry in fingerprint_files] != sorted(entry["path"] for entry in fingerprint_files)
        or len({entry["path"] for entry in fingerprint_files}) != len(fingerprint_files)
    ):
        raise ValueError(f"invalid source file manifest in {root}")
    source_entries = current_source_entries()
    if fingerprint_files != source_entries:
        raise ValueError(f"source file manifest does not match the repository in {root}")
    source_fingerprint = aggregate(source_entries)
    if fingerprint.get("bundleSha256") != source_fingerprint:
        raise ValueError(f"source fingerprint aggregate mismatch in {root}")
    if root.name != source_fingerprint or expected_fingerprint not in (None, source_fingerprint):
        raise ValueError(f"artifact directory does not match its source fingerprint: {root}")

    if set(manifest) != MANIFEST_KEYS:
        raise ValueError(f"artifact manifest fields mismatch in {root}")
    if manifest.get("schemaVersion") != 1 or manifest.get("denoVersion") != "2.9.1":
        raise ValueError(f"invalid artifact manifest in {root}")
    if manifest.get("sourceFingerprint") != source_fingerprint:
        raise ValueError(f"source fingerprint mismatch in {root}")
    if manifest.get("upstreamCommit") != expected_upstream:
        raise ValueError(f"upstream commit mismatch in {root}")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest.get("artifactSha256", "")):
        raise ValueError(f"invalid artifact aggregate in {root}")
    entries = manifest.get("files")
    if (
        not isinstance(entries, list)
        or not all(valid_entry(entry) for entry in entries)
        or [entry["path"] for entry in entries] != EXPECTED_PATHS
    ):
        raise ValueError(f"artifact file list mismatch in {root}")
    for entry in entries:
        path = root / entry["path"]
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            raise ValueError(f"artifact entry must be a non-symlink regular file: {path}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != entry["sha256"]:
            raise ValueError(f"artifact file hash mismatch: {path}")
    if aggregate(entries) != manifest["artifactSha256"]:
        raise ValueError(f"artifact aggregate mismatch in {root}")

    template_info = template.lstat()
    if stat.S_ISLNK(template_info.st_mode) or not stat.S_ISREG(template_info.st_mode):
        raise ValueError(f"template must be a non-symlink regular file: {template}")
    source_template_hash = next(
        entry["sha256"] for entry in source_entries
        if entry["path"] == "supabase/templates/confirmation.html"
    )
    deployed_template_hash = hashlib.sha256(template.read_bytes()).hexdigest()
    if deployed_template_hash != source_template_hash or source_template_hash != hashlib.sha256(SOURCE_TEMPLATE.read_bytes()).hexdigest():
        raise ValueError(f"template fingerprint mismatch in {root}")

    artifact_files = []
    for path in root.rglob("*"):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f"artifact contains a symlink: {path}")
        if stat.S_ISREG(info.st_mode):
            artifact_files.append(path)
        elif not stat.S_ISDIR(info.st_mode):
            raise ValueError(f"artifact contains a special file: {path}")
    expected_files = {
        root / "artifact-manifest.json",
        root / "fingerprint.json",
        *(root / path for path in EXPECTED_PATHS),
    }
    if set(artifact_files) != expected_files:
        raise ValueError(f"artifact contains unexpected files in {root}")
    writable = [path for path in [*artifact_files, template] if path.stat().st_mode & 0o222]
    if writable:
        raise ValueError(f"artifact contains writable files: {writable}")
    return manifest


parser = argparse.ArgumentParser()
parser.add_argument("artifact", type=Path)
parser.add_argument("comparison", nargs="?", type=Path)
parser.add_argument("--template", type=Path)
parser.add_argument("--comparison-template", type=Path)
parser.add_argument("--expected-fingerprint")
parser.add_argument("--expected-upstream-commit")
args = parser.parse_args()
locks = lock_values()
expected_upstream = args.expected_upstream_commit or locks["SUPABASE_COMMIT"]
first = verify(
    args.artifact,
    template_for(args.artifact, args.template),
    args.expected_fingerprint,
    expected_upstream,
)
if args.comparison:
    second = verify(
        args.comparison,
        template_for(args.comparison, args.comparison_template),
        args.expected_fingerprint,
        expected_upstream,
    )
    if first != second:
        raise SystemExit("function artifacts are not byte-identical")
print(f"Verified immutable function artifact {first['artifactSha256']}.")
