#!/usr/bin/env bash
set -euo pipefail

if grep -RInE 'SERVICE_ROLE|SUPABASE_SERVICE_ROLE' src; then
  echo "Forbidden privileged key reference found under admin/src" >&2
  exit 1
fi
