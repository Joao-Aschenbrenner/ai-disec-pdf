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
- páginas físicas com dois holerites geram dois PDFs independentes (top/bottom);\n- página com apenas um holerite não sofre split falso-positivo;
- extrato de investimentos é separado de extrato de conta;
- nomes finais têm no máximo 80 caracteres;\n- nomes duplicados dentro do ZIP recebem sufixo e não sobrescrevem o arquivo anterior;
- nenhum nome contém caracteres inválidos do Windows.

## 5. Modelos

Smoke test mínimo:

- NVIDIA medium => `z-ai/glm-5-3-flash`;
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
