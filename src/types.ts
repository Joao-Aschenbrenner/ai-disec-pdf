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
  /** Sinais visuais observados pela Vision e usados pelo Laya para classificar. */
  visualEvidence?: {
    layout?: "single_form" | "multi_row_table" | "bank_ledger" | "two_individual_forms" | "other" | "unknown";
    columnHeaders?: string[];
    separateDocumentBlocks?: number | null;
    repeatedPeopleRows?: boolean;
    transactionLedgerRows?: boolean;
    pageMarker?: string | null;
  };
  /** Indica em que região visual cada campo foi encontrado. */
  fieldEvidence?: {
    companyNameLocation?: "issuer_header" | "employer_field" | "institution_header" | "account_holder_header" | "transaction_row" | "unknown";
    pessoaNomeLocation?: "employee_field" | "report_employee_row" | "transaction_party" | "unknown";
    valorLocation?: "document_total" | "employee_row" | "transaction_row" | "unknown";
  };
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
  /** Se true, o backend mudou para outro candidato Vision e a página deve continuar. */
  modelRotated?: boolean;
  /** Indica pressão real do provedor; rotação por modelo indisponível não pausa a fila. */
  providerPressure?: boolean;
  /** Só vira true depois que TODOS os candidatos Vision desta página falharem. */
  modelExhausted?: boolean;
  /** Falha LOCAL do cliente (ex.: render watchdog) — não pausa nem halta a fila. */
  localFailure?: boolean;
  candidateCount?: number;
  modelsTried?: number;
  modelsRemaining?: number;
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
    /** false somente quando a passagem local provou que visão não é necessária. */
    requiresVision?: boolean;
    modelTier?: 'fast' | 'medium';
  };
}
