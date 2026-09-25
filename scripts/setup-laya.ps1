$ErrorActionPreference = "Stop"

$LayaHome = Join-Path $HOME ".ai-disec-pdf\laya"
$Venv = Join-Path $LayaHome "venv"
$Python = Join-Path $Venv "Scripts\python.exe"

Write-Host "DocSplit AI - preparando Laya local isolado..." -ForegroundColor Cyan

if (-not (Test-Path $LayaHome)) {
  New-Item -ItemType Directory -Force -Path $LayaHome | Out-Null
}

if (-not (Test-Path $Python)) {
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    & py -3.11 -m venv $Venv
    if ($LASTEXITCODE -ne 0) {
      & py -3 -m venv $Venv
    }
  } else {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $systemPython) {
      throw "Python 3.10+ nao encontrado. Instale Python 3.11 antes de continuar."
    }
    & python -m venv $Venv
  }
}

if (-not (Test-Path $Python)) {
  throw "Nao foi possivel criar o ambiente virtual do Laya."
}

& $Python -m pip install --upgrade pip
& $Python -m pip install "laya[serve]==0.3.20"

Write-Host ""
Write-Host "Laya instalado em $Venv" -ForegroundColor Green
Write-Host "Para iniciar: powershell -ExecutionPolicy Bypass -File scripts/start-laya.ps1"
Write-Host "Health esperado: http://127.0.0.1:8000/health"
