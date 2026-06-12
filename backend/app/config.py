from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # API
    API_HOST: str = "127.0.0.1"
    API_PORT: int = 8000
    API_WORKERS: int = 1

    # OCR
    TESSERACT_CMD: str = Field(default="/usr/bin/tesseract", alias="TESSERACT_CMD")
    TESSERACT_LANG: str = "por+eng"
    OCR_DPI: int = 300
    OCR_MAX_WORKERS: int = 4

    # Storage
    UPLOAD_DIR: Path = Path("./data/uploads")
    PROCESSED_DIR: Path = Path("./data/processed")
    TEMP_DIR: Path = Path("./data/temp")
    DB_PATH: Path = Path("./data/history.db")

    # Processing
    MAX_FILE_SIZE_MB: int = 500
    CHUNK_SIZE: int = 81920
    POLL_INTERVAL_MS: int = 1500
    MAX_WAIT_SECONDS: int = 3600

    # Logging
    LOG_LEVEL: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()

# Ensure directories exist
for dir_path in [settings.UPLOAD_DIR, settings.PROCESSED_DIR, settings.TEMP_DIR]:
    dir_path.mkdir(parents=True, exist_ok=True)
settings.DB_PATH.parent.mkdir(parents=True, exist_ok=True)