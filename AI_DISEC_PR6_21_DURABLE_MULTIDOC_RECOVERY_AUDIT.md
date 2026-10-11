# AI DISEC PDF — Auditoria PR6.21: recuperação durável e E2E multidocumento

**Data da auditoria:** 2026-10-11
**Repositório:** Joao-Aschenbrenner/ai-disec-pdf
**Código testado:** branch local fix/exhaustive-vision-failover, HEAD 91591a75ffd4e616f0a56633377e76efdfc408d1, mais alterações locais não commitadas existentes
**Base da publicação documental:** origin/master em 37357fc418f629bc91358890c26f9e1a81e23247
**Escopo:** fechamento sintético da PR6.21 e publicação desta auditoria; não é release nem promoção do código de produto.

## A. Resumo executivo

A PR6.21 corrigiu a restauração visual dos cartões de revisão após reiniciar o Electron: a UI não depende mais exclusivamente do objeto File em memória, e reidrata os cartões a partir do cofre local, validando a origem antes de reconstruir os recortes. O fluxo sintético Alice/Bruno foi demonstrado pela interface Electron isolada, incluindo estados independentes, reinícios e dois ZIPs verificados.

O primeiro ZIP contém exatamente o PDF sintético de Alice. O segundo contém exatamente os PDFs sintéticos de Alice e Bruno. Um verificador local confirmou identidade, campos de referência, geometrias e ausência de mistura. A queda isolada do módulo do servidor restaurou o job como pausado e sem resultado; a continuação exigiu reanexar a entrada e produziu uma única saída em revisão.

As aprovações executadas na interface foram automações TEST_ONLY em perfil isolado. Elas não são confirmação humana real nem ground truth de documentos municipais. Depois da execução, o usuário informou que revisou Alice e autorizou sua aprovação; essa mensagem posterior não foi atribuída retroativamente à ação automatizada nem alterou o ledger TEST_ONLY.

Decisão: MULTIDOC_E2E=PASS_SYNTHETIC; STATE_RECOVERY e QUEUE_RESILIENCE=PASS_SYNTHETIC_CONSTRAINED. AUTOMATIC_QUALITY e ORCHESTRATION_QUALITY continuam NOT_CERTIFIED. SECURITY e RELEASE continuam BLOCKED. Nenhum PDF municipal foi processado, nenhum provedor externo foi chamado e nenhum código de produto foi incluído na publicação documental.

## B. Estado do repositório e preservação

- Checkout observado antes da publicação: branch fix/exhaustive-vision-failover, HEAD 91591a75ffd4e616f0a56633377e76efdfc408d1.
- Após atualizar apenas as referências remotas, origin/fix/exhaustive-vision-failover estava 24 commits à frente do HEAD local.
- O working tree já estava amplamente modificado e continha artefatos não rastreados das rodadas PR6.x. Não foi limpo, resetado ou reorganizado. O estado testado corresponde ao HEAD acima mais as alterações locais existentes; portanto, o SHA do HEAD, sozinho, não identifica todo o código executado.
- O remote informado corresponde ao repositório público Joao-Aschenbrenner/ai-disec-pdf; origin/master apontava para 37357fc418f629bc91358890c26f9e1a81e23247 após fetch.
- A publicação usa uma branch documental separada, audit/pr6-21-report-20261011, baseada no origin/master atualizado. Ela contém somente este Markdown e o resumo JSON sintético indicado abaixo. Não altera master nem incorpora as alterações de implementação locais.
- Nenhum relatório anterior foi substituído. Não houve limpeza de perfis, cofres, logs, ZIPs ou builds. Não houve processamento do PDF municipal de 129 páginas, chamada a provedor, commit de código, merge ou release.

## C. Causa-raiz da restauração visual

Antes da correção, o ramo principal da UI tratava selectedFile — um objeto File mantido apenas em memória — como sinal de que havia documento carregado. Depois que o Electron reiniciava, selectedFile começava nulo. O cofre recuperava splitPages e os registros individuais, mas o ramo que exibia cartões e preview permanecia oculto. O checkpoint concluído coexistia com resultados visualmente ausentes.

Na PR6.21, a UI considera documento carregado quando há selectedFile ou splitPages restauradas. A hidratação consulta os registros associados ao fingerprint do PDF, recompõe os metadados e restaura cartões e preview. O IPC obtém a página da origem e valida que o arquivo existe e que seu SHA-256 ainda corresponde ao registro antes de devolver bytes ao renderer. Se a origem está ausente ou mudou, a revisão é invalidada e o documento não se torna exportável.

A persistência de metadados/decisões e a reconstrução de bytes ficam separadas: o checkpoint não armazena imagem ou conteúdo documental. A restauração dos cartões e aprovações após reinício do Electron foi observada no perfil sintético. Há, contudo, duas limitações de renderer registradas nas seções E e G: o preview de Bruno ficou vazio e o job da queda isolada não foi reanexado ao renderer.

## D. Implementação, contratos e funções relacionadas

O estado de código avaliado é o working tree PR6.x local, não um commit publicado. Os arquivos/funções relevantes são:

| Arquivo | Funções/contrato e responsabilidade |
|---|---|
| src/App.tsx | hasLoadedDocument reconhece splitPages restauradas; restoreReviewRecords recompõe e valida cartões; persistReviewSnapshot grava snapshots; reidratação de sessão repõe cartões/preview e evita duplicar recortes. |
| src/utils/reviewPersistence.ts | makePersistedDocumentReview, mergePersistedReview e invalidatePersistedReview; IDs/fingerprints estáveis de documento, recorte, metadados e base de revisão; alterações incompatíveis invalidam aprovação. |
| electron/main.cjs | getReviewSourcePage valida origem e hash, recupera a página física e recorta a região solicitada; IPC do cofre valida renderer confiável e retorna respostas estruturadas. |
| electron/preload.cjs | expõe métodos restritos de status/listagem/leitura/gravação do cofre e recuperação da página via IPC, sem expor IPC genérico ao renderer. |
| electron/localReviewVault.cjs | cofre local protegido, validação de schemas/campos, gravação atômica e falha fechada na leitura inválida. |
| src/utils/pageSegmenter.ts | splitPdfPageAtRatio recompõe PDFs recortados usando proporção/posição persistidas; limites de proporção são restringidos. |
| src/utils/zipExport.ts e src/types.ts | isPageExportable e collectZipExportEntries excluem estados pendentes, origens ausentes/alteradas e registros sem elegibilidade; nomes de saída são estabilizados. |
| server/runtimeJobStore.ts e server/runtimeJobScheduler.ts | checkpoint guarda IDs/estados/etapas/contadores, não conteúdo; na inicialização RUNNING/QUEUED vira PAUSED e páginas RUNNING voltam a PENDING. |
| tests/review-persistence.test.ts, tests/local-review-vault.test.ts, tests/zip.test.ts e testes runtime | contratos de persistência, invalidation, fail-closed, fila, retry e elegibilidade do ZIP. |

A lista delimita os caminhos funcionais auditados, não atribui cada alteração do working tree a uma única PR. Nesta publicação, apenas documentação sanitizada é preparada para commit.

## E. Evidências Electron e transições de estado

Foi usado somente o fixture sintético pr6-18-multidoc: uma página física com dois holerites fictícios, Alice Sintética no recorte superior e Bruno Amostra no recorte inferior. O hash do fixture é publicado no resumo JSON porque identifica exclusivamente esse fixture sintético. O perfil Electron foi isolado do perfil real e o harness bloqueou chamadas externas a provedores.

Campos de referência do fixture: Alice Sintética, Prefeitura Fictícia de Exemplo, competência 12/2025, registro DEMO-101 e líquido sintético R$ 1.234,56; Bruno Amostra, mesmo empregador fictício, competência 12/2025, registro DEMO-202 e líquido sintético R$ 987,65.

Sequência observada:

1. A classificação sintética produziu dois cartões/recortes, um por pessoa. A origem foi verificada pelo fingerprint/hash.
2. A interface aprovou Alice por automação SKY_CUA e marcou o evento TEST_ONLY. Bruno permaneceu NEEDS_REVIEW.
3. Após reiniciar o Electron, a UI restaurou os dois cartões com estado misto: Alice aprovada no escopo de teste; Bruno pendente. Isso permitiu verificar que a aprovação de Alice não aprovava Bruno por associação.
4. O primeiro ZIP foi gerado enquanto Bruno ainda estava pendente. A interface confirmou contagem de um arquivo.
5. O cartão de Bruno foi aberto e os campos persistidos foram confrontados com o fixture. O preview ao vivo de Bruno, porém, ficou vazio/cinza após restauração; a imagem original sintética preservada e o PDF exportado foram usados para validação, não um preview da UI.
6. Bruno foi aprovado pela interface de teste e a ação foi registrada separadamente como TEST_ONLY. Após novo reinício, os dois cartões apareceram aprovados no perfil sintético.
7. Depois da injeção de queda do servidor, o ciclo Electron 11 voltou a mostrar os dois cartões aprovados e a origem verificada. O checkpoint operacional do renderer ainda mostrava PAUSED porque o job isolado do módulo de servidor não estava anexado ao renderer.

O ledger local append-only registra scope TEST_ONLY, automação, estado antes/depois, IDs sintéticos e realHumanConfirmation=false; o cabeçalho marca humanGroundTruth=false. A UI mostra a frase genérica “aprovado(s) por revisão humana”, mas isso não transforma a automação de teste em revisão humana real. O ledger da execução não foi alterado para incorporar uma resposta recebida depois do teste. A revisão posterior declarada pelo usuário limita-se à Alice fictícia e não certifica documentos reais.

## F. ZIPs e integridade dos recortes

Os dois arquivos foram baixados pelo fluxo da interface e abertos pelo verificador scripts/pr6-18-verify-multidoc-export.ts. O resultado local foi PASS_SYNTHETIC_CROP_AND_EXPORT_INTEGRITY. Os arquivos binários ZIP e os PDFs não serão publicados; o resumo verificável com contagens, hashes sintéticos, dimensões e sinais checados acompanha este relatório em AI_DISEC_PR6_21_SYNTHETIC_EVIDENCE_SUMMARY.json.

**ZIP 1 — estado misto:** SHA-256 do ZIP 9D50143E4F78C0B954D061F46D64AAD3422520DD73CEF9086E62F8FD2AB7F7B4; tamanho local 138.356 bytes; exatamente uma entrada, pag1_HOL_Alice_Sintetica.pdf. O PDF tem uma página, identidade única de Alice, registro, competência e valor líquido sintéticos reconhecidos; não contém identidade de Bruno. Bruno estava NEEDS_REVIEW e não foi exportado.

**ZIP 2 — ambas as aprovações TEST_ONLY:** SHA-256 do ZIP 8C1576441F2883D4AE0F6647EE92701862406292931D0E04CE351E7F37D2CD25; tamanho local 284.992 bytes; exatamente duas entradas distintas: pag1_HOL_Alice_Sintetica.pdf e pag1_HOL_Bruno_Amostra.pdf. Os dois PDFs têm uma página cada; verificador marcou identidade, registro, competência e valor líquido como verdadeiros e ausência de conteúdo da outra pessoa. Não houve duplicação, campo cortado ou página perdida.

A página fonte mede 595,28 × 841,89 pt. O recorte superior de Alice mede 595,28 × 372,54 pt (44,25%); o inferior de Bruno mede 595,28 × 469,35 pt (55,75%). As alturas somam a altura da página fonte. SHA-256 dos PDFs extraídos: Alice no ZIP 1 4dde5afddf555503638f1f92eb66e533ac20538752ff4a2b711c2e0bd7579d1d; Alice no ZIP 2 92c778160f6695202f9c324b4344958c96d6a91a3d2b3e6da3aeab2ea0317df9; Bruno no ZIP 2 da592319389d37e2e875f9d64beeeb93e36c16df8e93fdd8c56f8214f4dd05d3. Os hashes binários de Alice diferem entre as duas exportações; portanto, foi verificada a identidade/conteúdo esperado e geometria em cada exportação, mas não a igualdade byte a byte entre os dois PDFs de Alice.

A prova atende aos nove critérios sintéticos: dois documentos detectados em uma página; dois recortes; aprovações independentes; persistência dos cartões após reinício; ZIP 1 só Alice; ZIP 2 Alice+Bruno; correspondência de identidade e geometria; ausência de mistura/duplicação; e exclusão de Bruno enquanto pendente.

## G. Resiliência e queda isolada do servidor

A aplicação inicia o servidor dentro do processo principal do Electron. Para testar uma queda do processo do servidor sem matar a UI, o harness executou o módulo compilado do servidor como filho Node isolado, usando o perfil sintético. Isso testa o módulo e o cofre/checkpoint partilhado, mas não é equivalente a matar o processo principal real do Electron.

O job sintético foi marcado RUNNING e a página p1 estava RUNNING; o endpoint de resultado retornava 404. O filho foi terminado por SIGKILL. Após reiniciar o módulo, o checkpoint voltou PAUSED, a página PENDING, stage QUEUED, zero páginas concluídas, zero resultados e scheduler indisponível em memória. Resume/start sem reanexar a entrada retornaram HTTP 409; nenhum resultado foi inventado.

O harness então reanexou explicitamente o input (HTTP 202) e iniciou a recuperação (HTTP 202). A execução concluiu o job com página NEEDS_REVIEW, uma chamada sintética, uma saída no endpoint e uma entrada no resumo. A contagem de HTTP externo de provedor foi zero. A saída não se tornou autoaprovada. O teste terminou em PASS_EXPLICIT_REATTACH_AND_RESUME_SYNTHETIC_ONLY.

stdout/stderr foram drenados: no harness de crash, stdout 249 bytes, stderr 0, EPIPE=false. No fechamento do Electron ciclo 11, o supervisor registrou exit code 0, stdout 708 bytes, stderr 0 e EPIPE=false. A evidência resumida está no JSON publicado. Capturas, logs brutos, perfis e cofres ficam locais e não são incluídos no commit.

A recuperação de estado do cofre no Electron após reinício foi comprovada; a retomada coordenada desse job específico pela UI não foi. O renderer mostrou PAUSED porque não estava anexado ao processo isolado. Essa limitação explica o qualificador CONSTRAINED dos gates de recuperação.

## H. Testes, build e comandos

Os comandos abaixo foram executados na árvore de trabalho PR6.x existente, não na branch documental. Não foram repetidos porque os artefatos e resultados desta mesma rodada estavam disponíveis; a alteração desta tarefa é documental.

- Testes focados, 7 arquivos/82 testes: npm test -- tests/local-review-vault.test.ts tests/review-persistence.test.ts tests/zip.test.ts tests/runtime-job-scheduler.test.ts tests/runtime-page-processor.test.ts tests/runtime-result-contract.test.ts tests/server.test.ts --reporter=dot
- Suíte completa: npm test -- --reporter=dot — 46 arquivos, 729 testes aprovados, 1 ignorado.
- Lint: npm run lint — PASS.
- Tipos: tsc --noEmit — PASS.
- Build isolado do renderer: node_modules/.bin/vite build --outDir tmp/pr6-21-certification-20261011-01/renderer — PASS; avisos de chunk/import foram observados.
- Bundle isolado do servidor: node_modules/.bin/esbuild server/bin/server-module.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=tmp/pr6-21-certification-20261011-01/server-module.cjs — PASS; avisos de import.meta em CommonJS foram observados.
- Verificação dos ZIPs: node_modules/.bin/tsx scripts/pr6-18-verify-multidoc-export.ts --profile <perfil-sintético> --first <zip-alice> --second <zip-alice-bruno> — PASS_SYNTHETIC_CROP_AND_EXPORT_INTEGRITY.
- Espaçamento: git diff --check — PASS, apenas avisos de normalização LF/CRLF em três fontes preexistentes.
- npm audit anterior: 8 moderadas, zero altas e zero críticas no conjunto completo; npm audit --omit=dev reportou zero vulnerabilidades de produção no conjunto examinado.

O build registrou também avisos conhecidos de bundle/importação dinâmica e CommonJS; não foram tratados como erros. Soak de memória não foi repetido nesta rodada. Os testes de segurança oficiais não são substituídos pela suíte funcional.

## I. Segurança e privacidade da publicação

O pacote público da auditoria contém apenas este relatório e um resumo JSON sintético. Não inclui PDF municipal, imagem escaneada/preview, OCR bruto de documento real, nomes/CPFs reais, salários reais, cofre, tokens, chaves, log bruto, dump de memória ou arquivo temporário. Nomes, empregador, competência, registros, valores e hashes citados para Alice e Bruno pertencem exclusivamente ao fixture sintético. Os arquivos ZIP/PDF sintéticos e capturas locais não serão publicados.

A auditoria manual do conteúdo foi feita para os dois arquivos destinados ao stage. O scanner Gitleaks 8.30.1 executado sobre exatamente esses arquivos staged, com regras internas padrão, não encontrou findings. A saída bruta não foi exibida nem publicada. Isso é uma verificação complementar; a política oficial Gitleaks mantida pelo DevKit não foi localizada neste ambiente, e o comando SkySecurityGate 1.0.0 e o contrato Evidence v1 continuam indisponíveis. Portanto, SECURITY permanece BLOCKED e nenhum PASS oficial é declarado.

npm audit anterior identificou oito alertas moderados de cadeia de desenvolvimento/empacotamento Electron e zero high/critical; omitindo dependências de desenvolvimento, zero vulnerabilidades de produção foram reportadas. Isso não substitui a adjudicação dos candidatos históricos do Gitleaks sob a política DevKit nem SkySecurityGate.

## J. Qualidade documental e contexto PR6.19/PR6.20

**PR6.19:** o runtime estava em 8/129, parado por aproximadamente 3 min 48 s, concorrência 1, com três eventos da página 9 (dois rotulados NVIDIA e um sem provedor), sem status HTTP, duração individual ou código de transporte. A origem externa não foi determinada. O EPIPE foi isolado no pipe do harness, com saída drenada e encerramento normal; não há evidência de que EPIPE tenha causado a falha de classificação. O E2E multidocumento ainda falhou naquela rodada por não restaurar cartões após reinício e não produzir segundo ZIP.

**PR6.20:** limites de fila/retry, deadline, cancelamento, circuito por provedor e rejeição de payload incompleto passaram em testes sintéticos. A orquestração A/B/C foi comparada em quatro fixtures com respostas mockadas; classe/contagem conhecidas foram iguais, sem ganho de qualidade provado. Latências eram locais/mockadas e não comparáveis à produção. A flag experimental permaneceu desligada por padrão e não deve ser promovida por esses dados.

**Documentos reais:** páginas 5, 8, 9 e 11 continuam sem verdade-terreno humana independente certificada. Não se verificou a NFS da página 5, a classificação da página 8, os nomes/recortes reais da página 9 nem o resultado da página 11 nesta PR6.21. O PDF municipal inteiro não foi executado. O reporte posterior do usuário sobre conferir Alice se refere apenas ao personagem sintético e não altera esses estados.

## K. Decisões finais por gate

| Gate | Decisão | Fundamentação |
|---|---|---|
| STATE_RECOVERY | PASS_SYNTHETIC_CONSTRAINED | Cartões/estados persistiram em reinícios do Electron; crash isolado recuperou PAUSED/PENDING sem resultado inventado e exigiu reanexação. O job isolado não foi ligado ao renderer. |
| MULTIDOC_E2E | PASS_SYNTHETIC | Evidência local verificável cobre os nove critérios em E/F: dois cartões e recortes, aprovações independentes, restauração, dois ZIPs e validação de conteúdo/geometria sem exportação pendente. Não equivale a qualidade real. |
| QUEUE_RESILIENCE | PASS_SYNTHETIC_CONSTRAINED | SIGKILL, zero resultados após reinício, 409 sem input, continuação após reanexação, uma chamada/saída sintética e nenhum HTTP externo. |
| AUTOMATIC_QUALITY | NOT_CERTIFIED | Sem ground truth humana independente para documentos municipais reais. |
| ORCHESTRATION_QUALITY | NOT_CERTIFIED | Benchmarks A/B/C foram mockados e não mostraram melhora real; arquitetura permanece experimental/desligada. |
| SECURITY | BLOCKED | Sem política oficial DevKit/Gitleaks, SkySecurityGate 1.0.0 e Evidence v1. |
| RELEASE | BLOCKED | Gates oficiais de segurança e certificação de qualidade real permanecem pendentes. Não houve release. |

## L. Recomendações por prioridade

1. **P0 — Segurança oficial:** obter a política Gitleaks do DevKit e contrato/adaptador SkySecurityGate Evidence v1; executar no escopo apropriado, sanitizar a evidência e resolver findings conforme política. Aceitação: gate oficial com evidência versionada, sem HIGH/CRITICAL/unknown.
2. **P1 — Paridade de recuperação UI/backend:** corrigir o preview vazio de Bruno e testar queda do processo Electron principal com retomada coordenada, sem duplicação ou resultado inventado. Aceitação: cartões e recortes restaurados, estados visíveis, job continuado somente após input recuperável, exportação pendente bloqueada.
3. **P1 — Qualidade real controlada:** somente com autorização e referências humanas independentes, validar páginas 5, 8, 9 e 11 por conteúdo, identidade, valor líquido, separação/geometry e decisão de revisão. Aceitação: métricas por página e evidência auditável sem PII em logs.
4. **P2 — Memória e runtime:** repetir soak comparável e investigar bytes privados antes de considerar promoção; medir latência/retries com critérios predefinidos e sem aumentar limites por conveniência.

Até os critérios P0/P1 aplicáveis e gates oficiais passarem, manter SECURITY/RELEASE bloqueados. Não processar o PDF municipal completo nem promover orquestração experimental como consequência desta auditoria.
