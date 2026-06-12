#!/usr/bin/env python3
"""Entry point para o backend FastAPI."""
import uvicorn
from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        workers=settings.API_WORKERS,
        reload=False,
        log_level=settings.LOG_LEVEL.lower(),
    )