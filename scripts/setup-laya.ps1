$ErrorActionPreference = "Stop"

Write-Host "DocSplit AI - instalando Laya local..." -ForegroundColor Cyan

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  throw "Python 3.10+ nao encontrado no PATH."
}

python -m pip install --upgrade pip
python -m pip install "laya[serve]"

Write-Host ""
Write-Host "Laya instalado." -ForegroundColor Green
Write-Host "Para iniciar: powershell -ExecutionPolicy Bypass -File scripts/start-laya.ps1"
Write-Host "Health esperado: http://127.0.0.1:8000/health"
