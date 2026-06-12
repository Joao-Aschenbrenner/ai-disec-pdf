import { cn } from '@/utils/cn'
import { FileText, FolderOpen, X } from 'lucide-react'
import { selectPdfFile, selectOutputFolder } from '@/utils/api'

interface FileSelectorProps {
  pdfPath: string
  outputFolder: string
  onPdfSelect: (path: string) => void
  onOutputSelect: (path: string) => void
  onPdfClear: () => void
  onOutputClear: () => void
  disabled?: boolean
}

export function FileSelector({
  pdfPath,
  outputFolder,
  onPdfSelect,
  onOutputSelect,
  onPdfClear,
  onOutputClear,
  disabled,
}: FileSelectorProps) {

  const handlePdfSelect = async () => {
    if (disabled) return
    const path = await selectPdfFile()
    if (path) onPdfSelect(path)
  }

  const handleOutputSelect = async () => {
    if (disabled) return
    const path = await selectOutputFolder()
    if (path) onOutputSelect(path)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <FileText className="w-5 h-5 text-indigo-600" />
        Configuração
      </h3>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Arquivo PDF
          </label>
          <div className="relative">
            <button
              onClick={handlePdfSelect}
              disabled={disabled}
              className={cn(
                'w-full px-4 py-3 rounded-lg border transition-colors',
                'text-left focus:outline-none focus:ring-2 focus:ring-indigo-500',
                pdfPath
                  ? 'border-gray-300 bg-white hover:border-indigo-500'
                  : 'border-gray-200 bg-gray-50 hover:border-gray-300',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {pdfPath ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-900 truncate pr-8">
                      {pdfPath}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onPdfClear() }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <FileText className="w-3 h-3" />
                    <span>PDF selecionado</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                  <FileText className="w-8 h-8 text-gray-300" />
                  <span className="text-gray-500">Clique para selecionar um PDF</span>
                  <span className="text-xs text-gray-400">Arraste e solte também funciona</span>
                </div>
              )}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pasta de Destino
          </label>
          <div className="relative">
            <button
              onClick={handleOutputSelect}
              disabled={disabled}
              className={cn(
                'w-full px-4 py-3 rounded-lg border transition-colors',
                'text-left focus:outline-none focus:ring-2 focus:ring-indigo-500',
                outputFolder
                  ? 'border-gray-300 bg-white hover:border-indigo-500'
                  : 'border-gray-200 bg-gray-50 hover:border-gray-300',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {outputFolder ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-900 truncate pr-8">
                      {outputFolder}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onOutputClear() }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                    <FolderOpen className="w-3 h-3" />
                    <span>Pasta selecionada</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-2">
                  <FolderOpen className="w-8 h-8 text-gray-300" />
                  <span className="text-gray-500">Clique para escolher a pasta</span>
                  <span className="text-xs text-gray-400">Onde os arquivos organizados serão salvos</span>
                </div>
              )}
            </button>
          </div>
        </div>
      </div>

      {pdfPath && outputFolder && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
          <span className="text-green-700 text-sm">Pronto para processar</span>
        </div>
      )}
    </div>
  )
}