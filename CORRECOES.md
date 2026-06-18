# Correções Implementadas - DocSplit AI

## Problemas Identificados e Corrigidos

### 1. Erro na Conversão de PDF para Imagem
**Problema:** O sistema não estava convertendo PDFs escaneados corretamente para o formato que o modelo LLaMA Vision suporta.

**Solução:**
- Substituído o uso de `sharp` (que requer libvips com suporte a PDF no Windows) por `pdfjs-dist` + `canvas`
- Atualizado `src/utils/pdfToImage.ts` para usar `createCanvas` do pacote `canvas`
- Adicionada função `pdfBufferToPngBase64` para conversão de PDFs em base64 PNG

### 2. Servidor Não Encontrado no App Empacotado
**Problema:** O arquivo `server.cjs` e o `.env` não estavam sendo copiados para o diretório `release/win-unpacked/dist`.

**Solução:**
- Copiados manualmente os arquivos `dist/server.cjs` e `dist/server.cjs.map` para `release/win-unpacked/dist/`
- Copiado `.env` para `release/win-unpacked/` e `release/win-unpacked/resources/app/`
- Atualizado o atalho `DocSplit AI.lnk` para apontar corretamente para o executável

### 3. Testes Automatizados
**Solução:**
- Criados testes unitários para conversão de PDF (`tests/pdfToImage.test.ts`)
- Criados testes de fixtures (`tests/fixtures.test.ts`)
- Criados testes de integração do servidor (`tests/server.test.ts`)
- Adicionado script para gerar PDFs de teste (`tests/generate-fixtures.ts`)

### 4. Logs de Depuração
**Solução:**
- Adicionados logs detalhados no `server.ts` para rastrear:
  - Tamanho do base64 recebido
  - Conversão de PDF para PNG
  - Envio para API NVIDIA
  - Resposta da API

## Como Testar

### Teste 1: Executar Testes Automatizados
```bash
npm test
```

**Resultado Esperado:**
- ✓ 6 testes passam (2 de fixtures + 4 de conversão de PDF)
- Mensagens de aviso sobre fontes são normais

### Teste 2: Teste Manual via Frontend
1. Execute o atalho `DocSplit AI.lnk`
2. Aguarde o frontend carregar
3. Faça upload de um PDF (escaneado ou de texto)
4. Clique em "Extrair Dados"
5. Verifique se os dados são extraídos corretamente

**Resultado Esperado:**
- PDF é convertido para imagem
- API NVIDIA retorna JSON com:
  - `isNotaFiscal`: true/false
  - `companyName`: nome da empresa
  - `notaNumber`: número da nota (ou null)
  - `valor`: valor numérico
  - `documentType`: tipo de documento

### Teste 3: Teste via Script PowerShell
```powershell
.\test-extraction.ps1 -PdfPath "tests/fixtures/text.pdf" -BaseUrl "http://localhost:3001"
```

**Pré-requisito:** Servidor rodando com `npm run dev`

**Resultado Esperado:**
- Script exibe dados extraídos do PDF
- Sem erros de conversão

### Teste 4: Teste com PDF Escaneado Real
1. Digitalize um documento (nota fiscal, DARF, etc.) como PDF
2. Execute o app pelo atalho
3. Faça upload do PDF escaneado
4. Verifique a extração

**Resultado Esperado:**
- PDF escaneado é convertido para imagem PNG
- Texto é extraído corretamente pela IA
- JSON retornado contém informações válidas

## Arquivos Modificados

| Arquivo | Alteração |
|---------|-----------|
| `src/utils/pdfToImage.ts` | Reescrito para usar `pdfjs-dist` + `canvas` |
| `server.ts` | Adicionada conversão de PDF e logs de depuração |
| `package.json` | Adicionado `author`, scripts de teste, dependência `canvas` |
| `tests/` | Criados testes automatizados e fixtures |
| `test-extraction.ps1` | Script de teste manual |
| `release/win-unpacked/` | Copiados arquivos do servidor e .env |

## Dependências Adicionadas

```json
{
  "canvas": "^0.35.1",
  "vitest": "^4.1.9"
}
```

## Próximos Passos (Opcionais)

1. **Melhorar ícone do app**: Adicionar um ícone personalizado em `package.json`
2. **Habilitar asar**: Melhorar empacotamento com `asar: true` e `asarUnpack`
3. **Adicionar mais testes**: Testes E2E com Playwright
4. **Otimizar tamanho**: Reduzir tamanho do bundle com code-splitting

## Solução de Problemas Comuns

### "Cannot find module 'canvas'"
```bash
npm install canvas
```

### "NVIDIA_API_KEY not configured"
Verifique se o arquivo `.env` existe em:
- `C:\Users\USUARIO\Documents\Separador de PDF\.env`
- `C:\Users\USUARIO\Documents\Separador de PDF\release\win-unpacked\.env`

### "Server failed to start"
Verifique os logs no console do Electron (DevTools) ou execute:
```bash
npm run dev
```

### Testes falhando com timeout
Aumente o timeout em `vite.config.test.ts`:
```ts
test: {
  timeout: 120000, // 2 minutos
}
```

## Status Atual

✅ Conversão de PDF (escaneado e texto)  
✅ Testes automatizados passando  
✅ Servidor com logs de depuração  
✅ Atalho corrigido  
✅ Arquivos copiados para release  
✅ Suporte a PDFs escaneados por impressora  

🔄 Aguardando teste do usuário com PDFs reais