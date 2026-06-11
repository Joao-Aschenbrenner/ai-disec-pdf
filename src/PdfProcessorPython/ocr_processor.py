#!/usr/bin/env python3
"""Fast parallel PDF OCR processor."""
import sys
import json
import time
import tempfile
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import fitz  # PyMuPDF
import pytesseract
from PIL import Image

TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH


def ocr_page(args):
    """OCR a single page image."""
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
    """Process a PDF file: render pages + OCR in parallel."""
    start = time.time()

    if not os.path.exists(pdf_path):
        return {"success": False, "error": f"File not found: {pdf_path}"}

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    print(f"PDF loaded: {page_count} pages", file=sys.stderr)

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
        if (i + 1) % 10 == 0:
            print(f"  Rendered {i + 1}/{page_count} pages", file=sys.stderr)

    doc.close()
    render_time = int((time.time() - render_start) * 1000)
    print(f"All pages rendered in {render_time}ms", file=sys.stderr)

    if max_workers is None:
        max_workers = min(os.cpu_count() or 4, 8)

    ocr_start = time.time()
    pages = [None] * page_count

    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(ocr_page, args): args[0] for args in page_images}
        done_count = 0
        for future in as_completed(futures):
            result = future.result()
            pages[result["index"]] = result
            done_count += 1
            if done_count % 5 == 0 or done_count == page_count:
                print(f"  OCR {done_count}/{page_count} pages", file=sys.stderr)

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


def main():
    import argparse
    parser = argparse.ArgumentParser(description="PDF OCR Processor")
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--dpi", type=int, default=300, help="DPI for rendering")
    parser.add_argument("--lang", default="por+eng", help="OCR languages")
    parser.add_argument("--workers", type=int, default=None, help="Parallel workers")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    result = process_pdf(args.pdf_path, args.dpi, args.lang, args.workers)

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"Pages: {result.get('page_count', 0)}")
        print(f"Chars: {result.get('total_chars', 0)}")
        print(f"Render: {result.get('render_time_ms', 0)}ms")
        print(f"OCR: {result.get('ocr_time_ms', 0)}ms")
        print(f"Total: {result.get('total_time_ms', 0)}ms")
        if result.get('error'):
            print(f"Error: {result['error']}")


if __name__ == "__main__":
    main()
