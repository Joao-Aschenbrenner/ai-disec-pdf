# LOCAL AUDIT — Classification V3

> Este PR deve permanecer em draft durante esta auditoria. NÃO criar versão, tag, release nem merge até revisão do resultado.

## 1. Preparar

```powershell
git fetch origin
git checkout feat/classification-v3-context-learning
git pull origin feat/classification-v3-context-learning
npm ci
```

Ler:

```text
CLASSIFICATION_V3.md
tests/golden/classification-v2-local-spec.json
```

Usar o PDF real somente localmente:

```text
custeio-municipal-12-25okokok.pdf
```

NÃO commitá-lo.

## 2. Gates automáticos

```powershell
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Se qualquer comando falhar, corrigir no branch e repetir.

## 3. Laya obrigatório

Abrir o desktop.

Em Configurações:

- Laya instalado;
- checkpoint multilingual;
- health `status=ok`;
- badge ativo.

Tentar processar com Laya parado.

Esperado:

- processamento não começa;
- configurações são abertas;
- mensagem informa que V3 exige Laya.

Iniciar Laya e repetir.

Esperado:

- processamento inicia;
- cards mostram etapas;
- depois do resultado cada página com texto deve mostrar `Laya ✓`.

Para PDF scan-only, o Laya pode entrar após o VLM gerar `classificationText`.

## 4. Passagens V3

Validar por logs/UI:

### Passagem 1

```text
texto local
 -> Signatures
 -> Laya
 -> Learning Store
```

### Passagem 2

```text
previous/current/next
 -> SequenceResolver
```

### Passagem visual

VLM extrai campos, não escolhe classe.

### Passagem 3

Usa `classificationText` final para reavaliar sequência.

## 5. Caso crítico — extrato multipágina

No PDF real, revisar manualmente páginas consecutivas de extrato.

Criar/confirmar um cenário onde a página do meio isoladamente tenderia a TED/OUTRO.

Esperado:

- anterior e seguinte fortes como `EXTRATO_CC`;
- página do meio marcada para revisão pode ser corrigida pelo `source=sequence`;
- uma confidence bruta Laya 100% NÃO impede correção contextual.

Registrar páginas usadas e resultado.

## 6. Folha multipágina

Validar relatório de folha:

```text
Página 1 de 3
Página 2 de 3
Página 3 de 3
```

Esperado:

- todas pertencem a `FOPAG_RESUMO` ou `FOPAG_13_RESUMO` conforme o bloco;
- página 2/3 sem cabeçalho não vira documento aleatório.

## 7. NFS-e / cabeçalho municipal

Validar pelo menos 5 NFS-e do PDF real.

Esperado:

- `documentClass=NFS`;
- companyName vem do PRESTADOR/EMITENTE;
- nome de cidade/prefeitura/secretaria não vira empresa só por estar no topo;
- TOMADOR não substitui PRESTADOR.

## 8. Holerites duplos

Golden mensal:

```text
páginas 9–26 => dois holerites
página 27    => um holerite
```

Esperado:

- páginas 9–26: dois PDFs físicos independentes;
- ordem: top -> bottom;
- crop usa separatorY real quando detectado;
- página 27 NÃO divide.

Também validar lote do 13º conforme golden.

## 9. Retry / Abort

NVIDIA:

- concorrência efetiva = 1 no modo automático;
- timeout = 120 s;
- provocar/observar timeout de modo controlado;
- erro não deve aparecer cru como `This operation was aborted`;
- retry precisa fazer até 3 tentativas reais;
- UI mostra `Tentando novamente`.

Não fazer 400 chamadas reais.

## 10. Modo automático

Configurar:

```text
Precisão do modelo = Automático
```

Validar:

- caso claro -> hint fast;
- caso ambíguo -> medium;
- automático NÃO seleciona Nemotron;
- `Preciso` manual continua disponível.

## 11. Segundo plano

Iniciar processamento e:

- minimizar;
- deixar outra janela em primeiro plano;
- restaurar.

Esperado:

- fila continua avançando;
- timers/retries continuam;
- não processa apenas quando a janela ganha/perde foco.

Confirmar `backgroundThrottling=false` no Electron.

## 12. Status animados

Observar cards:

```text
Preparando página
Classificando com Laya
Identificando documento
Extraindo campos
Validando contexto
Confirmando
Tentando novamente
```

A barra não deve ficar congelada em `Lendo...`.

## 13. Confiança geral

Após terminar:

- mostrar `Confiança geral NN%`;
- mostrar quantidade para revisar;
- conferir que falhas/revisões reduzem o índice;
- não chamar o índice de garantia ou probabilidade calibrada.

## 14. Aprendizado local

Escolher uma página marcada para revisão.

1. corrigir `Classe fina`;
2. clicar `Confirmar e aprender`;
3. verificar `GET /api/learning/stats`;
4. reprocessar documento semelhante.

Esperado:

- store criado em `~/.ai-disec-pdf/learning-store.json`;
- não contém imagem/base64/chave/API;
- não contém texto integral;
- exemplo confirmado aparece na contagem;
- não ocorre fine-tuning automático;
- similaridade baixa não domina a classificação.

Testar também que `Confirmar e aprender` fica indisponível sem classe fina.

## 15. Nomes / ZIP

Repetir:

- nomes <= 80;
- Windows reserved names;
- ponto decimal;
- collision `_2`, `_3`;
- dois holerites nunca sobrescrevem um ao outro.

## 16. Performance realista

Máximo do produto: 400 páginas.

Usar mocks para stress.

Não fazer 400 chamadas cloud.

Medir:

- split;
- extração de texto local;
- sequence;
- ZIP;
- memória;
- ausência de freeze/crash.

Smoke real cloud: somente amostra pequena.

## 17. Segurança

Executar ferramentas disponíveis:

- npm audit;
- Gitleaks;
- Semgrep;
- scanner local/Mimosa se disponível.

Não transformar cobertura parcial em PASS total.

Não logar keys/base64/PDF.

## 18. Electron

```powershell
npm run electron:dev
npm run electron:build
```

Validar:

- app abre;
- Laya obrigatório;
- background;
- processamento;
- fechar sem processo órfão;
- instalador gera.

Não testar auto-update nesta fase, pois ainda não existe nova release.

## 19. Relatório obrigatório

Publicar no PR:

```text
LOCAL_CLASSIFICATION_V3_AUDIT

LINT=PASS|FAIL
TESTS=PASS|FAIL
TEST_COUNT=<n>
BUILD=PASS|FAIL
NPM_AUDIT=PASS|FAIL

LAYA_REQUIRED_GATE=PASS|FAIL
LAYA_ALL_READABLE_PAGES=PASS|FAIL
LAYA_SCAN_AFTER_VISION=PASS|FAIL

PASS1_LOCAL_TEXT=PASS|FAIL
PASS2_SEQUENCE=PASS|FAIL
PASS3_POST_VISION_SEQUENCE=PASS|FAIL

EXTRATO_CONTINUATION=PASS|FAIL
FOPAG_CONTINUATION=PASS|FAIL
NFS_PRESTADOR_RULE=PASS|FAIL

TWO_HOLERITES=PASS|FAIL
PAGE27_SINGLE_GUARD=PASS|FAIL
REAL_SEPARATOR_CROP=PASS|FAIL

NVIDIA_CONCURRENCY_1=PASS|FAIL
NVIDIA_TIMEOUT_120S=PASS|FAIL
RETRY_3_ATTEMPTS=PASS|FAIL
ABORT_FRIENDLY_ERROR=PASS|FAIL

BACKGROUND_PROCESSING=PASS|FAIL
STATUS_PROGRESS_UI=PASS|FAIL
GLOBAL_CONFIDENCE=PASS|FAIL

LEARNING_STORE=PASS|FAIL
LEARNING_FINE_CLASS=PASS|FAIL
LEARNING_NO_RAW_DOC=PASS|FAIL
AUTO_FINETUNE_DISABLED=PASS|FAIL

SAFE_FILENAMES=PASS|FAIL
ZIP_COLLISION=PASS|FAIL

SECURITY_SCAN=<status + limitações>
ELECTRON_DEV=PASS|FAIL
ELECTRON_BUILD=PASS|FAIL

FIXES_APPLIED=
- ...

NOTES=
- ...

FINAL=APPROVE|REJECT
```

## 20. Regra final

Se `FINAL=REJECT`:

- corrigir apenas o necessário;
- retestar;
- manter PR draft;
- NÃO mergear/tag/release.

Se `FINAL=APPROVE`:

- publicar o relatório;
- manter PR sem release;
- devolver o resultado para revisão antes de qualquer promoção.
