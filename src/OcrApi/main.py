#!/usr/bin/env python3
"""OCR API Service - FastAPI + Tesseract + PyMuPDF."""
import os
import io
import json
import time
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="OCR API", version="1.0.0")

TESSERACT_PATH = os.getenv("TESSERACT_CMD", "/usr/bin/tesseract")
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

# In-memory job storage
jobs: dict = {}


class PageResult(BaseModel):
    index: int
    text: str
    confidence: float
    char_count: int
    processing_time_ms: int


class OcrJobResult(BaseModel):
    job_id: str
    status: str  # pending, processing, done, error
    pdf_name: str
    page_count: int = 0
    pages: list[PageResult] = []
    total_text: str = ""
    total_chars: int = 0
    avg_confidence: float = 0.0
    render_time_ms: int = 0
    ocr_time_ms: int = 0
    total_time_ms: int = 0
    error: Optional[str] = None


def ocr_single_page(args):
    """OCR a single page image."""
    index, img_path, languages = args
    start = time.time()
    try:
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang=languages)
        data = pytesseract.image_to_data(img, lang=languages, output_type=pytesseract.Output.DICT)
        confs = [int(c) for c in data["conf"] if int(c) > 0]
        confidence = round(sum(confs) / len(confs), 1) if confs else 0.0
        elapsed = int((time.time() - start) * 1000)
        return PageResult(
            index=index,
            text=text.strip(),
            confidence=confidence,
            char_count=len(text.strip()),
            processing_time_ms=elapsed,
        )
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return PageResult(
            index=index, text="", confidence=0.0,
            char_count=0, processing_time_ms=elapsed,
        )


def process_pdf_background(job_id: str, pdf_bytes: bytes, dpi: int, languages: str):
    """Background PDF processing."""
    job = jobs[job_id]
    job["status"] = "processing"
    start = time.time()

    try:
        # Render pages
        render_start = time.time()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        job["page_count"] = page_count

        tmpdir = tempfile.mkdtemp(prefix="ocr_")
        page_images = []
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        for i in range(page_count):
            page = doc[i]
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            img_path = os.path.join(tmpdir, f"page_{i:04d}.png")
            pix.save(img_path)
            page_images.append((i, img_path, languages))
        doc.close()
        render_time = int((time.time() - render_start) * 1000)

        # OCR in parallel
        ocr_start = time.time()
        pages = [None] * page_count
        max_workers = min(os.cpu_count() or 4, 8)

        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(ocr_single_page, args): args[0] for args in page_images}
            for future in as_completed(futures):
                result = future.result()
                pages[result.index] = result

        ocr_time = int((time.time() - ocr_start) * 1000)
        total_time = int((time.time() - start) * 1000)

        total_text = "\n".join(p.text for p in pages if p and p.text)
        total_chars = sum(p.char_count for p in pages if p)
        valid = [p for p in pages if p and p.confidence > 0]
        avg_conf = round(sum(p.confidence for p in valid) / len(valid), 1) if valid else 0.0

        # Cleanup temp files
        for p in page_images:
            try: os.remove(p[1])
            except: pass
        try: os.rmdir(tmpdir)
        except: pass

        job.update({
            "status": "done",
            "pages": [p.model_dump() for p in pages],
            "total_text": total_text,
            "total_chars": total_chars,
            "avg_confidence": avg_conf,
            "render_time_ms": render_time,
            "ocr_time_ms": ocr_time,
            "total_time_ms": total_time,
        })

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        job["total_time_ms"] = int((time.time() - start) * 1000)


@app.post("/ocr")
async def start_ocr(
    file: UploadFile = File(...),
    dpi: int = Query(300, ge=72, le=600),
    languages: str = Query("por+eng"),
):
    """Start OCR processing for a PDF file."""
    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(400, "Empty file")

    job_id = f"job_{int(time.time()*1000)}"
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "pdf_name": file.filename or "unknown.pdf",
        "page_count": 0,
        "pages": [],
        "total_text": "",
        "total_chars": 0,
        "avg_confidence": 0.0,
        "render_time_ms": 0,
        "ocr_time_ms": 0,
        "total_time_ms": 0,
        "error": None,
    }

    # Run in thread pool (non-blocking)
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, process_pdf_background, job_id, contents, dpi, languages)

    return {"job_id": job_id, "status": "done"}


@app.get("/ocr/{job_id}")
async def get_ocr_result(job_id: str):
    """Get OCR result for a job."""
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")
    return jobs[job_id]


@app.get("/ocr/{job_id}/zip")
async def download_ocr_zip(job_id: str):
    """Download OCR results as ZIP."""
    if job_id not in jobs:
        raise HTTPException(404, "Job not found")

    job = jobs[job_id]
    if job["status"] != "done":
        raise HTTPException(400, f"Job status: {job['status']}")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Full text
        zf.writestr("texto_completo.txt", job["total_text"])

        # Per-page text
        for page in job["pages"]:
            zf.writestr(f"pagina_{page['index']+1:04d}.txt", page["text"])

        # Metadata JSON
        meta = {
            "pdf_name": job["pdf_name"],
            "page_count": job["page_count"],
            "total_chars": job["total_chars"],
            "avg_confidence": job["avg_confidence"],
            "render_time_ms": job["render_time_ms"],
            "ocr_time_ms": job["ocr_time_ms"],
            "total_time_ms": job["total_time_ms"],
        }
        zf.writestr("metadata.json", json.dumps(meta, ensure_ascii=False, indent=2))

    buf.seek(0)
    zip_name = Path(job["pdf_name"]).stem + "_ocr.zip"
    return StreamingResponse(
        io.BytesIO(buf.read()),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


@app.get("/health")
async def health():
    return {"status": "ok", "tesseract": TESSERACT_PATH}
