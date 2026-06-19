# AI Disec PDF

> Separador Inteligente de PDF com IA.
> "Disseca" PDFs página por página usando inteligência artificial.

Divide PDFs com múltiplos documentos (notas fiscais, DARFs, holerites, extratos, boletos) em arquivos individuais, renomeados automaticamente com base no conteúdo de cada página.

## Como usar

1. **Instalar** — execute `AI Disec PDF Setup 1.0.0.exe`
2. **Abrir** — atalho no Desktop ou Menu Iniciar
3. **Configurar chave** — clique em ⚙️ Configurações, escolha um provedor e cole sua chave de API
4. **Processar** — arraste ou selecione um PDF, clique em "Identificar & Organizar Páginas"
5. **Baixar** — clique em "Baixar ZIP Processado"

O app verifica atualizações automaticamente toda vez que inicia.

## Provedores de IA

| Provedor    | Modelo                    | Imagens |
|-------------|---------------------------|---------|
| Google      | Gemini 2.0 Flash (grátis) | Sim     |
| NVIDIA      | Llama 3.2 90B Vision      | Sim     |
| OpenAI      | GPT-4o                    | Sim     |
| Anthropic   | Claude 3 Sonnet           | Sim     |
| Mistral     | Mistral Vision            | Sim     |
| OpenRouter  | Gemini Flash via API      | Sim     |
| Groq        | Llama Vision (grátis)     | Sim     |
| Cerebras    | texto apenas              | Não     |

## Desenvolvimento

```bash
git clone https://github.com/Joao-Aschenbrenner/ai-disec-pdf.git
cd ai-disec-pdf
npm install
npm run dev         # servidor web em localhost:3001
npm run electron:dev  # Electron + servidor dev
npm run test        # 386 testes
npm run build       # build produção
npm run electron:build  # gera instalador em release/
npm run release     # build + publica no GitHub
```

## Publicar atualização

```bash
# 1. Altere a versão em package.json
# 2. Crie um token GitHub com escopo "repo"
# 3. Defina o token
$env:GH_TOKEN = "ghp_seu_token"

# 4. Publique
npm run release

# Usuários existentes recebem a atualização ao abrir o app
```

## Estrutura

```
├── assets/          # Ícones
├── electron/        # main.cjs (auto-update, menu removido)
├── legal/           # Termos de uso, privacidade, LGPD
├── server/          # Express + 8 providers IA
├── src/             # React
├── tests/           # 386 testes (Vitest)
└── dist/            # build
```

## Licença

MIT — João Aschenbrenner
