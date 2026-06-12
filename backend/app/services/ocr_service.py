import os
import time
import tempfile
import shutil
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional
import fitz
import pytesseract
from PIL import Image

from app.config import settings
from app.models.schemas import PageResult, OCRResult, ProcessingStatus


os.environ["TESSDATA_PREFIX"] = "/usr/share/tesseract-ocr/5/tessdata"
pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD


def ocr_single_page(args: tuple) -> PageResult:
    index, img_path, languages = args
    start = time.perf_counter()
    try:
        img = Image.open(img_path)
        text = pytesseract.image_to_string(img, lang=languages)
        data = pytesseract.image_to_data(img, lang=languages, output_type=pytesseract.Output.DICT)
        confs = [int(c) for c in data["conf"] if int(c) > 0]
        confidence = round(sum(confs) / len(confs), 1) if confs else 0.0
        elapsed = int((time.perf_counter() - start) * 1000)
        return PageResult(
            index=index,
            text=text.strip(),
            confidence=confidence,
            char_count=len(text.strip()),
            processing_time_ms=elapsed,
        )
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        return PageResult(
            index=index, text="", confidence=0.0,
            char_count=0, processing_time_ms=elapsed,
        )


def process_pdf_ocr(
    pdf_bytes: bytes,
    dpi: int = 300,
    languages: str = "por+eng",
    max_workers: int = 4,
    progress_callback=None
) -> OCRResult:
    job_id = f"job_{int(time.time() * 1000)}"
    result = OCRResult(
        job_id=job_id,
        status=ProcessingStatus.OCR_PROCESSING,
        pdf_name="uploaded.pdf"
    )

    overall_start = time.perf_counter()

    try:
        render_start = time.perf_counter()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        result.page_count = page_count

        if progress_callback:
            progress_callback(f"Renderizando {page_count} páginas...", 10)

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

        result.render_time_ms = int((time.perf_counter() - render_start) * 1000)

        if progress_callback:
            progress_callback(f"Iniciando OCR em {page_count} páginas...", 20)

        ocr_start = time.perf_counter()
        pages = [None] * page_count
        workers = min(max_workers, os.cpu_count() or 4, page_count)

        with ProcessPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(ocr_single_page, args): args[0] for args in page_images}
            completed = 0
            for future in as_completed(futures):
                page_result = future.result()
                pages[page_result.index] = page_result
                completed += 1
                if progress_callback:
                    pct = 20 + int((completed / page_count) * 60)
                    progress_callback(f"OCR: {completed}/{page_count} páginas", pct)

        result.ocr_time_ms = int((time.perf_counter() - ocr_start) * 1000)

        total_text = "\n".join(p.text for p in pages if p and p.text)
        total_chars = sum(p.char_count for p in pages if p)
        valid = [p for p in pages if p and p.confidence > 0]
        avg_conf = round(sum(p.confidence for p in valid) / len(valid), 1) if valid else 0.0

        result.pages = pages
        result.total_text = total_text
        result.total_chars = total_chars
        result.avg_confidence = avg_conf
        result.total_time_ms = int((time.perf_counter() - overall_start) * 1000
        result.status = ProcessingStatus.COMPLETED

        if progress_callback:
            progress_callback(f"OCR concluído: {page_count} páginas, {total_chars} chars", 80)

    except Exception as e:
        result.status = ProcessingStatus.ERROR
        result.error = str(e)
        result.total_time_ms = int((time.perf_counter() - overall_start) * 1000
        if progress_callback:
            progress_callback(f"Erro no OCR: {e}", 0)
    finally:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except:
            pass

    return result