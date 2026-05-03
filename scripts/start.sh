#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SEED=false
for arg in "$@"; do [ "$arg" = "--seed" ] && SEED=true; done

# --- Validate required env ---
check_env() {
  local missing=()
  for var in AGENT_PRIVATE_KEY CONTEXT_MANAGER_ADDRESS MEMORY_STORE_ADDRESS AGENT_REGISTRY_ADDRESS; do
    [ -z "$(grep "^${var}=.\+" packages/agent/.env 2>/dev/null)" ] && missing+=("$var")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: Missing required vars in packages/agent/.env: ${missing[*]}"
    echo "Run: cp .env.example .env && edit with your keys"
    exit 1
  fi
}
check_env

echo "==> Building SDK..."
npm run sdk:build

echo "==> Building agent..."
npm run agent:build

echo "==> Building frontend..."
npm run frontend:build

# --- Optional seed ---
if $SEED; then
  echo "==> Seeding demo data on-chain..."
  npm run demo:seed || echo "WARN: demo:seed had errors (may need DEPLOYER_PRIVATE_KEY in contracts/.env)"
fi

echo "==> Starting agent (port 3001)..."
npm run agent:start &
AGENT_PID=$!

# Wait for agent health
for i in $(seq 1 15); do
  curl -sf http://localhost:3001/health >/dev/null 2>&1 && break
  sleep 1
done

echo "==> Starting frontend (port 3000)..."
npm run frontend:start &
FRONTEND_PID=$!

echo ""
echo "App running:"
echo "  Frontend : http://localhost:3000"
echo "  Agent    : http://localhost:3001"
echo "  Health   : http://localhost:3001/health"
[ "$SEED" = true ] && echo "  Demo data: seeded on-chain"
echo ""
echo "Press Ctrl+C to stop."

trap "echo '==> Stopping...'; kill $AGENT_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
