$ErrorActionPreference = "Stop"

$Venv = Join-Path $HOME ".ai-disec-pdf\laya\venv"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
  throw "Laya nao instalado. Execute scripts/setup-laya.ps1 ou use Configuracoes > Laya no aplicativo."
}

$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PORT = "8000"
$env:LAYA_DEVICE = if ($env:LAYA_DEVICE) { $env:LAYA_DEVICE } else { "cpu" }
$env:LAYA_PRELOAD = "1"
$env:LAYA_MODELS = "multilingual"
if (-not $env:LAYA_THREADS) {
  $env:LAYA_THREADS = [Math]::Max(1, [int]([Environment]::ProcessorCount / 2))
}

Write-Host "Iniciando Laya multilingual em http://127.0.0.1:8000 ..." -ForegroundColor Cyan
& $Python -m laya.serve
