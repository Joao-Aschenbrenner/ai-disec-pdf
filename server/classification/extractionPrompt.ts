export function buildExtractionPrompt(correction?: string): string {
  return `Leia SOMENTE a imagem desta página. NAO classifique o documento. O sistema local fará a classificação.

Sua tarefa é apenas LER e EXTRAIR. Retorne SOMENTE JSON, sem markdown e sem explicações.

FORMATO:
{
  "classificationText": "copie literalmente os principais textos de cabecalho, titulos e rotulos visiveis",
  "notaNumber": "numero da nota/documento ou null",
  "companyName": "prestador/emitente/empresa principal ou null",
  "pessoaNome": "nome do funcionario se existir ou null",
  "valor": 1234.56
}

REGRAS:
1. NAO escolha documentType e NAO escolha documentClass. A classificação é responsabilidade do DocSplit/Laya.
2. NAO invente. Campo ilegivel = null.
3. classificationText deve copiar TEXTO REAL da imagem, principalmente cabecalhos e rotulos. Inclua termos como DANFE, NFS-e, Receita Federal, Relatorio Folha Pagamentos, Folha Mensal, TED, CPFL, Vencimentos e Descontos quando realmente visiveis.
4. NFS-e: companyName = PRESTADOR/EMITENTE, nunca TOMADOR.
5. DANFE/NF-e: companyName = EMITENTE/REMETENTE.
6. Holerite: pessoaNome = funcionario; valor = null.
7. Relatorio Folha Pagamentos nao e holerite individual.
8. Ignore carimbos sobrepostos como "Pago com Recurso do TERMO DE COLABORACAO" para decidir empresa.
9. Se houver DOIS holerites fisicamente separados na mesma pagina, retorne ARRAY com dois objetos independentes. Cada objeto deve repetir em classificationText os rotulos do seu proprio holerite.
10. Use numero americano em valor: 5425.00, nunca 5.425,00.
11. Se estiver em duvida, deixe o campo duvidoso null. Nao tente adivinhar o tipo.

EXCLUSÃO DE CARIMBO / MULTIPLICIDADE: carimbo PREFEITURA ou Termo de Colaboração não muda o documento. Em 2 holerites, retorne ARRAY. Para holerite, valor SEMPRE null; NÃO tente extrair Valor Líquido.

${correction ? `OBSERVACAO DO USUARIO: ${correction}\n` : ""}`;
}
