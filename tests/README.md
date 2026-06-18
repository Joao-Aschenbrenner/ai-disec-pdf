# Testes Automatizados - DocSplit AI

Este diretório contém testes automatizados para validar o funcionamento do sistema de extração de PDFs.

## Como Executar os Testes

### Testes Unitários (Conversão de PDF)
```bash
npm test
```

Executa testes de conversão de PDF para imagem usando `pdfjs-dist` + `canvas`.

### O que os testes verificam:

1. **Conversão de PDF escaneado** - Valida que PDFs escaneados são convertidos para PNG
2. **Conversão de PDF de texto** - Valida que PDFs gerados por texto também funcionam
3. **Conversão base64** - Testa a conversão de base64 PDF para base64 PNG
4. **Tamanho das imagens** - Verifica que as imagens geradas têm tamanho razoável (>1KB)

## Estrutura dos Testes

```
tests/
├── fixtures/           # PDFs de exemplo para testes
│   ├── scanned.pdf    # PDF "escaneado" (simulado)
│   └── text.pdf       # PDF de texto
├── fixtures.test.ts   # Testes dos arquivos fixture
├── pdfToImage.test.ts # Testes de conversão de PDF
├── server.test.ts     # Testes de integração do servidor
└── generate-fixtures.ts # Script para gerar PDFs de teste
```

## Executando Teste Manual do Servidor

Para testar o servidor manualmente:

1. Inicie o servidor em modo de desenvolvimento:
```bash
npm run dev
```

2. Use o frontend em `http://localhost:3001` para upload de PDFs

3. Ou use curl para testar a API diretamente:
```bash
# Converter um PDF para base64 e enviar para a API
$pdf = [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\para\seu\arquivo.pdf"))
$body = @{
    pdfBase64 = $pdf
    originalName = "teste.pdf"
    pageIndex = 0
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/extract" -Method POST -ContentType "application/json" -Body $body
```

## Solução de Problemas

### Erro: "OffscreenCanvas is not defined"
- Certifique-se de que o pacote `canvas` está instalado: `npm install canvas`

### Erro: "Input buffer contains unsupported image format"
- O `sharp` no Windows requer libvips com suporte a PDF
- Use a implementação com `pdfjs-dist` + `canvas` (padrão atual)

### Erro: "NVIDIA_API_KEY não configurada"
- Verifique se o arquivo `.env` existe na raiz do projeto
- Confirme que a chave está correta: `NVIDIA_API_KEY=nvapi-...`

### Testes falhando com PDFs grandes
- Aumente o timeout no `vite.config.test.ts`
- Reduza o número de páginas dos PDFs de teste

## Dependências dos Testes

- `vitest` - Framework de testes
- `canvas` - Renderização de PDF no Node.js
- `pdfjs-dist` - Leitura e renderização de PDF
- `pdf-lib` - Geração de PDFs de teste