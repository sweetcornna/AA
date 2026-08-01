#!/usr/bin/env bash
set -euo pipefail

APPROVED_MIN_CPUS=4
APPROVED_MIN_MEMORY_KIB=8388608
APPROVED_MIN_DISK_KIB=41943040
APPROVED_MIN_DEBIAN_VERSION=12

# The observed/planning footprint for one seven-service stack is about 650-700
# MiB. Its explicit caps are db 256 + templates 16 + auth 64 + rest 32 +
# realtime 96 + functions 144 + kong 80 = 688 MiB. Add 130 MiB for the existing
# host services and 78 MiB for Debian kernel/daemons to reach 896 MiB; swap is
# deliberately excluded. Two CPUs schedule the database plus application tier,
# and 20 GiB holds one pinned image set, database volume, and backup workspace.
SINGLE_STACK_MIN_CPUS=2
SINGLE_STACK_MIN_MEMORY_KIB=917504
SINGLE_STACK_MIN_DISK_KIB=20971520
# The OS floor is NOT a capacity trade-off and is identical in both profiles.
# Debian 11 LTS ends 2026-08-31, after which the host receives no security
# updates. A stack holding user financial records must not run on an
# unsupported base, however few people use it.
SINGLE_STACK_MIN_DEBIAN_VERSION="$APPROVED_MIN_DEBIAN_VERSION"

PROFILE=dual-stack
if [[ "${1:-}" == "--profile" ]]; then
  [[ "$#" -ge 2 ]] || { printf '%s\n' 'Usage: capacity-check.sh [--profile dual-stack|single-stack] [path ...]' >&2; exit 2; }
  PROFILE="$2"
  shift 2
fi
case "$PROFILE" in
  dual-stack)
    PROFILE_MIN_CPUS="$APPROVED_MIN_CPUS"
    PROFILE_MIN_MEMORY_KIB="$APPROVED_MIN_MEMORY_KIB"
    PROFILE_MIN_DISK_KIB="$APPROVED_MIN_DISK_KIB"
    PROFILE_MIN_DEBIAN_VERSION="$APPROVED_MIN_DEBIAN_VERSION"
    ;;
  single-stack)
    PROFILE_MIN_CPUS="$SINGLE_STACK_MIN_CPUS"
    PROFILE_MIN_MEMORY_KIB="$SINGLE_STACK_MIN_MEMORY_KIB"
    PROFILE_MIN_DISK_KIB="$SINGLE_STACK_MIN_DISK_KIB"
    PROFILE_MIN_DEBIAN_VERSION="$SINGLE_STACK_MIN_DEBIAN_VERSION"
    ;;
  *)
    printf 'Unknown capacity profile: %s.\n' "$PROFILE" >&2
    exit 2
    ;;
esac

MIN_CPUS="${AA_MIN_CPUS:-$PROFILE_MIN_CPUS}"
MIN_MEMORY_KIB="${AA_MIN_MEMORY_KIB:-$PROFILE_MIN_MEMORY_KIB}"
MIN_DISK_KIB="${AA_MIN_DISK_KIB:-$PROFILE_MIN_DISK_KIB}"
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
(( VERSION_ID >= PROFILE_MIN_DEBIAN_VERSION )) || {
  printf 'Debian version gate failed for %s: %s < %s.\n' "$PROFILE" "$VERSION_ID" "$PROFILE_MIN_DEBIAN_VERSION" >&2
  exit 1
}

for value in "$MIN_CPUS" "$MIN_MEMORY_KIB" "$MIN_DISK_KIB"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || { printf 'Capacity thresholds must be positive integers.\n' >&2; exit 1; }
done
(( MIN_CPUS >= PROFILE_MIN_CPUS )) || { printf 'CPU threshold cannot be lower than the %s floor of %s.\n' "$PROFILE" "$PROFILE_MIN_CPUS" >&2; exit 1; }
(( MIN_MEMORY_KIB >= PROFILE_MIN_MEMORY_KIB )) || { printf 'RAM threshold cannot be lower than the %s floor of %s KiB.\n' "$PROFILE" "$PROFILE_MIN_MEMORY_KIB" >&2; exit 1; }
(( MIN_DISK_KIB >= PROFILE_MIN_DISK_KIB )) || { printf 'disk threshold cannot be lower than the %s floor of %s KiB.\n' "$PROFILE" "$PROFILE_MIN_DISK_KIB" >&2; exit 1; }

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
printf '%s capacity gates passed: %s CPUs, %s KiB RAM.\n' "$PROFILE" "$cpus" "$memory_kib"
