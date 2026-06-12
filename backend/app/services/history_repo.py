from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, List
import csv
import io

from app.models.database import ProcessingHistoryDB, ProcessingJobDB, session_scope
from app.models.schemas import HistoryEntry, ProcessingStatus, ProcessingJob, DocumentType


def save_history(entry: HistoryEntry) -> int:
    with session_scope() as session:
        db_entry = ProcessingHistoryDB(
            file_path=entry.file_path,
            file_name=entry.file_name,
            file_hash=entry.file_hash,
            doc_type=entry.doc_type.value,
            status=entry.status.value,
            new_file_name=entry.new_file_name,
            destination_folder=entry.destination_folder,
            error_message=entry.error_message,
            retry_count=entry.retry_count,
            processing_time_ms=entry.processing_time_ms,
            processed_at=entry.processed_at,
        )
        session.add(db_entry)
        session.flush()
        return db_entry.id


def get_by_hash(file_hash: str) -> Optional[HistoryEntry]:
    with session_scope() as session:
        db_entry = session.query(ProcessingHistoryDB).filter(
            ProcessingHistoryDB.file_hash == file_hash
        ).order_by(ProcessingHistoryDB.processed_at.desc()).first()

        if db_entry:
            return _to_history_entry(db_entry)
    return None


def get_recent(limit: int = 100) -> List[HistoryEntry]:
    with session_scope() as session:
        entries = session.query(ProcessingHistoryDB).order_by(
            ProcessingHistoryDB.processed_at.desc()
        ).limit(limit).all()
        return [_to_history_entry(e) for e in entries]


def get_by_date_range(from_date: datetime, to_date: datetime) -> List[HistoryEntry]:
    with session_scope() as session:
        entries = session.query(ProcessingHistoryDB).filter(
            ProcessingHistoryDB.processed_at >= from_date,
            ProcessingHistoryDB.processed_at <= to_date
        ).order_by(ProcessingHistoryDB.processed_at.desc()).all()
        return [_to_history_entry(e) for e in entries]


def export_to_csv(file_path: str):
    with session_scope() as session:
        entries = session.query(ProcessingHistoryDB).order_by(
            ProcessingHistoryDB.processed_at.desc()
        ).all()

        with open(file_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "ID", "FilePath", "FileName", "FileHash", "DocType",
                "Status", "NewFileName", "DestinationFolder",
                "ErrorMessage", "RetryCount", "ProcessingTimeMs", "ProcessedAt"
            ])
            for e in entries:
                writer.writerow([
                    e.id, e.file_path, e.file_name, e.file_hash, e.doc_type,
                    e.status, e.new_file_name, e.destination_folder,
                    e.error_message, e.retry_count, e.processing_time_ms,
                    e.processed_at.isoformat()
                ])


def clear_history():
    with session_scope() as session:
        session.query(ProcessingHistoryDB).delete()
        session.query(ProcessingJobDB).delete()


def save_job(job: ProcessingJob):
    with session_scope() as session:
        db_job = session.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job.job_id
        ).first()

        import json
        if db_job:
            db_job.status = job.status.value
            db_job.progress = job.progress
            db_job.current_step = job.current_step
            db_job.ocr_result_json = json.dumps(job.ocr_result.model_dump()) if job.ocr_result else None
            db_job.document_info_json = json.dumps(job.document_info.model_dump()) if job.document_info else None
            db_job.error_message = job.error_message
            db_job.updated_at = datetime.utcnow()
            db_job.completed_at = job.completed_at
        else:
            db_job = ProcessingJobDB(
                job_id=job.job_id,
                file_path=job.file_path,
                file_name=job.file_name,
                file_hash=job.file_hash,
                output_folder=job.output_folder,
                status=job.status.value,
                progress=job.progress,
                current_step=job.current_step,
                ocr_result_json=json.dumps(job.ocr_result.model_dump()) if job.ocr_result else None,
                document_info_json=json.dumps(job.document_info.model_dump()) if job.document_info else None,
                error_message=job.error_message,
            )
            session.add(db_job)


def get_job(job_id: str) -> Optional[ProcessingJob]:
    with session_scope() as session:
        db_job = session.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id
        ).first()

        if not db_job:
            return None

        import json
        return ProcessingJob(
            job_id=db_job.job_id,
            file_path=db_job.file_path,
            file_name=db_job.file_name,
            file_hash=db_job.file_hash,
            output_folder=db_job.output_folder,
            status=ProcessingStatus(db_job.status),
            progress=db_job.progress,
            current_step=db_job.current_step,
            ocr_result=json.loads(db_job.ocr_result_json) if db_job.ocr_result_json else None,
            document_info=json.loads(db_job.document_info_json) if db_job.document_info_json else None,
            error_message=db_job.error_message,
            created_at=db_job.created_at,
            updated_at=db_job.updated_at,
            completed_at=db_job.completed_at,
        )


def get_jobs(status: Optional[ProcessingStatus] = None, limit: int = 50) -> List[ProcessingJob]:
    with session_scope() as session:
        query = session.query(ProcessingJobDB).order_by(ProcessingJobDB.created_at.desc())
        if status:
            query = query.filter(ProcessingJobDB.status == status.value)
        jobs = query.limit(limit).all()

        import json
        result = []
        for j in jobs:
            result.append(ProcessingJob(
                job_id=j.job_id,
                file_path=j.file_path,
                file_name=j.file_name,
                file_hash=j.file_hash,
                output_folder=j.output_folder,
                status=ProcessingStatus(j.status),
                progress=j.progress,
                current_step=j.current_step,
                ocr_result=json.loads(j.ocr_result_json) if j.ocr_result_json else None,
                document_info=json.loads(j.document_info_json) if j.document_info_json else None,
                error_message=j.error_message,
                created_at=j.created_at,
                updated_at=j.updated_at,
                completed_at=j.completed_at,
            ))
        return result


def _to_history_entry(db_entry: ProcessingHistoryDB) -> HistoryEntry:
    return HistoryEntry(
        id=db_entry.id,
        file_path=db_entry.file_path,
        file_name=db_entry.file_name,
        file_hash=db_entry.file_hash,
        doc_type=DocumentType(db_entry.doc_type),
        status=ProcessingStatus(db_entry.status),
        new_file_name=db_entry.new_file_name,
        destination_folder=db_entry.destination_folder,
        error_message=db_entry.error_message,
        retry_count=db_entry.retry_count,
        processing_time_ms=db_entry.processing_time_ms,
        processed_at=db_entry.processed_at,
    )