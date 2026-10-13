# AI DISEC PDF — PR6.25 Boundary Regression & Local Field Association Audit

**Data:** 2026-10-12
**Decisão:** investigação concluída com certificações parciais; qualidade documental real, runtime empacotado, segurança e release continuam sem certificação.
**Escopo de publicação:** somente este relatório e o resumo JSON sanitizado.

## A. Resumo executivo

A PR6.25 adicionou estados e hipóteses explícitas para segmentação, associação geométrica conservadora entre rótulos e valores dentro do documento candidato, diagnósticos sanitizados e encaminhamento de hipóteses ao contrato experimental do Laya. A rota experimental continua desligada por padrão. Nenhum PDF real foi enviado a provedor e somente as páginas locais 5, 8, 9 e 11 foram executadas; o documento completo de 129 páginas não foi processado.

O holdout sintético congelado antes das alterações mediu ganho claro na associação regional: 12/12 associações únicas corretas contra 0/12 pela regra anterior de distância entre centros; quatro casos com múltiplos valores foram corretamente abstidos. A segmentação teve 6/6 divisões corretas entre 18 decisões escoráveis, sem falso corte, mas 7 dos 25 casos foram marcados para revisão e dois desses casos ambíguos foram resolvidos automaticamente como documento único. A amostra é pequena e direcionada; não representa qualidade geral.

Nas páginas municipais selecionadas, a página 9 recebeu dois candidatos e `SPLIT_CONFIDENT`, mas identidades, limites e exportação não foram validados por verdade-terreno humana. A página 11 ficou em `NEEDS_REVIEW` com um candidato e quatro hipóteses alternativas. A página 5 conservou associações monetárias não resolvidas; a página 8 ficou com segmentação de documento único, mas revisão necessária. Não houve ganho real demonstrado para associação de campos. A qualidade real permanece `NOT_CERTIFIED`.

O build isolado do app Windows foi gerado fora de `dist`; o executável iniciou, carregou o módulo empacotado, registrou carregamento do renderer e leu o catálogo local de modelos. Porém, os probes HTTP locais não obtiveram uma resposta verificável. Não houve processamento documental nem prova de disponibilidade offline de Paddle/Tesseract no pacote; `PACKAGED_RUNTIME` permanece `NOT_CERTIFIED`.

A suíte, lint e builds isolados passaram. O working tree de produto foi preservado e não houve commit de código, merge ou release. A publicação desta auditoria é documental e separada. Os gates oficiais DevKit Gitleaks, SkySecurityGate 1.0.0 e Evidence v1 continuam indisponíveis, portanto `SECURITY=BLOCKED` e `RELEASE=BLOCKED`.

## B. Repositório e identidade do código avaliado

| Item | Evidência |
|---|---|
| Repositório | `https://github.com/Joao-Aschenbrenner/ai-disec-pdf` |
| Checkout de avaliação | branch local `fix/exhaustive-vision-failover`; HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1` |
| Estado | working tree amplo já estava sujo antes desta auditoria; preservado, sem reset, clean, stash, pull, rebase ou merge |
| Fingerprint de fontes/configuração executados | `1792982c28cf09977f5540a1e9078f39be5894cfea3c7f2931659e56191a6730` em 175 arquivos |
| Fingerprint publicado PR6.24 | `edff2c8213ad26615ab187819e2b66ddbc960cc084aef06c9501b70e640c2dd5` em 172 arquivos; diferente do código atual |
| Base documental remota | `master` em `37357fc418f629bc91358890c26f9e1a81e23247` |

O fingerprint foi calculado sobre arquivos em `electron/`, `scripts/`, `server/`, `shared/`, `src/` e `tests/`, além dos arquivos de configuração de build na raiz. Os caminhos relativos foram normalizados para minúsculas e `/`; cada linha do manifesto contém caminho, NUL, SHA-256 do arquivo e LF; SHA-256 final sobre o manifesto UTF-8. Exclui PDFs, imagens, cofres, logs, builds e `tmp`. Como o código avaliado contém alterações locais não commitadas, o HEAD sozinho não identifica o artefato testado.

Os artefatos e alterações preexistentes do checkout não foram incluídos no commit documental. O commit desta auditoria contém exclusivamente os dois arquivos sanitizados listados na entrega.

## C. Divergência histórica da página 11

A divergência não permite atribuição causal exata ao algoritmo com as evidências arquivadas:

- O relatório e resumo publicados da PR6.23 registram dois candidatos na página 11.
- Um resumo local de outra execução PR6.23 (`r5`) registra um candidato e falha do layout; portanto, os próprios registros PR6.23 não são consistentes entre execuções.
- A PR6.24 registra um candidato.
- O commit disponível da PR6.23 (`9ba529aea61b035f0d142030c88f48f2a09e5abc`) contém somente a atualização dos dois documentos de auditoria, sem o código do segmentador daquela execução. O código histórico necessário para reexecutar ambos os algoritmos sobre a mesma rasterização, OCR, coordenadas e parâmetros não está disponível neste checkout. Não foi fabricado um replay.

Na execução PR6.25, a página 11 produziu 56 linhas OCR, zero regiões do PP-DocLayout-S, um candidato principal, cinco posições candidatas de limite, quatro hipóteses alternativas e estado `NEEDS_REVIEW`. Os códigos observados foram `REPEATED_FAMILY_CUE`, `DISTINCT_IDENTITIES`, `VISUAL_BOUNDARY_CUE`, `OCR_CLUSTER_GAP` e `INSUFFICIENT_FIELD_CUES`; não houve `FIELDS_PRESENT_ON_BOTH_SIDES`. A leitura mais provável é que a regra atual exige evidência positiva de campos em ambos os lados e, sem essa evidência estrutural/layout, preserva hipóteses e se abstém. Isso explica o comportamento atual, mas não prova por que a execução arquivada PR6.23 divergiu.

A decisão permanece indeterminada: não se impôs contagem de dois documentos e não se promoveu uma hipótese a verdade. O gate de regressão histórica fica parcial até ser possível reproduzir ambos os algoritmos sob entradas idênticas.

## D. Implementação local avaliada

As seguintes alterações continuam somente no working tree local:

- `shared/documentSegmentation.ts`: estados `SPLIT_CONFIDENT`, `SINGLE_CONFIDENT`, `NEEDS_REVIEW` e `UNRESOLVED`; códigos de motivo tipados; hipóteses com limites, evidências e motivos. Hipóteses não equivalem a aprovação ou exportação.
- `shared/localLayoutEvidence.ts`: contrato local de evidências v2; associação geométrica por região/linha; associação única somente quando não ambígua; múltiplos candidatos permanecem não resolvidos; evidências que cruzam limites não são atribuídas a pessoas/documentos. As hipóteses seguem ao Laya como propostas somente para revisão, sem poder de alterar a segmentação.
- `server/classification/localLayoutPipeline.ts`: métricas sanitizadas de estado, motivos, hipóteses, relações geométricas, rótulos monetários não resolvidos e cruzamentos de limite.
- `scripts/pr6-23-local-layout-benchmark.ts` e `scripts/pr6-25-boundary-field-benchmark.ts`: saída de benchmark limitada a IDs sintéticos, contagens e códigos de motivo.
- `tests/pr6-25-local-association.test.ts`: associação em colunas distantes na mesma linha, abstenção com múltiplos valores, rótulo que cruza limite e contrato de hipótese Laya/rejeição de ID inválido.
- `tests/fixtures/pr6-25-holdout.ts`: conjunto sintético congelado antes das mudanças algorítmicas; SHA-256 sintético `61791ddb9527c8f83a265d67eec9a6990bd9ce9bf86a1315cde43b820d4db31b`.

A flag de produção continua `OFF`. Não houve promoção da arquitetura experimental nem commit de código de produto.

## E. Páginas reais selecionadas — métricas sem conteúdo documental

Execução local com Tesseract.js e PP-DocLayout-S; worker Paddle com quatro threads, limite declarado de 1,5 GB e rede bloqueada durante o worker. Rasterização de escala 2 com limite de 20 MP. Nenhum OCR bruto, imagem ou valor foi publicado.

| Página física | Linhas OCR | Regiões layout | Candidatos documentais | Estado | Relações monetárias / diagnósticos |
|---:|---:|---:|---:|---|---|
| 5 | 70 | 1 | 1 | `NEEDS_REVIEW` | 1 relação candidata; 0 associações geométricas novas; 3 rótulos monetários não resolvidos |
| 8 | 32 | 1 | 1 | Segmentação `SINGLE_CONFIDENT`; resultado geral `NEEDS_REVIEW` | 0 relações monetárias |
| 9 | 60 | 0 | 2 | `SPLIT_CONFIDENT` | 0 relações monetárias; recortes/identidades/exportação não certificados |
| 11 | 56 | 0 | 1 principal | `NEEDS_REVIEW` | 5 posições candidatas, 4 hipóteses, 2 candidatos de separador; quantidade correta não confirmada |

Em todas as quatro páginas, o pipeline não registrou rótulos monetários atravessando limites. Na página 5, a relação candidata existente não se tornou uma associação geométrica verificável pelo novo mecanismo. Nas páginas 9 e 11, zero regiões de layout limitaram a evidência estrutural.

Tempos observados: p5 10,804 s; p8 7,262 s; p9 6,547 s; p11 7,174 s. P50 7,174 s e p95 10,804 s na amostra de quatro páginas. Nenhuma referência humana independente foi fornecida; a anotação real segue `PENDING_HUMAN_VALIDATION`. O usuário não precisa classificar nada para este relatório.

## F. Holdouts e comparação mensurável

### F.1 Segmentação sintética congelada

O conjunto contém 25 casos: 19 referências de documento único, 6 de dois documentos e 7 casos definidos para revisão. Dezoito decisões foram escoráveis; entre elas houve 6 verdadeiros positivos de divisão, zero falsos positivos e zero falsos negativos: precisão, recall e F1 de 1,00 somente nesse subconjunto escorável. IoU mínimo dos recortes correspondidos: 0,947. Houve oito abstenções no conjunto total. Apenas cinco dos sete casos definidos para revisão foram abstidos; dois casos ambíguos foram resolvidos como documento único. Isso é uma falha de calibração observada e impede interpretar a métrica perfeita como certificação.

A regressão PR6.24 manteve 7/7 divisões esperadas em 14 fixtures totais e zero falsos cortes nas referências de documento único. Três casos de tabela longa/relatórios com continuidade de tabela foram mantidos em revisão com `TABLE_CONTINUITY_VETO`; o benchmark não os dividiu automaticamente.

### F.2 Associação sintética rótulo/valor

Foram 16 fixtures: 12 relações únicas válidas e 4 casos ambíguos com múltiplos valores. A regra anterior de distância entre centros encontrou 0/12 relações válidas (recall 0); a regra regional encontrou 12/12, sem falsos vínculos, sem associação entre documentos e com abstenção nos quatro casos ambíguos. O resultado comprova ganho neste conjunto direcionado, não em documentos gerais.

Os fixtures foram sintéticos; não foram usados mocks como substituto de resultado real. Não existe ganho real certificado nas páginas municipais porque nenhuma relação geométrica nova foi encontrada e não há verdade-terreno humana.

## G. Contrato experimental do Laya e proveniência

A integração foi executada apenas por testes mockados/locais, sem provedor externo. O pedido carrega IDs de evidência, texto OCR associado a regiões, rótulos, valores candidatos, relações geométricas, ambiguidades e hipóteses alternativas. Validadores cobrem IDs e escopo. Hipóteses permanecem revisáveis; uma resposta do Laya não pode mudar limites, criar evidência inexistente, associar campos de documentos distintos ou aprovar automaticamente. Falha do Laya conserva o fallback de revisão.

A evidência cobre o contrato e os testes locais; não é uma validação de qualidade do Laya com modelo real. Nenhum PDF municipal foi enviado ao Laya ou a qualquer outro provedor.

## H. Testes, lint, build e integridade

- Testes focados antes do holdout: 15 aprovados em quatro arquivos.
- Suíte completa Vitest: 763 aprovados, 1 ignorado; 55 arquivos aprovados e 1 arquivo ignorado.
- Grupo de resiliência/worker/OCR/Laya: 42 aprovados em cinco arquivos, incluindo scheduler, processador de página, worker Paddle, OCR offline e integração local mockada do Laya.
- `npm run lint` (TypeScript `--noEmit`): passou.
- Build isolado: Vite gerou o cliente em `tmp/pr6-25-isolated-build-20261012/client`; esbuild gerou `server.cjs` e `server-module.cjs` no mesmo diretório e o catálogo foi copiado. Passou com avisos de chunk grande/import dinâmico e `import.meta` em bundle CommonJS. Não foi usado `npm run build` e o `dist` preexistente não foi alvo.
- Empacotamento isolado: electron-builder 26.17.0, Electron 42.11.8, Windows x64, saída `tmp/pr6-25-packaged-smoke-20261012/build/electron/win-unpacked`; build do diretório passou. O `asar=false` configurado gerou o aviso de segurança do electron-builder.
- Smoke do executável: processo sintético iniciou, carregou o módulo de servidor empacotado, registrou “Page loaded successfully” e carregou `server/models.json` do pacote. Probes em `localhost`/loopback não obtiveram status HTTP verificável; o processo isolado foi encerrado pelo harness. Nenhum PDF foi selecionado. Resultado: bootstrap observado, smoke funcional incompleto.
- `git diff --check`: passou. Varredura de whitespace dos arquivos novos/alterados da PR6.25: passou. Git emitiu apenas avisos de conversão LF/CRLF em três arquivos preexistentes/alterados.

O smoke não executou OCR, PP-DocLayout, Laya, download de modelo, falha de worker nem medição de memória do Electron. O desligamento forçado do harness não certifica liberação graciosa de recursos pelo pacote.

## I. CPU, memória e resiliência

O host observado informou 16 CPUs lógicas; o worker foi limitado a quatro threads e 1,5 GB. RSS de Node por página: 459–594 MB. Pico de bytes privados do worker layout: 236–246 MiB; RSS do worker: 310–321 MiB. São picos por execução/página e não foram medidos simultaneamente. Não há pico total Node+Python+Electron, nem prova em máquina de quatro núcleos/8 GB. Portanto `CPU_MEMORY` não é certificado para o perfil-alvo.

Os testes isolados de fila e worker passaram (42 casos). Isso sustenta resiliência no escopo de teste, sem afirmar soak do Electron principal ou execução de ponta a ponta em hardware de 8 GB.

## J. Segurança e privacidade

A publicação contém apenas métricas, códigos técnicos e IDs de fixtures sintéticos. Não contém PDFs, imagens, OCR, nomes, documentos pessoais, valores financeiros reais, hashes de PDF privado, cofres, logs, dumps ou credenciais. O resumo JSON marca explicitamente essas classes como ausentes.

Gitleaks padrão 8.30.1 foi executado somente nos dois arquivos de publicação e encontrou zero resultados. Isso é higiene documental, não substitui a política oficial nem autoriza `SECURITY`. Permanecem indisponíveis neste ambiente:

| Gate oficial | Bloqueio e desbloqueio concreto |
|---|---|
| Gitleaks DevKit | Não há caminho/hash da política oficial nem adapter aprovado. O mantenedor do DevKit A3 deve fornecer a versão da política e o comando/escopo oficial. |
| SkySecurityGate 1.0.0 | Binário/integração oficial não disponível. O mantenedor DevKit A3 deve disponibilizar a versão 1.0.0 e executar gate no escopo autorizado, emitindo evidência válida. |
| Evidence v1 | Schema/writer oficial não disponível. O mantenedor do DevKit deve fornecer contrato versionado e writer capaz de emitir evidência validada. |

Nenhum resultado do Gitleaks padrão será descrito como aprovação oficial. `SECURITY=BLOCKED` até os três itens acima serem atendidos.

## K. Gates e decisão

| Gate | Estado | Fundamentação |
|---|---|---|
| `SEGMENTATION_REGRESSION` | `PARTIAL_NOT_CERTIFIED` | Regressão sintética 7/7 e zero falsos cortes; replay histórico idêntico da página 11 impossível e registros PR6.23 discordam. |
| `FIELD_ASSOCIATION` | `PASS_SYNTHETIC_ONLY` | 12/12 ligações únicas no fixture; 4/4 ambiguidades abstidas; nenhum ganho real confirmado. |
| `TABLE_PROTECTION` | `PASS_SCOPED_SYNTHETIC` | Veto de continuidade preservou três casos tabulares do conjunto; não generaliza para todas as tabelas. |
| `HOLDOUT_QUALITY` | `NOT_CERTIFIED` | Amostra pequena, sete casos de revisão e dois resolvidos automaticamente; score perfeito refere-se apenas aos 18 escoráveis. |
| `EVIDENCE_PROVENANCE` | `PASS_SCOPED_TESTS` | IDs/escopo e hipóteses cobertos por testes e fluxo local mockado; sem avaliação de documentos reais anotados. |
| `LAYA_CONTRACT` | `PASS_MOCKED_ONLY` | Contrato e fallback testados sem provedor/modelo real; não certifica qualidade de classificação. |
| `QUEUE_RESILIENCE` | `PASS_SCOPED_TESTS` | 42 testes focados passaram; smoke empacotado e queda do processo Electron não foram certificados. |
| `CPU_MEMORY` | `NOT_CERTIFIED` | Host de 16 CPUs lógicas; sem medição simultânea nem máquina alvo 4-core/8-GB. |
| `PACKAGED_RUNTIME` | `NOT_CERTIFIED` | Build Windows isolado passou e bootstrap foi observado, porém resposta HTTP funcional, OCR offline, modelos Python e encerramento gracioso não foram comprovados. |
| `REAL_DOCUMENT_QUALITY` | `NOT_CERTIFIED` | Sem referência humana independente para páginas 5, 8, 9 e 11. |
| `SECURITY` | `BLOCKED` | Gitleaks DevKit, SkySecurityGate 1.0.0 e Evidence v1 ausentes. |
| `RELEASE` | `BLOCKED` | Depende de segurança, runtime empacotado e qualidade real ainda sem certificação. Nenhum release realizado. |

**Decisão geral: investigação concluída; não promover a arquitetura experimental.** Resultados sintéticos apoiam a associação regional, enquanto a segmentação real, runtime completo, segurança e qualidade documental permanecem não certificados.

## L. Próximas ações necessárias

1. Obter do DevKit A3 mantenedor os três contratos oficiais de segurança, versões e adapters; executar e arquivar evidência aceita.
2. Reproduzir a página 11 somente quando o código PR6.23 e as entradas idênticas de OCR/renderização estiverem disponíveis; comparar causas tipadas sem expor conteúdo privado.
3. Corrigir/calibrar os dois casos de revisão ambígua do holdout em um conjunto de desenvolvimento; criar novo holdout antes de qualquer ajuste e não reutilizar este holdout para tuning.
4. Repetir o smoke empacotado com probe HTTP que prove a resposta da UI, caminho offline de OCR/layout, limites de subprocesso, ausência de downloads durante processamento e encerramento controlado.
5. Só medir classificação real após um revisor independente autorizado registrar verdade-terreno no cofre local protegido. Até lá, páginas 5, 8, 9 e 11 ficam pendentes e não se promove resultado automático.
6. Medir simultaneamente Node, Python e Electron em ambiente real de quatro núcleos/8 GB antes de declarar `CPU_MEMORY` aprovado.

Nenhum item acima autoriza processar as 129 páginas, enviar documentos municipais a provedores, alterar aprovação humana, publicar dados privados, fazer merge ou release.
