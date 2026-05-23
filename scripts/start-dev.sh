#!/usr/bin/env bash
# start-dev.sh — full-stack dev runner for Fhedin (Arkiv tier included).
#
# What it does:
#   1. Loads .env.local + .env so the api sees the Arkiv-tier vars.
#   2. Pre-flight checks (ARKIV_BACKEND_WALLET present? builds clean? GLM
#      balance available?). Each check is non-blocking — prints a hint and
#      keeps going so a partial setup still boots v2/v3.
#   3. Builds the SDK (api + frontend depend on its dist).
#   4. Starts the api on :3001 with MEMORY_AGENT_ENABLED=true by default.
#   5. Waits for /health, then starts the frontend on :3000.
#   6. Prints a pretty banner with every URL a judge or developer needs.
#   7. Tears both processes down cleanly on Ctrl+C.
#
# Flags:
#   --no-frontend   start api only (legacy behaviour)
#   --no-memory     keep MEMORY_AGENT_ENABLED unset (run plain v3)
#   --no-build      skip the SDK build (faster restart while iterating)
set -euo pipefail
cd "$(dirname "$0")/.."

WANT_FRONTEND=1
WANT_MEMORY=1
WANT_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-frontend) WANT_FRONTEND=0 ;;
    --no-memory)   WANT_MEMORY=0 ;;
    --no-build)    WANT_BUILD=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

# Load env files (both — .env.local wins for any duplicate key)
set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

# ─── Pre-flight ────────────────────────────────────────────────────────────
echo "==> Pre-flight checks"
miss=0

if [ -z "${ARKIV_BACKEND_WALLET:-}" ] || [ -z "${MEMORY_AGENT_WALLET:-}" ] || [ -z "${DEMO_BUYER_WALLET:-}" ]; then
  echo "    [warn] demo wallets missing — run:  npm run gen:demo-wallets"
  miss=1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "    [warn] DATABASE_URL not set — v2/v3 routes (brains, agents, earnings) will 500."
  miss=1
fi

if [ "$miss" -eq 0 ]; then
  echo "    [ok]   wallets and DATABASE_URL look set"
fi

# Optional balance probe — non-blocking, surfaces faucet hints if low.
if command -v curl >/dev/null 2>&1 && [ -n "${ARKIV_BACKEND_WALLET:-}" ]; then
  rpc="${ARKIV_RPC_URL:-https://braga.hoodi.arkiv.network/rpc}"
  resp=$(curl -sS --max-time 5 -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ARKIV_BACKEND_WALLET\",\"latest\"],\"id\":1}" \
    "$rpc" 2>/dev/null || true)
  hex=$(echo "$resp" | sed -E 's/.*"result":"(0x[0-9a-fA-F]+)".*/\1/' | head -c 200)
  if [ -n "$hex" ] && [ "$hex" != "$resp" ]; then
    wei=$(printf '%d' "$hex")
    glm=$(awk -v w="$wei" 'BEGIN{printf "%.4f", w/1e18}')
    echo "    [ok]   GLM balance on Braga: $glm (backend wallet)"
    if awk -v w="$wei" 'BEGIN{exit !(w < 100000000000000000)}'; then  # < 0.1 GLM
      echo "    [hint] low — top up: https://braga.hoodi.arkiv.network/faucet/  (paste $ARKIV_BACKEND_WALLET)"
    fi
  fi
fi

# ─── Build ─────────────────────────────────────────────────────────────────
if [ "$WANT_BUILD" -eq 1 ]; then
  echo ""
  echo "==> Building SDK (api + frontend depend on its dist)"
  npm run sdk:build --silent
fi

# ─── Start api ─────────────────────────────────────────────────────────────
echo ""
if [ "$WANT_MEMORY" -eq 1 ]; then
  echo "==> Starting API (port 3001, MEMORY_AGENT_ENABLED=true)"
  MEMORY_AGENT_ENABLED=true npm run api:dev &
else
  echo "==> Starting API (port 3001, plain v3 mode)"
  npm run api:dev &
fi
API_PID=$!

# Wait for api health (max 30s, log on every retry).
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/health >/dev/null 2>&1; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "    [error] api process died during boot. Check the logs above."
    exit 1
  fi
  sleep 1
done

# ─── Start frontend ────────────────────────────────────────────────────────
FRONTEND_PID=""
if [ "$WANT_FRONTEND" -eq 1 ]; then
  echo "==> Starting frontend (port 3000)"
  npm run frontend:dev &
  FRONTEND_PID=$!
fi

# ─── Banner ────────────────────────────────────────────────────────────────
sleep 1
cat <<EOF

╔════════════════════════════════════════════════════════════════╗
║  Fhedin · full-stack dev mode                                  ║
╠════════════════════════════════════════════════════════════════╣
║  Frontend          http://localhost:3000                       ║
║  Memory feed       http://localhost:3000/memory                ║
║  API               http://localhost:3001                       ║
║  Health            http://localhost:3001/health                ║
║  v4 diagnostic     http://localhost:3001/v4/version            ║
║  OpenAPI agent     http://localhost:3001/openapi.json          ║
╠════════════════════════════════════════════════════════════════╣
║  Arkiv block expl. https://explorer.braga.hoodi.arkiv.network  ║
║  Arkiv data expl.  https://data.arkiv.network                  ║
║  Faucet (GLM)      https://braga.hoodi.arkiv.network/faucet/   ║
╠════════════════════════════════════════════════════════════════╣
║  Try               npm run smoke:arkiv      (ARKIV_LIVE=1)     ║
║                    npm run demo:arkiv-memory-market            ║
╚════════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop.
EOF

trap 'echo ""; echo "==> Stopping..."; kill ${API_PID} ${FRONTEND_PID} 2>/dev/null; wait 2>/dev/null; exit 0' INT TERM
wait
