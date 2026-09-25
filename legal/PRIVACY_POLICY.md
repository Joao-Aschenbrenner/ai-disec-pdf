# Política de Privacidade — AI Disec PDF

**Versão:** 1.0.0  
**Data de vigência:** Junho de 2026

## 1. Coleta de Dados

O aplicativo e o servidor interno rodam localmente na máquina do usuário. O autor não coleta nem armazena os PDFs, imagens, textos ou metadados processados. Quando o usuário escolhe um provedor de IA em nuvem, a imagem da página e o prompt necessário para a extração são enviados diretamente à API desse provedor; esse tráfego não passa por servidores controlados pelo autor.

## 2. Processamento Local

- O split, a geração de ZIP, as regras de classificação, os nomes dos arquivos e o Laya local podem operar inteiramente na máquina do usuário.
- Os arquivos PDF processados e gerados permanecem no sistema de arquivos local, sob controle do usuário.
- Ollama Local e Laya local não enviam dados a provedores cloud.
- Nenhuma telemetria, analytics ou rastreamento está embutido no Software.

## 3. Dados Compartilhados com Provedores de IA

No modo cloud, as imagens das páginas dos PDFs e o prompt de extração são enviados somente ao provedor explicitamente selecionado pelo usuário. No modo local, esses dados permanecem na máquina. O provedor escolhido pode aplicar sua própria política de retenção, treinamento e uso; consulte as políticas abaixo:

| Provedor    | Política de Privacidade                                       |
|-------------|---------------------------------------------------------------|
| OpenAI      | https://openai.com/policies/privacy-policy                    |
| Google      | https://policies.google.com/privacy                           |
| Anthropic   | https://www.anthropic.com/legal/privacy                       |
| Mistral     | https://mistral.ai/terms/#privacy-policy                      |
| NVIDIA      | https://www.nvidia.com/en-us/privacy-policy/                  |
| OpenRouter  | https://openrouter.ai/privacy                                 |
| Ollama      | https://ollama.com/privacy                                    |

## 4. Segurança

- As configurações e chaves fornecidas pelo usuário são armazenadas localmente em `~/.ai-disec-pdf/settings.json` e nunca são enviadas ao autor.
- Uma chave só é enviada ao endpoint do provedor correspondente quando o usuário solicita uma operação cloud.
- O arquivo `.env` é usado apenas para desenvolvimento/configuração local e deve permanecer fora do controle de versão.

## 5. Direitos do Usuário (LGPD)

Você tem o direito de:
- Saber quais dados são processados (apenas os PDFs que você mesmo seleciona);
- Solicitar a exclusão de qualquer dado processado (basta remover os arquivos gerados);
- Revogar o consentimento a qualquer momento (deixando de usar o Software).

## 6. Contato

João Aschenbrenner  
https://github.com/Joao-Aschenbrenner

---

*Esta política é fornecida como modelo informativo e não substitui aconselhamento jurídico especializado.*
