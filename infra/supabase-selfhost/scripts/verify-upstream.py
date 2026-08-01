#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath

INFRA = Path(__file__).resolve().parents[1]
MANIFEST_NAME = ".aa-upstream-manifest.json"
MANIFEST_KEYS = {"schemaVersion", "upstreamCommit", "archiveSha256", "files"}
ENTRY_KEYS = {"path", "type", "mode", "sha256"}
EXPECTED_FILES = {
    ".aa-upstream-sha256": "0444",
    "api/kong-entrypoint.sh": "0555",
    "db/jwt.sql": "0444",
    "db/realtime.sql": "0444",
    "db/roles.sql": "0444",
    "functions/main/index.ts": "0444",
}


def json_object(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def lock_values() -> dict[str, str]:
    values = {}
    for raw in (INFRA / "upstream.lock").read_text().splitlines():
        if raw and not raw.startswith("#"):
            key, value = raw.split("=", 1)
            values[key] = value
    return values


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected_directories(root: Path) -> set[Path]:
    directories = {root}
    for relative in EXPECTED_FILES:
        parent = (root / relative).parent
        while parent != root:
            directories.add(parent)
            parent = parent.parent
    return directories


def verify(root: Path, expected_commit: str, expected_archive: str) -> dict:
    root_info = root.lstat()
    if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
        raise ValueError(f"upstream root must be a non-symlink directory: {root}")
    manifest_path = root / MANIFEST_NAME
    manifest_info = manifest_path.lstat()
    if stat.S_ISLNK(manifest_info.st_mode) or not stat.S_ISREG(manifest_info.st_mode):
        raise ValueError("upstream manifest must be a non-symlink regular file")
    manifest = json.loads(manifest_path.read_text(), object_pairs_hook=json_object)
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_KEYS:
        raise ValueError("upstream manifest fields mismatch")
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("upstreamCommit") != expected_commit
        or manifest.get("archiveSha256") != expected_archive
    ):
        raise ValueError("upstream manifest identity mismatch")

    entries = manifest.get("files")
    expected_paths = sorted(EXPECTED_FILES)
    if not isinstance(entries, list) or len(entries) != len(expected_paths):
        raise ValueError("upstream manifest file inventory mismatch")
    if [entry.get("path") if isinstance(entry, dict) else None for entry in entries] != expected_paths:
        raise ValueError("upstream manifest paths are not the retained-file allowlist")

    actual_files = set()
    actual_directories = set()
    for directory, names, filenames in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        directory_info = directory_path.lstat()
        if stat.S_ISLNK(directory_info.st_mode) or not stat.S_ISDIR(directory_info.st_mode):
            raise ValueError(f"upstream contains an invalid directory: {directory_path}")
        if stat.S_IMODE(directory_info.st_mode) & 0o222:
            raise ValueError(f"upstream contains a writable directory: {directory_path}")
        actual_directories.add(directory_path)
        for name in names:
            path = directory_path / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                raise ValueError(f"upstream contains a symlink: {path}")
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError(f"upstream contains a special entry: {path}")
        for name in filenames:
            path = directory_path / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise ValueError(f"upstream contains a non-regular file: {path}")
            actual_files.add(path)

    expected_file_set = {manifest_path, *(root / path for path in expected_paths)}
    if actual_files != expected_file_set or actual_directories != expected_directories(root):
        raise ValueError("upstream contains unexpected files or directories")

    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
            raise ValueError("upstream manifest entry fields mismatch")
        relative = entry.get("path")
        pure = PurePosixPath(relative) if isinstance(relative, str) else PurePosixPath(".")
        if (
            not isinstance(relative, str)
            or relative != pure.as_posix()
            or pure.is_absolute()
            or ".." in pure.parts
            or entry.get("type") != "file"
            or entry.get("mode") != EXPECTED_FILES.get(relative)
            or re.fullmatch(r"[0-9a-f]{64}", entry.get("sha256", "")) is None
        ):
            raise ValueError(f"invalid upstream manifest entry: {relative}")
        path = root / relative
        info = path.lstat()
        mode = f"{stat.S_IMODE(info.st_mode):04o}"
        if mode != entry["mode"] or sha256(path) != entry["sha256"]:
            raise ValueError(f"upstream file metadata mismatch: {relative}")

    marker = root / ".aa-upstream-sha256"
    if marker.read_text() != f"{expected_archive}\n":
        raise ValueError("upstream archive marker mismatch")
    if stat.S_IMODE(manifest_info.st_mode) != 0o444:
        raise ValueError("upstream manifest mode must be 0444")
    return manifest


parser = argparse.ArgumentParser()
parser.add_argument("upstream", type=Path)
parser.add_argument("--expected-commit")
parser.add_argument("--expected-archive-sha256")
args = parser.parse_args()
locks = lock_values()
expected_commit = args.expected_commit or locks["SUPABASE_COMMIT"]
expected_archive = args.expected_archive_sha256 or locks["SUPABASE_ARCHIVE_SHA256"]
if re.fullmatch(r"[0-9a-f]{40}", expected_commit) is None:
    raise SystemExit("locked upstream commit is invalid")
if re.fullmatch(r"[0-9a-f]{64}", expected_archive) is None:
    raise SystemExit("locked upstream archive SHA-256 is invalid")
try:
    verified = verify(args.upstream, expected_commit, expected_archive)
except (OSError, ValueError, json.JSONDecodeError) as error:
    raise SystemExit(str(error)) from error
print(f"Verified retained upstream manifest for {verified['upstreamCommit']}.")
