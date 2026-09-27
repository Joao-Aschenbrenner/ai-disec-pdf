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
  "classificationText": "copie literalmente os principais textos de cabecalho, titulos, rotulos e marcadores de pagina visiveis",
  "notaNumber": "numero da nota/documento ou null",
  "companyName": "prestador/emitente/empresa principal ou null",
  "pessoaNome": "nome do funcionario se existir ou null",
  "valor": 1234.56
}

REGRAS:
1. NAO escolha documentType e NAO escolha documentClass.
2. NAO invente. Campo ilegivel = null.
3. classificationText deve copiar TEXTO REAL da imagem, incluindo marcadores como "Pagina 2 de 3", cabecalhos e rotulos.
4. NFS-e: companyName = valor do bloco PRESTADOR/EMITENTE. Nunca use TOMADOR.
5. NFS-e: textos grandes de PREFEITURA, MUNICIPIO, SECRETARIA, DEPARTAMENTO ou nome da cidade NAO sao empresa, salvo se estiverem explicitamente dentro do campo PRESTADOR/EMITENTE.
6. DANFE/NF-e: companyName = EMITENTE/REMETENTE.
7. Holerite: pessoaNome = funcionario; valor = null.
8. Relatorio Folha Pagamentos nao e holerite individual.
9. Ignore carimbos sobrepostos como "Pago com Recurso do TERMO DE COLABORACAO" para decidir empresa.
10. Se houver DOIS holerites fisicamente separados na mesma pagina, retorne ARRAY com dois objetos independentes.
11. Use numero americano em valor: 5425.00, nunca 5.425,00.
12. Se estiver em duvida, deixe o campo duvidoso null.
13. Em paginas de continuacao, copie os rotulos/linhas visiveis; nao invente um novo documento apenas porque o cabecalho principal nao aparece.

EXCLUSÃO DE CARIMBO / MULTIPLICIDADE: carimbo PREFEITURA ou Termo de Colaboração não muda o documento. Em 2 holerites, retorne ARRAY. Para holerite, valor SEMPRE null; NÃO tente extrair Valor Líquido.

${correction ? `OBSERVACAO DO USUARIO: ${correction}\n` : ""}`;
}
