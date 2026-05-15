#!/bin/bash
set -e

echo "==> FHE Second Brain — Production Deploy"

# Pull latest
git pull origin main 2>/dev/null || true

# Build all containers
echo "==> Building..."
docker compose build --parallel

# Start everything
echo "==> Starting services..."
docker compose up -d --remove-orphans

# Health check
echo "==> Checking health..."
sleep 5
if curl -sf http://localhost:3001/health >/dev/null; then
  echo "✓ API healthy"
else
  echo "✗ API not ready — check logs: docker compose logs api"
fi

echo ""
echo "Services running:"
echo "  API:    http://localhost:3001"
echo "  Worker: running (background)"
echo "  Redis:  localhost:6379"
echo "  PG:     localhost:5432"
echo "  Caddy:  :80/:443"
echo ""
echo "Logs: docker compose logs -f"
