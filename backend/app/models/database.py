from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Float, Index,
    create_engine, event
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager
import threading

from app.config import settings

Base = declarative_base()

engine = create_engine(
    f"sqlite:///{settings.DB_PATH}",
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_local = threading.local()


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.close()


def get_session() -> Session:
    if not hasattr(_local, "session") or _local.session is None:
        _local.session = SessionLocal()
    return _local.session


@contextmanager
def session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


class ProcessingHistoryDB(Base):
    __tablename__ = "processing_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False, index=True)
    doc_type = Column(String(50), nullable=False)
    status = Column(String(30), nullable=False)
    new_file_name = Column(String(255), nullable=True)
    destination_folder = Column(String(500), nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    processing_time_ms = Column(Float, default=0.0)
    processed_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("idx_filepath", "file_path"),
        Index("idx_status", "status"),
        Index("idx_processed_at", "processed_at"),
    )


class ProcessingJobDB(Base):
    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(36), unique=True, nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False)
    output_folder = Column(String(500), nullable=False)
    status = Column(String(30), nullable=False, default="pending")
    progress = Column(Float, default=0.0)
    current_step = Column(String(100), default="")
    ocr_result_json = Column(Text, nullable=True)
    document_info_json = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_job_status", "status"),
        Index("idx_job_created", "created_at"),
    )


def init_db():
    Base.metadata.create_all(bind=engine)


def drop_db():
    Base.metadata.drop_all(bind=engine)