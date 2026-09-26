export type DocumentClass =
  | "NFS"
  | "NFE_DANFE"
  | "HOLERITE"
  | "HOLERITE_13"
  | "FOPAG_RESUMO"
  | "FOPAG_13_RESUMO"
  | "DARF"
  | "GUIA_ISS"
  | "GUIA_INSS"
  | "EXTRATO_CC"
  | "EXTRATO_INVESTIMENTO"
  | "TED"
  | "FATURA_ENERGIA"
  | "PLANILHA"
  | "OUTRO";

export const DOCUMENT_CLASSES: DocumentClass[] = [
  "NFS", "NFE_DANFE", "HOLERITE", "HOLERITE_13",
  "FOPAG_RESUMO", "FOPAG_13_RESUMO", "DARF", "GUIA_ISS",
  "GUIA_INSS", "EXTRATO_CC", "EXTRATO_INVESTIMENTO", "TED",
  "FATURA_ENERGIA", "PLANILHA", "OUTRO"
];

export function toLegacyDocumentType(documentClass: DocumentClass): string {
  switch (documentClass) {
    case "NFS":
    case "NFE_DANFE":
      return "nota_fiscal";
    case "HOLERITE":
    case "HOLERITE_13":
    case "FOPAG_RESUMO":
    case "FOPAG_13_RESUMO":
      return "folha_pagamento";
    case "DARF":
      return "darf";
    case "EXTRATO_CC":
    case "EXTRATO_INVESTIMENTO":
      return "extrato";
    case "PLANILHA":
      return "planilha";
    case "GUIA_ISS":
    case "GUIA_INSS":
    case "FATURA_ENERGIA":
      return "imposto";
    case "TED":
      return "outros";
    default:
      return "outros";
  }
}

export const CLASS_LABELS: Record<DocumentClass, string> = {
  NFS: "nota fiscal de servicos eletronica, NFS-e, prestador e tomador de servicos",
  NFE_DANFE: "DANFE ou documento auxiliar da nota fiscal eletronica de mercadorias",
  HOLERITE: "holerite individual, folha mensal, mensalista, vencimentos e descontos",
  HOLERITE_13: "holerite individual de decimo terceiro salario",
  FOPAG_RESUMO: "relatorio de folha de pagamentos com lista de funcionarios",
  FOPAG_13_RESUMO: "relatorio de folha de pagamentos do decimo terceiro salario",
  DARF: "documento de arrecadacao de receitas federais, DARF, Receita Federal",
  GUIA_ISS: "guia municipal de recolhimento de ISS ou ISSQN",
  GUIA_INSS: "guia ou documento de recolhimento de INSS",
  EXTRATO_CC: "extrato de conta corrente ou movimentacao bancaria",
  EXTRATO_INVESTIMENTO: "extrato de investimentos, fundos ou aplicacoes",
  TED: "TED, transferencia bancaria ou comprovante entre contas",
  FATURA_ENERGIA: "conta ou fatura de energia eletrica",
  PLANILHA: "planilha, tabela consolidada ou prestacao de contas com varias linhas",
  OUTRO: "documento que nao se encaixa nas classes anteriores"
};
