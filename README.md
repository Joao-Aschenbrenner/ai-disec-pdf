# DocSplit AI

Separador Inteligente de PDF com 8 provedores de IA. Divide PDFs com várias páginas em arquivos individuais, renomeados automaticamente com base no conteúdo de cada página.

## Stack

| Camada     | Tecnologia                                           |
|------------|------------------------------------------------------|
| Frontend   | React 19 + Vite + Tailwind v4 + pdf-lib + Lucide     |
| Backend    | Express (Node.js)                                    |
| Desktop    | Electron + electron-builder (NSIS)                   |
| PDF Render | pdfjs-dist + Sharp                                   |
| Testes     | Vitest                                               |

## Provedores de IA

| Provedor    | Modelo Padrão               | Imagens |
|-------------|-----------------------------|---------|
| Google      | Gemini 2.0 Flash (grátis)   | Sim     |
| NVIDIA      | Llama 3.2 90B Vision        | Sim     |
| OpenAI      | GPT-4o                      | Sim     |
| Anthropic   | Claude 3 Sonnet             | Sim     |
| Mistral     | Mistral Vision              | Sim     |
| OpenRouter  | google/gemini-2.0-flash-exp | Sim     |
| Groq        | Mixtral 8x7B                | Sim     |
| Cerebras    | (texto apenas)              | Não     |

## Requisitos

- Node.js 18+
- Chave de API de pelo menos um provedor

## Setup

```bash
# Instalar dependências
npm install

# Configurar chave da API (no .env ou nas Configurações do app)
cp .env.example .env
# Edite .env com suas configurações (opcional - configurável via UI)
```

## Desenvolvimento (Web)

```bash
npm run dev
```

Acesse http://localhost:3001

## Desktop (Electron)

```bash
# Desenvolvimento
npm run electron:dev

# Build para produção + instalador
npm run build
npm run electron:build
# O instalador .exe estará em release/
```

## Scripts

| Script            | Descrição                                 |
|-------------------|-------------------------------------------|
| `npm run dev`     | Servidor Express com Vite HMR             |
| `npm run build`   | Build Vite + bundles do servidor          |
| `npm run start`   | Inicia servidor produção                  |
| `npm run test`    | Executa testes (Vitest)                   |
| `npm run electron:dev` | Electron + servidor dev              |
| `npm run electron:build` | Gera instalador NSIS              |
| `npm run lint`    | TypeScript check                          |
| `npm run clean`   | Limpa build                               |

## Estrutura

```
├── assets/          # Ícones do aplicativo
├── electron/        # Código do Electron (main.cjs, preload.cjs)
├── legal/           # Termos de uso e política de privacidade
├── server/          # Servidor Express (server.ts + bin/)
├── src/             # Frontend React
│   ├── App.tsx      # Componente principal
│   ├── types.ts     # Interfaces compartilhadas
│   └── utils/       # Utilitários (fileHelpers, pdfToImage)
├── tests/           # Testes unitários (Vitest)
└── dist/            # Build de produção (gerado)
```

## Licença

MIT - João Aschenbrenner
