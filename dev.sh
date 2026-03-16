#!/bin/bash
# ─── SoftDB Dev Runner ───
# Chạy app ở chế độ development với hot-reload
# Cross-platform: dùng dev.ps1 trên Windows, dev.sh trên Linux/macOS

set -e

# Detect OS and run appropriate script
if [[ "$OS" == "Windows_NT" ]] || [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS* ]]; then
    echo "⚠️  Detected Windows. Please run: powershell -File dev.ps1"
    echo "   Or use: wails3 dev -config ./build/config.yml -port 9245"
    exit 1
fi

export PATH="$HOME/go/bin:$PATH"
VITE_PORT="${VITE_PORT:-9245}"

echo "🚀 Starting SoftDB in dev mode..."
echo "   Vite port: $VITE_PORT"
echo ""

wails3 dev -config ./build/config.yml -port "$VITE_PORT"
