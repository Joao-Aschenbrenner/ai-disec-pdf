<div align="center">

# AI Disec PDF

**Separador inteligente de PDFs escaneados com classificação assistida por Laya**

</div>

Aplicação desktop em Electron + React para dividir, identificar, revisar e renomear documentos escaneados. A Classification V2 foi desenhada para funcionar mesmo quando o modelo visual é simples: o VLM lê campos/evidências, regras locais identificam assinaturas fortes e o Laya atua como segunda opinião para os casos ambíguos.

## Classification V2

```text
PDF / página escaneada
        ↓
VLM: somente leitura de texto + extração de campos
        ↓
DocumentSignatures / hard guards
        ↓
Laya local (quando necessário e disponível)
        ↓
DocumentRouter
        ↓
extratores / validação
        ↓
SafeFilenameBuilder
        ↓
revisão manual quando a confiança não é suficiente
```

O modelo visual **não é mais autoridade final para documentType**. Isso evita que uma NFS-e ou DANFE seja transformada em folha de pagamento apenas porque o modelo interpretou palavras isoladas.

### Classes iniciais

- NFS / NFS-e
- NF-e / DANFE
- Holerite mensal
- Holerite de 13º
- Relatório de folha
- Relatório de 13º
- DARF
- Guia ISS
- Guia INSS
- Extrato de conta corrente
- Extrato de investimentos
- TED / transferência
- Conta de energia
- Planilha / prestação consolidada
- Outro / revisão

## Laya

Laya é opcional e roda localmente. Sem ele, o aplicativo continua usando signatures + fallback controlado.

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-laya.ps1
powershell -ExecutionPolicy Bypass -File scripts/start-laya.ps1
```

Health:

```text
http://127.0.0.1:8000/health
```

O DocSplit consulta o Laya em `POST /v1/systemone`. O Laya recebe **texto/evidências**, não a imagem da página.

Detalhes: [CLASSIFICATION_V2.md](CLASSIFICATION_V2.md).

## Nomes de arquivo seguros

A Classification V2 usa rótulos curtos:

```text
NFS_7225_CLINICA_MONTEIRO_1700.00.pdf
NFE_134364_JVD_1440.30.pdf
HOL_JOAO_SILVA.pdf
13S_MARIA_SOUZA.pdf
DARF_0561_6550.69.pdf
EXTINV_2025-12.pdf
```

O nome final é limitado a **80 caracteres**. Entidades longas são encurtadas e, quando necessário, o final recebe um hash curto determinístico.

## Provedores

| Provedor | Papel atual |
|---|---|
| NVIDIA | GLM-5.3-Flash padrão; Nemotron Omni no tier preciso |
| Google | Gemini 2.5 Flash |
| OpenAI | GPT-4o |
| Anthropic | Claude Sonnet |
| OpenRouter | modelos compatíveis configurados no catálogo |
| Groq | Qwen 3.8 27B multimodal |
| Ollama Local | opção offline |
| Ollama Cloud | opção cloud |
| Codex | integração existente |
| Mistral | backend legado/opcional; removido do caminho principal da UI |

Os IDs ficam em `server/models.json` e podem ser revisados pelo atualizador do catálogo.

## Privacidade

Split, ZIP, regras de assinatura, roteamento e Laya podem rodar localmente. Quando um provedor cloud é escolhido, a imagem da página é enviada à API desse provedor para leitura/extração. Consulte [legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md).

## Desenvolvimento

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

## Desktop

```bash
npm run electron:dev
npm run electron:build
```

## Estrutura relevante

```text
server/
  classification/
    documentTaxonomy.ts
    documentSignatures.ts
    documentRouter.ts
    extractionPrompt.ts
    layaClient.ts
  server.ts
  models.json

src/
  App.tsx
  types.ts
  utils/fileHelpers.ts

scripts/
  setup-laya.ps1
  start-laya.ps1

tests/
  classification-v2.test.ts
```

## Regra de release

Uma versão nova só deve ser criada depois de:

1. `npm run lint`
2. `npm test`
3. `npm run build`
4. auditoria local no Windows/Electron
5. teste com PDF real
6. validação de nomes <= 80 caracteres
7. validação do instalador NSIS

Não fazer bump/tag/release antes desse gate.

## Licença

MIT.
