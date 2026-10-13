# AI DISEC PDF — Certificação do Runtime Windows após PR6.25

**Data da execução:** 2026-10-13
**Escopo:** smoke funcional do pacote Electron Windows com fixture inteiramente sintético.
**Decisão:** operação parcial comprovada; certificação do pacote **REJECT**. Segurança e release permanecem bloqueados.

## 1. Resumo executivo

O pacote Windows iniciou, o renderer Electron ficou acessível e o servidor embutido respondeu HTTP 200 em /health pelo endereço de loopback IPv4 127.0.0.1. O PDF sintético foi aberto pela interface e renderizado pelo PDF.js. O perfil era TEST_ONLY, sem chave de provedor e sem chamadas externas.

O smoke encontrou duas falhas funcionais relevantes. Primeiro, o pacote não continha os modelos de idioma Tesseract por e eng; antes da correção local, a inicialização do worker podia permanecer pendente sem progresso. Foi adicionado um preflight local que falha rapidamente e rastreável, sem tentar baixar modelos. Depois da correção, a chamada OCR terminou em HTTP 503 em 7 ms: o erro ficou visível e não virou sucesso, mas OCR offline funcional não foi demonstrado. Segundo, o fixture de duas folhas de pagamento resultou em uma única página genérica OUTRO, marcada para revisão. Não houve dois cartões separados nem ZIP; nenhuma aprovação foi feita.

Após reiniciar o Electron, o checkpoint COMPLETED persistiu, mas os cartões e o resultado não foram restaurados. Reabrir o fixture recuperou a prévia sem iniciar outro processamento; o cartão permaneceu Aguardando. Isso demonstra persistência parcial do estado, não recuperação funcional do resultado.

**Conclusão:** não há evidência para certificar OCR/layout offline, exportação do fixture ou recuperação completa. O smoke não processou o PDF municipal de 129 páginas, não usou provedores externos e não alterou a janela do usuário que já tinha esse PDF carregado.

## 2. Identidade e preservação do código

- Repositório: Joao-Aschenbrenner/ai-disec-pdf
- Branch do checkout testado: fix/exhaustive-vision-failover
- HEAD local: 91591a75ffd4e616f0a56633377e76efdfc408d1
- Commit PR6.25 citado na solicitação: 40729165e57e0cd1cfce0769e1f325e3936ce89d; esse objeto não estava disponível no banco Git local, portanto não foi possível reconstruir ou comparar esse baseline a partir do repositório.
- Fingerprint de fonte atribuído ao baseline PR6.25: 1792982c28cf09977f5540a1e9078f39be5894cfea3c7f2931659e56191a6730 (referência recebida; não equivale ao fingerprint do pacote testado).
- Fingerprint SHA-256 do pacote efetivamente testado: e9ba93efde5c94e88e7aa2f7eef59674631811a04f7b07676ebfde05b8d08d5e.
- Método do fingerprint do pacote: manifesto determinístico de 16 arquivos do artefato — executável, arquivos Electron main/preload/helper, package.json, catálogo de modelos e conteúdo completo de dist; perfil de teste excluído.
- SHA-256 de resources/app/dist/server.cjs: e0e9c6c650f87057672a9a4db248f41e22a867c25e11f62ca65ed309867182b8.
- SHA-256 do bundle JavaScript do renderer index-Cz42N_U6.js: 065c9ec5066ff5ae916407c502237f4db2ba74ee75631cff8c11cf4286bddc9b.
- O checkout original já tinha alterações locais e arquivos não rastreados. O preflight desta auditoria também modificou localmente server/classification/localOcr.ts e tests/local-ocr-offline.test.ts. Essas alterações continuam sem commit e não foram incluídas na publicação documental.
- Os builds e perfis de teste foram isolados sob tmp/pr6-26-packaged-runtime-certification-20261013; não sobrescreveram dist original nem copiaram PDFs ou perfis anteriores.

O fingerprint identifica o artefato e permite distinguir o pacote testado. Não afirma que o checkout sujo é reproduzível a partir do HEAD sozinho.

## 3. Startup, listener e prontidão

| Etapa | Evidência | Resultado |
|---|---|---|
| Electron main | Processo do executável observado no perfil isolado | Iniciou |
| Servidor embutido | Listener observado em 127.0.0.1, porta definida pelo perfil de smoke | Iniciou |
| Readiness | GET http://127.0.0.1:<porta>/health | HTTP 200 |
| Renderer | DOM/CDP local acessível; título do app presente | Iniciou |
| PDF.js | Worker local carregado e canvas renderizado | Funcionou para fixture sintético |
| Modelos | Refresh no perfil sintético foi ignorado pelo guard local | Nenhuma consulta externa |

O falso negativo inicial do probe não demonstrava falha do servidor: o app fazia bind somente em 127.0.0.1, enquanto localhost podia resolver primeiro para ::1; houve também uma corrida de prontidão durante o startup. O endpoint observado e válido foi /health no IPv4 loopback. Uma execução fria levou aproximadamente 7,2 s até a prontidão; o resultado foi resolvido pelo probe no endereço e endpoint corretos, sem ampliar arbitrariamente timeout. Não foi aberto bind público.

SERVER_READINESS aplica-se neste pacote porque o servidor embutido fornece /health; a resposta foi comprovada diretamente.

## 4. OCR local, layout e correção de falha

### OCR

A cópia empacotada não tinha por.traineddata nem eng.traineddata no cache local do perfil de teste. No primeiro smoke, a chamada /api/classification/ocr permaneceu pendente por mais de um minuto e foi cancelada pela interface. A inspeção do caminho de inicialização indicou que o wrapper do Tesseract.js podia deixar a Promise de criação sem conclusão útil quando o carregamento local da língua falhava.

Foi adicionado um preflight em server/classification/localOcr.ts: exige arquivos não vazios para por e eng antes de criar o worker e retorna o erro estável OCR_LOCAL_LANGUAGE_DATA_MISSING quando faltam. Não baixa modelos automaticamente. O teste de regressão correspondente valida falha rápida e confirma que createWorker não é chamado sem os arquivos.

No pacote reconstruído com essa alteração, a API OCR respondeu HTTP 503 em 7 ms. O resultado demonstra falha explícita e não bloqueante quando o modelo está ausente, não processamento OCR bem-sucedido offline. O smoke não tinha modelos disponíveis para provar OCR com texto reconhecido.

### Layout

A feature experimental de layout permaneceu desligada. Os workers Python scripts/pr6-23-paddle-layout-worker.py e scripts/pr6-23-paddle-layout-only-worker.py, runtime Python e modelo PP-DocLayout-S não estavam presentes no pacote. Nenhum download ocorreu. Não foi possível certificar layout offline no executável.

## 5. Smoke funcional sintético no Electron

Foi usado o fixture sintético PR6-18 multidocumento, composto por uma página rasterizada com duas folhas fictícias. A sessão estava marcada TEST_ONLY; dados de teste e telemetria sintética não representam revisão humana.

1. Executável e renderer iniciaram no perfil isolado.
2. O fixture foi selecionado pela interface; uma página e um canvas PDF.js apareceram.
3. /api/classification/ocr falhou explicitamente por falta dos modelos.
4. O guard do perfil sintético usou resposta sintética local para a rota de identificação. O tráfego observado foi para loopback. Nenhuma chamada a NVIDIA, Laya ou outro provedor externo foi feita.
5. A fila encerrou 1/1 página. O resultado foi uma classificação genérica OUTRO, confiança baixa e estado NEEDS_REVIEW.
6. A página combinada não foi aprovada. A interface não ofereceu ZIP para esse estado.
7. Não houve dois cartões para visualizar individualmente e não foi feita exportação.

A verificação foi funcional e intencionalmente conservadora: não foram convertidos dados incompletos em aprovação, não foi clicada a aprovação TEST_ONLY e não se alegou separação dos dois documentos.

### Aprovações e exportação

Não foi reutilizada aprovação do perfil real, nem criada nova aprovação sintética. A prova de exportação sintética específica para este pacote, com aprovação isolada e dois PDFs, não foi concluída, pois a segmentação retornou apenas um cartão genérico pendente. Nenhum ZIP foi criado nesta execução.

## 6. Reinício, recuperação e recursos

O app isolado foi encerrado normalmente e iniciado novamente com o mesmo perfil sintético:

- /health voltou a responder HTTP 200.
- O checkpoint persistido informou COMPLETED, 1/1 página.
- A interface exibiu aviso de que a sessão anterior não podia ser restaurada e pediu reabertura explícita do PDF.
- Após reabrir o mesmo fixture pela interface, a prévia foi renderizada sem novo job e sem nova chamada de extração.
- O resultado classificado e o cartão não foram restaurados; o cartão permaneceu Aguardando 0%.

Portanto, a reabertura não duplicou processamento nem inventou resultado, mas também não restaurou a revisão concluída. PROCESS_RECOVERY=REJECT.

Uma desconexão de transporte do renderer foi injetada pelo protocolo de depuração: uma busca local falhou offline e voltou após reconectar; o health do servidor permaneceu ativo. Isso não é queda do servidor nem queda do processo principal Electron. Não foi executada injeção de encerramento do processo principal, encerramento de worker Python, nem timeout de OCR com modelos presentes. Esses cenários permanecem não testados.

Os processos Electron iniciados para o smoke foram encerrados; seus listeners foram confirmados fechados. Não foram observados processos auxiliares órfãos na verificação final. O teste não incluiu worker Python, pois o runtime de layout não estava empacotado.

## 7. Memória e hardware

A máquina de teste tinha 8 processadores lógicos informados pelo host e 32 GB de RAM. Não representa o alvo de quatro núcleos/8 GB; a certificação desse perfil permanece pendente.

Em dez amostras simultâneas do grupo de processos Electron durante o smoke:

- Pico agregado observado de Working Set: aproximadamente 1.138,9 MiB.
- Pico agregado observado de memória privada: aproximadamente 192,1 MiB.
- Grupo amostrado: quatro processos Electron.
- Worker Python: não executado/não presente no pacote.

Os picos agregados foram medidos no mesmo ciclo de amostragem, não somados de máximos individuais em horários diferentes. Estes valores não são uma medição de memória de um worker OCR/layout funcional nem uma certificação de 8 GB.

## 8. Empacotamento e asar=false

O pacote usa asar=false. Isso mantém scripts e recursos externos acessíveis para subprocessos e caminhos de modelos locais, mas reduz a proteção contra adulteração e inspeção do conteúdo empacotado. Não foi alterado nesta auditoria. Alternativas para avaliação futura: empacotar código em ASAR e declarar asarUnpack/extraResources apenas para executáveis, scripts e modelos necessários, com caminhos de runtime explícitos e verificáveis. Essa alternativa exige smoke próprio de subprocessos; não foi implementada nem certificada.

A ausência de modelos/scripts no pacote deve ser resolvida por uma decisão explícita de distribuição local e licenciamento, não por download automático durante processamento.

## 9. Validação de engenharia

Comandos e resultados registrados no checkout avaliado:

| Verificação | Resultado |
|---|---|
| Teste focado tests/local-ocr-offline.test.ts | 3 aprovados |
| Suíte completa npm test | 765 aprovados, 1 ignorado; 56 arquivos de teste |
| npm run lint (tsc --noEmit) | Aprovado, sem diagnósticos |
| Build isolado Vite + esbuild | Concluído; não escreveu no dist original |
| git diff --check no checkout original | Código de saída 0; apenas avisos de normalização LF/CRLF em arquivos já modificados |
| Smoke no executável isolado | Startup e readiness aprovados; OCR/layout/exportação/recuperação funcional não certificados |

O build isolado emitiu avisos conhecidos sobre importação estática e dinâmica de pdfToImage.ts, tamanho de chunk JS e import.meta em saída CommonJS. Não foram tratados como prova de falha do startup.

## 10. Segurança e privacidade

- Dados municipais reais não foram processados nesta certificação.
- Nenhum documento ou conteúdo derivado foi enviado a provedor externo.
- Nenhum PDF, imagem, OCR bruto, captura, cofre, log bruto, token ou chave está incluído nesta publicação.
- O artefato sintético usado no smoke não foi publicado.
- O perfil real da janela Electron que mostrava o PDF municipal foi deixado intacto; não foi identificado, limpo, fechado ou reiniciado por esta execução.
- A política DevKit oficial do Gitleaks, SkySecurityGate 1.0.0 e contrato Evidence v1 não estavam disponíveis nesta sessão. Uma varredura suplementar do Gitleaks 8.30.1 padrão, limitada aos dois documentos de publicação e com saída redigida, não encontrou achados; ela não usa a política DevKit oficial e não substitui esses gates. Nenhum gate oficial de segurança foi declarado aprovado.
- Risco residual: o perfil sintético e o perfil real precisam de isolamento verificável no nível de armazenamento e credenciais; o teste confirmou uma faixa TEST_ONLY e guard de chamadas sintéticas nesse perfil, mas não certificou todos os caminhos de promoção entre perfis.

## 11. Gates

| Gate | Decisão | Evidência |
|---|---|---|
| PACKAGED_STARTUP | **PASS** | Executável, renderer e fixture sintético abriram no pacote isolado. |
| SERVER_READINESS | **PASS** | /health respondeu HTTP 200 no bind IPv4 de loopback observado. |
| OFFLINE_OCR | **REJECT** | Modelos por/eng ausentes; o erro agora falha rápido, mas OCR funcional não foi demonstrado. |
| OFFLINE_LAYOUT | **REJECT** | Feature desligada e workers/runtime/modelo ausentes do pacote. |
| SYNTHETIC_EXPORT | **REJECT** | Uma página combinada ficou NEEDS_REVIEW; não havia dois documentos aprováveis e nenhum ZIP foi produzido. |
| PROCESS_RECOVERY | **REJECT** | Checkpoint persistiu, porém resultado/cartão não foram restaurados após reabrir a origem. |
| MEMORY_TARGET | **NOT_CERTIFIED** | Host de 8 processadores lógicos/32 GB; alvo declarado de 4 núcleos/8 GB não avaliado. |
| REAL_DOCUMENT_QUALITY | **NOT_CERTIFIED** | Nenhuma página municipal processada ou validada. |
| SECURITY | **BLOCKED** | Política oficial DevKit Gitleaks, SkySecurityGate 1.0.0 e Evidence v1 indisponíveis. |
| RELEASE | **BLOCKED** | OCR/layout/exportação/recuperação e gates oficiais de segurança não certificados. |

## 12. Recomendações com critérios objetivos

1. **Distribuição OCR offline:** definir proveniência/licença e empacotar por/eng; aceitar somente se smoke no executável reconhecer texto sintético offline e não fizer download.
2. **Layout empacotado:** incluir de forma reproduzível o runtime Python, worker e modelo local licenciado; aceitar somente se o worker for iniciado, encerrar limpo e detectar regiões em fixture sintético offline.
3. **Exportação multidocumento:** corrigir o caminho sintético para produzir dois cartões independentes, cada qual em revisão/aprovação TEST_ONLY; aceitar somente se a UI exportar dois PDFs sintéticos distintos e o ZIP for validado sem duplicação ou mistura.
4. **Recuperação:** persistir resultado e identidade da origem com IDs estáveis; aceitar somente se reinício restaurar ambos os cartões e estados, sem nova chamada, duplicação ou resultado inventado.
5. **Resiliência:** injetar timeout real de OCR com modelo presente, encerramento de worker e queda do processo principal Electron em perfil descartável; provar continuação/retomada e ausência de órfãos.
6. **Memória:** repetir o ciclo em Windows representativo de quatro núcleos/8 GB, com Electron + Node + Python simultâneos; definir limites antes do teste e capturar pico agregado.
7. **Segurança/release:** obter contratos oficiais DevKit Gitleaks, SkySecurityGate 1.0.0 e Evidence v1; executar e anexar resultados válidos antes de considerar publicação de produto.

A arquitetura experimental continua sem promoção. Este relatório conclui o diagnóstico do runtime e documenta resultados negativos que ainda bloqueiam a certificação funcional e o release.
