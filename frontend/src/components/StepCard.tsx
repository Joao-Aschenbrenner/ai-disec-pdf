import { cn } from '@/utils/cn'
import { ProgressUpdate } from '@/types'
import { Check, Loader2, AlertCircle, Clock } from 'lucide-react'

interface StepCardProps {
  step: {
    id: number
    title: string
    description: string
    color: string
    bgColor: string
    icon: React.ReactNode
  }
  status: 'waiting' | 'active' | 'completed' | 'error'
  progress?: ProgressUpdate
  onClick?: () => void
  disabled?: boolean
}

export function StepCard({ step, status, progress, onClick, disabled }: StepCardProps) {
  const isActive = status === 'active'
  const isCompleted = status === 'completed'
  const isError = status === 'error'

  const getStatusIcon = () => {
    if (isCompleted) return <Check className="w-5 h-5 text-green-600" />
    if (isError) return <AlertCircle className="w-5 h-5 text-red-600" />
    if (isActive) return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
    return <Clock className="w-5 h-5 text-gray-400" />
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled || !onClick}
      className={cn(
        'relative w-full p-4 rounded-xl border-2 transition-all duration-300',
        'hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2',
        isActive && 'ring-2 ring-blue-500 border-blue-500 bg-blue-50',
        isCompleted && 'border-green-300 bg-green-50',
        isError && 'border-red-300 bg-red-50',
        status === 'waiting' && 'border-gray-200 bg-white hover:border-gray-300',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            isActive && 'bg-blue-100 text-blue-600',
            isCompleted && 'bg-green-100 text-green-600',
            isError && 'bg-red-100 text-red-600',
            status === 'waiting' && 'bg-gray-100 text-gray-400'
          )}
        >
          {getStatusIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{step.title}</h3>
            {isActive && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full animate-pulse">
                Processando
              </span>
            )}
            {isCompleted && (
              <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                Concluído
              </span>
            )}
            {isError && (
              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                Erro
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{step.description}</p>

          {progress && (
            <div className="mt-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">{progress.current_step || progress.message}</span>
                <span className="font-medium text-gray-900">{Math.round(progress.progress)}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${progress.progress}%`,
                    backgroundColor: isError ? '#ef4444' : isCompleted ? '#22c55e' : step.color,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}