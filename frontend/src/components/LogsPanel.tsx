import { cn } from '@/utils/cn'
import { Download, Trash2 } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface LogEntry {
  timestamp: Date
  level: 'info' | 'warning' | 'error' | 'debug'
  message: string
  step?: string
}

const LEVEL_COLORS = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  debug: 'bg-gray-100 text-gray-700',
}

const LEVEL_ICONS = {
  info: 'ℹ',
  warning: '⚠',
  error: '✕',
  debug: '●',
}

interface LogsPanelProps {
  logs: LogEntry[]
  onExport: () => void
  onClear: () => void
}

export function LogsPanel({ logs, onExport, onClear }: LogsPanelProps) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info' | 'debug'>('all')
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const filteredLogs = logs.filter((log) =>
    filter === 'all' ? true : log.level === filter
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">Logs</h3>
          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
            {filteredLogs.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'error' | 'warning' | 'info' | 'debug')}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Todos</option>
            <option value="error">Erros</option>
            <option value="warning">Avisos</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
          <button
            onClick={onExport}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Exportar logs"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={onClear}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Limpar logs"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="text-4xl mb-2">📋</div>
            <p>Nenhum log encontrado</p>
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={index}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                'hover:bg-gray-50'
              )}
            >
              <div className="flex-shrink-0 w-8 text-center text-xs text-gray-400 font-mono">
                {log.timestamp.toLocaleTimeString('pt-BR', { hour12: false })}
              </div>
              <span
                className={cn(
                  'flex-shrink-0 px-2 py-0.5 text-xs font-mono rounded',
                  LEVEL_COLORS[log.level]
                )}
              >
                {LEVEL_ICONS[log.level]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{log.message}</p>
                {log.step && (
                  <span className="text-xs text-gray-500">[{log.step}]</span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  )
}