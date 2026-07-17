#!/usr/bin/env bash
# Report dependency staleness and known vulnerabilities.
#
# `pnpm deps:check`          full report: outdated packages + audit
# `pnpm deps:check --nudge`  throttled one-liner for the pre-push hook
#
# --nudge only reports vulnerability advisories that are NOT already listed in
# .deps-audit-baseline. It deliberately says nothing about packages being behind
# on a major version: being on eslint 9 while 10 exists is normal and needs no
# action, so reporting it on every push would be noise. Run the full report when
# you actually want to survey versions.
#
# --nudge is advisory only: it always exits 0 and can never block a push. It
# throttles to once every STALE_AFTER_DAYS via a stamp file under
# node_modules/.cache (gitignored; wiped by a clean install, which is a
# reasonable time to re-check anyway).

set -uo pipefail

STALE_AFTER_DAYS=7
STAMP="node_modules/.cache/deps-check-stamp"
AUDIT_BASELINE=".deps-audit-baseline"

# Advisory ids accepted in the baseline file (strips comments/blanks).
baselined_ids() {
  [ -f "$AUDIT_BASELINE" ] || return 0
  grep -oE "^[0-9]+" "$AUDIT_BASELINE" || true
}

# Advisory ids currently reported by pnpm audit --prod.
current_audit_ids() {
  pnpm audit --prod --json 2>/dev/null | node -e "
    let s = ''
    process.stdin.on('data', d => (s += d)).on('end', () => {
      try {
        console.log(Object.keys(JSON.parse(s).advisories || {}).join('\n'))
      } catch {
        // Audit unreachable or output unparseable (offline, registry error).
        // Print nothing, so the nudge reports 0 new advisories rather than
        // reporting a network problem as if it were a security finding.
      }
    })
  " || true
}

full_report() {
  echo "📦 Outdated packages:"
  pnpm outdated || true   # exits non-zero when anything is outdated
  echo ""
  echo "🔒 Vulnerabilities (production deps):"
  pnpm audit --prod || true   # exits non-zero when anything is found
  echo ""
  echo "   $(baselined_ids | grep -c . || true) advisory(ies) above are listed in ${AUDIT_BASELINE}"
  echo "   (no upstream fix published). The pre-push nudge ignores those and"
  echo "   reports only advisories that are new."
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

new_vulns=$(current_audit_ids | grep -vxF -f <(baselined_ids) | grep -c . || true)

if [ "${new_vulns:-0}" -gt 0 ]; then
  echo ""
  echo "🔒 ${new_vulns} new vulnerability advisory(ies) since the last baseline."
  echo "   Run 'pnpm deps:check' for details. (Checked at most every ${STALE_AFTER_DAYS} days.)"
  echo ""
fi

exit 0
