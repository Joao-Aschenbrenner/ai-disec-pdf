from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import sys
import time
import tempfile
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
import shutil

import fitz
import pytesseract
from PIL import Image

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


class OcrResult(BaseModel):
    index: int
    text: str
    confidence: float
    char_count: int
    processing_time_ms: int
    success: bool
    error: Optional[str] = None


class ProcessResult(BaseModel):
    success: bool
    pdf_path: str
    page_count: int
    pages: List[OcrResult]
    total_text: str
    total_chars: int
    avg_confidence: float
    render_time_ms: int
    ocr_time_ms: int
    total_time_ms: int
    error: Optional[str] = None


def ocr_page(args):
    index, img_path, languages = args
    start = time.time()
    try:
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang=languages)
        confidence_data = pytesseract.image_to_data(img, lang=languages, output_type=pytesseract.Output.DICT)
        confs = [int(c) for c in confidence_data['conf'] if int(c) > 0]
        confidence = sum(confs) / len(confs) if confs else 0.0
        elapsed = int((time.time() - start) * 1000)
        return {
            "index": index,
            "text": text.strip(),
            "confidence": round(confidence, 1),
            "char_count": len(text.strip()),
            "processing_time_ms": elapsed,
            "success": True,
            "error": None
        }
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        return {
            "index": index,
            "text": "",
            "confidence": 0.0,
            "char_count": 0,
            "processing_time_ms": elapsed,
            "success": False,
            "error": str(e)
        }


def process_pdf(pdf_path: str, dpi: int = 300, languages: str = "por+eng", max_workers: int = None):
    start = time.time()

    if not os.path.exists(pdf_path):
        return {"success": False, "error": f"File not found: {pdf_path}"}

    doc = fitz.open(pdf_path)
    page_count = len(doc)

    render_start = time.time()
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

    if max_workers is None:
        max_workers = min(os.cpu_count() or 4, 8)

    ocr_start = time.time()
    pages = [None] * page_count

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(ocr_page, args): args[0] for args in page_images}
        for future in as_completed(futures):
            result = future.result()
            pages[result["index"]] = result

    ocr_time = int((time.time() - ocr_start) * 1000)
    total_time = int((time.time() - start) * 1000)

    total_text = "\n".join(p["text"] for p in pages if p and p["text"])
    total_chars = sum(p["char_count"] for p in pages if p)
    avg_confidence = 0.0
    valid = [p for p in pages if p and p["confidence"] > 0]
    if valid:
        avg_confidence = round(sum(p["confidence"] for p in valid) / len(valid), 1)

    for p in page_images:
        try:
            os.remove(p[1])
        except:
            pass
    try:
        os.rmdir(tmpdir)
    except:
        pass

    return {
        "success": True,
        "pdf_path": os.path.basename(pdf_path),
        "page_count": page_count,
        "pages": pages,
        "total_text": total_text,
        "total_chars": total_chars,
        "avg_confidence": avg_confidence,
        "render_time_ms": render_time,
        "ocr_time_ms": ocr_time,
        "total_time_ms": total_time,
        "error": None
    }


@app.post("/process-pdf/", response_model=ProcessResult)
async def process_pdf_endpoint(
    file: UploadFile = File(...),
    dpi: int = 300,
    languages: str = "por+eng"
):
    temp_dir = None
    try:
        temp_dir = Path(tempfile.mkdtemp())
        input_path = temp_dir / file.filename

        with open(input_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)

        result = process_pdf(str(input_path), dpi, languages)

        if not result["success"]:
            raise HTTPException(status_code=500, detail=result.get("error", "Processing failed"))

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)