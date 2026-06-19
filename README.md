# AI Disec PDF

> Separador Inteligente de PDF com 8 provedores de IA.
> "Disseca" seus PDFs página por página com inteligência artificial.

Divide PDFs com múltiplos documentos (notas fiscais, DARFs, holerites, extratos, boletos) em arquivos individuais, renomeados automaticamente com base no conteúdo de cada página.

## Stack

| Camada     | Tecnologia                                           |
|------------|------------------------------------------------------|
| Frontend   | React 19 + Vite + Tailwind v4 + pdf-lib + Lucide     |
| Backend    | Express (Node.js) + esbuild                          |
| Desktop    | Electron 34 + electron-builder (NSIS)                |
| PDF Render | pdfjs-dist + Sharp                                   |
| Testes     | Vitest 4.1                                           |

## Provedores de IA

| Provedor    | Modelo Padrão                    | Imagens |
|-------------|----------------------------------|---------|
| Google      | Gemini 2.0 Flash (grátis)        | Sim     |
| NVIDIA      | Llama 3.2 90B Vision             | Sim     |
| OpenAI      | GPT-4o                           | Sim     |
| Anthropic   | Claude 3 Sonnet                  | Sim     |
| Mistral     | Mistral Vision                   | Sim     |
| OpenRouter  | google/gemini-2.0-flash-001      | Sim     |
| Groq        | Llama 3.2 90B Vision Preview     | Sim     |
| Cerebras    | (texto apenas, sem visão)        | Não     |

## Setup

```bash
git clone https://github.com/Joao-Aschenbrenner/ai-disec-pdf.git
cd ai-disec-pdf
npm install
cp .env.example .env
npm run dev
```

Acesse http://localhost:3001

## Desktop

```bash
npm run electron:dev          # Desenvolvimento (com Vite HMR)
npm run electron:build        # Build + instalador NSIS
```

O instalador `.exe` estará em `release/AI Disec PDF Setup 1.0.0.exe`.

## Auto-Update

O app verifica atualizações automaticamente toda vez que é iniciado pelo atalho.

### Fluxo

1. Ao iniciar, o app lê o token do GitHub em `~/.docsplit-ai/settings.json`
2. Verifica no GitHub se há release mais recente
3. Se houver: pergunta se quer baixar
4. Após download: pergunta se quer reiniciar para instalar

### Como publicar uma nova versão

```bash
# 1. Atualize a versão em package.json
# 2. Crie um GitHub Personal Access Token com escopo "repo"
#    https://github.com/settings/tokens
# 3. Defina o token como variável de ambiente
$env:GH_TOKEN="ghp_seu_token_aqui"

# 4. Faça o build e publique
npm run release

# 5. O instalador será enviado para GitHub Releases
#    e os usuários existentes receberão a atualização
```

### Token no settings.json (runtime)

Para que o auto-update funcione em máquinas com o app já instalado, adicione ao arquivo `~/.docsplit-ai/settings.json`:

```json
{
  "provider": "GOOGLE",
  "apiKey": "sua-chave",
  "githubToken": "ghp_seu_token_aqui"
}
```

## Scripts

| Script            | Descrição                                 |
|-------------------|-------------------------------------------|
| `npm run dev`     | Servidor Express com Vite HMR             |
| `npm run build`   | Build Vite + bundles do servidor          |
| `npm run start`   | Inicia servidor produção                  |
| `npm run test`    | Executa testes (Vitest) — 386 testes      |
| `npm run lint`    | TypeScript check                          |
| `npm run clean`   | Limpa build                               |
| `npm run electron:dev` | Electron + servidor dev              |
| `npm run electron:build` | Gera instalador NSIS              |
| `npm run electron:publish` | Build + publica no GitHub         |
| `npm run release` | Build + instalador Win + publish          |

## Estrutura

```
├── assets/          # Ícones (512×512)
├── electron/        # main.cjs (auto-update, menu removido)
├── legal/           # Termos de uso, privacidade, LGPD
├── server/          # Express + 8 providers IA
├── src/             # React (FilenameOptions, modal docs)
├── tests/           # 386 testes (Vitest)
└── RELEASE_REPORT.md / SECURITY_REPORT.md / ...
```

## Licença

MIT — João Aschenbrenner
