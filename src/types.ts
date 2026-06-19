export interface ExtractedMetadata {
  isNotaFiscal: boolean;
  notaNumber: string | null;
  companyName: string | null;
  valor: number | null;
  pessoaNome: string | null;
  documentType: 'nota_fiscal' | 'imposto' | 'darf' | 'extrato' | 'planilha' | 'folha_pagamento' | 'outros';
}

export interface FilenameOptions {
  includePageNumber: boolean;
  includeDocumentType: boolean;
  includeCompanyName: boolean;
  includeValue: boolean;
  compactFormat: boolean;
}

export const DEFAULT_FILENAME_OPTIONS: FilenameOptions = {
  includePageNumber: true,
  includeDocumentType: true,
  includeCompanyName: true,
  includeValue: true,
  compactFormat: false,
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
}
