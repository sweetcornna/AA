#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CI_PATH = ".github/workflows/ci.yml"
RELEASE_PATH = ".github/workflows/release.yml"
FORBIDDEN_TRACKED = {
    "supabase/hosted-targets.json",
}
FORBIDDEN_SUFFIXES = {".jks", ".keystore", ".p12", ".pfx", ".pem", ".key"}
PRIVATE_KEY = re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")
SECRET_ASSIGNMENT = re.compile(
    rb"^(?:POSTGRES_PASSWORD|JWT_SECRET|SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|SMTP_PASS|OPENAI_API_KEY|ANDROID_(?:STORE|KEY)_PASSWORD)=(?!<|\$\{|\$|$)[^\r\n]+$",
    re.MULTILINE,
)
SECRET_TOKEN = re.compile(rb"(?:sb_secret_[A-Za-z0-9._-]{16,}|service_role[^\r\n]{0,20}eyJ[A-Za-z0-9_-]{20,})", re.I)
ACTION_PINS = {
    "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
    "actions/configure-pages": "983d7736d9b0ae728b81ab479565c72886d7745b",
    "actions/deploy-pages": "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/setup-java": "c1e323688fd81a25caa38c78aa6df2d33d3e20d9",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
    "actions/upload-pages-artifact": "56afc609e74202658d3ffba0e8f6dda462b719fa",
    "android-actions/setup-android": "9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407",
    "denoland/setup-deno": "22d081ff2d3a40755e97629de92e3bcbfa7cf2ed",
    "dtolnay/rust-toolchain": "4cda84d5c5c54efe2404f9d843567869ab1699d4",
    "swatinem/rust-cache": "e18b497796c12c097a38f9edb9d0641fb99eee32",
}


def git_paths(args: list[str]) -> list[str]:
    output = subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [line for line in output.splitlines() if line]


def check_path(path: str, failures: list[str]) -> None:
    lower = path.lower()
    name = Path(path).name.lower()
    if path in FORBIDDEN_TRACKED or Path(path).suffix.lower() in FORBIDDEN_SUFFIXES:
        failures.append(f"forbidden credential-bearing path: {path}")
    if (name == ".env" or name.startswith(".env.")) and not name.endswith(".example"):
        failures.append(f"tracked environment file is forbidden: {path}")
    if "provider-secret" in lower or "provider_secret" in lower:
        failures.append(f"provider secret file is forbidden: {path}")

    absolute = ROOT / path
    if not absolute.is_file():
        return
    data = absolute.read_bytes()
    if PRIVATE_KEY.search(data):
        failures.append(f"private key material detected: {path}")
    if SECRET_ASSIGNMENT.search(data):
        failures.append(f"non-placeholder sensitive assignment detected: {path}")
    if SECRET_TOKEN.search(data):
        failures.append(f"secret credential token detected: {path}")


def check_action_pins(failures: list[str]) -> None:
    seen: set[str] = set()
    for workflow_path in sorted((ROOT / ".github/workflows").glob("*.yml")):
        for line_number, line in enumerate(workflow_path.read_text().splitlines(), 1):
            match = re.search(r"\buses:\s+([^\s#]+)", line)
            if not match:
                continue
            action_ref = match.group(1)
            if action_ref.startswith("./"):
                continue
            action, separator, commit = action_ref.rpartition("@")
            if not separator or action not in ACTION_PINS:
                failures.append(
                    f"workflow action is not approved: {workflow_path.relative_to(ROOT)}:{line_number}: {action_ref}"
                )
                continue
            if commit != ACTION_PINS[action] or not re.fullmatch(r"[0-9a-f]{40}", commit):
                failures.append(
                    f"workflow action is not pinned to the approved commit: "
                    f"{workflow_path.relative_to(ROOT)}:{line_number}: {action_ref}"
                )
                continue
            seen.add(action)
    missing = sorted(set(ACTION_PINS) - seen)
    if missing:
        failures.append(f"approved workflow actions are unused or missing: {', '.join(missing)}")


def check_ci(failures: list[str]) -> None:
    source = (ROOT / CI_PATH).read_text()
    forbidden = {
        "GitHub secret context": r"\$\{\{\s*secrets\.",
        "protected environment": r"(?m)^\s*environment\s*:",
        "OIDC permission": r"(?m)^\s*id-token\s*:",
        "write permission": r"(?m)^\s*(?:contents|actions|packages|deployments)\s*:\s*write\s*$",
        "remote shell or copy": r"(?i)(?:^|[\s;|&])(?:ssh|scp|rsync)\s",
        "cloud login": r"(?i)(?:az|supabase)\s+login\b",
        "Compose startup": r"docker\s+compose[^\n]*\s+up(?:\s|$)",
        "migration apply": r"run-migrations\.py(?![^\n]*--dry-run)",
        "backup execution": r"(?:^|[\s/])backup\.sh(?:\s|$)",
        "restore execution": r"restore-drill\.sh",
    }
    for label, pattern in forbidden.items():
        if re.search(pattern, source):
            failures.append(f"CI contains forbidden {label}")
    if not re.search(r"(?m)^permissions:\s*\n\s+contents:\s*read\s*$", source):
        failures.append("CI top-level permissions must be contents: read")


def check_release(failures: list[str]) -> None:
    source = (ROOT / RELEASE_PATH).read_text()
    required = (
        "options: [candidate, publish]",
        "environment: production\n",
        "environment: production-publish",
        "candidate_run_id:",
        "expected_apk_sha256:",
        "[[ \"$TAG\" == \"v0.0.5\" ]]",
        "[[ \"$GITHUB_REF\" == \"refs/tags/$TAG\" ]]",
        "[[ \"$GITHUB_SHA\" == \"$sha\" ]]",
        "! grep -q '<REQUIRED>' docs/PRIVACY.md",
        "version_code=\"${version_contract[1]}\"",
        "[[ \"$version\" == \"0.0.5\" ]]",
        "[[ \"$version_code\" == \"5\" ]]",
        "AA_ANDROID_EXPECTED_VERSION_CODE:",
        "schemaVersion: 3",
        "publishableKeySha256:",
        "versionCode: Number(process.env.VERSION_CODE)",
        "EXPECTED_VERSION_CODE:",
        "versionCode: Number(process.env.EXPECTED_VERSION_CODE)",
        "candidate-metadata.json",
        "AA_HOSTED_TARGETS_FILE: supabase/hosted-targets.example.json",
        "EXPECTED_PRODUCTION_PUBLIC_KEY",
        "EXPECTED_CANDIDATE_RUN_ID",
        "EXPECTED_SOURCE_COMMIT",
        "'.head_sha'",
        "versionCode='$EXPECTED_VERSION_CODE'",
        "gh release create",
        "Refusing to modify existing release",
        "app-universal-release.apk",
        # notes 必须同时声明真机验收结论与仍未覆盖的范围，两者缺一不可。
        "已在真机完成安装与注册验收",
        "尚未广泛验证",
    )
    for value in required:
        if value not in source:
            failures.append(f"release contract missing: {value}")
    for value in (
        "accepted_apk_sha256",
        "device_acceptance_id",
        "desktop-candidate",
        "gh release upload",
        "push:\n    tags:",
        "tauri-apps/tauri-action",
    ):
        if value in source:
            failures.append(f"release contract contains forbidden path: {value}")
    if source.count("scripts/android-build-apk.sh release") != 1:
        failures.append("release workflow must build the Android candidate exactly once")
    match = re.search(r"(?ms)^  publish:\n(.*)\Z", source)
    if not match:
        failures.append("release publish job is missing")
        return
    publish = match.group(1)
    for pattern in (r"npm\s+(?:ci|run)", r"android-build-apk", r"tauri", r"gradle", r"cargo\s+build"):
        if re.search(pattern, publish, re.I):
            failures.append(f"publish job contains forbidden build tooling: {pattern}")
    if "contents: write" not in publish or "actions: read" not in publish:
        failures.append("publish job permissions mismatch")


def check_android_identity(failures: list[str]) -> None:
    config = json.loads((ROOT / "apps/app/src-tauri/tauri.conf.json").read_text())
    if config.get("version") != "0.0.5":
        failures.append("Tauri Android release version must be exactly 0.0.5")
    if config.get("identifier") != "com.aa.expense":
        failures.append("Tauri Android application ID must be exactly com.aa.expense")
    if config.get("bundle", {}).get("android", {}).get("versionCode") != 5:
        failures.append("Tauri Android versionCode must be exactly 5")

    gradle = (ROOT / "apps/app/src-tauri/gen/android/app/build.gradle.kts").read_text()
    for value in (
        'appVersionCode != 5 || appVersionName != "0.0.5"',
        'throw GradleException("Release version must be 0.0.5 (versionCode 5)")',
        "versionCode = appVersionCode",
        "versionName = appVersionName",
    ):
        if value not in gradle:
            failures.append(f"Gradle release identity contract missing: {value}")

    verifier = (ROOT / "scripts/android-verify-apk.sh").read_text()
    for value in (
        "AA_ANDROID_EXPECTED_VERSION_CODE",
        '[[ "$AA_ANDROID_EXPECTED_VERSION_CODE" != "5" ]]',
        "bundle.android.versionCode",
        '[[ "$VERSION_CODE" == "$AA_ANDROID_EXPECTED_VERSION_CODE" ]]',
    ):
        if value not in verifier:
            failures.append(f"APK verifier identity contract missing: {value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-untracked", action="store_true")
    args = parser.parse_args()
    paths = set(git_paths(["ls-files"]))
    if args.include_untracked:
        paths.update(git_paths(["ls-files", "--others", "--exclude-standard"]))
    failures: list[str] = []
    for path in sorted(paths):
        check_path(path, failures)
    check_action_pins(failures)
    check_ci(failures)
    check_release(failures)
    check_android_identity(failures)
    if failures:
        raise SystemExit("Repository policy failed:\n- " + "\n- ".join(failures))
    print(f"Repository no-secret/no-deploy policy passed for {len(paths)} files.")


if __name__ == "__main__":
    main()
