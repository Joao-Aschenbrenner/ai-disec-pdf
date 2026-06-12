import asyncio
import hashlib
import time
from pathlib import Path
from typing import Optional, Callable, Awaitable
import aiofiles

from app.config import settings
from app.models.schemas import (
    ProcessingJob, ProcessingStatus, ProgressUpdate,
    DocumentInfo, OCRResult
)
from app.services.ocr_service import process_pdf_ocr
from app.services.classifier import classify_document, extract_data
from app.services.file_organizer import organize_document, create_result_zip, save_zip_to_downloads
from app.services.history_repo import save_job, save_history, get_by_hash
from app.services.file_organizer import compute_file_hash


ProgressCallback = Callable[[str, float], Awaitable[None]]


class PDFProcessor:
    def __init__(self):
        self._current_job: Optional[ProcessingJob] = None
        self._cancel_event = asyncio.Event()
        self._progress_callback: Optional[ProgressCallback] = None

    async def process(
        self,
        file_path: str,
        output_folder: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> ProcessingJob:
        self._progress_callback = progress_callback
        self._cancel_event.clear()

        job = ProcessingJob(
            file_path=file_path,
            file_name=Path(file_path).name,
            file_hash="",
            output_folder=output_folder,
            status=ProcessingStatus.PENDING,
        )

        try:
            await self._update_progress(job, ProcessingStatus.PRE_PROCESSING, 5, "Validando arquivo...")
            if not Path(file_path).exists():
                raise FileNotFoundError(f"Arquivo não encontrado: {file_path}")

            if not Path(output_folder).exists():
                raise NotADirectoryError(f"Pasta não existe: {output_folder}")

            file_size = Path(file_path).stat().st_size
            if file_size > settings.MAX_FILE_SIZE_MB * 1024 * 1024:
                raise ValueError(f"Arquivo muito grande: {file_size / 1024 / 1024:.1f}MB (máx: {settings.MAX_FILE_SIZE_MB}MB)")

            await self._update_progress(job, ProcessingStatus.PRE_PROCESSING, 10, "Calculando hash...")
            job.file_hash = await asyncio.to_thread(compute_file_hash, Path(file_path))

            await self._update_progress(job, ProcessingStatus.PRE_PROCESSING, 20, "Verificando histórico...")
            existing = await asyncio.to_thread(get_by_hash, job.file_hash)
            if existing and existing.status == ProcessingStatus.COMPLETED:
                job.status = ProcessingStatus.COMPLETED
                job.progress = 100
                job.current_step = "Já processado anteriormente"
                await self._update_progress(job, ProcessingStatus.COMPLETED, 100, "Arquivo já processado")
                await asyncio.to_thread(save_job, job)
                return job

            await self._update_progress(job, ProcessingStatus.OCR_PROCESSING, 25, "Enviando para OCR...")
            pdf_bytes = await self._read_file_async(file_path)

            def ocr_progress(msg: str, pct: float):
                if self._progress_callback:
                    asyncio.create_task(self._progress_callback(msg, 25 + pct * 0.5))

            ocr_result = await asyncio.to_thread(
                process_pdf_ocr,
                pdf_bytes,
                settings.OCR_DPI,
                settings.TESSERACT_LANG,
                settings.OCR_MAX_WORKERS,
                ocr_progress
            )

            job.ocr_result = ocr_result
            job.status = ProcessingStatus.CLASSIFYING
            await self._update_progress(job, ProcessingStatus.CLASSIFYING, 75, "Classificando documento...")

            if ocr_result.status == ProcessingStatus.ERROR or not ocr_result.total_text.strip():
                job.status = ProcessingStatus.ERROR
                job.error_message = ocr_result.error or "OCR retornou texto vazio"
                await self._update_progress(job, ProcessingStatus.ERROR, 0, f"Erro: {job.error_message}")
                await asyncio.to_thread(save_job, job)
                return job

            await self._update_progress(job, ProcessingStatus.CLASSIFYING, 80, "Classificando...")
            classification = await asyncio.to_thread(classify_document, ocr_result.total_text)

            await self._update_progress(job, ProcessingStatus.CLASSIFYING, 85, "Extraindo dados...")
            extracted = await asyncio.to_thread(extract_data, ocr_result.total_text, classification.doc_type)

            document = DocumentInfo(
                file_path=file_path,
                file_name=job.file_name,
                doc_type=classification.doc_type,
                ocr_text=ocr_result.total_text,
                ocr_confidence=ocr_result.avg_confidence,
                classification_method=classification.method,
                classification_confidence=classification.confidence,
                extracted_data=extracted,
                file_hash=job.file_hash,
                page_count=ocr_result.page_count,
            )

            await self._update_progress(job, ProcessingStatus.ORGANIZING, 90, "Organizando arquivos...")
            document = await asyncio.to_thread(organize_document, document, output_folder)

            await self._update_progress(job, ProcessingStatus.ORGANIZING, 95, "Criando ZIP...")
            zip_bytes = await asyncio.to_thread(create_result_zip, document, output_folder)

            await self._update_progress(job, ProcessingStatus.ORGANIZING, 98, "Salvando em Downloads...")
            zip_path = await asyncio.to_thread(save_zip_to_downloads, document, zip_bytes)

            job.document_info = document
            job.status = ProcessingStatus.COMPLETED
            job.progress = 100
            job.current_step = f"Concluído: {document.new_file_name}"
            job.completed_at = time.time()

            history = history_entry_from_job(job)
            await asyncio.to_thread(save_history, history)

            await self._update_progress(job, ProcessingStatus.COMPLETED, 100, f"ZIP salvo em: {zip_path}")

        except asyncio.CancelledError:
            job.status = ProcessingStatus.CANCELLED
            job.error_message = "Cancelado pelo usuário"
            await self._update_progress(job, ProcessingStatus.CANCELLED, 0, "Cancelado")
        except Exception as e:
            job.status = ProcessingStatus.ERROR
            job.error_message = str(e)
            await self._update_progress(job, ProcessingStatus.ERROR, 0, f"Erro: {e}")
        finally:
            await asyncio.to_thread(save_job, job)

        return job

    async def _read_file_async(self, file_path: str) -> bytes:
        async with aiofiles.open(file_path, "rb") as f:
            return await f.read()

    async def _update_progress(
        self,
        job: ProcessingJob,
        status: ProcessingStatus,
        progress: float,
        message: str
    ):
        job.status = status
        job.progress = progress
        job.current_step = message
        if self._progress_callback:
            await self._progress_callback(message, progress)
        await asyncio.to_thread(save_job, job)

    def cancel(self):
        self._cancel_event.set()


def history_entry_from_job(job: ProcessingJob) -> HistoryEntry:
    return HistoryEntry(
        file_path=job.file_path,
        file_name=job.file_name,
        file_hash=job.file_hash,
        doc_type=job.document_info.doc_type if job.document_info else None,
        status=job.status,
        new_file_name=job.document_info.new_file_name if job.document_info else None,
        destination_folder=job.document_info.destination_folder if job.document_info else None,
        error_message=job.error_message,
        processing_time_ms=0,
        processed_at=time.time(),
    )