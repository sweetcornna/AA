#!/usr/bin/env bash
set -euo pipefail

APPROVED_MIN_CPUS=4
APPROVED_MIN_MEMORY_KIB=8388608
APPROVED_MIN_DISK_KIB=41943040
APPROVED_MIN_DEBIAN_VERSION=12
MIN_CPUS="${AA_MIN_CPUS:-$APPROVED_MIN_CPUS}"
MIN_MEMORY_KIB="${AA_MIN_MEMORY_KIB:-$APPROVED_MIN_MEMORY_KIB}"
MIN_DISK_KIB="${AA_MIN_DISK_KIB:-$APPROVED_MIN_DISK_KIB}"
TARGET_PATHS=("$@")
if (( ${#TARGET_PATHS[@]} == 0 )); then
  TARGET_PATHS=(/srv/aa)
fi

[[ -r /etc/os-release ]] || { printf 'Operating system identity is unavailable.\n' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "debian" && "${VERSION_ID:-}" =~ ^[0-9]+$ ]] || {
  printf 'Only a supported Debian host is approved.\n' >&2
  exit 1
}
(( VERSION_ID >= APPROVED_MIN_DEBIAN_VERSION )) || {
  printf 'Debian version gate failed: %s < %s.\n' "$VERSION_ID" "$APPROVED_MIN_DEBIAN_VERSION" >&2
  exit 1
}

for value in "$MIN_CPUS" "$MIN_MEMORY_KIB" "$MIN_DISK_KIB"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { printf 'Capacity thresholds must be positive integers.\n' >&2; exit 1; }
done
(( MIN_CPUS >= APPROVED_MIN_CPUS )) || { printf 'CPU threshold cannot be lower than %s.\n' "$APPROVED_MIN_CPUS" >&2; exit 1; }
(( MIN_MEMORY_KIB >= APPROVED_MIN_MEMORY_KIB )) || { printf 'RAM threshold cannot be lower than %s KiB.\n' "$APPROVED_MIN_MEMORY_KIB" >&2; exit 1; }
(( MIN_DISK_KIB >= APPROVED_MIN_DISK_KIB )) || { printf 'disk threshold cannot be lower than %s KiB.\n' "$APPROVED_MIN_DISK_KIB" >&2; exit 1; }

cpus="$(getconf _NPROCESSORS_ONLN)"
memory_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"

fail=0
if (( cpus < MIN_CPUS )); then printf 'CPU gate failed: %s < %s.\n' "$cpus" "$MIN_CPUS" >&2; fail=1; fi
if (( memory_kib < MIN_MEMORY_KIB )); then printf 'RAM gate failed: %s KiB < %s KiB.\n' "$memory_kib" "$MIN_MEMORY_KIB" >&2; fail=1; fi
for target_path in "${TARGET_PATHS[@]}"; do
  [[ -e "$target_path" ]] || { printf 'disk gate path does not exist: %s.\n' "$target_path" >&2; fail=1; continue; }
  disk_kib="$(df -Pk "$target_path" | awk 'NR == 2 {print $4}')"
  if (( disk_kib < MIN_DISK_KIB )); then
    printf 'disk gate failed for %s: %s KiB < %s KiB free.\n' "$target_path" "$disk_kib" "$MIN_DISK_KIB" >&2
    fail=1
  else
    printf 'Disk gate passed for %s: %s KiB free.\n' "$target_path" "$disk_kib"
  fi
done
if (( fail )); then exit 1; fi
printf 'CPU and RAM gates passed: %s CPUs, %s KiB RAM.\n' "$cpus" "$memory_kib"
