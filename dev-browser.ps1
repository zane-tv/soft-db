# ─── SoftDB Browser Dev Runner ───
# Chạy Go backend (server mode) + Vite frontend song song
# Mở http://localhost:9245 trên trình duyệt để dev UI
# Proxy /wails/* sẽ tự forward sang Go backend port 8080

$ErrorActionPreference = "Stop"

# Ensure GOPATH/bin is in PATH
$gopath = & go env GOPATH
$goBin = Join-Path $gopath "bin"
if ($env:PATH -notlike "*$goBin*") {
    $env:PATH = "$goBin;$env:PATH"
}

$BackendPort = if ($env:WAILS_SERVER_PORT) { $env:WAILS_SERVER_PORT } else { "8080" }
$VitePort = if ($env:VITE_PORT) { $env:VITE_PORT } else { "9245" }

Write-Host "🌐 Starting SoftDB in BROWSER dev mode..." -ForegroundColor Cyan
Write-Host "   Go backend (server mode):  http://localhost:$BackendPort" -ForegroundColor Gray
Write-Host "   Vite frontend:             http://localhost:$VitePort" -ForegroundColor Gray
Write-Host "   Open browser at:           http://localhost:$VitePort" -ForegroundColor Green
Write-Host ""

# Step 1: Build frontend + generate bindings
Write-Host "📦 Building frontend..." -ForegroundColor Yellow
Push-Location frontend
bun install
Pop-Location

# Step 2: Build Go server mode binary
Write-Host "🔨 Building Go server..." -ForegroundColor Yellow
go build -tags server -o bin/SoftDB-server.exe .

# Step 3: Start Go backend in background
Write-Host "🚀 Starting Go backend..." -ForegroundColor Yellow
$env:WAILS_SERVER_PORT = $BackendPort
$backend = Start-Process -FilePath ".\bin\SoftDB-server.exe" -PassThru -NoNewWindow

# Step 4: Start Vite dev server
Write-Host "⚡ Starting Vite dev server..." -ForegroundColor Yellow
try {
    Push-Location frontend
    bun run dev -- --port $VitePort --strictPort
}
finally {
    # Cleanup: kill backend when Vite is stopped
    Write-Host "`n🛑 Stopping backend..." -ForegroundColor Red
    if ($backend -and !$backend.HasExited) {
        Stop-Process -Id $backend.Id -Force
    }
    Pop-Location
}
