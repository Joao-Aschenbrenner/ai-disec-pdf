# CLASSIFICATION-V2 — Laya + Regras + VLM

## Objetivo

Tornar a classificação robusta mesmo usando um VLM mais fraco.

## Ordem de decisão

1. **VLM extrator** lê a imagem e devolve apenas campos + `classificationText`.
2. **DocumentSignatures** aplica hard guards e âncoras determinísticas.
3. **Laya local** atua como segunda opinião quando as assinaturas não forem suficientes.
4. O candidato do VLM só é aceito como fallback e sempre entra em revisão quando não há evidência local forte.
5. O VLM **não é autoridade final de `documentType`**.
6. Se o router confirmar holerite e o layout indicar dois blocos empilhados, `PageSegmenter` cria dois PDFs cropados e reprocessa cada metade.
7. `SafeFilenameBuilder` limita o nome final a 80 caracteres e usa classes curtas.

## Hard guards iniciais

- `DANFE` / `DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA` => `NFE_DANFE`
- `NOTA FISCAL DE SERVICOS ELETRONICA` / `NFS-e` => `NFS`
- `DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS` => `DARF`
- `RELATORIO FOLHA PAGAMENTOS` => `FOPAG_RESUMO`
- `FOLHA MENSAL + MENSALISTA + VENCIMENTOS/DESCONTOS` => `HOLERITE`

## Laya

Servidor esperado: `http://127.0.0.1:8000`.

Instalação de referência:

```bash
python -m pip install "laya[serve]"
LAYA_DEVICE=auto LAYA_PRELOAD=1 laya-serve
```

Endpoint usado pelo DocSplit: `POST /v1/systemone`.

Variáveis opcionais:

- `LAYA_URL`
- `LAYA_API_KEY`

Se o Laya estiver offline ou exceder o timeout, o DocSplit continua funcionando com signatures + VLM fallback.

## Dataset de calibração

O PDF real de custeio do hospital deve ser convertido em golden cases contendo ao menos:

- extrato conta corrente
- NFS-e
- relatório de folha
- holerite individual
- dois holerites na mesma página
- TED
- DARF
- conta de energia
- guia ISS
- guia INSS
- 13º salário
- DANFE/NF-e
- extrato de investimentos

O threshold do Laya só deve ser alterado depois de medir precisão nesse conjunto.

## Segmentação de dois holerites

O detector visual é propositalmente conservador e só é acionado depois que a classe local já é `HOLERITE` ou `HOLERITE_13`. Ele exige conteúdo significativo nas duas metades e uma faixa relativamente branca perto do centro. Se houver dúvida ou erro no crop, a página original é preservada.

Quando a IA já retorna dois objetos, o DocSplit também materializa duas metades em PDFs independentes, na ordem superior -> inferior.
