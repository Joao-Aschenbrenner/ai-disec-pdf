export interface ExtractedMetadata {
  isNotaFiscal: boolean;
  notaNumber: string | null;
  companyName: string | null;
  valor: number | null;
  pessoaNome: string | null;
  documentType: 'nota_fiscal' | 'imposto' | 'darf' | 'extrato' | 'planilha' | 'folha_pagamento' | 'outros' | 'nao_identificado';
  /** Classe fina definida pelo CLASSIFICATION-V2. Mantemos documentType para compatibilidade da UI. */
  documentClass?: string;
  classificationText?: string;
  classificationConfidence?: number;
  classificationSource?: string;
  classificationEvidence?: string[];
  needsReview?: boolean;
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
  metadata?: ExtractedMetadata;
  metadataList?: ExtractedMetadata[];
  /** Segmento gerado quando uma página física contém mais de um documento. */
  sourcePageIndex?: number;
  segmentIndex?: number;
  segmentPosition?: 'top' | 'bottom';
}
