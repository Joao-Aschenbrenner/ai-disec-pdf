$ErrorActionPreference = "Stop"

$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PORT = "8000"
$env:LAYA_DEVICE = if ($env:LAYA_DEVICE) { $env:LAYA_DEVICE } else { "auto" }
$env:LAYA_PRELOAD = if ($env:LAYA_PRELOAD) { $env:LAYA_PRELOAD } else { "1" }

Write-Host "Iniciando Laya em http://127.0.0.1:8000 ..." -ForegroundColor Cyan
laya-serve
