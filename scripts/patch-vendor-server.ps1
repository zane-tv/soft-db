# ─── Patch Wails vendor files for server mode on Windows ───
# Chạy script này sau mỗi lần `go mod vendor` để fix build -tags server trên Windows
#
# Vấn đề: Wails v3 alpha thiếu `!server` build constraint trên nhiều _windows.go files,
# khiến server mode bị redeclare symbols khi build trên Windows.

$ErrorActionPreference = "Stop"
$base = Join-Path $PSScriptRoot '..\vendor\github.com\wailsapp\wails\v3\pkg\application'

if (-not (Test-Path $base)) {
    Write-Host "❌ Vendor directory not found. Run 'go mod vendor' first." -ForegroundColor Red
    exit 1
}

Write-Host "🔧 Patching Wails vendor files for server mode..." -ForegroundColor Cyan

# Files that need //go:build windows && !server (currently only have //go:build windows)
$filesToPatch = @(
    'clipboard_windows.go',
    'dialogs_windows.go',
    'single_instance_windows.go',
    'systemtray_windows.go',
    'webview_window_windows.go',
    'events_common_windows.go',
    'mainthread_windows.go',
    'keys_windows.go',
    'menuitem_windows.go',
    'screen_windows.go'
)

foreach ($f in $filesToPatch) {
    $path = Join-Path $base $f
    if (Test-Path $path) {
        $content = Get-Content $path -Raw
        if ($content -match '//go:build windows\s*$' -or $content -match '//go:build windows\r?\n') {
            $content = $content -replace '//go:build windows(\r?\n)', '//go:build windows && !server$1'
            Set-Content $path -Value $content -NoNewline
            Write-Host "  ✅ $f" -ForegroundColor Green
        } else {
            Write-Host "  ⏭  $f (already patched or different tag)" -ForegroundColor Gray
        }
    }
}

# File without any build tag (popupmenu_windows.go)
$popup = Join-Path $base 'popupmenu_windows.go'
if (Test-Path $popup) {
    $content = Get-Content $popup -Raw
    if ($content -notmatch '!server') {
        $content = "//go:build windows && !server`n`n" + ($content -replace '^//go:build[^\n]*\n\n?', '')
        Set-Content $popup -Value $content -NoNewline
        Write-Host "  ✅ popupmenu_windows.go" -ForegroundColor Green
    }
}

# Devtools file
$devtools = Join-Path $base 'webview_window_windows_devtools.go'
if (Test-Path $devtools) {
    $content = Get-Content $devtools -Raw
    if ($content -notmatch '!server') {
        $content = $content -replace '//go:build windows && \(!production \|\| devtools\)', '//go:build windows && (!production || devtools) && !server'
        Set-Content $devtools -Value $content -NoNewline
        Write-Host "  ✅ webview_window_windows_devtools.go" -ForegroundColor Green
    }
}

# Add missing AttachModal to BrowserWindow (browser_window.go)
$browserWindow = Join-Path $base 'browser_window.go'
if (Test-Path $browserWindow) {
    $content = Get-Content $browserWindow -Raw
    if ($content -notmatch 'AttachModal') {
        $content = $content -replace 'func \(b \*BrowserWindow\) SetContentProtection\(protection bool\) Window  \{ return b \}', "func (b *BrowserWindow) SetContentProtection(protection bool) Window  { return b }`nfunc (b *BrowserWindow) AttachModal(modalWindow Window)               {}"
        Set-Content $browserWindow -Value $content -NoNewline
        Write-Host "  ✅ browser_window.go (added AttachModal)" -ForegroundColor Green
    }
}

# Add missing attachModal to serverWebviewWindow (application_server.go)
$serverApp = Join-Path $base 'application_server.go'
if (Test-Path $serverApp) {
    $content = Get-Content $serverApp -Raw
    if ($content -notmatch 'attachModal') {
        $content = $content -replace 'func \(w \*serverWebviewWindow\) setContentProtection\(enabled bool\)\s+\{\}', "func (w *serverWebviewWindow) setContentProtection(enabled bool)          {}`nfunc (w *serverWebviewWindow) attachModal(modalWindow *WebviewWindow)      {}"
        Set-Content $serverApp -Value $content -NoNewline
        Write-Host "  ✅ application_server.go (added attachModal)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "✅ Done! Server mode should now build on Windows." -ForegroundColor Cyan
Write-Host "   Test with: go build -tags server -o bin/SoftDB-server.exe ." -ForegroundColor Gray
