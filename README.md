# Separador de PDF v2.0 - Arquitetura Python + React/Tauri

## Visão Geral

Sistema completo de separação automática de PDFs com OCR, composto por:

- **Backend**: Python FastAPI com OCR paralelo (PyMuPDF + Tesseract)
- **Frontend**: React + Tauri (app nativo desktop)
- **Comunicação**: WebSocket para progresso em tempo real + REST API

## Estrutura do Projeto

```
Separador de PDF/
├── backend/                 # Python FastAPI Backend
│   ├── app/
│   │   ├── api/routes.py    # Endpoints REST + WebSocket
│   │   ├── config.py        # Configurações via Pydantic
│   │   ├── main.py          # Entry point FastAPI
│   │   ├── models/          # Schemas Pydantic + SQLAlchemy
│   │   └── services/        # Lógica de negócio
│   │       ├── ocr_service.py      # OCR paralelo com ProcessPoolExecutor
│   │       ├── classifier.py       # Classificação por regex
│   │       ├── extractor.py        # Extração de dados
│   │       ├── file_organizer.py   # Organização + ZIP
│   │       ├── history_repo.py     # Histórico SQLite
│   │       └── processor.py        # Orquestrador principal
│   ├── Dockerfile
│   ├── requirements.txt
│   └── run.py
├── frontend/                # React + Tauri Frontend
│   ├── src/
│   │   ├── components/      # StepCard, ProgressBar, LogsPanel, FileSelector
│   │   ├── hooks/           # useProcessing
│   │   ├── types/           # TypeScript types
│   │   └── utils/           # API client
│   ├── src-tauri/           # Tauri Rust backend
│   └── package.json
└── docker-compose.yml       # Orquestração
```

## Pré-requisitos

- Docker + Docker Compose
- Node.js 18+ (para desenvolvimento frontend)
- Rust 1.70+ (para build Tauri)

## Execução Rápida (Produção)

```bash
# 1. Subir backend OCR
docker-compose up -d --build

# 2. Verificar saúde
curl http://localhost:8000/api/health

# 3. Build e rodar frontend (Tauri)
cd frontend
npm install
npm run tauri dev        # Desenvolvimento
# ou
npm run tauri build      # Build produção
```

## Desenvolvimento

### Backend (Python)

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows
pip install -r requirements.txt
python run.py
```

### Frontend (React)

```bash
cd frontend
npm install
npm run dev              # Vite dev server (porta 1420)
npm run tauri dev        # App Tauri com hot reload
```

## Fluxo de Processamento (3 Etapas)

1. **Pré-processamento**
   - Valida arquivo PDF
   - Calcula SHA-256 hash
   - Verifica histórico (evita reprocessamento)

2. **OCR (Docker API)**
   - Upload do PDF via multipart/form-data
   - Renderiza páginas com PyMuPDF (300 DPI)
   - OCR paralelo com Tesseract (ProcessPoolExecutor)
   - Polling WebSocket para progresso em tempo real

3. **Separar + ZIP**
   - Classificação por regex (Nota Fiscal, Boleto, Contrato, etc.)
   - Extração de dados (CNPJ, CPF, Chave Acesso, etc.)
   - Organização em pastas: `ano/mês/tipo/`
   - Gera ZIP com textos + metadados
   - Salva em `Downloads/`

## Configurações (backend/.env)

```env
# API
API_HOST=127.0.0.1
API_PORT=8000

# OCR
TESSERACT_CMD=/usr/bin/tesseract
TESSERACT_LANG=por+eng
OCR_DPI=300
OCR_MAX_WORKERS=4

# Storage
UPLOAD_DIR=./data/uploads
PROCESSED_DIR=./data/processed
TEMP_DIR=./data/temp
DB_PATH=./data/history.db

# Processing
MAX_FILE_SIZE_MB=500
```

## API Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| POST | `/api/upload` | Upload PDF + iniciar processamento |
| WS | `/api/ws/{job_id}` | WebSocket progresso tempo real |
| GET | `/api/job/{job_id}` | Status do job |
| GET | `/api/jobs` | Listar jobs |
| POST | `/api/job/{job_id}/cancel` | Cancelar processamento |
| GET | `/api/download/{job_id}` | Baixar ZIP resultado |
| GET | `/api/history` | Histórico de processamentos |
| GET | `/api/history/export` | Exportar CSV |
| DELETE | `/api/history` | Limpar histórico |
| GET | `/api/health` | Health check |

## Testando com PDF Grande

```bash
# O PDF de teste (62MB) está em:
# C:\Users\USUARIO\Downloads\scmt\custeio-03-25.pdf

# No app Tauri:
# 1. Clique "Selecionar PDF" → escolha o arquivo
# 2. Clique "Selecionar Pasta" → escolha destino
# 3. Clique "Iniciar Processamento"
# 4. Acompanhe progresso em tempo real nos 3 cards
# 5. Ao final, clique "Baixar ZIP" → salva em Downloads
```

## Logs Detalhados

O painel de logs mostra:
- Timestamp preciso
- Nível (Info/Warning/Error/Debug)
- Etapa atual
- Métricas: páginas, chars, confiança, tempos

## Build Produção

```bash
# Backend Docker
docker build -t pdf-separator-ocr ./backend

# Frontend Tauri
cd frontend
npm run tauri build
# Resultado em: frontend/src-tauri/target/release/bundle/
```

## Troubleshooting

**Tesseract não encontrado:**
```bash
# No container, já vem instalado
# Local: apt-get install tesseract-ocr tesseract-ocr-por tesseract-ocr-eng
```

**Porta 8000 ocupada:**
```bash
# Altere API_PORT no .env ou docker-compose.yml
```

**Memória insuficiente para PDFs grandes:**
```yaml
# Em docker-compose.yml, aumente:
deploy:
  resources:
    limits:
      memory: 8G
```

## Licença

MIT