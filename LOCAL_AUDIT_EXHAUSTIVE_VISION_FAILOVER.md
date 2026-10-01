# LOCAL AUDIT — Exhaustive Vision Failover

Branch: `fix/exhaustive-vision-failover`
Base: `master` / v1.11.1

NÃO fazer merge, bump, tag ou release nesta rodada.

## Objetivo

Validar a regra correta de estabilização:

```text
página atual falhou no modelo A
→ NÃO avança páginas novas
→ tenta modelo Vision B na MESMA página
→ se falhar, tenta C
→ D
→ ...
→ até um funcionar
→ só então libera a fila
```

Somente se TODOS os candidatos Vision disponíveis do provider falharem naquela página:

```text
modelExhausted=true
→ pipeline halted
→ páginas restantes permanecem waiting/pending
→ usuário pode Re-tentar ou trocar provider/chave
```

## Exceções

### Chave realmente inválida

```text
401
ou erro explícito de invalid API key/token
→ NÃO percorrer modelos
→ retry=0
→ rotation=0
→ parar e pedir credencial válida
```

### 403 específico de modelo

```text
403 "no access to this model"
→ é falha do candidato
→ tenta próximo Vision
```

### 429

```text
rate limit/quota
→ NÃO troca modelo
→ respeita Retry-After
→ mantém a página atual
→ no máximo 3 tentativas no mesmo candidato nesta rodada
```

## 1. Head e limpeza

```powershell
git fetch origin
git checkout fix/exhaustive-vision-failover
git pull origin fix/exhaustive-vision-failover
git rev-parse HEAD
git status
```

Registre o HEAD real.

## 2. Gates automáticos

```powershell
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev
npm run electron:build
```

Esperado:

```text
LINT=PASS
TESTS=PASS
FAILURES=0
BUILD=PASS
NPM_AUDIT=PASS
ELECTRON_BUILD=PASS
```

Integração cloud real continua opt-in.

## 3. Teste crítico — mais de 3 modelos

O antigo limite total de 3 tentativas NÃO pode existir para failover de modelos.

Mocke 8 candidatos Vision:

```text
A fail
B fail
C fail
D fail
E fail
F success
G
H
```

Na MESMA página.

Esperado:

```text
ATTEMPTS=6
ROTATIONS=5
FINAL=success
pipeline.halted=false
```

Isto prova que não parou após 3 tentativas.

## 4. Exaustão real

Mocke N modelos Vision, todos falhando.

Esperado:

- cada modelo é tentado no máximo uma vez pela página;
- nenhum modelo texto-only entra;
- antes do último, respostas têm `modelRotated=true`;
- depois que o último falha:
  - `modelExhausted=true`;
  - `retryable=false`;
  - `modelsTried=N`;
  - `modelsRemaining=0`;
  - pipeline fica halted;
  - fila não avança.

Registrar:

```text
ALL_VISION_MODELS_TRIED=
UNIQUE_MODELS_TRIED=
MODEL_EXHAUSTED_ONLY_AT_END=
```

## 5. Modelos ao vivo da API

Quando `/models` do provider funciona:

- usar somente candidatos Vision retornados AO VIVO;
- não acrescentar modelos antigos do catálogo versionado;
- metadata explícita image/vision vence heurística de nome.

O catálogo versionado só pode ser fallback se descoberta live falhar/vier vazia.

Registrar:

```text
LIVE_ONLY_WHEN_AVAILABLE=
TEXT_ONLY_EXCLUDED=
CATALOG_FALLBACK_ONLY=
```

## 6. Mesma página

Em todas as rotações, validar que:

```text
runtimePageId permanece o mesmo
pageIndex permanece o mesmo
PDF/image é da mesma página
```

A página não pode ser marcada como failed entre A→B→C enquanto ainda existem candidatos.

Na UI:

```text
Estabilizando esta página — testando modelos Vision X/Y...
```

O cronômetro deve continuar rodando durante o sweep.

## 7. Não avançar a fila

Comece com concorrência 3.

A/B/C podem já estar em voo.

Quando A falhar e virar dona da estabilização:

- nenhuma página D/E/F nova começa;
- B/C podem terminar somente a tentativa já iniciada;
- se B/C falharem, o retry deles espera A estabilizar.

Gate:

```text
NEW_PAGES_STARTED_DURING_STABILIZATION=0
```

## 8. Sucesso após rotação

Cenário:

```text
A → 504
B → resposta vazia
C → no workers
D → 200 válido
```

Esperado:

```text
página = success
fila reabre
concorrência = 1 inicialmente
recuperação gradual 1→2→3
modelExhausted=false
```

## 9. 401 real

Mock:

```text
A → HTTP 401 Invalid API key
```

Esperado:

```text
ATTEMPTS=1
RETRY_COUNT=0
ROTATION_COUNT=0
providerAuthError=true
modelExhausted ausente
fila halted
mensagem pede chave/token
```

Não tente B/C/D.

## 10. 403 de modelo

Mock:

```text
A → HTTP 403 "Forbidden: no access to this model"
B → 200
```

Esperado:

```text
A → modelRotated=true
B → success
providerAuthError ausente
```

## 11. 429

Mock:

```text
A → 429
A → 429
A → 200
```

Esperado:

- mesmo modelo A nas 3;
- rotation=0;
- respeita Retry-After;
- nenhuma página nova durante estabilização.

## 12. Concorrência/race

Teste três requests inicialmente usando o mesmo candidato A.

Se A falhar nas três quase juntas:

- não deve pular três modelos por acidente;
- cada página mantém seu próprio Set de modelos tentados;
- active model global pode avançar, mas uma página deve usar candidato ativo ainda não tentado antes de avançar novamente;
- nenhuma página deve acreditar que tentou um candidato que nunca chamou.

Criar teste determinístico para isto.

## 13. Manual retry

Depois de `modelExhausted=true`:

- clicar Re-tentar deve zerar o sweep DAQUELA página;
- se o usuário trocou a chave, o último candidato atual pode ser testado novamente;
- continua pela lista se ainda falhar.

Validar:

```text
POST /api/models/runtime/reset-page-failover
```

nos caminhos:
- Re-tentar individual;
- Re-tentar N;
- correção manual.

## 14. Timer

Não pode regredir.

Durante A→B→C→D:

- timer continua;
- não pausa entre rotações automáticas;
- se todos modelos esgotarem e aguardar usuário, timer para;
- Re-tentar manual retoma acumulado.

## 15. PDF real

Usar PDF real local sem commit.

Preferencialmente o mesmo que expôs o problema.

Não é obrigatório provocar falha artificial na NVIDIA real.

Se ocorrer falha espontânea:
- observar página atual;
- confirmar que contador de concluídas não avança por páginas novas durante sweep;
- confirmar que a mesma página troca de candidato automaticamente;
- confirmar que não aparecem 3/10/20 páginas novas em Falhou.

## 16. Segurança

Executar:
- Gitleaks;
- Semgrep;
- Mimosa se disponível.

Confirmar:
- IDs de modelo não são exibidos na UI;
- API keys não entram em logs;
- pageFailoverCycles não persiste dados do PDF;
- model-runtime continua sem chave/PDF/OCR;
- runtimePageId é identificador técnico local, não conteúdo sensível.

## 17. Relatório

Publicar no PR:

```text
EXHAUSTIVE_VISION_FAILOVER_LOCAL_AUDIT

HEAD=

LINT=
TESTS=
TEST_COUNT=
FAILURES=
BUILD=
NPM_AUDIT=
ELECTRON_BUILD=

FAILOVER_GT_3_ATTEMPTS=
SIXTH_MODEL_SUCCESS=
ALL_VISION_MODELS_TRIED=
UNIQUE_MODELS_TRIED=
MODEL_EXHAUSTED_ONLY_AT_END=

LIVE_ONLY_WHEN_AVAILABLE=
TEXT_ONLY_EXCLUDED=
CATALOG_FALLBACK_ONLY=

SAME_PAGE_RUNTIME_ID=
SAME_PAGE_IMAGE=
NO_INTERMEDIATE_FAILED_STATE=

NEW_PAGES_STARTED_DURING_STABILIZATION=
NON_OWNER_RETRIES_WAIT=

MIXED_FAILURES_A_B_C_D=
QUEUE_RESUMES_AFTER_MODEL_SUCCESS=
CONCURRENCY_RECOVERY=

AUTH_401_ATTEMPTS=
AUTH_401_ROTATIONS=
AUTH_401_STOPS=

MODEL_403_FAILOVER=
RATE_LIMIT_429_SAME_MODEL=

CONCURRENT_ROTATION_RACE=
MANUAL_RETRY_RESETS_PAGE_SWEEP=

TIMER_DURING_MODEL_SWEEP=
TIMER_AFTER_EXHAUSTION=
TIMER_MANUAL_RESUME=

REAL_PDF_SMOKE=
CASCADE_FAILURES=

GITLEAKS=
SEMGREP=
MIMOSA=

FIXES_APPLIED=
- ...

NOTES=
- ...

FINAL=APPROVE|REJECT
```

## Stop

Mesmo com FINAL=APPROVE:
- não retirar Draft;
- não mergear;
- não bump;
- não tag;
- não release.

Aguardar reauditoria do ChatGPT.
