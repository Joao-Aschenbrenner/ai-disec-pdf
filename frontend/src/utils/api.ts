import { open } from '@tauri-apps/plugin-dialog'
import { ProcessingJob, UploadResponse, HistoryEntry, ProgressUpdate, DocumentType, ProcessingStatus } from '@/types'

const API_BASE = 'http://127.0.0.1:8000/api'

export async function selectPdfFile(): Promise<string | null> {
  const selected = await open({
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    multiple: false,
    directory: false,
  })
  return selected || null
}

export async function selectOutputFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
  })
  return selected || null
}

export async function uploadPdf(filePath: string, outputFolder: string): Promise<UploadResponse> {
  const fileResponse = await fetch(`file://${filePath}`)
  const fileBlob = await fileResponse.blob()

  const formData = new FormData()
  formData.append('file', fileBlob, 'file.pdf')
  formData.append('output_folder', outputFolder)

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) throw new Error('Falha no upload')
  return response.json()
}

export async function getJobStatus(jobId: string): Promise<ProcessingJob> {
  const response = await fetch(`${API_BASE}/job/${jobId}`)
  if (!response.ok) throw new Error('Job não encontrado')
  return response.json()
}

export async function listJobs(status?: ProcessingStatus, limit = 50): Promise<ProcessingJob[]> {
  const params = new URLSearchParams()
  if (status) params.append('status', status)
  params.append('limit', limit.toString())
  const response = await fetch(`${API_BASE}/jobs?${params}`)
  return response.json()
}

export async function cancelJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/job/${jobId}/cancel`, { method: 'POST' })
  if (!response.ok) throw new Error('Falha ao cancelar')
}

export async function downloadResult(jobId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/download/${jobId}`)
  if (!response.ok) throw new Error('Falha no download')
  return response.blob()
}

export async function getHistory(limit = 100): Promise<HistoryEntry[]> {
  const response = await fetch(`${API_BASE}/history?limit=${limit}`)
  return response.json()
}

export async function exportHistory(): Promise<Blob> {
  const response = await fetch(`${API_BASE}/history/export`)
  return response.blob()
}

export async function clearHistory(): Promise<void> {
  const response = await fetch(`${API_BASE}/history`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Falha ao limpar histórico')
}

export async function checkHealth(): Promise<{ status: string; tesseract: string }> {
  const response = await fetch(`${API_BASE}/health`)
  return response.json()
}

export function connectWebSocket(jobId: string, onMessage: (msg: ProgressUpdate) => void): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:8000/api/ws/${jobId}`)
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      onMessage(msg)
    } catch (e) {
      console.error('WS parse error:', e)
    }
  }
  ws.onerror = (err) => console.error('WS error:', err)
  return ws
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  nota_fiscal: 'Nota Fiscal',
  boleto: 'Boleto',
  contrato: 'Contrato',
  recibo: 'Recibo',
  outro: 'Outro',
  desconhecido: 'Desconhecido',
}

export const STATUS_LABELS: Record<ProcessingStatus, string> = {
  pending: 'Aguardando',
  pre_processing: 'Pré-processando',
  ocr_processing: 'OCR',
  classifying: 'Classificando',
  organizing: 'Organizando',
  completed: 'Concluído',
  error: 'Erro',
  cancelled: 'Cancelado',
}

export const STATUS_COLORS: Record<ProcessingStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  pre_processing: 'bg-blue-100 text-blue-700',
  ocr_processing: 'bg-orange-100 text-orange-700',
  classifying: 'bg-purple-100 text-purple-700',
  organizing: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
}