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
AUDIT_BASELINE=".deps-audit-baseline"

# Packages the nudge stays quiet about, because being behind is a settled
# decision rather than pending work. A nudge that reports the same known items
# every week trains you to ignore it — which is how the next real advisory gets
# missed. `pnpm deps:check` (no --nudge) still lists these, with the reason.
#
# Each entry: <package>|<reason>. Recheck when the reason stops holding — the
# full report prints them, so they stay visible rather than silently rotting.
HELD_BACK=(
  "typescript|typescript-eslint 8.64.0 (latest) peer-caps typescript <6.1.0; TS 7 is the native port and no eslint tooling supports it yet"
  "eslint|eslint-plugin-react 7.37.5 (latest, via eslint-config-next) peer-caps eslint ^9.7"
  "@types/node|deliberately tracks engines/Koyeb (Node 22), not the dev machine; revisit when Node 26 goes LTS"
)

held_back_names() {
  printf '%s\n' "${HELD_BACK[@]}" | cut -d'|' -f1
}

full_report() {
  echo "📦 Outdated packages:"
  pnpm outdated || true   # exits non-zero when anything is outdated
  echo ""
  echo "⏸️  Held back on purpose (excluded from the pre-push nudge):"
  printf '%s\n' "${HELD_BACK[@]}" | while IFS='|' read -r pkg reason; do
    echo "   - ${pkg}: ${reason}"
  done
  echo ""
  echo "🔒 Vulnerabilities (production deps):"
  pnpm audit --prod || true   # exits non-zero when anything is found
  echo ""
  echo "   ($(baselined_count) of the above are baselined in ${AUDIT_BASELINE} —"
  echo "    no upstream fix exists, so the pre-push nudge ignores them.)"
}

# Advisory ids accepted in the baseline file (strips comments/blanks).
baselined_ids() {
  [ -f "$AUDIT_BASELINE" ] || return 0
  grep -oE "^[0-9]+" "$AUDIT_BASELINE" || true
}

baselined_count() {
  baselined_ids | grep -c . || true
}

# Advisory ids currently reported by pnpm audit --prod.
current_audit_ids() {
  pnpm audit --prod --json 2>/dev/null | node -e "
    let s = ''
    process.stdin.on('data', d => (s += d)).on('end', () => {
      try {
        console.log(Object.keys(JSON.parse(s).advisories || {}).join('\n'))
      } catch {
        // Audit unreachable or output unparseable (offline, registry hiccup).
        // Print nothing: the nudge then reports 0 new advisories rather than
        // crying wolf about an outage it can't distinguish from a real finding.
      }
    })
  " || true
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

# `pnpm outdated` exits non-zero when anything is outdated, so capture its
# output first rather than piping — with `set -o pipefail` a pipeline would
# report failure and trip any `||` fallback on top of the real value.
outdated_raw=$(pnpm outdated 2>/dev/null || true)

# One table row per package; borders/header filtered by requiring a
# package-name-ish first cell. Field 2 of the row is the package name.
outdated=$(printf '%s' "$outdated_raw" \
  | grep -E "^│ [a-z@]" \
  | awk -F'│' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' \
  | sed 's/ (dev)$//' \
  | grep -vxF -f <(held_back_names) \
  | grep -c . || true)

# Only advisories we haven't already accepted. A known-unfixable advisory
# reported every week is noise; a new one is worth interrupting a push for.
new_vulns=$(current_audit_ids | grep -vxF -f <(baselined_ids) | grep -c . || true)

if [ "${outdated:-0}" -gt 0 ] || [ "${new_vulns:-0}" -gt 0 ]; then
  echo ""
  echo "📦 Dependency check: ${outdated:-0} package(s) behind latest, ${new_vulns:-0} new vulnerability(ies)."
  echo "   Run 'pnpm deps:check' for details. (This nudge appears at most every ${STALE_AFTER_DAYS} days.)"
  echo ""
fi

exit 0
