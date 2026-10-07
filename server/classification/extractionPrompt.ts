export interface ExtractionHint {
  documentClass?: string;
  confidence?: number;
  source?: string;
  previousClass?: string | null;
  nextClass?: string | null;
  sequenceReason?: string | null;
}

export function buildExtractionPrompt(correction?: string, hint?: ExtractionHint): string {
  const context = hint?.documentClass
    ? `
CONTEXTO LOCAL JA CALCULADO (NAO E PARA VOCE RECLASSIFICAR):
- classe provavel: ${hint.documentClass}
- confianca local: ${Math.round(Number(hint.confidence || 0) * 100)}%
- fonte: ${hint.source || "desconhecida"}
- pagina anterior: ${hint.previousClass || "desconhecida"}
- pagina seguinte: ${hint.nextClass || "desconhecida"}
- contexto sequencial: ${hint.sequenceReason || "nenhum"}

Use esse contexto SOMENTE para saber quais campos ler. NAO altere a classe.
`
    : "";

  return `Leia SOMENTE a imagem desta página. NAO classifique o documento. O sistema local (Signatures + Laya + SequenceResolver) fará a classificação.

Sua tarefa é apenas LER e EXTRAIR. Retorne SOMENTE JSON, sem markdown e sem explicações.

${context}

FORMATO:
{
  "classificationText": "somente titulos, cabecalhos, rotulos e nomes das colunas; nunca copie conteudo de linhas, nomes, documentos, contas, descricoes ou valores",
  "visualEvidence": {
    "layout": "single_form | multi_row_table | bank_ledger | two_individual_forms | other | unknown",
    "columnHeaders": ["rotulos de coluna visiveis, sem dados das linhas"],
    "separateDocumentBlocks": 1,
    "repeatedPeopleRows": false,
    "transactionLedgerRows": false,
    "pageMarker": "Pagina 2 de 3 ou null"
  },
  "fieldEvidence": {
    "companyNameLocation": "issuer_header | employer_field | institution_header | account_holder_header | transaction_row | unknown",
    "pessoaNomeLocation": "employee_field | report_employee_row | transaction_party | unknown",
    "valorLocation": "document_total | employee_row | transaction_row | unknown"
  },
  "notaNumber": "numero da nota/documento ou null",
  "companyName": "prestador/emitente/empregador/titular da conta no cabecalho correto ou null",
  "pessoaNome": "nome do funcionario em holerite individual ou null",
  "valor": 1234.56
}

REGRAS:
1. NAO escolha documentType e NAO escolha documentClass.
2. NAO invente. Campo ilegivel = null.
3. classificationText deve conter somente titulos, cabecalhos e rotulos visiveis. Nao inclua valores de campos nem texto das linhas de tabela; o Laya recebe esses sinais estruturais para decidir a classe.
3a. visualEvidence descreve o formato da pagina, nao o conteudo das pessoas/operacoes: use multi_row_table para tabela com varias linhas; bank_ledger para extrato com grade de lancamentos; two_individual_forms somente para dois formularios completos e fisicamente separados; separateDocumentBlocks conta formularios completos, nao linhas da tabela.
4. NFS-e: companyName = valor do bloco PRESTADOR/EMITENTE; marque issuer_header. Nunca use TOMADOR.
5. NFS-e: textos grandes de PREFEITURA, MUNICIPIO, SECRETARIA, DEPARTAMENTO ou nome da cidade NAO sao empresa, salvo se estiverem explicitamente dentro do campo PRESTADOR/EMITENTE.
6. DANFE/NF-e: companyName = EMITENTE/REMETENTE; marque issuer_header.
7. Holerite individual: pessoaNome deve vir do campo FUNCIONARIO/NOME do formulario; marque employee_field; valor = null.
8. Relatorio Folha Pagamentos, inclusive tabela com varias pessoas: e UM documento na pagina, nunca gere um objeto/arquivo por funcionario. Marque layout=multi_row_table, repeatedPeopleRows=true, separateDocumentBlocks=1; companyName somente do campo EMPREGADOR; marque employer_field. Nao extraia nomes nem valores das linhas; valor e pessoaNome ficam null.
9. Extrato bancario com varias operacoes: e UM documento, nunca gere um objeto/arquivo por transacao. Marque layout=bank_ledger e transactionLedgerRows=true; companyName somente do cabecalho da instituicao ou titular da conta; nunca use favorecido/contraparte da transacao; marque transaction_party se a pagina mostrar nomes em lancamentos; valor = null.
10. Ignore carimbos sobrepostos como "Pago com Recurso do TERMO DE COLABORACAO" para decidir empresa.
11. Retorne ARRAY somente se houver exatamente dois formularios completos, cada um com seu proprio cabecalho/campos, visualmente separados na pagina. Nesse caso marque, em cada objeto, layout=two_individual_forms e separateDocumentBlocks=2. Duas ou mais linhas de tabela nunca justificam ARRAY.
12. Preencha valor somente quando estiver rotulado como total consolidado do proprio documento (ex.: Valor Total da Nota/Total a Pagar); marque document_total. Nunca copie total de linha de tabela, lancamento bancario ou empregado.
13. Use numero americano em valor: 5425.00, nunca 5.425,00.
14. Se estiver em duvida, deixe o campo duvidoso null.
15. Em paginas de continuacao, copie apenas cabecalhos/rotulos visiveis; nao invente um novo documento apenas porque o cabecalho principal nao aparece.
16. O retorno normal e um objeto JSON por pagina. Listas dentro do objeto (por exemplo visualEvidence.columnHeaders) sao apenas campos do mesmo documento; nunca as retorne ou interprete como documentos separados.

EXCLUSAO DE CARIMBO / MULTIPLICIDADE: carimbo PREFEITURA ou Termo de Colaboracao nao muda o documento. Em 2 holerites fisicamente separados, retorne ARRAY. Para qualquer holerite, valor SEMPRE null; NAO tente extrair Valor Liquido. O Laya e o classificador da classe: forneca sinais visuais e rotulos, sem decidir a classe.

${correction ? `OBSERVACAO DO USUARIO: ${correction}\n` : ""}`;
}
