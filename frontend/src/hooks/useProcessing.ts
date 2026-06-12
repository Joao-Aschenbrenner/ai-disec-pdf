import { useState, useCallback, useRef, useEffect } from 'react'
import { ProcessingJob } from '@/types'
import { uploadPdf, connectWebSocket, cancelJob, downloadResult } from '@/utils/api'

export function useProcessing() {
  const [job, setJob] = useState<ProcessingJob | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const startProcessing = useCallback(async (filePath: string, outputFolder: string) => {
    setError(null)
    setIsProcessing(true)

    try {
      const upload = await uploadPdf(filePath, outputFolder)
      const newJob: ProcessingJob = {
        job_id: upload.job_id,
        file_path: filePath,
        file_name: filePath.split(/[\\/]/).pop() || '',
        file_hash: '',
        output_folder: outputFolder,
        status: upload.status,
        progress: 0,
        current_step: 'Iniciando...',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setJob(newJob)

      wsRef.current = connectWebSocket(upload.job_id, (msg) => {
        setJob((prev) => prev ? { ...prev, ...msg } : null)
        if (msg.completed || msg.status === 'completed' || msg.status === 'error' || msg.status === 'cancelled') {
          setIsProcessing(false)
          wsRef.current?.close()
          wsRef.current = null
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao iniciar processamento')
      setIsProcessing(false)
    }
  }, [])

  const cancel = useCallback(async () => {
    if (job) {
      await cancelJob(job.job_id)
      wsRef.current?.close()
      wsRef.current = null
      setIsProcessing(false)
    }
  }, [job])

  const download = useCallback(async () => {
    if (job && job.status === 'completed') {
      const blob = await downloadResult(job.job_id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${job.file_name.replace('.pdf', '')}_separado.zip`
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [job])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  return {
    job,
    isProcessing,
    error,
    startProcessing,
    cancel,
    download,
    progress: job?.progress || 0,
    status: job?.status || 'pending',
    currentStep: job?.current_step || '',
  }
}