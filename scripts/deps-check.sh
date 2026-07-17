#!/usr/bin/env bash
# Report dependency staleness and known vulnerabilities.
#
# Run directly (`pnpm deps:check`) for the full report, or with --nudge for the
# throttled one-line summary the pre-push hook uses.
#
# --nudge is advisory only: it always exits 0, so it can never block a push. It
# throttles itself to once every STALE_AFTER_DAYS via a stamp file under
# node_modules/.cache (gitignored, and wiped by a clean install — which is fine,
# a fresh install is a reasonable time to re-check).
#
# Both `pnpm outdated` and `pnpm audit` hit the network, so the throttle is what
# keeps this off the critical path of every push.

set -uo pipefail

STALE_AFTER_DAYS=7
STAMP="node_modules/.cache/deps-check-stamp"

full_report() {
  echo "📦 Outdated packages:"
  pnpm outdated || true   # exits non-zero when anything is outdated
  echo ""
  echo "🔒 Vulnerabilities (production deps):"
  pnpm audit --prod || true   # exits non-zero when anything is found
}

if [ "${1:-}" != "--nudge" ]; then
  full_report
  exit 0
fi

# Throttle: skip silently if we checked within the window.
if [ -f "$STAMP" ]; then
  last=$(cat "$STAMP" 2>/dev/null || echo 0)
  now=$(date +%s)
  if [ $(( (now - last) / 86400 )) -lt "$STALE_AFTER_DAYS" ]; then
    exit 0
  fi
fi

mkdir -p "$(dirname "$STAMP")"
date +%s > "$STAMP"

# Both commands exit non-zero when they have something to report, so capture
# their output first rather than piping — with `set -o pipefail` a pipeline
# would report failure and trip any `||` fallback on top of the real value.
outdated_raw=$(pnpm outdated 2>/dev/null || true)
audit_raw=$(pnpm audit --prod 2>/dev/null || true)

# One table row per package; borders/header filtered by requiring a
# package-name-ish first cell.
outdated=$(printf '%s' "$outdated_raw" | grep -cE "^│ [a-z@]" || true)
vulns=$(printf '%s' "$audit_raw" | grep -oE "^[0-9]+ vulnerabilities" | head -1 | grep -oE "^[0-9]+" || true)

if [ "${outdated:-0}" -gt 0 ] || [ "${vulns:-0}" -gt 0 ]; then
  echo ""
  echo "📦 Dependency check: ${outdated:-0} package(s) behind latest, ${vulns:-0} known vulnerability(ies)."
  echo "   Run 'pnpm deps:check' for details. (This nudge appears at most every ${STALE_AFTER_DAYS} days.)"
  echo ""
fi

exit 0
