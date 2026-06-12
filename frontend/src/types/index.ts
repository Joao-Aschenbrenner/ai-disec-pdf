export type DocumentType =
  | 'nota_fiscal'
  | 'boleto'
  | 'contrato'
  | 'recibo'
  | 'outro'
  | 'desconhecido'

export type ProcessingStatus =
  | 'pending'
  | 'pre_processing'
  | 'ocr_processing'
  | 'classifying'
  | 'organizing'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface PageResult {
  index: number
  text: string
  confidence: number
  char_count: number
  processing_time_ms: number
}

export interface OCRResult {
  job_id: string
  status: ProcessingStatus
  pdf_name: string
  page_count: number
  pages: PageResult[]
  total_text: string
  total_chars: number
  avg_confidence: number
  render_time_ms: number
  ocr_time_ms: number
  total_time_ms: number
  error?: string
}

export interface ExtractedData {
  numero_nota?: string
  cnpj_emitente?: string
  cpf?: string
  nome_pessoa?: string
  numero_imposto?: string
  chave_acesso?: string
}

export interface ClassificationResult {
  doc_type: DocumentType
  confidence: number
  method: string
}

export interface DocumentInfo {
  file_path: string
  file_name: string
  doc_type: DocumentType
  ocr_text: string
  ocr_confidence: number
  classification_method: string
  classification_confidence: number
  extracted_data: ExtractedData
  file_hash: string
  page_count: number
  new_file_name?: string
  destination_folder?: string
}

export interface ProcessingJob {
  job_id: string
  file_path: string
  file_name: string
  file_hash: string
  output_folder: string
  status: ProcessingStatus
  progress: number
  current_step: string
  ocr_result?: OCRResult
  document_info?: DocumentInfo
  error_message?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface HistoryEntry {
  id?: number
  file_path: string
  file_name: string
  file_hash: string
  doc_type: DocumentType
  status: ProcessingStatus
  new_file_name?: string
  destination_folder?: string
  error_message?: string
  retry_count: number
  processing_time_ms: number
  processed_at: string
}

export interface LogEntry {
  timestamp: Date
  level: 'info' | 'warning' | 'error' | 'debug'
  message: string
  step?: string
}

export interface UploadResponse {
  job_id: string
  status: ProcessingStatus
}

export interface ProgressUpdate {
  job_id: string
  status: ProcessingStatus
  progress: number
  current_step: string
  message: string
  completed?: boolean
  document_info?: DocumentInfo
  zip_path?: string
  error?: string
}

export interface StepConfig {
  id: number
  title: string
  description: string
  icon: React.ReactNode
  color: string
  bgColor: string
  enabled: boolean
  status: 'waiting' | 'active' | 'completed' | 'error'
}