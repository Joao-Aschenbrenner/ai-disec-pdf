import { useState, useCallback, useEffect } from 'react'
import { FileSelector } from '@/components/FileSelector'
import { StepCard } from '@/components/StepCard'
import { ProgressBar } from '@/components/ProgressBar'
import { LogsPanel } from '@/components/LogsPanel'
import { useProcessing } from '@/hooks/useProcessing'
import { LogEntry, ProcessingStatus, StepConfig } from '@/types'
import { Check, FileText, Cpu, FolderKanban, Download, AlertTriangle, Loader2, X } from 'lucide-react'

const STEPS: StepConfig[] = [
  {
    id: 1,
    title: 'Pré-processamento',
    description: 'Validar arquivo, calcular hash, verificar histórico',
    icon: <FileText className="w-5 h-5" />,
    color: '#3b82f6',
    bgColor: 'bg-blue-100',
    enabled: true,
    status: 'waiting',
  },
  {
    id: 2,
    title: 'OCR (Docker API)',
    description: 'Enviar PDF, processar páginas em paralelo, extrair texto',
    icon: <Cpu className="w-5 h-5" />,
    color: '#f97316',
    bgColor: 'bg-orange-100',
    enabled: true,
    status: 'waiting',
  },
  {
    id: 3,
    title: 'Separar + ZIP',
    description: 'Classificar, extrair dados, organizar arquivos, gerar ZIP',
    icon: <FolderKanban className="w-5 h-5" />,
    color: '#22c55e',
    bgColor: 'bg-green-100',
    enabled: true,
    status: 'waiting',
  },
]

export default function App() {
  const [pdfPath, setPdfPath] = useState('')
  const [outputFolder, setOutputFolder] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [steps, setSteps] = useState(STEPS)
  const [overallProgress, setOverallProgress] = useState(0)
  const [currentStatus, setCurrentStatus] = useState<ProcessingStatus>('pending')

  const {
    job,
    isProcessing,
    error,
    startProcessing,
    cancel,
    download,
  } = useProcessing()

  const addLog = useCallback((level: LogEntry['level'], message: string, step?: string) => {
    setLogs((prev) => [
      ...prev.slice(-999),
      { timestamp: new Date(), level, message, step },
    ])
  }, [])

  const handlePdfSelect = useCallback((path: string) => {
    setPdfPath(path)
    addLog('info', `PDF selecionado: ${path.split(/[\\/]/).pop()}`, 'config')
  }, [addLog])

  const handleOutputSelect = useCallback((path: string) => {
    setOutputFolder(path)
    addLog('info', `Pasta de destino: ${path}`, 'config')
  }, [addLog])

  const handlePdfClear = useCallback(() => {
    setPdfPath('')
    addLog('info', 'PDF desmarcado', 'config')
  }, [addLog])

  const handleOutputClear = useCallback(() => {
    setOutputFolder('')
    addLog('info', 'Pasta desmarcada', 'config')
  }, [addLog])

  const handleStart = useCallback(async () => {
    if (!pdfPath || !outputFolder) return
    setLogs([])
    setSteps(STEPS.map(s => ({ ...s, status: 'waiting' as const })))
    setOverallProgress(0)
    addLog('info', '=== INICIANDO PROCESSAMENTO ===', 'system')
    await startProcessing(pdfPath, outputFolder)
  }, [pdfPath, outputFolder, startProcessing, addLog])

  const handleCancel = useCallback(() => {
    cancel()
    addLog('warning', 'Processamento cancelado pelo usuário', 'system')
  }, [cancel, addLog])

  const handleDownload = useCallback(() => {
    download()
    addLog('info', 'ZIP baixado para Downloads', 'system')
  }, [download, addLog])

  const handleExportLogs = useCallback(() => {
    const csv = logs.map(l => `${l.timestamp.toISOString()},${l.level},${l.step || ''},${l.message}`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  const handleClearLogs = useCallback(() => {
    setLogs([])
  }, [])

  useEffect(() => {
    if (job) {
      setCurrentStatus(job.status)
      setOverallProgress(job.progress)

      const newSteps = steps.map((step, i) => {
        let stepStatus: StepConfig['status'] = 'waiting'
        if (job.status === 'completed' || job.status === 'error') {
          stepStatus = 'completed'
        } else if (i === 0 && ['pre_processing', 'ocr_processing', 'classifying', 'organizing', 'completed'].includes(job.status)) {
          stepStatus = job.status === 'pre_processing' ? 'active' : 'completed'
        } else if (i === 1 && ['ocr_processing', 'classifying', 'organizing', 'completed'].includes(job.status)) {
          stepStatus = ['ocr_processing'].includes(job.status) ? 'active' : 'completed'
        } else if (i === 2 && ['classifying', 'organizing', 'completed'].includes(job.status)) {
          stepStatus = ['classifying', 'organizing'].includes(job.status) ? 'active' : 'completed'
        }

        if (job.status === 'error') stepStatus = 'error'

        return { ...step, status: stepStatus }
      })
      setSteps(newSteps)
    }
  }, [job])

  useEffect(() => {
    if (job?.ocr_result) {
      addLog('info', `OCR: ${job.ocr_result.page_count} páginas, ${job.ocr_result.total_chars} chars, ${job.ocr_result.avg_confidence}% conf`, 'ocr')
    }
  }, [job?.ocr_result, addLog])

  useEffect(() => {
    if (job?.document_info) {
      addLog('info', `Classificado: ${job.document_info.doc_type} (${(job.document_info.classification_confidence * 100).toFixed(0)}%)`, 'classify')
      addLog('info', `Arquivo: ${job.document_info.new_file_name} → ${job.document_info.destination_folder}`, 'organize')
    }
  }, [job?.document_info, addLog])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-indigo-600 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Separador de PDF</h1>
                <p className="text-white/80 text-sm">OCR Automático - 3 Etapas</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="px-3 py-1 text-xs font-medium bg-white/20 rounded-full">
                {currentStatus.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <FileSelector
              pdfPath={pdfPath}
              outputFolder={outputFolder}
              onPdfSelect={handlePdfSelect}
              onOutputSelect={handleOutputSelect}
              onPdfClear={handlePdfClear}
              onOutputClear={handleOutputClear}
              disabled={isProcessing}
            />

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Loader2 className="w-5 h-5 text-indigo-600" />
                Pipeline de Processamento
              </h3>
              <div className="space-y-3">
                {steps.map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    status={step.status}
                    progress={job && job.status !== 'pending' ? {
                      job_id: job.job_id,
                      status: job.status,
                      progress: job.progress,
                      current_step: job.current_step,
                      message: job.current_step,
                    } : undefined}
                    onClick={() => step.enabled && !isProcessing && step.status !== 'completed' && handleStart()}
                    disabled={!step.enabled || isProcessing}
                  />
                ))}
              </div>
            </div>

            <ProgressBar
              progress={job ? {
                job_id: job.job_id,
                status: job.status,
                progress: job.progress,
                current_step: job.current_step,
                message: job.current_step,
              } : null}
              overallProgress={overallProgress}
              status={currentStatus}
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-red-800">Erro no Processamento</p>
                  <p className="text-sm text-red-700 mt-1">{error}</p>
                </div>
                <button
                  onClick={handleCancel}
                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  Tentar novamente
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <LogsPanel
              logs={logs}
              onExport={handleExportLogs}
              onClear={handleClearLogs}
            />
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 mt-6 flex items-center justify-center gap-4">
          <button
            onClick={handleStart}
            disabled={isProcessing || !pdfPath || !outputFolder}
            className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Iniciar Processamento
              </>
            )}
          </button>

          {isProcessing && (
            <button
              onClick={handleCancel}
              className="px-8 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <X className="w-5 h-5" />
              Cancelar
            </button>
          )}

          {job?.status === 'completed' && (
            <button
              onClick={handleDownload}
              className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-5 h-5" />
              Baixar ZIP
            </button>
          )}
        </div>
      </main>
    </div>
  )
}