# Script de Teste Manual - DocSplit AI
# Este script testa a API de extração de PDFs

param(
    [string]$PdfPath = "tests/fixtures/text.pdf",
    [string]$BaseUrl = "http://localhost:3001"
)

Write-Host "=== Teste de Extração de PDF - DocSplit AI ===" -ForegroundColor Cyan
Write-Host ""

# Verifica se o arquivo PDF existe
if (-not (Test-Path $PdfPath)) {
    Write-Host "ERRO: Arquivo PDF não encontrado: $PdfPath" -ForegroundColor Red
    exit 1
}

Write-Host "PDF: $PdfPath" -ForegroundColor Green
Write-Host "URL: $BaseUrl/api/extract" -ForegroundColor Green
Write-Host ""

# Converte PDF para base64
Write-Host "Convertendo PDF para base64..." -ForegroundColor Yellow
$pdfBytes = [IO.File]::ReadAllBytes($PdfPath)
$pdfBase64 = [Convert]::ToBase64String($pdfBytes)
Write-Host "Tamanho do base64: $($pdfBase64.Length) caracteres" -ForegroundColor Gray

# Prepara a requisição
$body = @{
    pdfBase64 = $pdfBase64
    originalName = (Split-Path $PdfPath -Leaf)
    pageIndex = 0
} | ConvertTo-Json -Compress

Write-Host ""
Write-Host "Enviando requisição para a API..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/api/extract" -Method POST -ContentType "application/json" -Body $body
    
    Write-Host ""
    Write-Host "=== RESPOSTA DA API ===" -ForegroundColor Cyan
    
    if ($response.error) {
        Write-Host "ERRO: $($response.error)" -ForegroundColor Red
    } else {
        Write-Host "Sucesso!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Dados extraídos:" -ForegroundColor White
        
        if ($response.isNotaFiscal) {
            Write-Host "  Tipo: NOTA FISCAL" -ForegroundColor Blue
            Write-Host "  Empresa: $($response.companyName)" -ForegroundColor White
            Write-Host "  Número: $($response.notaNumber)" -ForegroundColor White
            Write-Host "  Valor: R$ $($response.valor)" -ForegroundColor Green
        } else {
            Write-Host "  Tipo: $($response.documentType)" -ForegroundColor Blue
            Write-Host "  Empresa/Órgão: $($response.companyName)" -ForegroundColor White
            Write-Host "  Valor: R$ $($response.valor)" -ForegroundColor Green
        }
    }
} catch {
    Write-Host ""
    Write-Host "ERRO na requisição: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        $errBody = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($errBody.error) {
            Write-Host "Detalhes: $($errBody.error)" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "Possíveis causas:" -ForegroundColor Yellow
    Write-Host "  1. O servidor não está rodando em $BaseUrl" -ForegroundColor Gray
    Write-Host "  2. A chave NVIDIA_API_KEY não está configurada" -ForegroundColor Gray
    Write-Host "  3. Problema de conexão com a API NVIDIA" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Fim do Teste ===" -ForegroundColor Cyan