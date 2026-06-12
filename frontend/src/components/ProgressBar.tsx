import { ProgressUpdate, ProcessingStatus } from '@/types'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface ProgressBarProps {
  progress: ProgressUpdate | null
  overallProgress: number
  status: ProcessingStatus
}

const STATUS_ICONS: Record<ProcessingStatus, React.ReactNode> = {
  pending: <div className="w-5 h-5 text-gray-400" />,
  pre_processing: <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />,
  ocr_processing: <Loader2 className="w-5 h-5 text-orange-600 animate-spin" />,
  classifying: <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />,
  organizing: <Loader2 className="w-5 h-5 text-indigo-600 animate-spin" />,
  completed: <CheckCircle className="w-5 h-5 text-green-600" />,
  error: <AlertCircle className="w-5 h-5 text-red-600" />,
  cancelled: <AlertCircle className="w-5 h-5 text-gray-500" />,
}

export function ProgressBar({ progress, overallProgress, status }: ProgressBarProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {STATUS_ICONS[status]}
          <h3 className="font-semibold text-gray-900">Progresso Geral</h3>
        </div>
        <span className="text-lg font-bold text-indigo-600">{Math.round(overallProgress)}%</span>
      </div>

      <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out relative"
          style={{
            width: `${overallProgress}%`,
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          }}
        >
          {overallProgress > 15 && (
            <div
              className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-white/50"
            />
          )}
        </div>
      </div>

      {progress && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-600">{progress.current_step || progress.message}</span>
          <span className="text-gray-400">{progress.job_id?.slice(0, 8)}</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 text-center">
        <div className="bg-green-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-600">✓</div>
          <div className="text-xs text-green-700">Sucesso</div>
        </div>
        <div className="bg-red-50 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-600">✗</div>
          <div className="text-xs text-red-700">Erros</div>
        </div>
      </div>
    </div>
  )
}