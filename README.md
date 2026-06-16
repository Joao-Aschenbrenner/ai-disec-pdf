# DocSplit AI

Separador Inteligente de Notas e Impostos PDF com NVIDIA AI.

## Requisitos

- Node.js 18+
- Chave da API NVIDIA (https://build.nvidia.com/)

## Setup

```bash
# Instalar dependências
npm install

# Configurar chave da API NVIDIA
# Copie .env.example para .env e coloque sua chave:
NVIDIA_API_KEY="nvapi-sua-chave-aqui"
```

## Desenvolvimento (Web)

```bash
npm run dev
```

Acesse http://localhost:3000

## Desktop (Electron)

```bash
# Desenvolvimento - inicia servidor + Electron
npm run electron:dev

# Build para produção
npm run build
# Depois execute o Electron:
npm run electron:dev
# Ou gere instalador:
npm run electron:build
```

## Stack

- **Frontend:** React 19 + Vite + Tailwind v4 + pdf-lib
- **Backend:** Express + NVIDIA AI (Llama 3.2 90B Vision)
- **Desktop:** Electron
- **PDF Render:** pdfjs-dist (conversão página → imagem)
