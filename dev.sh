#!/bin/bash
# ─── SoftDB Dev Runner ───
# Chạy app ở chế độ development với hot-reload

set -e

export PATH="$HOME/go/bin:$PATH"
VITE_PORT="${VITE_PORT:-9245}"

echo "🚀 Starting SoftDB in dev mode..."
echo "   Vite port: $VITE_PORT"
echo ""

wails3 dev -config ./build/config.yml -port "$VITE_PORT"
