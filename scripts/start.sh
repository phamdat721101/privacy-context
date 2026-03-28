#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building SDK..."
npm run sdk:build

echo "==> Building agent..."
npm run agent:build

echo "==> Building frontend..."
npm run frontend:build

echo "==> Starting agent (port 3001)..."
npm run agent:start &
AGENT_PID=$!

echo "==> Starting frontend (port 3000)..."
npm run frontend:start &
FRONTEND_PID=$!

echo ""
echo "App running:"
echo "  Frontend : http://localhost:3000"
echo "  Agent    : http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop."

trap "echo '==> Stopping...'; kill $AGENT_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
