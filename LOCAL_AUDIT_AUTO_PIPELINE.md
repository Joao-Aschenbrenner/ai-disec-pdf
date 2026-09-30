
# LOCAL AUDIT — Auto Pipeline + Runtime Model Rotation

Branch: perf/auto-triple-pipeline
Base: master / v1.10.0

Este ciclo é de auditoria/correção. NÃO fazer merge, bump, tag ou release até revisão do relatório.

## Objetivo

Validar quatro mudanças:

1. UI mostra apenas nomes de providers, sem IDs de modelo/tier manual.
2. Modelo é descoberto e atualizado automaticamente em runtime.
3. Falha do modelo rotaciona para outro candidato compatível.
4. Pipeline processa até 3 páginas simultâneas sem perder estabilidade.

## 1. Gates automáticos

~~~
npm ci
npm run lint
npm test
npm run build
npm audit --omit=dev
~~~

Todos precisam terminar em exit code 0.

## 2. UI de providers

Esperado:

~~~
NVIDIA
Google
OpenAI
Anthropic
OpenRouter
Groq
Ollama Cloud
Codex
Ollama Local
~~~

NÃO pode aparecer ID de modelo, nome de modelo específico, Fast/Rápido, Medium/Equilibrado, Preciso ou seletor de tier.

Deve aparecer apenas Modo: Automático.

## 3. Chaves por provider

Salvar chaves de teste distintas para dois providers. Trocar provider e voltar.

Esperado:
- cada provider recupera somente sua própria chave;
- nenhuma chave aparece em log;
- settings.json usa mapa apiKeys;
- migração de settings antigos não mistura chaves.

## 4. Atualização automática do catálogo

Ao iniciar o app, POST /api/models/runtime/refresh-all deve rodar em background.

Providers configurados devem consultar seus endpoints de modelos quando possível.

Sem chave:
- não falhar o app;
- usar catálogo versionado como fallback.

Validar ~/.ai-disec-pdf/model-runtime.json.

Pode conter IDs internos de modelo, mas NÃO API keys.

## 5. Candidato mais recente

Mockar provider com dois modelos multimodais:

~~~
novo created=200
antigo created=100
~~~

Esperado:
- candidato novo primeiro;
- IDs não aparecem ao usuário.

## 6. Rotação por falha

Cenário obrigatório:

~~~
modelo novo -> HTTP 503 / capacity
modelo antigo -> HTTP 200
~~~

Esperado:
1. primeira chamada retorna erro retryable/modelRotated;
2. runtime marca candidato atual como falho;
3. retry usa próximo modelo;
4. página conclui;
5. UI não exige troca manual.

Rodar tests/model-runtime-rotation.test.ts.

## 7. Erros que DEVEM rotacionar

Validar:
- 404 model not found;
- 410 retired;
- 422 unsupported image;
- 503 capacidade;
- 529 overloaded;
- timeout/AbortError;
- resposta vazia;
- saída sem JSON/texto utilizável;
- JSON incompatível após reparo.

## 8. Erros que NÃO devem rotacionar

Validar:
- 401 chave inválida;
- 403 acesso negado;
- 429 rate limit/quota.

Nesses casos:
- manter candidato;
- aplicar erro/backoff;
- não mascarar credencial/cota como problema de modelo.

## 9. Modalidades

Se a API retornar metadata de modalidades, usar essa informação acima da heurística por nome.

Modelo explicitamente texto-only NÃO pode entrar na fila.

## 10. Ollama Local

A interface NÃO deve mostrar nomes dos modelos.

Fluxo esperado:

~~~
Ollama Local
-> Preparar / atualizar automaticamente
-> detectar hardware
-> instalar Ollama se necessário
-> preparar modelo compatível
-> consultar /api/tags
-> selecionar candidato multimodal instalado
~~~

Modelo texto-only instalado NÃO pode ser escolhido só por estar em /api/tags.

## 11. Concorrência 3

Confirmar:

~~~
AUTO_PIPELINE_CONCURRENCY=3
~~~

Validar até 3 páginas simultâneas em:
- extração local;
- Laya Passagem 1;
- visão/provider.

Não aumentar acima de 3 nesta rodada.

## 12. Retry com stagger

Quando 3 páginas falharem juntas:

~~~
retry base 2s / 5s / 10s
+ stagger por posição
~~~

As três não devem retomar no mesmo milissegundo.

## 13. Render adaptativo

Página clara:

~~~
mode=fast
scale aproximadamente 2.2
JPEG quality aproximadamente 0.88
~~~

Holerite/folha/caso ambíguo:

~~~
mode=detail
scale 3.0
JPEG quality 0.95
~~~

Validar que holerites continuam legíveis e split permanece correto.

## 14. PDF real

Usar localmente custeio-municipal-12-25okokok.pdf.

NÃO commitá-lo.

Validar:
- NFS;
- extratos multipágina;
- folha multipágina;
- holerites duplos;
- página 27 não dividida;
- nomes;
- ZIP.

## 15. Benchmark realista

Não fazer 400 chamadas reais.

Usar:
- 9 páginas reais para smoke de throughput;
- 30/100/400 páginas com provider mockado para stress.

Registrar:

~~~
TRIPLE_9_PAGE_TIME=<tempo>
ERROR_COUNT=<n>
RETRY_COUNT=<n>
ROTATION_COUNT=<n>
~~~

Se houver baseline v1.10.0, comparar.

Objetivo:
- redução perceptível de tempo;
- sem crescimento relevante de erro;
- sem freeze;
- sem corrupção de sequência.

## 16. Background

Minimizar durante processamento.

Esperado:
- 3 workers continuam;
- Laya continua;
- provider continua;
- retry continua;
- progresso avança.

## 17. Segurança

Executar:
- npm audit;
- Gitleaks;
- Semgrep;
- scanner local/Mimosa se disponível.

Verificar:
- settings.json não é empacotado;
- model-runtime.json não contém keys;
- logs não contêm API key;
- model discovery usa apenas URLs do catálogo interno;
- provider/model vindo da API não vira URL arbitrária.

## 18. Electron

~~~
npm run electron:dev
npm run electron:build
~~~

Validar:
- Configurações simplificadas;
- provider switch;
- chave correta por provider;
- processamento 3x;
- Laya;
- background;
- instalador.

## 19. Relatório

Publicar no PR:

~~~
AUTO_PIPELINE_LOCAL_AUDIT

LINT=PASS|FAIL
TESTS=PASS|FAIL
TEST_COUNT=<n>
BUILD=PASS|FAIL
NPM_AUDIT=PASS|FAIL

UI_PROVIDER_NAMES_ONLY=PASS|FAIL
UI_NO_MODEL_IDS=PASS|FAIL
UI_AUTO_ONLY=PASS|FAIL

PER_PROVIDER_KEYS=PASS|FAIL
STARTUP_REFRESH_ALL=PASS|FAIL
LIVE_MODEL_DISCOVERY=PASS|FAIL
LATEST_CANDIDATE_FIRST=PASS|FAIL
MODALITY_FILTER=PASS|FAIL

ROTATE_503=PASS|FAIL
ROTATE_TIMEOUT=PASS|FAIL
ROTATE_EMPTY=PASS|FAIL
ROTATE_INVALID_OUTPUT=PASS|FAIL
NO_ROTATE_401=PASS|FAIL
NO_ROTATE_429=PASS|FAIL

OLLAMA_AUTO=PASS|FAIL
OLLAMA_TEXT_ONLY_GUARD=PASS|FAIL

CONCURRENCY_3=PASS|FAIL
LAYA_CONCURRENCY_3=PASS|FAIL
VISION_CONCURRENCY_3=PASS|FAIL
RETRY_STAGGER=PASS|FAIL

ADAPTIVE_RENDER=PASS|FAIL
HOLERITE_DETAIL_GUARD=PASS|FAIL

REAL_PDF=PASS|FAIL
TWO_HOLERITES=PASS|FAIL
PAGE27_GUARD=PASS|FAIL

TRIPLE_9_PAGE_TIME=<tempo>
ERROR_COUNT=<n>
RETRY_COUNT=<n>
ROTATION_COUNT=<n>

BACKGROUND_PROCESSING=PASS|FAIL
SECURITY_SCAN=<resultado + limitações>
ELECTRON_DEV=PASS|FAIL
ELECTRON_BUILD=PASS|FAIL

FIXES_APPLIED=
- ...

NOTES=
- ...

FINAL=APPROVE|REJECT
~~~

## Regra final

Se FINAL=REJECT:
- corrigir;
- retestar;
- manter PR draft;
- não promover.

Se FINAL=APPROVE:
- publicar relatório;
- manter PR sem release;
- devolver para reauditoria antes de merge/bump/tag.
