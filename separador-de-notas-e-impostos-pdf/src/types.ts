export interface ExtractedMetadata {
  isNotaFiscal: boolean;
  notaNumber: string | null;
  companyName: string | null;
  valor: number | null;
  documentType: 'nota_fiscal' | 'imposto' | 'darf' | 'outros';
}

export interface SplitPage {
  index: number;
  base64: string;
  blobUrl: string;
  originalFileName: string;
  customFilename: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
  metadata?: ExtractedMetadata;
}
