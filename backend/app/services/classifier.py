import re
from typing import Dict, Optional
from app.models.schemas import DocumentType, ClassificationResult, ExtractedData


PATTERNS = {
    DocumentType.NOTA_FISCAL: [
        r"nota\s+fiscal\s+de\s+servi[cç]o",
        r"nfe\s*[-\s]?\d{44}",
        r"chave\s+de\s+acesso\s*:?\s*\d{44}",
        r"danfe",
        r"emitente\s*:?\s*[A-Z]{2,}",
    ],
    DocumentType.BOLETO: [
        r"boleto\s+banc[aá]rio",
        r"linha\s+digit[aá]vel",
        r"c[oó]digo\s+de\s+barras",
        r"nosso\s+n[úu]mero",
        r"vencimento\s*:?\s*\d{2}/\d{2}/\d{4}",
    ],
    DocumentType.CONTRATO: [
        r"contrato\s+(?:de\s+)?[a-z\s]+",
        r"cl[aá]usula\s+\d+",
        r"partes\s*:?\s*[A-Z]",
        r"objeto\s+do\s+contrato",
        r"vig[eê]ncia\s*:?\s*\d{2}/\d{2}/\d{4}",
    ],
    DocumentType.RECIBO: [
        r"recibo\s+(?:de\s+)?pagamento",
        r"received\s+(?:from|by)",
        r"valor\s+recebido",
        r"pagamento\s+efetuado",
        r"quitan[cç][aã]o",
    ],
}

CN_PJ_PATTERN = re.compile(r"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}")
CPF_PATTERN = re.compile(r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}")
NFe_PATTERN = re.compile(r"\d{44}")
CHAVE_ACESSO_PATTERN = re.compile(r"\d{44}")
NOTA_NUMERO_PATTERN = re.compile(r"(?:n[úu]mero|n[ºo])\s*:?\s*(\d{1,9})", re.IGNORECASE)
VALOR_PATTERN = re.compile(r"(?:valor|total)\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)", re.IGNORECASE)


def classify_document(text: str) -> ClassificationResult:
    text_lower = text.lower()
    scores: Dict[DocumentType, int] = {dt: 0 for dt in DocumentType}

    for doc_type, patterns in PATTERNS.items():
        for pattern in patterns:
            matches = len(re.findall(pattern, text_lower, re.IGNORECASE))
            scores[doc_type] += matches * 2

    if "nota fiscal" in text_lower and "boleto" not in text_lower:
        scores[DocumentType.NOTA_FISCAL] += 10
    if "boleto" in text_lower:
        scores[DocumentType.BOLETO] += 10

    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]
    total_score = sum(scores.values())

    if best_score == 0 or best_type == DocumentType.OUTRO:
        return ClassificationResult(
            doc_type=DocumentType.DESCONHECIDO,
            confidence=0.0,
            method="regex"
        )

    confidence = min(1.0, best_score / max(total_score, 1) * 1.5)
    return ClassificationResult(
        doc_type=best_type if confidence > 0.3 else DocumentType.DESCONHECIDO,
        confidence=round(confidence, 3),
        method="regex"
    )


def extract_data(text: str, doc_type: DocumentType) -> ExtractedData:
    data = ExtractedData()

    cnpj_match = CN_PJ_PATTERN.search(text)
    if cnpj_match:
        data.cnpj_emitente = cnpj_match.group(0)

    cpf_match = CPF_PATTERN.search(text)
    if cpf_match:
        data.cpf = cpf_match.group(0)

    nfe_match = NFe_PATTERN.search(text)
    if nfe_match:
        data.chave_acesso = nfe_match.group(0)

    chave_match = CHAVE_ACESSO_PATTERN.search(text)
    if chave_match:
        data.chave_acesso = chave_match.group(0)

    nota_match = NOTA_NUMERO_PATTERN.search(text)
    if nota_match:
        data.numero_nota = nota_match.group(1)

    nome_patterns = [
        r"(?:emitente|fornecedor|nome)\s*:?\s*([A-Z][A-Z\s]{10,})",
        r"raz[aã]o\s+social\s*:?\s*([A-Z][A-Z\s]{10,})",
    ]
    for pattern in nome_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            data.nome_pessoa = match.group(1).strip()[:100]
            break

    if doc_type == DocumentType.NOTA_FISCAL:
        impostos = re.findall(r"(?:ICMS|IPI|PIS|COFINS|ISS)\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)", text, re.IGNORECASE)
        if impostos:
            data.numero_imposto = ", ".join(impostos[:5])

    return data