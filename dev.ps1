# ─── SoftDB Dev Runner (Windows) ───
# Chạy app ở chế độ development với hot-reload

$ErrorActionPreference = "Stop"

# Ensure GOPATH/bin is in PATH
$gopath = & go env GOPATH
$goBin = Join-Path $gopath "bin"
if ($env:PATH -notlike "*$goBin*") {
    $env:PATH = "$goBin;$env:PATH"
}

$VitePort = if ($env:VITE_PORT) { $env:VITE_PORT } else { "9245" }

Write-Host "🚀 Starting SoftDB in dev mode..." -ForegroundColor Cyan
Write-Host "   Vite port: $VitePort" -ForegroundColor Gray
Write-Host ""

wails3 dev -config ./build/config.yml -port $VitePort
