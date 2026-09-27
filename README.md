<div align="center">

# AI Disec PDF

**Separador inteligente de PDFs escaneados com classificação assistida por Laya**

</div>

Aplicação desktop em Electron + React para dividir, identificar, revisar e renomear documentos escaneados. A Classification V3 usa três passagens: texto local + Laya, contexto entre páginas e validação pós-visão. O VLM lê a imagem e extrai campos; não é autoridade final de classe.

## Classification V3

```text
PDF
 ↓
texto local quando existir
 ↓
Signatures + Laya + memória confirmada
 ↓
SequenceResolver (anterior / atual / próxima)
 ↓
VLM apenas para leitura/extração visual
 ↓
router V3 + Laya novamente
 ↓
SequenceResolver pós-visão
 ↓
SafeFilenameBuilder
```

O Laya é obrigatório para iniciar o processamento V3. Páginas com texto embutido passam por ele na primeira passagem; páginas scan-only passam após o VLM produzir `classificationText`.

A UI mostra por página:

- etapa atual e barra de progresso;
- classe fina;
- fonte;
- confiança;
- `Laya ✓` quando a página foi validada pelo Laya;
- `Revisar` quando ainda exige confirmação.

Páginas de continuação de extrato/folha são avaliadas usando anterior e próxima. Holerites empilhados usam detecção do separador real em vez de corte fixo 50/50.

Correções confirmadas podem entrar no Learning Store local por **Confirmar e aprender**. Não existe fine-tuning automático silencioso.

Detalhes: [CLASSIFICATION_V3.md](CLASSIFICATION_V3.md).

A arquitetura anterior permanece documentada em [CLASSIFICATION_V2.md](CLASSIFICATION_V2.md).

## Laya

No Classification V3, o Laya é requisito do processamento e roda localmente. No desktop, abra **Configurações > Laya local** para instalar/iniciar. O Electron cria uma venv isolada em `~/.ai-disec-pdf/laya/venv` e tenta fazer auto-start nas execuções seguintes.

Health: `http://127.0.0.1:8000/health`.

O Laya recebe texto/evidências, não a imagem da página. A porcentagem dele é confiança bruta do classificador, não probabilidade calibrada.

## Nomes de arquivo seguros

A Classification V3 preserva os rótulos curtos e nomes Windows-safe:

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
    v3Router.ts
    sequenceResolver.ts
    learningStore.ts
    extractionPrompt.ts
    layaClient.ts
  server.ts
  models.json

src/
  App.tsx
  types.ts
  utils/fileHelpers.ts
  utils/pdfLocalText.ts
  utils/pageSegmenter.ts

scripts/
  setup-laya.ps1
  start-laya.ps1

tests/
  classification-v2.test.ts
  classification-v3.test.ts
  classification-v3-wiring.test.ts
```

## Regra de release

Uma versão nova só deve ser criada depois de:

1. `npm run lint`
2. `npm test`
3. `npm run build`
4. auditoria local em LOCAL_AUDIT_CLASSIFICATION_V3.md
5. teste com PDF real
6. validação de nomes <= 80 caracteres
7. validação do instalador NSIS

Não fazer bump/tag/release antes desse gate.

## Licença

MIT.
