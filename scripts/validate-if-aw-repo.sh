#!/bin/sh
# pre-push: run the real loader check when AW_REPO points at an agent-wrangler
# checkout. Skipped with a warning locally otherwise; CI always sets it.
if [ -z "${AW_REPO:-}" ]; then
  echo "AW_REPO not set: skipping the real-loader check (CI runs it)." >&2
  exit 0
fi
exec node scripts/validate-manifest.mjs
