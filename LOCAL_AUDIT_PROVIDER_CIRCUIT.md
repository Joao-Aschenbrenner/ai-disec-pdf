# LOCAL AUDIT — Provider Circuit Breaker

Branch: `fix/provider-circuit-breaker`
Base: `master` / v1.11.0

NÃO fazer merge, bump, tag ou release nesta rodada.

## Objetivo

Corrigir a cascata observada em PDF grande:

- processamento começa saudável e rápido;
- provider passa a responder 503/504 ou saída incompatível;
- pipeline antigo continuava alimentando páginas novas;
- várias páginas falhavam em sequência;
- modelo podia ser rotacionado cedo demais.

## Contrato novo

### Saudável

```text
provider saudável
→ até 3 páginas simultâneas
```

### Primeiro erro transitório sério

```text
503/504/408/502/529
429
resposta vazia
formato incompatível
```

deve resultar em:

```text
FILA GLOBAL PAUSADA
CONCORRÊNCIA=1
PÁGINA ATUAL = dona da estabilização
NENHUMA PÁGINA NOVA é iniciada
retry na página atual
mesmo modelo no primeiro erro transitório
```

### Página já em voo

Páginas que já estavam em voo podem terminar a tentativa atual.

Se uma delas também falhar, ela NÃO pode iniciar novo retry enquanto outra página for a dona da estabilização.

### Estabilização

Se a página dona obtiver sucesso:

```text
circuit breaker fecha
fila é liberada
concorrência continua 1
recupera gradualmente após sucessos
1 → 2 → 3
```

### Falha persistente

Se a página dona esgotar as tentativas:

```text
fila permanece pausada
restante fica aguardando/pending
não criar cascata de erros
usuário pode Re-tentar
```

### 401 / 403

```text
sem retry
sem rotação
PARA A FILA INTEIRA
mensagem de credencial/permissão
```

## Política de modelo

Histórico persistido em `model-runtime.json` NÃO decide sozinho uma rotação.

Rotação por falha transitória usa apenas sequência da sessão atual.

### Não rotacionar na primeira ocorrência

- 503/504 genérico;
- timeout genérico;
- resposta vazia;
- resposta incompatível / JSON inválido.

Primeira ocorrência:

```text
pausa fila
retry mesma página
mesmo modelo
```

### Rotacionar por repetição consecutiva

Segunda falha consecutiva do mesmo candidato na sessão:

- timeout/504/503 transitório;
- resposta vazia;
- saída incompatível.

Então:

```text
rotate
continua NA MESMA PÁGINA
estabiliza candidato novo
só depois libera fila
```

### Rotação imediata

Somente sinais fortes de modelo realmente indisponível/incompatível:

- 404 model not found;
- 410 retired;
- 422 incompatible;
- explicit model unavailable;
- no workers for this model;
- worker/request limit reached para o candidato;
- resource exhausted;
- unsupported image.

### 429

```text
sem rotate
retryAfter/backoff
fila pausada
concorrência 1
```

## Gates

Executar:

```text
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev
npm run electron:build
```

Esperado: suite padrão 100% verde.

Executar também:

- Gitleaks;
- Semgrep, se disponível;
- Mimosa, declarando PARTIAL se parcial.

## Testes obrigatórios

### A — 504 único

```text
start concurrency=3
page A → 504
queuePaused=true
concurrency=1
mesmo modelo
page A retry → 200
queuePaused=false
concurrency permanece 1
```

### B — duas falhas

```text
page A → 504
retry mesmo modelo → 504
rotate
retry candidato novo → 200
fila só libera depois do 200
```

### C — saída incompatível

```text
1ª saída incompatível
→ NÃO rotate
→ fila pausa
→ retry mesmo modelo

2ª saída incompatível consecutiva
→ rotate
→ mesma página tenta candidato novo
```

### D — páginas concorrentes

Inicie 3 páginas.

Faça A falhar primeiro.

Esperado:

```text
A = dona da estabilização
nenhuma página 4 é iniciada
B/C podem encerrar tentativa já em voo
se B/C falharem, não iniciam retry antes de A estabilizar
A sucesso
→ fila volta
```

### E — não estabiliza

```text
A falha até esgotar tentativas
→ pipeline.halted=true
→ queuePaused=true
→ páginas ainda na fila ficam pending/waiting
→ nenhuma chamada nova ao provider
```

### F — 401/403

```text
primeira página → 401
retry=0
rotation=0
fila para
nenhuma segunda página enviada
```

### G — 429

```text
429
→ sem rotate
→ fila pausa
→ concorrência 1
→ respeita retryAfter
→ sucesso
→ libera fila
```

## Teste real obrigatório

Usar localmente o PDF real grande:

```text
custeio-municipal-12-25okokok.pdf
```

NÃO commitá-lo.

Não precisa concluir 129 páginas se o objetivo já tiver sido comprovado.

Reproduzir preferencialmente até:

- pelo menos 20–30 páginas;
- ou até ocorrer instabilidade real do provider.

Observar visualmente:

### Quando saudável

```text
Concorrência: 3
```

### Ao primeiro erro

Esperado IMEDIATAMENTE:

```text
Concorrência: 1
Fila pausada — estabilizando a página atual...
```

Enquanto essa mensagem existir:

- contador de páginas iniciadas NÃO deve avançar com páginas novas;
- páginas seguintes devem continuar aguardando;
- não pode aparecer uma cascata de novas falhas.

Se estabilizar:

```text
fila volta
começa em 1
depois pode recuperar 2 e 3
```

Se não estabilizar:

```text
Fila pausada — provedor não estabilizou. Re-tente para continuar.
```

## Teste específico da tela reportada

A falha anterior mostrava:

```text
Tentativas: 57
Retries: 6
Rotações: 5
Concorrência: 2
múltiplas folhas Falhou
```

Isso NÃO deve se repetir.

Durante estabilização:

```text
NEW_PAGES_STARTED_DURING_STABILIZATION=0
```

é gate obrigatório.

## Manual retry

Validar:

- botão "Re-tentar N";
- botão "Re-tentar" individual;
- reprocessamento por correção manual.

Todos devem usar o MESMO `AdaptivePipeline`.

Ao retry manual:

```text
reset concurrency=1
retry/stabilização
não bypassar circuit breaker
```

## Relatório

Publicar no PR:

```text
PROVIDER_CIRCUIT_BREAKER_LOCAL_AUDIT

HEAD=

LINT=
TESTS=
TEST_COUNT=
FAILURES=
BUILD=
NPM_AUDIT=
ELECTRON_BUILD=

CIRCUIT_FIRST_504=
QUEUE_PAUSED_ON_PRESSURE=
CONCURRENCY_DROPS_TO_1=
OWNER_PAGE_STABILIZES=
NON_OWNER_RETRY_BLOCKED=
NO_NEW_PAGE_DURING_STABILIZATION=

FIRST_TIMEOUT_SAME_MODEL=
SECOND_TIMEOUT_ROTATES=
FIRST_INVALID_OUTPUT_SAME_MODEL=
SECOND_INVALID_OUTPUT_ROTATES=
HARD_MODEL_FAILURE_ROTATES_IMMEDIATELY=

AUTH_401_STOPS_QUEUE=
AUTH_401_RETRY_COUNT=
AUTH_401_ROTATION_COUNT=

RATE_LIMIT_429_NO_ROTATE=
RATE_LIMIT_429_PAUSES_QUEUE=

UNRESOLVED_PROVIDER_HALTS_QUEUE=
PENDING_PAGES_PRESERVED=

MANUAL_BULK_RETRY_USES_PIPELINE=
MANUAL_SINGLE_RETRY_USES_PIPELINE=
MANUAL_CORRECTION_USES_PIPELINE=

REAL_PDF_SMOKE=
PAGES_OBSERVED=
NEW_PAGES_STARTED_DURING_STABILIZATION=
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

- não mergear;
- não bump;
- não tag;
- não release.

Aguardar reauditoria do ChatGPT.
