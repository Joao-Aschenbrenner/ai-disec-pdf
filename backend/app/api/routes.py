from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path
import asyncio
import json
import time
from typing import Optional, Dict
import uuid

from app.models.schemas import (
    ProcessingJob, ProcessingStatus, UploadResponse, ProgressUpdate,
    HistoryEntry, DocumentType
)
from app.services.processor import PDFProcessor
from app.services.history_repo import (
    get_job, get_jobs, save_history, get_by_hash, export_to_csv, clear_history
)

router = APIRouter()

active_connections: Dict[str, WebSocket] = {}
processors: Dict[str, PDFProcessor] = {}


@router.post("/upload", response_model=UploadResponse)
async def upload_pdf(
    file: UploadFile = File(...),
    output_folder: str = Form(...),
    dpi: int = Form(300),
    languages: str = Form("por+eng"),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Apenas arquivos PDF são aceitos")

    if not Path(output_folder).exists():
        raise HTTPException(400, "Pasta de destino não existe")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Arquivo vazio")

    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        file_path=f"temp_{job_id}.pdf",
        file_name=file.filename,
        file_hash="",
        output_folder=output_folder,
        status=ProcessingStatus.PENDING,
    )

    temp_path = Path(settings.TEMP_DIR) / f"{job_id}.pdf"
    async with open(temp_path, "wb") as f:
        await f.write(content)

    job.file_path = str(temp_path)

    from app.services.history_repo import save_job
    save_job(job)

    return UploadResponse(job_id=job_id, status=ProcessingStatus.PENDING)


@router.websocket("/ws/{job_id}")
async def websocket_progress(websocket: WebSocket, job_id: str):
    await websocket.accept()
    active_connections[job_id] = websocket

    processor = PDFProcessor()
    processors[job_id] = processor

    try:
        job = get_job(job_id)
        if not job:
            await websocket.send_json({"error": "Job não encontrado"})
            return

        async def progress_callback(message: str, progress: float):
            if job_id in active_connections:
                try:
                    await active_connections[job_id].send_json({
                        "job_id": job_id,
                        "status": job.status.value,
                        "progress": progress,
                        "current_step": message,
                        "message": message,
                    })
                except:
                    pass

        job = await processor.process(job.file_path, job.output_folder, progress_callback)

        if job_id in active_connections:
            await active_connections[job_id].send_json({
                "job_id": job_id,
                "status": job.status.value,
                "progress": job.progress,
                "current_step": job.current_step,
                "message": job.current_step,
                "completed": True,
                "document_info": job.document_info.model_dump() if job.document_info else None,
                "zip_path": f"/download/{job_id}" if job.status == ProcessingStatus.COMPLETED else None,
            })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        if job_id in active_connections:
            try:
                await active_connections[job_id].send_json({"error": str(e)})
            except:
                pass
    finally:
        active_connections.pop(job_id, None)
        processors.pop(job_id, None)
        try:
            temp_path = Path(settings.TEMP_DIR) / f"{job_id}.pdf"
            if temp_path.exists():
                temp_path.unlink()
        except:
            pass


@router.get("/job/{job_id}", response_model=ProcessingJob)
async def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job não encontrado")
    return job


@router.get("/jobs", response_model=list[ProcessingJob])
async def list_jobs(status: Optional[str] = None, limit: int = 50):
    status_enum = ProcessingStatus(status) if status else None
    return get_jobs(status_enum, limit)


@router.post("/job/{job_id}/cancel")
async def cancel_job(job_id: str):
    if job_id in processors:
        processors[job_id].cancel()
        return {"message": "Cancelamento solicitado"}
    raise HTTPException(404, "Job não encontrado ou já finalizado")


@router.get("/download/{job_id}")
async def download_result(job_id: str):
    job = get_job(job_id)
    if not job or job.status != ProcessingStatus.COMPLETED or not job.document_info:
        raise HTTPException(404, "Resultado não disponível")

    from app.services.file_organizer import create_result_zip
    zip_bytes = await asyncio.to_thread(
        create_result_zip, job.document_info, job.output_folder
    )

    from io import BytesIO
    buf = BytesIO(zip_bytes)
    filename = f"{Path(job.file_name).stem}_separado.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/history", response_model=list[HistoryEntry])
async def get_history(limit: int = 100):
    return get_jobs(limit=limit)


@router.get("/history/export")
async def export_history():
    from io import StringIO
    output = StringIO()
    export_to_csv(output)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=history.csv"}
    )


@router.delete("/history")
async def clear_all_history():
    clear_history()
    return {"message": "Histórico limpo"}


@router.get("/health")
async def health():
    import pytesseract
    try:
        version = pytesseract.get_tesseract_version()
        tesseract_ok = True
    except:
        tesseract_ok = False
        version = None

    return {
        "status": "ok",
        "tesseract": str(version) if version else "não encontrado",
        "tesseract_ok": tesseract_ok,
    }


from app.config import settings