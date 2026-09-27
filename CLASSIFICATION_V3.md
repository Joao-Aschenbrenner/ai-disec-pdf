# Classification V3 — Laya universal + contexto + aprendizado confirmado

## Objetivo

A V3 reduz a dependência de uma IA visual forte. O VLM continua sendo usado para ler imagens e extrair campos, mas não é autoridade final de classe.

Os problemas que esta versão ataca são:

- páginas 2/3 de extrato ou relatório sem cabeçalho principal;
- Laya com confiança bruta alta em uma classe errada isolada;
- múltiplos holerites empilhados na mesma página;
- timeouts/aborts do provider em processamento paralelo;
- falta de feedback visual sobre a etapa atual;
- reaprender mensalmente padrões já corrigidos pelo usuário.

## Fluxo em três passagens

```text
PDF
 │
 ├─ PASSAGEM 1A: texto embutido local
 │      ├─ texto útil -> Signatures + Laya + memória confirmada
 │      └─ scan puro  -> marca requiresVision
 │
 ├─ PASSAGEM 2: SequenceResolver
 │      anterior <- atual -> seguinte
 │      resolve páginas de continuação quando há evidência suficiente
 │
 ├─ PASSAGEM VISUAL
 │      GLM/VLM lê a imagem e extrai apenas campos + classificationText
 │      toda saída com texto volta a passar pelo router V3 + Laya
 │
 └─ PASSAGEM 3: SequenceResolver pós-visão
        usa classificationText final de todas as páginas
        corrige continuações que só ficaram legíveis após o VLM
```

### Regra central

O VLM não escolhe `documentClass` nem `documentType`.

Ele extrai:

- `classificationText`;
- número do documento/nota;
- empresa/prestador/emitente;
- funcionário;
- valor.

A classificação final vem de:

```text
hard guards
+ DocumentSignatures
+ Laya
+ Learning Store confirmado
+ SequenceResolver
```

## Laya obrigatório

Na V3 o processamento só inicia com health válido do Laya.

O Laya é consultado:

1. na passagem local quando existe texto embutido útil;
2. novamente após a leitura visual, usando `classificationText`, inclusive para páginas escaneadas.

Logo, páginas scan-only podem precisar do VLM antes da primeira decisão útil do Laya, porque o Laya não é OCR/vision.

A UI mostra por página:

```text
Laya ✓ 87%
```

A porcentagem é confiança bruta do classificador e não uma probabilidade calibrada.

## Continuidade

O `SequenceResolver` usa:

- página anterior;
- página atual;
- página seguinte;
- marcador `Página X de Y`;
- termos de extrato;
- grade de folha;
- confiança/review state.

Uma página marcada `needsReview=true` pode ser corrigida pelo contexto mesmo se o Laya tiver retornado `1.0`, pois a confidence do checkpoint base não é tratada como probabilidade calibrada.

Exemplo:

```text
p1 EXTRATO_CC 96%
p2 TED 100% + Revisar
p3 EXTRATO_CC 94%

p2 contém PIX / BOLETO / SALDO

=> p2 EXTRATO_CC (source=sequence)
```

## Holerites empilhados

A V3 procura uma faixa horizontal vazia real e retorna `separatorRatio`.

Antes:

```text
corte fixo = 50%
```

Agora:

```text
detectStackedDocumentSeparator()
        ↓
separatorRatio real
        ↓
splitPdfPageAtRatio()
```

Se a passagem inicial já indica `HOLERITE` / `HOLERITE_13`, o layout é testado antes de enviar a página inteira ao VLM.

Se a página tiver somente um holerite, o detector deve preservar a página original.

## Concorrência e timeout

Modo automático:

- NVIDIA: 1 chamada visual por vez;
- Ollama Local: 1;
- demais providers: 2.

NVIDIA usa timeout de 120 s.

Retry real:

```text
tentativa 1
2 s
tentativa 2
5 s
tentativa 3
```

`retryAfter` do provider pode aumentar o intervalo.

No modo Automático:

- página já classificada com alta confiança -> tier fast / detail low / budget menor;
- caso não claro -> tier medium;
- V3 não seleciona Nemotron automaticamente.

O usuário ainda pode escolher `Preciso` manualmente.

## Background

Electron usa:

```js
backgroundThrottling: false
```

para impedir desaceleração de timers/processamento ao minimizar ou colocar a janela em segundo plano.

## Status por página

Estados da UI:

```text
Aguardando
Preparando página
Classificando com Laya
Identificando documento
Extraindo campos
Validando contexto
Confirmando
Tentando novamente
Pronto
Revisar
Falhou
```

Cada card possui progresso percentual.

## Índice geral

A UI mostra:

```text
Confiança geral NN%
```

É um índice heurístico, não uma garantia estatística. Itens `needsReview` recebem penalidade.

## Aprendizado local

Arquivo local:

```text
~/.ai-disec-pdf/learning-store.json
```

O store NÃO salva o texto completo da página. Salva apenas fingerprint de tokens com hash do exemplo confirmado + classe + contexto mínimo.

Nada é enviado para treinamento externo.

### Importante

Não existe auto-fine-tuning silencioso.

Fluxo:

```text
classificação
 -> usuário escolhe/ajusta Classe fina
 -> Confirmar e aprender
 -> fingerprint entra no Learning Store
 -> futuros documentos muito semelhantes podem usar esse exemplo
```

Threshold inicial de similaridade:

```text
>= 0.92
```

O treinamento real de um checkpoint Laya especializado fica para uma etapa futura e só deve usar dataset explicitamente confirmado + golden evaluation.

## Classes finas editáveis

- NFS
- NFE_DANFE
- HOLERITE
- HOLERITE_13
- FOPAG_RESUMO
- FOPAG_13_RESUMO
- DARF
- GUIA_ISS
- GUIA_INSS
- EXTRATO_CC
- EXTRATO_INVESTIMENTO
- TED
- FATURA_ENERGIA
- PLANILHA
- OUTRO

## Segurança / privacidade

- Laya: loopback local.
- Learning Store: local.
- Split/ZIP: local.
- Provider cloud: recebe imagem quando a passagem visual é necessária.
- O Learning Store não contém API keys.
- O PDF real de auditoria nunca deve ser commitado.

## Release

Este PR não autoriza release.

Primeiro executar `LOCAL_AUDIT_CLASSIFICATION_V3.md`.

Somente um ciclo posterior, com todos os gates aprovados, pode decidir bump/tag/release.
