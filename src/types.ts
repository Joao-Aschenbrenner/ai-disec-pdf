export interface ExtractedMetadata {
  isNotaFiscal: boolean;
  notaNumber: string | null;
  companyName: string | null;
  valor: number | null;
  pessoaNome: string | null;
  documentType: 'nota_fiscal' | 'imposto' | 'darf' | 'extrato' | 'planilha' | 'folha_pagamento' | 'outros' | 'nao_identificado';
  /** Classe fina definida pelo Classification V3. Mantemos documentType para compatibilidade da UI. */
  documentClass?: string;
  classificationText?: string;
  classificationConfidence?: number;
  classificationSource?: string;
  classificationEvidence?: string[];
  needsReview?: boolean;
  /** Classification V3 */
  layaChecked?: boolean;
  layaConfidence?: number;
  sequenceAdjusted?: boolean;
  sequenceReason?: string;
  requiresVision?: boolean;
}

export interface FilenameOptions {
  showPageNumber: boolean;
  showType: boolean;
  showNotaNumber: boolean;
  showCompanyName: boolean;
  showValor: boolean;
  showPessoaNome: boolean;
}

export const DEFAULT_FILENAME_OPTIONS: FilenameOptions = {
  showPageNumber: true,
  showType: true,
  showNotaNumber: true,
  showCompanyName: true,
  showValor: true,
  showPessoaNome: true,
};

export interface SplitPage {
  id: string;
  index: number;
  base64: string;
  blobUrl: string;
  originalFileName: string;
  customFilename: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
  retryAfter?: string;
  /** Se false, o erro é definitivo para a requisição atual (ex.: 401/403). */
  retryable?: boolean;
  /** Se true, o backend rotacionou o modelo e a página deve ser retentada. */
  modelRotated?: boolean;
  /** Código de status HTTP do erro (ex.: 504, 429, 401). */
  statusCode?: number;
  metadata?: ExtractedMetadata;
  metadataList?: ExtractedMetadata[];
  /** Segmento gerado quando uma página física contém mais de um documento. */
  sourcePageIndex?: number;
  segmentIndex?: number;
  segmentPosition?: 'top' | 'bottom';
  /** Classification V3 orchestration */
  localText?: string;
  processingStage?: 'waiting' | 'preparing' | 'laya' | 'identifying' | 'extracting' | 'validating' | 'confirming' | 'done' | 'review' | 'retrying' | 'failed';
  processingProgress?: number;
  v3Hint?: {
    documentClass?: string;
    confidence?: number;
    source?: string;
    previousClass?: string | null;
    nextClass?: string | null;
    sequenceAdjusted?: boolean;
    sequenceReason?: string | null;
    modelTier?: 'fast' | 'medium';
  };
}
