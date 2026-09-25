# LOCAL AUDIT GATE — CLASSIFICATION V2

> Este PR NÃO deve ser mergeado nem publicado antes desta auditoria.

## 1. Preparar branch

```powershell
git fetch origin
git checkout feat/classification-v2-laya
git pull
npm ci
```

## 2. Gates automáticos

```powershell
npm run lint
npm test
npm run build
```

Todos devem encerrar com exit code 0.

## 3. Laya

No app, abrir **Configurações > Laya local**.

Validar o fluxo completo:

1. estado inicial correto (`não instalado`, `parado`, `iniciando` ou `ativo`);
2. se necessário, clicar **Instalar Laya** e confirmar criação da venv isolada;
3. clicar **Iniciar Laya**;
4. fechar/reabrir o app e confirmar auto-start quando já instalado;
5. clicar **Parar Laya** e confirmar que o app continua funcionando sem ele.

Também validar:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://localhost:3001/api/classification/health
```

O health deve ser realmente do Laya (`status=ok`) e o segundo endpoint deve informar `classification-v2`. Com Laya desligado, casos fracos precisam continuar processando e aparecer como **Revisar**, não como sucesso silencioso.

## 4. PDF real local

Usar localmente `custeio-municipal-12-25okokok.pdf`. NÃO adicionar o PDF ao Git.

Comparar com:

`tests/golden/classification-v2-local-spec.json`

Validar especialmente:

- páginas de NFS-e nunca viram folha;
- DANFE nunca vira folha;
- DARF nunca vira folha;
- relatório de folha não vira holerite individual;
- holerite e 13º são distinguidos;
- páginas físicas com dois holerites geram dois PDFs independentes (top/bottom);
- página com apenas um holerite não sofre split falso-positivo;
- extrato de investimentos é separado de extrato de conta;
- nomes finais têm no máximo 80 caracteres;
- nomes duplicados dentro do ZIP recebem sufixo e não sobrescrevem o arquivo anterior;
- nenhum nome contém caracteres inválidos do Windows.

## 5. Modelos

Smoke test mínimo:

- NVIDIA medium => `z-ai/glm-5.3-flash`;
- NVIDIA precise => `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`;
- Groq => `qwen/qwen3.8-27b`.

Não gastar créditos em lote. Fazer 1–3 páginas por provider. O teste completo de 129 páginas deve usar o provider disponível/permitido ou mocks quando o objetivo for performance.

## 6. Electron

```powershell
npm run electron:build
```

Validar:

- app abre sem terminal;
- processamento não congela a UI;
- ZIP é criado;
- nomes <= 80 caracteres;
- reprocessamento funciona;
- fechamento não deixa processo órfão.

## 7. Resultado da auditoria

Publicar comentário no PR com:

```text
LOCAL_CLASSIFICATION_V2_AUDIT

LINT=PASS|FAIL
TESTS=PASS|FAIL
BUILD=PASS|FAIL
LAYA_HEALTH=PASS|FAIL
LAYA_INSTALL_UI=PASS|FAIL
LAYA_AUTOSTART=PASS|FAIL
REVIEW_BADGE=PASS|FAIL
ELECTRON=PASS|FAIL
REAL_PDF=PASS|FAIL
TWO_DOC_SPLIT=PASS|FAIL
SAFE_FILENAMES=PASS|FAIL
ZIP_COLLISION=PASS|FAIL
GLM_SMOKE=PASS|FAIL
GROQ_SMOKE=PASS|FAIL

TEST_COUNT=<n>
FAILURES=<n>
NOTES=<...>
FINAL=APPROVE|REJECT
```

## 8. Nova versão

Somente com `FINAL=APPROVE`:

1. corrigir qualquer achado;
2. alterar versão de `1.8.1` para `1.9.0`;
3. rodar novamente lint + tests + build;
4. gerar NSIS;
5. atualizar RELEASE_REPORT;
6. mergear PR;
7. criar tag `v1.9.0`;
8. publicar release para o auto-updater.

Se qualquer gate falhar, não criar tag nem release.

## 9. Resultado executado em 25/09/2026

Evidências executadas nesta auditoria:

- `npm run lint`: **PASS** (`tsc --noEmit`).
- `npm test -- --reporter=dot`: **PASS**, 14 arquivos e 477 testes.
- `npm run build`: **PASS** (Vite + dois bundles esbuild).
- `npm audit --omit=dev --audit-level=moderate`: **PASS**, 0 vulnerabilidades.
- auditoria de segurança profunda selada: **FAIL (cobertura)** para o gate de promoção; o scan `scan-2026-09-25T20-09-33.859Z-11839d8889cb` encontrou `findingCount: 0` em 546 pacotes e 0 advisories offline correspondentes, com selo SHA-256 válido, mas o hook registrou `library_source_limit_exceeded`/`callgraph_fact_partial`.
- `npm run electron:dev`: **PASS** após o launcher iniciar o servidor e aguardar a porta 3001.
- executável empacotado: **PASS**, processo vivo por 10 s e `GET /api/models` HTTP 200.
- NSIS: **PASS**, instalação isolada código 0 e desinstalação isolada código 0, sem arquivos remanescentes.
- hard guards, split físico, nomes seguros e colisões ZIP: **PASS** pelos testes automatizados e calibração golden.
- Laya health/inferência/restart/stop: **PASS**; instalação pela UI completa e auto-start pela UI não foram repetidos nesta execução (**NOT_RUN**).
- processamento dos PDFs reais fornecidos pelo usuário nesta execução: **NOT_RUN**; os PDFs reais não foram adicionados ao Git.
- smoke NVIDIA GLM: **FAIL**, excedeu 60 s.
- smoke NVIDIA Nemotron: **FAIL**, `503 ResourceExhausted` por limite de workers do provedor.
- smoke Groq, Mistral e OpenRouter: **NOT_RUN**, nenhuma chave presente no ambiente.
- auto-update: **NOT_RUN**, não existe release `v1.9.0` publicada para exercitar o canal.

### Matriz de decisão

```text
LINT=PASS
TESTS=PASS (477)
BUILD=PASS
DEPENDENCY_AUDIT=PASS (0)
SECURITY_SCAN=FAIL (coverage incomplete; sealed scan reported 0 findings)
LAYA_HEALTH=PASS
LAYA_INSTALL_UI=NOT_RUN
LAYA_AUTOSTART=NOT_RUN
REVIEW_BADGE=PASS (testes/UI anteriores)
ELECTRON_RUNTIME=PASS
NSIS_INSTALL=PASS
NSIS_UNINSTALL=PASS
REAL_PDF=NOT_RUN
TWO_DOC_SPLIT=PASS
HARD_GUARDS=PASS
SAFE_FILENAMES=PASS
ZIP_COLLISION=PASS
GLM_SMOKE=FAIL
NEMOTRON_SMOKE=FAIL
GROQ_SMOKE=NOT_RUN
MISTRAL_SMOKE=NOT_RUN
OPENROUTER_SMOKE=NOT_RUN
AUTO_UPDATE=NOT_RUN
FINAL=REJECT
```

Enquanto existir qualquer `FAIL` ou `NOT_RUN` acima, o PR não deve ser mergeado, a versão não deve ser alterada para `1.9.0`, e não devem ser criadas tag ou release.
