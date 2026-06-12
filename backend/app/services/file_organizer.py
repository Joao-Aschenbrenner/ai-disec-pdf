import os
import shutil
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional
import zipfile
import io

from app.models.schemas import DocumentInfo, DocumentType
from app.config import settings


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def compute_file_hash(file_path: Path) -> str:
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(81920), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def sanitize_filename(name: str) -> str:
    invalid = '<>:"/\\|?*'
    for char in invalid:
        name = name.replace(char, "_")
    return name[:200]


def generate_new_filename(doc: DocumentInfo) -> str:
    date_str = datetime.now().strftime("%Y%m%d")
    type_short = {
        DocumentType.NOTA_FISCAL: "NF",
        DocumentType.BOLETO: "BL",
        DocumentType.CONTRATO: "CT",
        DocumentType.RECIBO: "RC",
        DocumentType.OUTRO: "OT",
        DocumentType.DESCONHECIDO: "UN",
    }.get(doc.doc_type, "XX")

    parts = [date_str, type_short]

    if doc.extracted_data.numero_nota:
        parts.append(f"N{doc.extracted_data.numero_nota}")
    if doc.extracted_data.cnpj_emitente:
        cnpj_clean = "".join(c for c in doc.extracted_data.cnpj_emitente if c.isdigit())
        parts.append(f"CNPJ{cnpj_clean[:8]}")
    if doc.extracted_data.cpf:
        cpf_clean = "".join(c for c in doc.extracted_data.cpf if c.isdigit())
        parts.append(f"CPF{cpf_clean[:6]}")

    base = "_".join(parts)
    return sanitize_filename(f"{base}.pdf")


def get_destination_folder(doc: DocumentInfo, base_output: Path) -> Path:
    year = datetime.now().strftime("%Y")
    month = datetime.now().strftime("%m")
    type_folder = doc.doc_type.value
    return base_output / year / month / type_folder


def organize_document(doc: DocumentInfo, output_folder: str) -> DocumentInfo:
    src = Path(doc.file_path)
    if not src.exists():
        raise FileNotFoundError(f"Arquivo origem não encontrado: {src}")

    base_output = Path(output_folder)
    ensure_dir(base_output)

    dest_folder = get_destination_folder(doc, base_output)
    ensure_dir(dest_folder)

    new_name = generate_new_filename(doc)
    dest_path = dest_folder / new_name

    counter = 1
    original_dest = dest_path
    while dest_path.exists():
        stem = original_dest.stem
        dest_path = dest_folder / f"{stem}_{counter}{original_dest.suffix}"
        counter += 1

    shutil.copy2(src, dest_path)

    doc.new_file_name = dest_path.name
    doc.destination_folder = str(dest_folder)
    return doc


def create_result_zip(doc: DocumentInfo, output_folder: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("texto_completo.txt", doc.ocr_text)

        if doc.ocr_text:
            lines = doc.ocr_text.split("\n")
            chunk_size = max(1, len(lines) // 10)
            for i in range(0, len(lines), chunk_size):
                chunk = "\n".join(lines[i:i+chunk_size])
                zf.writestr(f"pagina_{i//chunk_size + 1:04d}.txt", chunk)

        meta = {
            "pdf_name": doc.file_name,
            "new_file_name": doc.new_file_name,
            "destination_folder": doc.destination_folder,
            "doc_type": doc.doc_type.value,
            "page_count": doc.page_count,
            "total_chars": len(doc.ocr_text),
            "ocr_confidence": doc.ocr_confidence,
            "classification_method": doc.classification_method,
            "classification_confidence": doc.classification_confidence,
            "extracted_data": doc.extracted_data.model_dump(),
            "processed_at": datetime.utcnow().isoformat(),
        }
        import json
        zf.writestr("metadata.json", json.dumps(meta, ensure_ascii=False, indent=2))

    buf.seek(0)
    return buf.read()


def save_zip_to_downloads(doc: DocumentInfo, zip_bytes: bytes) -> str:
    downloads = Path.home() / "Downloads"
    ensure_dir(downloads)

    base_name = Path(doc.file_name).stem
    zip_name = f"{base_name}_separado.zip"
    zip_path = downloads / zip_name

    counter = 1
    while zip_path.exists():
        zip_path = downloads / f"{base_name}_separado_{counter}.zip"
        counter += 1

    with open(zip_path, "wb") as f:
        f.write(zip_bytes)

    return str(zip_path)