#!/usr/bin/env bash

aa_load_env() {
  local path="${1:?environment path is required}"
  local key value
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || {
      printf 'Invalid environment key in %s.\n' "$path" >&2
      return 1
    }
    printf -v "$key" '%s' "$value"
    export "${key?}"
  done < "$path"
}
