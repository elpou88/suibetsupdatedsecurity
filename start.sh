#!/bin/bash
set -e

echo "=== SuiBets Startup ==="

# Build the API server
echo "[1/2] Building API server..."
cd /home/runner/workspace/artifacts/api-server
pnpm run build

# Start API server on port 8080 in background
echo "[2/2] Starting API server on port 8080..."
PORT=8080 NODE_ENV=development node --enable-source-maps ./dist/index.mjs &
API_PID=$!

# Give API server a moment to boot
sleep 2

# Start the Vite frontend on port 5000 in foreground
echo "[3/3] Starting Vite frontend on port 5000..."
cd /home/runner/workspace/artifacts/suibets
PORT=5000 BASE_PATH=/ exec pnpm run dev

# If frontend exits, kill API server
kill $API_PID 2>/dev/null || true
