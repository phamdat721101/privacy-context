#!/usr/bin/env bash
# run-all-smokes.sh — offline regression gate for the Sui-removal relaunch.
#
# WHAT THIS RUNS:
#   1. runtime-utils + sdk + ui + openx-mcp + api builds (tsc green)
#   2. SDK cognitive smoke (53 assertions — L4 + L5 in-memory tests)
#   3. Workflow runner smoke (auth + dispatch)
#   4. Marketing 7-step workflow smoke
#   5. Translator e2e smoke (lighthouse demo) — requires API_URL set
#
# WHAT THIS DOES NOT RUN (require live infra; invoke locally with creds):
#   - smoke:auth / smoke:x402
#   - smoke:marketplace-seller-flow / smoke:marketplace-seller-first
#
# Exits non-zero on any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

color_red='\033[0;31m'
color_green='\033[0;32m'
color_yellow='\033[0;33m'
color_reset='\033[0m'

step() { printf "\n${color_yellow}▶ %s${color_reset}\n" "$1"; }
ok()   { printf "${color_green}✅ %s${color_reset}\n" "$1"; }
fail() { printf "${color_red}❌ %s${color_reset}\n" "$1"; exit 1; }

# ─── 1. Builds ────────────────────────────────────────────────────────────
step "Build runtime-utils + sdk + ui + openx-mcp + api"
npm run runtime-utils:build > /dev/null
npm run sdk:build           > /dev/null
npm run ui:build            > /dev/null
npm run openx-mcp:build     > /dev/null
npm run api:build           > /dev/null
ok "all packages build green"

# ─── 2. SDK / runner smokes ───────────────────────────────────────────────
step "SDK cognitive smoke (L4 + L5)"
npm run smoke:cognitive-l4-l5 > /tmp/smoke1.log 2>&1 || fail "cognitive-l4-l5 smoke"
ok "$(grep 'passed,' /tmp/smoke1.log | tail -1)"

step "Workflow runner smoke"
npm run smoke:workflow-runner > /tmp/smoke2.log 2>&1 || fail "workflow-runner smoke"
ok "$(grep 'passed,' /tmp/smoke2.log | tail -1)"

step "Marketing 7-step workflow smoke"
npm run smoke:marketing-workflow > /tmp/smoke3.log 2>&1 || fail "marketing-workflow smoke"
ok "$(grep 'passed,' /tmp/smoke3.log | tail -1)"

# ─── 3. Translator lighthouse smoke ──────────────────────────────────────
if [ -n "${API_URL:-}" ]; then
  step "Translator lighthouse e2e (against ${API_URL})"
  npm run smoke:translator-e2e > /tmp/smoke4.log 2>&1 || fail "translator-e2e smoke"
  ok "translator e2e passed"

  step "PRD-E workspace e2e (uploads + recent-calls + try)"
  npm run smoke:workspace-e2e > /tmp/smoke5.log 2>&1 || fail "workspace-e2e smoke"
  ok "workspace e2e passed"
else
  printf "${color_yellow}⚠  API_URL not set — skipping translator-e2e + workspace-e2e (set API_URL to run)${color_reset}\n"
fi

# ─── 4. Existing-smoke registry (informational only) ──────────────────────
step "Existing smokes (run locally with credentials):"
cat <<EOF
   • smoke:auth                       (wallet + token roundtrip)
   • smoke:marketplace-seller-flow    (publish → list → discover → 402)
   • smoke:marketplace-seller-first   (multi-agent publish + workflow listing)
   • smoke:x402                       (multi-rail payment)
EOF

printf "\n${color_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${color_reset}\n"
printf "${color_green}✅ ALL OFFLINE REGRESSION CHECKS PASS${color_reset}\n"
printf "${color_green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${color_reset}\n"
