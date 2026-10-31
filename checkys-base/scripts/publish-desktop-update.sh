#!/usr/bin/env bash
set -Eeuo pipefail
command -v node >/dev/null || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }
exec node "$(dirname "${BASH_SOURCE[0]}")/publish-desktop-update.cjs" "$@"
