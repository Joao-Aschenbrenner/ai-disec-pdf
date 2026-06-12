from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.config import settings
from app.models.database import init_db
from app.api.routes import router as api_router


logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Iniciando aplicação...")
    init_db()
    logger.info("Banco de dados inicializado")
    yield
    logger.info("Encerrando aplicação...")


app = FastAPI(
    title="PDF Separator API",
    description="Backend para separação automática de PDFs com OCR",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "PDF Separator API v2.0", "docs": "/docs"}