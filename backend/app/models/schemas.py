from datetime import datetime
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field
import uuid


class DocumentType(str, Enum):
    NOTA_FISCAL = "nota_fiscal"
    BOLETO = "boleto"
    CONTRATO = "contrato"
    RECIBO = "recibo"
    OUTRO = "outro"
    DESCONHECIDO = "desconhecido"


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PRE_PROCESSING = "pre_processing"
    OCR_PROCESSING = "ocr_processing"
    CLASSIFYING = "classifying"
    ORGANIZING = "organizing"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


class PageResult(BaseModel):
    index: int
    text: str
    confidence: float
    char_count: int
    processing_time_ms: int


class OCRResult(BaseModel):
    job_id: str
    status: ProcessingStatus
    pdf_name: str
    page_count: int = 0
    pages: List[PageResult] = []
    total_text: str = ""
    total_chars: int = 0
    avg_confidence: float = 0.0
    render_time_ms: int = 0
    ocr_time_ms: int = 0
    total_time_ms: int = 0
    error: Optional[str] = None


class ExtractedData(BaseModel):
    numero_nota: Optional[str] = None
    cnpj_emitente: Optional[str] = None
    cpf: Optional[str] = None
    nome_pessoa: Optional[str] = None
    numero_imposto: Optional[str] = None
    chave_acesso: Optional[str] = None


class ClassificationResult(BaseModel):
    doc_type: DocumentType
    confidence: float
    method: str


class DocumentInfo(BaseModel):
    file_path: str
    file_name: str
    doc_type: DocumentType
    ocr_text: str
    ocr_confidence: float
    classification_method: str
    classification_confidence: float
    extracted_data: ExtractedData
    file_hash: str
    page_count: int
    new_file_name: Optional[str] = None
    destination_folder: Optional[str] = None


class ProcessingJob(BaseModel):
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_path: str
    file_name: str
    file_hash: str
    output_folder: str
    status: ProcessingStatus = ProcessingStatus.PENDING
    progress: float = 0.0
    current_step: str = ""
    ocr_result: Optional[OCRResult] = None
    document_info: Optional[DocumentInfo] = None
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None


class HistoryEntry(BaseModel):
    id: Optional[int] = None
    file_path: str
    file_name: str
    file_hash: str
    doc_type: DocumentType
    status: ProcessingStatus
    new_file_name: Optional[str] = None
    destination_folder: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    processing_time_ms: float = 0.0
    processed_at: datetime = Field(default_factory=datetime.utcnow)


class UploadResponse(BaseModel):
    job_id: str
    status: ProcessingStatus


class ProgressUpdate(BaseModel):
    job_id: str
    status: ProcessingStatus
    progress: float
    current_step: str
    message: str