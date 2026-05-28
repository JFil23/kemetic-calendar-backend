#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$ADMIN_DIR/src"

if grep -RInE 'SERVICE_ROLE|SUPABASE_SERVICE_ROLE' "$SRC_DIR"; then
  echo "Forbidden privileged key reference found under admin/src" >&2
  exit 1
fi
