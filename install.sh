#!/usr/bin/env bash
# Import the Terminal.app profile stored in this repository.
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
profile="$repo_dir/terminal/Default.terminal"

if [[ ! -f "$profile" ]]; then
  printf 'Terminal profile not found: %s\n' "$profile" >&2
  exit 1
fi

open "$profile"
printf '%s\n' 'Terminal imported. In Terminal → Settings → Profiles, select “Default” and make it the default profile.'
