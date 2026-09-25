# Release Report — AI Disec PDF

## Auditoria do PR #1 — 25/09/2026

A auditoria foi executada sobre a branch `feat/classification-v2-laya`. O resultado atual é **REJECT**: há smoke tests de providers em `FAIL` e gates manuais em `NOT_RUN`. Portanto, não houve merge, bump para `1.9.0`, tag ou release.

## Gates automatizados

| Gate | Resultado | Evidência |
|---|---|---|
| TypeScript | PASS | `npm run lint` / `tsc --noEmit` |
| Testes | PASS | 14 arquivos, 477 testes |
| Build | PASS | `npm run build` |
| Dependências runtime | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilidades |
| Segurança | FAIL (cobertura) | scan selado `scan-2026-09-25T20-09-33.859Z-11839d8889cb` retornou `findingCount: 0`, mas o hook reportou `library_source_limit_exceeded`/`callgraph_fact_partial` |
| Catálogo | PASS | IDs multimodais atuais e fail-safe do updater cobertos por testes |

## Electron e instalador

- `npm run electron:dev`: **PASS** após o launcher iniciar o servidor e aguardar a porta 3001.
- Executável empacotado: **PASS**; processo vivo por 10 segundos e `GET /api/models` retornando HTTP 200.
- NSIS: **PASS**; instalação isolada código 0 em `%TEMP%\\ai-disec-pdf-gate-20260925`.
- Desinstalação NSIS: **PASS**; código 0 e nenhum arquivo remanescente no diretório temporário.
- Artefatos gerados ainda são da versão `1.8.1`: `.exe`, `.blockmap` e `latest.yml`.
- Auto-update: **NOT_RUN**; não existe release `v1.9.0` publicada para testar o canal.

## Classification V2 e Laya

- Hard guards DANFE, NFS-e, DARF, FOPAG, holerite, 13º e roteamento local: **PASS** nos testes.
- Split físico top/bottom com PDFs independentes: **PASS** nos testes e na calibração golden.
- Nomes Windows-safe, limite de 80 caracteres e colisões no ZIP: **PASS**.
- Renderização de PDF real para PNG: **PASS** no teste de renderização; os PDFs reais fornecidos pelo usuário não foram processados nesta execução (**NOT_RUN**) e não foram adicionados ao Git.
- Laya health, inferência, stop/restart e ausência de processo órfão: **PASS**.
- Instalação completa pela UI e auto-start pela UI: **NOT_RUN** nesta execução.
- Badge `Revisar` e override manual: **PASS** nos testes/validação anteriores.

## Smoke tests de providers

- NVIDIA GLM `z-ai/glm-5.3-flash`: **FAIL**; excedeu 60 segundos.
- NVIDIA Nemotron `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`: **FAIL**; respondeu `503 ResourceExhausted` por limite de workers do provedor.
- Groq Qwen: **NOT_RUN**; nenhuma chave Groq presente.
- Mistral: **NOT_RUN**; nenhuma chave Mistral presente.
- OpenRouter: **NOT_RUN**; nenhuma chave OpenRouter presente.

A disponibilidade dos IDs no catálogo público foi verificada, mas isso não substitui um smoke autenticado bem-sucedido.

## Privacidade

A política foi atualizada para distinguir o processamento local do modo cloud: split, ZIP, regras locais, Ollama Local e Laya local permanecem na máquina; no modo cloud, a imagem da página e o prompt de extração são enviados diretamente ao provider selecionado. As configurações e chaves ficam em `~/.ai-disec-pdf/settings.json`.

## Decisão

```text
LINT=PASS
TESTS=PASS (477)
BUILD=PASS
DEPENDENCY_AUDIT=PASS (0)
SECURITY_SCAN=FAIL (coverage incomplete; sealed scan reported 0 findings)
ELECTRON_RUNTIME=PASS
NSIS_INSTALL=PASS
NSIS_UNINSTALL=PASS
REAL_PDF=NOT_RUN
LAYA_INSTALL_UI=NOT_RUN
LAYA_AUTOSTART=NOT_RUN
GLM_SMOKE=FAIL
NEMOTRON_SMOKE=FAIL
GROQ_SMOKE=NOT_RUN
MISTRAL_SMOKE=NOT_RUN
OPENROUTER_SMOKE=NOT_RUN
AUTO_UPDATE=NOT_RUN
FINAL=REJECT
```

A regra permanece: enquanto houver qualquer `FAIL` ou `NOT_RUN`, não fazer merge, tag ou release.
