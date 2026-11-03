#!/bin/sh
set -eu
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js >=22.16 with npm is required. Install Node.js, then run again.' >&2
  exit 1
fi
if [ -f "$0" ]; then
  installer_directory="$(CDPATH= cd "$(dirname "$0")" && pwd)"
  if [ -f "$installer_directory/install.mjs" ]; then
    exec node "$installer_directory/install.mjs" "$@"
  fi
fi
for installer_argument in "$@"; do
  if [ "$installer_argument" = '--dry-run' ]; then
    printf '%s\n' 'Would download install.mjs and prepare the selected npm release. No files changed.'
    exit 0
  fi
done
installer="$(mktemp "${TMPDIR:-/tmp}/capability-install.XXXXXX.mjs")"
trap 'rm -f "$installer"' EXIT HUP INT TERM
url='https://raw.githubusercontent.com/cyxysky/capability-sdk/main/install.mjs'
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$installer"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$installer" "$url"
else
  printf '%s\n' 'curl or wget is required.' >&2
  exit 1
fi
node "$installer" "$@"
