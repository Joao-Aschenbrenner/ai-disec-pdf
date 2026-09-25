export function buildExtractionPrompt(correction?: string): string {
  return `Leia SOMENTE a imagem desta página. Sua tarefa principal é EXTRAIR texto e campos; a classificação final será feita pelo sistema local.

Retorne SOMENTE JSON, sem markdown e sem explicações.

FORMATO:
{
  "classificationText": "copie literalmente os principais textos de cabecalho, titulos e rotulos visiveis que ajudam a reconhecer o documento",
  "documentClass": "NFS|NFE_DANFE|HOLERITE|HOLERITE_13|FOPAG_RESUMO|FOPAG_13_RESUMO|DARF|GUIA_ISS|GUIA_INSS|EXTRATO_CC|EXTRATO_INVESTIMENTO|TED|FATURA_ENERGIA|PLANILHA|OUTRO",
  "notaNumber": "numero da nota/documento ou null",
  "companyName": "prestador/emitente/empresa principal ou null",
  "pessoaNome": "nome do funcionario somente em holerite ou null",
  "valor": 1234.56,
  "isNotaFiscal": false
}

REGRAS CURTAS:
1. NAO invente. Campo ilegivel = null.
2. classificationText deve ser texto REAL visivel na imagem, preferencialmente cabecalhos e rotulos.
3. NFS-e: companyName = PRESTADOR/EMITENTE, nunca TOMADOR.
4. DANFE/NF-e: companyName = EMITENTE/REMETENTE.
5. Holerite: pessoaNome = funcionario; valor = null.
6. Relatorio Folha Pagamentos nao e holerite individual.
7. Ignore carimbos sobrepostos como "Pago com Recurso do TERMO DE COLABORACAO" para decidir empresa/tipo.
8. Se houver DOIS holerites fisicamente separados na mesma pagina, retorne ARRAY com dois objetos independentes.
9. Use numero americano em valor: 5425.00, nunca 5.425,00.
10. Se estiver em duvida, use OUTRO e deixe os campos duvidosos null.

EXCLUSÃO DE CARIMBO / MULTIPLICIDADE: carimbo PREFEITURA ou Termo de Colaboração não muda o tipo. Em 2 holerites, retorne ARRAY. Para holerite, valor SEMPRE null; NÃO tente extrair Valor Líquido.

${correction ? `OBSERVACAO DO USUARIO: ${correction}\n` : ""}`;
}
