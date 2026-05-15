#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "==> Starting API (port 3001)..."
npm run api:dev &
API_PID=$!

sleep 2
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   FHE Second Brain — Dev Mode       ║"
echo "╠══════════════════════════════════════╣"
echo "║  API:      http://localhost:3001     ║"
echo "║  Health:   http://localhost:3001/health"
echo "║  DB:       Supabase (remote)         ║"
echo "╠══════════════════════════════════════╣"
echo "║  Frontend: npm run frontend:dev      ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $API_PID 2>/dev/null" EXIT INT TERM
wait
