# AI DISEC PDF — PR6.22: Auditoria de validação controlada de documentos reais

**Data:** 2026-10-11

**Repositório:** `Joao-Aschenbrenner/ai-disec-pdf`

**Fonte da auditoria PR6.21:** commit `abe868f0b1c1e7e659b9e29d5af44abbd5d263c3`

**Código funcional avaliado:** branch local `fix/exhaustive-vision-failover`, HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1`, mais working tree local modificado.

**Fingerprint sanitizado do código/configuração:** `0273b9216902a8140e9f151c676ab9a66b0f2639b6236c5c82ac5a8fa8a46bd2` (142 arquivos de código/configuração, incluindo o catálogo de modelos; sem PDFs, logs, cofres ou builds).
**Escopo:** corrigir o caminho de preview/aprovação e a reanexação segura do renderer; preparar a conferência humana local das páginas 5, 8, 9 e 11; publicar apenas esta auditoria e seu resumo JSON sanitizado. Não é certificação de qualidade real nem release.

## A. Resumo executivo

Foram implementados três ajustes funcionais no working tree local:

1. O preview do cartão agora renderiza o PDF de uma página em canvas usando PDF.js, em vez de tratar o carregamento de um `iframe` como prova de que a imagem ficou visível.
2. A aprovação de revisão fica desabilitada até que o cartão selecionado tenha sido renderizado com sucesso; a função de aprovação repete essa checagem antes de persistir a decisão.
3. O perfil Electron sintético exibe uma faixa `TEST_ONLY`, apresenta rótulos de aprovação e liberação próprios para teste e grava `TEST_ONLY_APPROVAL` na trilha local. A aprovação humana real continua com ação `HUMAN_VERIFIED`.

A reanexação de um renderer passou a reconciliar páginas por página física/segmento, manter decisões locais persistidas apenas quando os bytes do documento continuam iguais e evitar substituição/duplicação dos cartões já existentes. O botão de retomar só fica habilitado quando o scheduler ainda tem as entradas na memória. Quando elas se perderam, a UI explica que a retomada está bloqueada e não tenta recriar resultados ou chamadas.

Os testes unitários/contratos, a suíte completa, o typecheck e os builds isolados passaram. Não foi possível comprovar a renderização em uma janela Electron real nesta rodada: o serviço de Computer Use não expôs janelas nativas. Portanto, a correção de preview e a reanexação ficam **implementadas e verificadas por código/build/testes, mas sem certificação visual E2E no Electron**. A queda do processo principal do Electron também não foi testada.

As páginas municipais reais 5, 8, 9 e 11 não receberam confirmação humana independente nesta rodada. Nenhuma referência foi preenchida automaticamente; todas permanecem `PENDING_HUMAN_VALIDATION`. Não foram executadas comparações de classificação, extração ou estratégias experimentais, pois falta a verdade-terreno humana. Não houve chamada externa de IA, processamento do PDF completo, repetição dos ZIPs sintéticos da PR6.21, commit de código, merge ou release.

**Decisão:** qualidade real `NOT_CERTIFIED`; segurança `BLOCKED`; release `BLOCKED`.

## B. Estado do repositório e preservação

- O checkout de implementação permaneceu em `fix/exhaustive-vision-failover`, HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1`; seu working tree já estava amplamente modificado antes desta etapa e continua assim.
- Na verificação final, `git status --porcelain` retornou 160 entradas modificadas/não rastreadas no checkout de implementação. Isso inclui o estado local anterior e os arquivos desta etapa; nenhum foi limpo ou movido.
- O branch local estava 24 commits atrás de seu ref remoto local no início. Não houve `pull`, `fetch`, `reset`, `rebase`, `merge`, checkout da branch principal ou alteração das mudanças preexistentes.
- O fingerprint informado acima foi calculado a partir de caminhos e hashes SHA-256 de 142 arquivos de código/configuração sob `src`, `server`, `electron`, `shared`, `tests`, `scripts`, `server/models.json` e configurações de build. PDFs, imagens, vaults, logs, diretórios `tmp` e builds foram excluídos do cálculo e da publicação.
- O build novo ficou isolado em `tmp/pr6-22-validation-20261011/`. O diretório `dist/` preexistente manteve os timestamps anteriores. Uma tentativa inicial de encaminhar `--outDir` pelo script geral de build foi interrompida ao constatar que o argumento não isolaria a saída; a compilação foi repetida diretamente em diretório novo e isolado.
- A branch documental foi criada em worktree separado, baseada no commit documental PR6.21 `abe868f0b1c1e7e659b9e29d5af44abbd5d263c3`. Somente este Markdown e o JSON sanitizado desta etapa são candidatos a commit.
- Perfis Electron, cofre, arquivos do usuário, logs e evidências anteriores não foram limpos, movidos ou sobrescritos.

## C. Correções de preview e aprovação

### C.1 Preview de Bruno após restauração

A PR6.21 registrou que o preview de Bruno ficava vazio após restauração embora o PDF sintético e o recorte exportado estivessem íntegros. O caminho de restauração reconstruía um PDF recortado e entregava sua URL a um `iframe`; o app não verificava se o visualizador interno do Electron havia efetivamente pintado o conteúdo.

O novo componente `src/components/PdfReviewPreview.tsx` recebe os bytes Base64 do próprio recorte, valida que o PDF tem uma página, renderiza a página com PDF.js em um canvas e expõe os estados `loading`, `ready` e `error`. Um erro mantém a aprovação bloqueada. A escolha do preview é identificada pelo ID estável do cartão, e a restauração seleciona o primeiro item pela posição da lista, sem confundir índice físico da página com índice visual do cartão.

**Resultado observado:** build do renderer inclui o componente e o worker PDF.js. **Resultado ainda não observado:** imagem real pintada em janela Electron e restauração visual de Bruno. Por falta de janela nativa acessível, esse critério permanece `NOT_VERIFIED_ELECTRON`.

### C.2 Aprovação somente com imagem renderizada

`src/utils/reviewPreviewGate.ts` centraliza a regra: o cartão precisa ser o ativo, ter bytes e ter enviado o evento de renderização concluída para o mesmo ID. Os botões ficam desabilitados para cartões não selecionados ou enquanto o preview carrega/falha. `humanVerifyDocument` aplica a regra novamente antes de abrir a confirmação e persistir a aprovação. A unidade cobre preview ausente, ID divergente e bytes vazios.

### C.3 TEST_ONLY e HUMAN_VERIFIED

No perfil sintético isolado, a UI exibe uma faixa permanente `PERFIL SINTÉTICO TEST_ONLY`, altera o rótulo do cartão e os textos de confirmação/download/ZIP e grava `TEST_ONLY_APPROVAL` com origem `synthetic-test-ui` na trilha local. No perfil normal, a ação permanece `HUMAN_VERIFIED` e a UI usa “Aprovado por você”.

Para manter compatibilidade com o fluxo de ZIP exclusivamente dentro do perfil isolado, o valor de estado de revisão usado pelo mecanismo de elegibilidade continua sendo `HUMAN_VERIFIED`; a interface e a ação auditável distinguem explicitamente a aprovação sintética. Não foi executado ZIP sintético nesta rodada. A trilha PR6.21 continua inalterada.

## D. Reanexação do renderer e resiliência

### D.1 Reanexação segura

`src/App.tsx` só materializa resultados quando o snapshot do servidor confirma `scheduler.availableInMemory`. O caminho de observação não envia novamente as páginas nem chama `/start`; ele consulta os resultados que o scheduler já possui. A nova função `mergeRecoveredRuntimePages` usa página física e segmento como identidade, deduplica entradas repetidas e preserva uma decisão salva/recusada somente quando os bytes do recorte são idênticos e a origem está verificada. Itens existentes sem resultado reanexado não são descartados.

O teste sintético cobre: preservar uma aprovação válida sem duplicar cartão; substituir a aprovação se os bytes diferirem; conservar itens ainda sem resultado; não duplicar o mesmo segmento; e exigir scheduler em memória antes de oferecer retomada.

### D.2 Perda das entradas e limite da recuperação

O checkpoint persistido continua contendo apenas estado operacional. Se o processo do servidor reiniciar e as entradas/imagens voláteis desaparecerem, a UI agora desabilita “Retomar”, exibe o bloqueio e não fabrica classificação. A aplicação ainda não reanexa automaticamente os bytes de um PDF ao job depois da queda do processo principal; uma nova execução exigirá reabrir a origem. Nenhuma política foi alterada para persistir páginas, OCR ou imagens no checkpoint.

### D.3 O que não foi testado

Não houve queda do processo principal do Electron nesta etapa. O ensaio PR6.21 do módulo de servidor isolado continua sendo apenas evidência limitada daquele módulo e não é promovido a certificação de crash do Electron. Também não houve Electron E2E de renderer reload/reconexão nesta etapa.

## E. Verdade-terreno local e qualidade documental

O escopo solicitado foi limitado às páginas físicas 5, 8, 9 e 11. A ferramenta existente `GroundTruthWorkspace` foi mantida como fluxo de referência manual protegido. As anotações devem ser digitadas por humano autorizado após observar a página; OCR ou saída do modelo não pode preencher automaticamente os campos de referência.

| Página | Referência manual necessária | Estado desta auditoria |
|---|---|---|
| 5 | Classe NFS e valor líquido exato vinculado visualmente ao rótulo impresso | `PENDING_HUMAN_VALIDATION` |
| 8 | Classe do documento e associação de cada pessoa às linhas/valores | `PENDING_HUMAN_VALIDATION` |
| 9 | Identidade, limites, competência e integridade dos dois holerites | `PENDING_HUMAN_VALIDATION` |
| 11 | Identidade, limites, competência e integridade dos dois holerites | `PENDING_HUMAN_VALIDATION` |

Não houve confirmação humana recebida na janela de trabalho, e nenhuma anotação foi promovida a `HUMAN_CONFIRMED`. Não consultei o OCR bruto nem publiquei conteúdo, nome, valor, CPF, imagem, caminho privado ou hash do PDF municipal. O campo “PENDING” deste relatório é um estado de auditoria; não afirma que uma nova anotação foi gravada no vault.

### Métricas de classificação

| Página | Classe | Nome/associação | Valor | Segmentação/recortes | Tempo/falhas |
|---|---|---|---|---|---|
| 5 | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| 8 | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| 9 | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |
| 11 | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` | `NOT_MEASURED` |

Essas métricas ficam em `NOT_MEASURED`, e não zero, porque a referência humana independente ainda não existe. Comparação entre pipeline atual e estratégias experimentais, falsa aprovação, revisão necessária, associação e latência não foi executada. Nenhum resultado mockado é usado como evidência de qualidade real. A nova orquestração continua desligada por padrão.

Os dois ZIPs sintéticos Alice/Bruno da PR6.21 não foram repetidos: não houve sinal de regressão que justificasse refazê-los.

## F. Arquivos e funções desta etapa

| Caminho | Mudança desta etapa |
|---|---|
| `src/components/PdfReviewPreview.tsx` | Renderiza bytes do recorte com PDF.js em canvas e só anuncia `ready` após concluir o desenho. |
| `src/utils/reviewPreviewGate.ts` | Regra verificável para habilitar aprovação apenas do preview selecionado e renderizado. |
| `src/utils/runtimeRecoveryMerge.ts` | Reconciliação/deduplicação de resultados e decisões locais; elegibilidade de retomada exige entradas em memória. |
| `src/App.tsx` | Restauração seleciona bytes/ID do cartão; bloqueia aprovação sem imagem; rotula TEST_ONLY; reconcilia reanexação e bloqueia retomar sem inputs. |
| `src/utils/documentReview.ts` | Tipo/validação da ação local `TEST_ONLY_APPROVAL`. |
| `src/utils/reviewPersistence.ts` | Contrato de ação de auditoria inclui `TEST_ONLY_APPROVAL`. |
| `electron/localReviewVault.cjs` | Vault aceita e preserva a ação sintética distinta. |
| `tests/review-preview-gate.test.ts` | Testa prontidão visual por cartão. |
| `tests/runtime-recovery-merge.test.ts` | Testa idempotência, decisão persistida, bytes divergentes, itens pendentes e retomada. |
| `tests/document-review.test.ts`, `tests/local-review-vault.test.ts` | Testam a distinção TEST_ONLY na trilha de auditoria. |

`src/App.tsx`, os utilitários de revisão e parte da suíte já estavam modificados antes desta etapa. Nenhum arquivo de produto foi commitado ou publicado. O fingerprint do working tree é a identificação técnica usada para vincular os testes ao estado local; o código correspondente não está contido na branch documental pública.

## G. Testes e builds

Todos os comandos abaixo foram executados no working tree identificado na seção B, sem chamadas externas a provedores:

- Testes focados: `npm test -- tests/runtime-recovery-merge.test.ts tests/review-preview-gate.test.ts tests/document-review.test.ts tests/review-persistence.test.ts tests/local-review-vault.test.ts tests/runtime-job-scheduler.test.ts tests/zip.test.ts --reporter=dot` — **7 arquivos, 56 testes aprovados**.
- Suíte completa: `npm test -- --reporter=dot` — **48 arquivos passaram, 1 foi ignorado; 736 testes passaram, 1 foi ignorado**. `tests/integration-nvidia.test.ts` foi ignorado pela configuração de integração; chamadas de provedor nos outros testes foram mocks/fixtures.
- Typecheck/lint: `npm run lint` (`tsc --noEmit`) — **PASS**.
- Renderer isolado: `node_modules/.bin/vite build --outDir tmp/pr6-22-validation-20261011/renderer` — **PASS**, incluindo bundle do PDF.js/worker; avisos existentes de chunk grande e importação dinâmica foram mantidos.
- Módulo de servidor isolado: `node_modules/.bin/esbuild server/bin/server-module.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=tmp/pr6-22-validation-20261011/server-module.cjs` — **PASS**, com avisos conhecidos de `import.meta` em formato CommonJS.
- `git diff --check` — **PASS**, com avisos de normalização LF/CRLF em três arquivos já modificados.
- ZIP pendente continua protegido por `isPageExportable` e os testes existentes de ZIP passaram na suíte; não foram gerados novos ZIPs.
- Não executados: Electron visual/E2E, crash do processo principal, PDF municipal completo, chamadas externas, benchmark A/B real, auditoria de dependências e soaks de memória.

## H. Segurança, privacidade e reprodutibilidade

- A publicação contém somente este Markdown e `AI_DISEC_PR6_22_REAL_DOCUMENT_VALIDATION_SUMMARY.json`.
- Não contém PDF, imagem/prévia, OCR, nome real, identificador, valor, página escaneada, log, dump, vault, caminho local ou hash derivado do documento real.
- O executável Gitleaks 8.30.1 existe no host, mas não há política oficial DevKit/Gitleaks nem arquivo de configuração oficial neste checkout. A busca no repositório não encontrou configuração/política nem o contrato Evidence v1.
- O comando `SkySecurityGate` não está disponível. O contrato oficial `SkySecurityGate Evidence v1` também não foi localizado. Portanto, nenhum gate oficial de segurança foi executado ou declarado PASS.
- Uma verificação suplementar do Gitleaks 8.30.1, com regras padrão e escopo restrito aos dois arquivos staged (22,56 KB), terminou com zero findings. O conteúdo bruto de matches não foi impresso. Isso não substitui o gate oficial nem libera `SECURITY`.
- O fingerprint de código usa somente hashes de arquivos fonte/configuração; não usa o hash do PDF municipal.
- A suíte completa não é gate de segurança. `SECURITY=BLOCKED` até disponibilizar política/adaptador oficiais e evidência sanitizada.

## I. Decisões por gate

| Gate | Decisão | Evidência/limite |
|---|---|---|
| `PREVIEW_RESTORATION` | `IMPLEMENTED_NOT_CERTIFIED` | Canvas PDF.js, build e bloqueio por render concluído passaram em testes; imagem de Bruno não foi confirmada em Electron real. |
| `APPROVAL_REQUIRES_VISIBLE_CROP` | `PASS_UNIT_BUILD_ONLY` | Helper e função de aprovação exigem o ID renderizado; não houve clique visual E2E. |
| `TEST_ONLY_VS_HUMAN_VERIFIED` | `PASS_UNIT_BUILD_ONLY` | Faixa/rótulo/ação distinta no código e trilha; perfil Electron não foi aberto para inspeção visual. |
| `RENDERER_REATTACHMENT` | `PASS_UNIT_CONSTRAINED` | Merge idempotente, preservação condicional e bloqueio de retomar sem entradas cobertos por unidade; sem E2E real do renderer. |
| `MAIN_ELECTRON_PROCESS_CRASH` | `NOT_TESTED` | Nenhuma queda do processo principal foi executada. O teste de módulo da PR6.21 não vale como evidência deste gate. |
| `PENDING_ZIP_BLOCK` | `PASS_TEST_SUITE` | Elegibilidade existente exclui pendentes; testes de ZIP passaram. Nenhuma exportação foi repetida. |
| `GROUND_TRUTH_PAGES_5_8_9_11` | `PENDING_HUMAN_VALIDATION` | Nenhuma referência foi confirmada por pessoa nesta etapa; OCR não foi usado para preencher referência. |
| `AUTOMATIC_QUALITY` | `NOT_CERTIFIED` | Sem verdade-terreno humana, métricas e comparações reais não foram executadas. |
| `ORCHESTRATION_QUALITY` | `NOT_CERTIFIED` | Sem benchmark controlado contra referências; orquestração experimental permanece desligada. |
| `SECURITY` | `BLOCKED` | Política oficial DevKit/Gitleaks, SkySecurityGate e Evidence v1 indisponíveis. Gitleaks padrão é somente suplementar. |
| `RELEASE` | `BLOCKED` | Qualidade real pendente, E2E Electron ausente e gates oficiais de segurança bloqueados. |

## J. Próximas ações necessárias

1. **Humano autorizado:** no AI Disec local, abra o PDF original e use “Anotar verdade-terreno”. Preencha manualmente as páginas 5, 8, 9 e 11, conferindo rótulo/valor líquido, associações de linhas e os quatro limites/identidades de holerite. Confirme a referência somente depois de revisar as páginas; não é necessário enviar esses dados no chat.
2. **Electron E2E:** com fixture sintético isolado, confirme a renderização visível dos dois recortes após restauração, botões bloqueados durante carregamento/falha e rótulos TEST_ONLY. Não repetir ZIPs salvo se aparecer regressão.
3. **Reanexação:** testar renderer reload com job vivo, contagem de chamadas antes/depois, resultados preservados e ausência de duplicação. Em uma rodada separada, encerrar o processo principal Electron e confirmar estado recuperável sem afirmar que input não persistido pode ser retomado sozinho.
4. **Qualidade real:** só após as referências humanas, executar comparações com as páginas autorizadas, sem mock de resposta de qualidade. Registrar classe, associação, valor, recortes, revisão/falsa aprovação, duração e falhas sem PII em artefatos públicos.
5. **Segurança:** obter a política oficial DevKit/Gitleaks e o adaptador SkySecurityGate/Evidence v1, executar no escopo aprovado e produzir evidência sanitizada. Até lá, manter `SECURITY` e `RELEASE` bloqueados.

## K. Conclusão

Esta etapa melhora a segurança de aprovação e a reconciliação local, e a implementação compila e passa os testes. Ela **não certifica** que o preview de Bruno já está visível em Electron, não certifica crash do processo principal, não mede a qualidade documental real e não confirma as páginas 5, 8, 9 e 11. A decisão é `QUALITY=NOT_CERTIFIED`, `SECURITY=BLOCKED`, `RELEASE=BLOCKED`. A publicação documental não promove código nem muda qualquer decisão de produto.
