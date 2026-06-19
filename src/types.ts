export interface ExtractedMetadata {
  isNotaFiscal: boolean;
  notaNumber: string | null;
  companyName: string | null;
  valor: number | null;
  pessoaNome: string | null;
  documentType: 'nota_fiscal' | 'imposto' | 'darf' | 'extrato' | 'planilha' | 'folha_pagamento' | 'outros';
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
}
