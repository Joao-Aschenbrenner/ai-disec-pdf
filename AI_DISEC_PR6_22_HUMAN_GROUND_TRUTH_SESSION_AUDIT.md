# AI DISEC PDF — Auditoria da sessão de verdade-terreno PR6.22

**Data:** 2026-10-11
**Repositório:** [Joao-Aschenbrenner/ai-disec-pdf](https://github.com/Joao-Aschenbrenner/ai-disec-pdf)
**Auditoria de referência:** `f80c7b6373e3cedf5e2f14ebc20e741473c8f240`
**Decisão desta sessão:** sessão local preparada; verdade-terreno ainda pendente.

## A. Resumo executivo

O Electron de desenvolvimento foi iniciado na sessão interativa do Windows, carregou a interface e permanece aberto para conferência local. A janela foi iniciada em um modo de anotação que mostra apenas a sessão das páginas 5, 8, 9 e 11. Esse modo não divide as 129 páginas, não apresenta comandos de classificação, não consulta configurações de provedores, bloqueia todas as rotas HTTP `/api` e não inicia o Laya.

O PDF municipal ainda não foi selecionado. Nenhum conteúdo, hash, imagem, OCR, identidade, valor ou referência humana foi lido ou gravado. A pessoa autorizada deve abrir o PDF na janela Electron, conferir as páginas originais e registrar as referências diretamente no cofre criptografado local. As quatro páginas permanecem `PENDING_HUMAN_VALIDATION`.

O processo e o carregamento da interface foram confirmados pelo terminal do launcher. O serviço de automação disponível nesta sessão não expõe janelas nativas; portanto, não há prova visual observável do canvas ou do estado do botão na tela. `ELECTRON_VISUAL` permanece `E2E_BLOCKED_ENVIRONMENT`.

## B. Estado do código e preservação

- Checkout de implementação: `fix/exhaustive-vision-failover`, HEAD `91591a75ffd4e616f0a56633377e76efdfc408d1`.
- O checkout original estava sujo com 162 entradas antes desta sessão; a contagem permaneceu em 162. Nenhuma dessas alterações foi staged ou commitada.
- O código avaliado na auditoria anterior tinha fingerprint `9f5545c415db26e098add67f1a1b4a14f5e40c5b67df336f6b6df89b0326da73`. A sessão segura de anotação acrescentou mudanças locais, ainda não commitadas.
- Fingerprint desta sessão: `01506de5ef2cdeb05c322c4522dc186cc67780063dbc8223dca8b9fadf7f2172` em 147 arquivos de código/configuração.
- Método reproduzível do fingerprint atual: SHA-256 dos registros ordenados `caminho relativo + SHA-256 do arquivo`, para arquivos `.ts`, `.tsx`, `.js`, `.cjs`, `.mjs`, `.json`, `.html` e `.css` em `src`, `server`, `electron`, `shared`, `tests` e `scripts`, mais `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vite.config.test.ts` e `.gitignore`.
- O fingerprint anterior é mantido como referência; não se afirma equivalência entre os inventários dos dois relatórios. PDFs, imagens, OCR, cofres, logs, builds e `tmp` são excluídos.
- Não houve `pull`, `reset`, `clean`, `stash`, rebase, merge, commit de código ou release. Os builds foram escritos em diretórios novos dentro de `tmp`.

O código da sessão segura permanece somente no checkout local. Esta publicação contém exclusivamente este relatório e o JSON sanitizado; um auditor remoto não consegue reconstruir o patch de produto apenas com estes dois documentos.

## C. Mudanças locais para uma sessão segura

O fluxo normal tem dois efeitos que não servem para esta conferência: selecionar o PDF divide todas as páginas em memória, e a inicialização consulta o catálogo de provedores e pode iniciar o Laya instalado. A sessão foi preparada com um modo temporário explícito, sem alterar credenciais:

- `electron/main.cjs`: reconhece `AI_DISEC_ANNOTATION_ONLY=1`, não inicia Laya e não abre DevTools nessa sessão.
- `electron/preload.cjs`: expõe o indicador de anotação somente em perfil normal; o modo não se apresenta como `TEST_ONLY`.
- `src/App.tsx`: apresenta seletor próprio de PDF, calcula o fingerprint localmente e abre diretamente o escopo `real-pages-5-8-9-11`. Não chama o divisor de páginas. A busca de configurações, atualização de catálogos, leitura do job mais recente, reanexação e heartbeat do renderer ficam desativados nesse modo.
- `server/server.ts`: responde `423 ANNOTATION_ONLY_MODE` a qualquer rota `/api` e pula a migração dos logs operacionais. O modo de anotação não precisa dessas rotas; a persistência da referência usa IPC local do Electron.
- `src/components/GroundTruthWorkspace.tsx`: oferece uma área de observações de campos ilegíveis ou ambíguos em cada página. O usuário deve deixar valores incertos vazios; a confirmação integral continua bloqueada enquanto faltarem campos obrigatórios.

O escopo não sugere OCR nem classificação. Ele abre a página original selecionada no canvas PDF.js e deixa a pessoa avançar uma página por vez. A página só pode ser confirmada após o preenchimento e a confirmação visual explícitos. Rascunhos e confirmações são destinados ao cofre criptografado do perfil normal.

## D. Perfil, cofre, filas e provedores

- `AI_DISEC_MODE`, `AI_DISEC_TEST_PROFILE` e `AI_DISEC_TEST_ISOLATION` não estavam definidos no processo de lançamento; não havia `.env`. O perfil usado pelo Electron é o normal, em `~/.ai-disec-pdf`, e não um perfil sintético.
- O modo `AI_DISEC_ANNOTATION_ONLY=1` foi definido apenas no processo que iniciou o launcher; não foi gravado no ambiente persistente do usuário.
- O arquivo do cofre de revisão ainda não existia antes da sessão. A interface consulta `reviewVaultStatus` pelo Electron e mantém o seletor desabilitado se o armazenamento protegido não estiver disponível. Como a janela nativa não pôde ser observada, o resultado visual dessa consulta é `NOT_OBSERVED`; a pessoa deve aguardar o seletor ficar ativo antes de carregar o PDF.
- Uma credencial de provedor estava presente no ambiente pai; seu nome e valor não foram impressos nem lidos pela interface de anotação. A tela não busca `/api/settings`, a atualização de catálogo é ignorada, e o middleware bloqueia qualquer chamada ao servidor local. Nenhuma chamada a Vision, NVIDIA ou Laya foi iniciada nesta sessão. Não foi feita captura de pacotes.
- O pacote Laya está instalado, mas a porta local 8000 não estava ouvindo antes nem depois do lançamento; o autostart foi suprimido.
- A porta local 3001 estava livre antes do lançamento e passou a servir o Vite local. O launcher faz apenas uma verificação HTTP local para essa porta. O Electron confirmou `Page loaded successfully`; quatro processos Electron estavam ativos na última verificação.
- O arquivo de checkpoint de jobs já existia. O código do modo não solicita job, não reanexa renderer e não chama `RuntimeJobScheduler.start`; todas as rotas `/api` estão bloqueadas. O carregamento do checkpoint não inicia a fila. O conteúdo do checkpoint não foi aberto neste trabalho.
- A migração automática dos logs foi desativada nesta sessão. Os arquivos operacionais existentes não foram abertos para leitura pelo agente, e nenhum conteúdo foi copiado para este relatório.

## E. Inicialização e evidência Electron

Foi usado o script já existente `npm run electron:dev`, em terminal interativo, com `AI_DISEC_ANNOTATION_ONLY=1` no processo. O script existente inicia o servidor Vite local e depois o Electron; nenhum comando de classificação foi acionado.

Evidências observadas no terminal:

1. O servidor local iniciou em `http://localhost:3001`.
2. O processo Electron informou `NODE_ENV=development` e criou a janela.
3. O renderer informou `Page loaded successfully`.
4. A porta 8000 do Laya continuou fechada.
5. Nenhum PDF foi selecionado durante a preparação.

O controle nativo do computador permanece indisponível para esta sessão. Assim, não foram inspecionados pixels, estado visual do cofre, renderização de página, dados do canvas nem alternância entre páginas. Não declarar PASS visual. A pessoa no Windows deve conferir o cabeçalho `ANOTAÇÃO LOCAL · SEM PROVEDORES`, aguardar o botão de seleção habilitar e então abrir o PDF local.

## F. Procedimento local para a pessoa revisora

1. Na janela Electron aberta, confirme o cabeçalho `ANOTAÇÃO LOCAL · SEM PROVEDORES`. A tela não deve mostrar o botão normal “Identificar & Organizar Páginas”.
2. Aguarde a verificação do cofre protegido. Se o botão de seleção não habilitar, não carregue o PDF; informe que o cofre não ficou disponível.
3. Use `Selecionar PDF para anotação` e escolha o documento municipal local. O modo não separa a fila de 129 páginas nem chama provedores.
4. Confira apenas as páginas físicas 5, 8, 9 e 11 pelo seletor da sessão.
5. Em cada página, preencha os dados diretamente após ler o original e marque a região visual correspondente. Não copie OCR, preencha previsões ou adivinhe campos. Registre o campo incerto na observação de ilegibilidade/ambiguidade; deixe o valor exato vazio.
6. Página 5: classe, evidência da classe, rótulo do valor líquido, valor impresso e as duas regiões monetárias.
7. Página 8: classe, cada linha/pessoa visível, nome, situação do identificador, valor, região da linha, ambiguidades e confirmação de que todas as pessoas foram revisadas.
8. Páginas 9 e 11: registre exatamente dois documentos por página; confira classe, nome, situação do identificador, competência, limites e integridade de cada recorte.
9. Deixe o trabalho parcial se houver qualquer campo obrigatório ilegível ou sem evidência. Só a pessoa revisora deve usar `Confirmar toda a verdade-terreno`, após revisar a página original e todas as referências. O agente não clicará nessa confirmação.

Não envie nomes, identificadores, valores, capturas ou trechos do PDF no chat ou no GitHub. O cofre local é o destino das referências.

## G. Estado da conferência e qualidade documental

| Página | Referência humana | Campos confirmados | Ambiguidades registradas | Medição do modelo |
|---|---|---:|---:|---|
| 5 | `PENDING_HUMAN_VALIDATION` | 0 | 0 | `NOT_MEASURED` |
| 8 | `PENDING_HUMAN_VALIDATION` | 0 | 0 | `NOT_MEASURED` |
| 9 | `PENDING_HUMAN_VALIDATION` | 0 | 0 | `NOT_MEASURED` |
| 11 | `PENDING_HUMAN_VALIDATION` | 0 | 0 | `NOT_MEASURED` |

Contagem nesta sessão: 0 páginas abertas, 0 recortes anotados, 0 referências confirmadas e 0 latências por página. Nenhuma avaliação de classe, nome, valor, associação, separação, recorte, falsa aprovação ou necessidade de revisão foi feita. A qualidade real permanece não certificada.

As referências sintéticas Alice/Bruno e as aprovações `TEST_ONLY` da PR6.21 não são usadas como verdade-terreno municipal nem foram repetidas.

## H. Validação técnica desta preparação

Não foram adicionados nem executados testes automatizados nesta rodada; a prioridade foi deixar a sessão real disponível, sem aumentar contagem de testes.

- `npm run lint` — **PASS** (`tsc --noEmit`).
- Build isolado do renderer em `tmp/pr6-22-gt-session-20261011-r2/renderer` — **PASS**, com os avisos já conhecidos de chunk grande e importação estática/dinâmica do módulo PDF.
- `node --check electron/main.cjs` e `node --check electron/preload.cjs` — **PASS**.
- `git diff --check` — **PASS**, com avisos de normalização LF/CRLF em arquivos preexistentes.
- Inicialização Electron — **PROCESSO E RENDERER CARREGADOS**; inspeção visual nativa — `NOT_AVAILABLE`.

Nenhum PDF real foi renderizado, dividido, classificado ou enviado a uma API. Nenhuma chamada externa foi necessária para lint ou build.

## I. Segurança e privacidade

Os gates oficiais continuam indisponíveis, conforme a auditoria de referência. Não foram repetidas buscas equivalentes:

| Gate oficial | Estado | Desbloqueio necessário |
|---|---|---|
| Política Gitleaks do DevKit A3 | `BLOCKED` | O mantenedor do SkyMetronDevKit deve fornecer caminho, versão/hash e adaptador oficiais. |
| SkySecurityGate 1.0.0 | `BLOCKED` | O responsável pelo DevKit deve disponibilizar a ferramenta/adaptador versionado e executá-lo no repositório autorizado. |
| SkySecurityGate Evidence v1 | `BLOCKED` | O responsável pelo DevKit deve fornecer o contrato e writer v1 e produzir evidência sanitizada válida. |

Gitleaks 8.30.1, com regras padrão, examinou somente cópias temporárias desses dois documentos e encontrou **zero candidatos**. Isso é uma checagem complementar de publicação: não substitui a política DevKit e não autoriza o gate `SECURITY`. Nenhum segredo, documento, imagem, OCR, nome, identificador, valor, caminho privado ou hash do PDF real foi incluído nesta publicação.

## J. Decisões por gate

| Gate | Decisão | Evidência / bloqueio |
|---|---|---|
| `ANNOTATION_MODE` | `RUNNING_LOCAL` | Electron carregado com tela local restrita; PDF ainda não selecionado. |
| `NORMAL_PROFILE` | `PASS_CONFIGURATION_ONLY` | Sem marcadores de perfil sintético; a inspeção visual do perfil permanece indisponível. |
| `PROVIDER_ISOLATION` | `PASS_BY_MODE_CONFIGURATION` | Refresh de provedor ignorado; Laya não iniciado; servidor rejeita todas as rotas `/api`. Sem captura de rede. |
| `QUEUE_START` | `NOT_STARTED_BY_SESSION` | UI não busca jobs e API fica bloqueada; checkpoint local preexistente não foi inspecionado. |
| `VAULT_READY` | `NOT_OBSERVED` | Caminho correto do perfil normal; interface deve manter seleção desabilitada se o armazenamento protegido falhar. |
| `ELECTRON_VISUAL` | `E2E_BLOCKED_ENVIRONMENT` | Renderer carregou, mas automação não acessa a janela nativa; canvas e botão não foram vistos. |
| `HUMAN_GROUND_TRUTH` | `PENDING_HUMAN_VALIDATION` | Nenhuma página aberta ou confirmada por pessoa autorizada. |
| `DOCUMENT_QUALITY` | `NOT_CERTIFIED` | Sem referência independente e sem medição. |
| `SESSION_RECOVERY` | `NOT_TESTED` | Nenhum rascunho humano foi criado nesta sessão. |
| `ORCHESTRATION_QUALITY` | `NOT_CERTIFIED` | Nenhuma comparação de modelos; orquestração experimental não ativada. |
| `SECURITY` | `BLOCKED` | Política oficial Gitleaks, SkySecurityGate 1.0.0 e Evidence v1 ainda faltam. |
| `RELEASE` | `BLOCKED` | Verdade-terreno, qualidade, verificação visual e gates oficiais pendentes. |

## K. Próximas ações necessárias

1. A pessoa revisora deve confirmar que a janela mostra o modo local e que o botão de seleção está habilitado.
2. A pessoa deve selecionar o PDF local e preencher as quatro páginas no escopo, mantendo campos duvidosos em branco e a sessão parcial quando necessário.
3. Após confirmação humana real no cofre local, medir somente os campos com referência independente nas quatro páginas. Não extrapolar para o documento completo.
4. Reabrir a mesma origem e escopo após haver um rascunho para verificar a recuperação local, sem repetir confirmação.
5. Obter os três artefatos oficiais do DevKit e executar os gates versionados antes de qualquer decisão de segurança/release.

## L. Conclusão

A janela Electron está disponível no modo local de anotação, com chamadas de provedor, classificação, divisão das 129 páginas, reanexação automática e migração de logs bloqueadas por configuração. Esta preparação ainda não constitui inspeção visual independente nem verdade-terreno: o usuário precisa selecionar o PDF e registrar as referências manualmente.

Decisão final desta sessão: `HUMAN_GROUND_TRUTH=PENDING_HUMAN_VALIDATION`; `ELECTRON_VISUAL=E2E_BLOCKED_ENVIRONMENT`; `DOCUMENT_QUALITY=NOT_CERTIFIED`; `SECURITY=BLOCKED`; `RELEASE=BLOCKED`. Nenhum código de produto foi commitado, nenhum merge ocorreu e nenhum release foi publicado.
