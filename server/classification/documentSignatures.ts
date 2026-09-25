import { DocumentClass } from "./documentTaxonomy";

export interface SignatureResult {
  documentClass: DocumentClass;
  score: number;
  evidence: string[];
  hardGuard: boolean;
}

type Signature = {
  documentClass: DocumentClass;
  hard?: string[];
  anchors: Array<{ re: RegExp; weight: number; label: string }>;
};

function normalize(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const signatures: Signature[] = [
  {
    documentClass: "NFE_DANFE",
    hard: ["DANFE", "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA"],
    anchors: [
      { re: /\bDANFE\b/, weight: 0.60, label: "DANFE" },
      { re: /DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA/, weight: 0.55, label: "documento auxiliar NF-e" },
      { re: /CHAVE DE ACESSO/, weight: 0.20, label: "chave de acesso" }
    ]
  },
  {
    documentClass: "NFS",
    hard: ["NOTA FISCAL DE SERVICOS ELETRONICA", "NFS-E"],
    anchors: [
      { re: /NOTA FISCAL DE SERVICOS ELETRONICA/, weight: 0.60, label: "NFS-e" },
      { re: /\bNFS-?E\b/, weight: 0.45, label: "sigla NFS-e" },
      { re: /PRESTADOR DE SERVICOS?/, weight: 0.20, label: "prestador" },
      { re: /TOMADOR DE SERVICOS?/, weight: 0.20, label: "tomador" }
    ]
  },
  {
    documentClass: "FOPAG_13_RESUMO",
    anchors: [
      { re: /RELATORIO FOLHA PAGAMENTOS/, weight: 0.55, label: "relatorio folha" },
      { re: /(?:13.?\s*SALARIO|13O SALARIO|PGTO 13)/, weight: 0.40, label: "13 salario" },
      { re: /QUANTIDADE DE PAGAMENTOS/, weight: 0.20, label: "quantidade pagamentos" }
    ]
  },
  {
    documentClass: "FOPAG_RESUMO",
    hard: ["RELATORIO FOLHA PAGAMENTOS"],
    anchors: [
      { re: /RELATORIO FOLHA PAGAMENTOS/, weight: 0.60, label: "relatorio folha" },
      { re: /NOME DA FOLHA/, weight: 0.20, label: "nome da folha" },
      { re: /QUANTIDADE DE PAGAMENTOS/, weight: 0.20, label: "quantidade pagamentos" },
      { re: /NOME\s+CPF\s+AGENCIA\/?CONTA\s+ACEITO\s+TIPO\s+VALOR/, weight: 0.55, label: "grade folha BB" },
      { re: /PAGINA\s+[123]\s+DE\s+3/, weight: 0.20, label: "pagina folha 1-3" }
    ]
  },
  {
    documentClass: "HOLERITE_13",
    anchors: [
      { re: /(?:13.?\s*SALARIO|13O INTEGRAL|PARCELA 13)/, weight: 0.45, label: "13 salario" },
      { re: /VENCIMENTOS/, weight: 0.18, label: "vencimentos" },
      { re: /DESCONTOS/, weight: 0.18, label: "descontos" },
      { re: /MENSALISTA/, weight: 0.18, label: "mensalista" }
    ]
  },
  {
    documentClass: "HOLERITE",
    anchors: [
      { re: /FOLHA MENSAL/, weight: 0.30, label: "folha mensal" },
      { re: /MENSALISTA/, weight: 0.22, label: "mensalista" },
      { re: /VENCIMENTOS/, weight: 0.18, label: "vencimentos" },
      { re: /DESCONTOS/, weight: 0.18, label: "descontos" },
      { re: /SALARIO BASE/, weight: 0.16, label: "salario base" },
      { re: /\bF\.?G\.?T\.?S\.?\b/, weight: 0.10, label: "FGTS" }
    ]
  },
  {
    documentClass: "DARF",
    hard: ["DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS"],
    anchors: [
      { re: /DOCUMENTO DE ARRECADACAO DE RECEITAS FEDERAIS/, weight: 0.70, label: "documento arrecadacao federal" },
      { re: /\bDARF\b/, weight: 0.45, label: "DARF" },
      { re: /RECEITA FEDERAL/, weight: 0.20, label: "Receita Federal" }
    ]
  },
  {
    documentClass: "GUIA_ISS",
    anchors: [
      { re: /GUIA PARA RECOLHIMENTO DE ISSQN?/, weight: 0.65, label: "guia ISS" },
      { re: /\bISSQN\b|\bISS\b/, weight: 0.25, label: "ISS/ISSQN" }
    ]
  },
  {
    documentClass: "GUIA_INSS",
    anchors: [
      { re: /\bINSS\b/, weight: 0.35, label: "INSS" },
      { re: /GUIA DE RECOLHIMENTO|DOCUMENTO DE ARRECADACAO/, weight: 0.30, label: "guia recolhimento" }
    ]
  },
  {
    documentClass: "EXTRATO_INVESTIMENTO",
    hard: ["EXTRATOS - INVESTIMENTOS", "FUNDOS - MENSAL"],
    anchors: [
      { re: /EXTRATOS?\s*-?\s*INVESTIMENTOS?/, weight: 0.65, label: "extrato investimentos" },
      { re: /FUNDOS?\s*-?\s*MENSAL/, weight: 0.35, label: "fundos mensal" }
    ]
  },
  {
    documentClass: "EXTRATO_CC",
    anchors: [
      { re: /EXTRATO DE CONTA CORRENTE/, weight: 0.65, label: "extrato conta corrente" },
      { re: /LANCAMENTOS/, weight: 0.15, label: "lancamentos" },
      { re: /SALDO ANTERIOR/, weight: 0.15, label: "saldo anterior" },
      { re: /PAGAMENTO DE BOLETO/, weight: 0.18, label: "pagamento boleto" },
      { re: /RESGATE AUTOMATICO/, weight: 0.18, label: "resgate automatico" },
      { re: /\bPIX\b/, weight: 0.10, label: "pix" }
    ]
  },
  {
    documentClass: "TED",
    anchors: [
      { re: /\bTED\b/, weight: 0.65, label: "TED" },
      { re: /ENTRE CONTAS CORRENTES/, weight: 0.55, label: "entre contas" },
      { re: /TRANSFERENCIA/, weight: 0.20, label: "transferencia" }
    ]
  },
  {
    documentClass: "FATURA_ENERGIA",
    anchors: [
      { re: /\bCPFL\b/, weight: 0.55, label: "CPFL" },
      { re: /ENERGIA ELETRICA|CONTA DE ENERGIA/, weight: 0.45, label: "energia eletrica" },
      { re: /KWH/, weight: 0.15, label: "kWh" }
    ]
  },
  {
    documentClass: "PLANILHA",
    anchors: [
      { re: /PRESTACAO DE CONTAS|CUSTEIO MUNICIPAL|DADOS DE TRANSPARENCIA/, weight: 0.55, label: "prestacao/planilha" },
      { re: /CREDOR.*CNPJ.*VALOR/, weight: 0.25, label: "tabela financeira" }
    ]
  }
];

export function classifyBySignatures(input: string): SignatureResult {
  const text = normalize(input);
  let best: SignatureResult = { documentClass: "OUTRO", score: 0, evidence: [], hardGuard: false };

  for (const sig of signatures) {
    const hardHit = (sig.hard || []).find(h => text.includes(h));
    const evidence: string[] = [];
    let score = 0;
    for (const a of sig.anchors) {
      if (a.re.test(text)) {
        score += a.weight;
        evidence.push(a.label);
      }
    }
    if (hardHit) {
      score = Math.max(score, 0.98);
      evidence.unshift(`hard:${hardHit}`);
    }
    score = Math.min(0.99, score);
    if (score > best.score) {
      best = { documentClass: sig.documentClass, score, evidence, hardGuard: Boolean(hardHit) };
    }
  }

  return best;
}
