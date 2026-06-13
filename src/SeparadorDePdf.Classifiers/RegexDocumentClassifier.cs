using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Classifiers;

public class RegexDocumentClassifier : IDocumentClassifier
{
    private readonly List<ClassificationRule> _rules;

    public bool SupportsOnnx => false;

    public RegexDocumentClassifier()
    {
        _rules = BuildRules();
    }

    public Task<ClassificationResult> ClassifyAsync(string ocrText, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(ocrText))
            return Task.FromResult(new ClassificationResult { Type = DocumentType.Desconhecido, Confidence = 0 });

        var upperText = ocrText.ToUpperInvariant();
        var scores = new Dictionary<DocumentType, int>();
        var matchedKeywords = new Dictionary<DocumentType, string>();

        foreach (var rule in _rules)
        {
            cancellationToken.ThrowIfCancellationRequested();

            bool matched;
            if (rule.IsRegex && rule.CompiledRegex is not null)
                matched = rule.CompiledRegex.IsMatch(ocrText);
            else
                matched = upperText.Contains(rule.Keyword.ToUpperInvariant());

            if (matched)
            {
                scores.TryGetValue(rule.Type, out var current);
                scores[rule.Type] = current + rule.Score;

                if (!matchedKeywords.ContainsKey(rule.Type) || rule.Score > (scores[rule.Type] - current))
                    matchedKeywords[rule.Type] = rule.Keyword;
            }
        }

        if (scores.Count == 0)
            return Task.FromResult(new ClassificationResult { Type = DocumentType.Desconhecido, Confidence = 0 });

        var best = scores.OrderByDescending(kvp => kvp.Value).First();
        var maxPossibleScore = _rules.Where(r => r.Type == best.Key).Sum(r => r.Score);
        var confidence = Math.Min((float)best.Value / maxPossibleScore, 1.0f);

        return Task.FromResult(new ClassificationResult
        {
            Type = best.Key,
            Confidence = confidence,
            Method = ClassificationMethod.Regex,
            MatchedKeyword = matchedKeywords.GetValueOrDefault(best.Key, string.Empty),
            Score = best.Value
        });
    }

    private static List<ClassificationRule> BuildRules()
    {
        return new List<ClassificationRule>
        {
            new() { Type = DocumentType.NotaFiscal, Keyword = "NOTA FISCAL", Score = 3 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "DANFE", Score = 5 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "NF-e", Score = 4 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "NFE", Score = 3 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "CHAVE DE ACESSO", Score = 5 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "DANFE NFC-e", Score = 5 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "DOCUMENTO AUXILIAR", Score = 4 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "EMITENTE", Score = 2 },
            new() { Type = DocumentType.NotaFiscal, Keyword = "DESTINATARIO", Score = 2 },
            new() { Type = DocumentType.NotaFiscal, IsRegex = true, CompiledRegex = new Regex(@"\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}"), Keyword = "CHAVE_ACESSO_44", Score = 4 },

            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "PLANILHA", Score = 3 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "BALANÇO", Score = 4 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "BALANCO", Score = 4 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "DRE", Score = 4 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "DEMONSTRAÇÃO", Score = 4 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "DEMONSTRACAO", Score = 4 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "CONTÁBIL", Score = 3 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "CONTABIL", Score = 3 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "RESULTADO", Score = 2 },
            new() { Type = DocumentType.PlanilhaBalanco, Keyword = "PATRIMONIAL", Score = 3 },

            new() { Type = DocumentType.Holerite, Keyword = "HOLERITE", Score = 5 },
            new() { Type = DocumentType.Holerite, Keyword = "CONTRACHEQUE", Score = 5 },
            new() { Type = DocumentType.Holerite, Keyword = "RECIBO DE PAGAMENTO", Score = 4 },
            new() { Type = DocumentType.Holerite, Keyword = "VENCIMENTOS", Score = 3 },
            new() { Type = DocumentType.Holerite, Keyword = "DESCONTOS", Score = 3 },
            new() { Type = DocumentType.Holerite, Keyword = "FOLHA DE PAGAMENTO", Score = 4 },
            new() { Type = DocumentType.Holerite, Keyword = "REMUNERAÇÃO", Score = 3 },
            new() { Type = DocumentType.Holerite, Keyword = "REMUNERACAO", Score = 3 },
            new() { Type = DocumentType.Holerite, Keyword = "RENDIMENTO", Score = 2 },
            new() { Type = DocumentType.Holerite, Keyword = "INSS", Score = 2 },
            new() { Type = DocumentType.Holerite, Keyword = "FGTS", Score = 2 },
            new() { Type = DocumentType.Holerite, Keyword = "SALÁRIO", Score = 2 },
            new() { Type = DocumentType.Holerite, Keyword = "SALARIO", Score = 2 },
            new() { Type = DocumentType.Holerite, Keyword = "ADIANTAMENTO", Score = 2 },

            new() { Type = DocumentType.Imposto, Keyword = "DARF", Score = 5 },
            new() { Type = DocumentType.Imposto, Keyword = "SIMPLES NACIONAL", Score = 4 },
            new() { Type = DocumentType.Imposto, Keyword = "RECEITA FEDERAL", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "GUIA", Score = 2 },
            new() { Type = DocumentType.Imposto, Keyword = "TRIBUTO", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "IMPOSTO", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "ICMS", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "ISS", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "PIS", Score = 2 },
            new() { Type = DocumentType.Imposto, Keyword = "COFINS", Score = 2 },
            new() { Type = DocumentType.Imposto, Keyword = "IRPJ", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "CSLL", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "IRRF", Score = 3 },
            new() { Type = DocumentType.Imposto, Keyword = "CUSTEIO", Score = 3 },

            new() { Type = DocumentType.Ferias, Keyword = "FÉRIAS", Score = 5 },
            new() { Type = DocumentType.Ferias, Keyword = "FERIAS", Score = 5 },
            new() { Type = DocumentType.Ferias, Keyword = "ABONO PECUNIÁRIO", Score = 4 },
            new() { Type = DocumentType.Ferias, Keyword = "ABONO PECUNIARIO", Score = 4 },
            new() { Type = DocumentType.Ferias, Keyword = "1/3 CONSTITUCIONAL", Score = 4 },
            new() { Type = DocumentType.Ferias, Keyword = "PERÍODO AQUISITIVO", Score = 4 },
            new() { Type = DocumentType.Ferias, Keyword = "PERIODO AQUISITIVO", Score = 4 },
            new() { Type = DocumentType.Ferias, IsRegex = true, CompiledRegex = new Regex(@"TERÇO|TERCO\s+CONSTITUCIONAL"), Keyword = "TERCO CONSTITUCIONAL", Score = 3 },

            new() { Type = DocumentType.Recibo, Keyword = "RECIBO", Score = 5 },
            new() { Type = DocumentType.Recibo, Keyword = "RECEBEMOS", Score = 3 },
            new() { Type = DocumentType.Recibo, Keyword = "QUITAÇÃO", Score = 3 },
            new() { Type = DocumentType.Recibo, Keyword = "QUITACAO", Score = 3 },
            new() { Type = DocumentType.Recibo, Keyword = "PAGO A", Score = 2 },
            new() { Type = DocumentType.Recibo, Keyword = "VALOR RECEBIDO", Score = 3 },

            new() { Type = DocumentType.Guia, Keyword = "GPS", Score = 5 },
            new() { Type = DocumentType.Guia, Keyword = "GRU", Score = 5 },
            new() { Type = DocumentType.Guia, Keyword = "GARE", Score = 5 },
            new() { Type = DocumentType.Guia, Keyword = "GUIA DE RECOLHIMENTO", Score = 4 },
            new() { Type = DocumentType.Guia, Keyword = "GUIA DA PREVIDÊNCIA", Score = 4 },
            new() { Type = DocumentType.Guia, Keyword = "CÓDIGO DE PAGAMENTO", Score = 3 },
            new() { Type = DocumentType.Guia, Keyword = "VALOR TOTAL DA GUIA", Score = 3 },

            new() { Type = DocumentType.Contrato, Keyword = "CONTRATO", Score = 4 },
            new() { Type = DocumentType.Contrato, Keyword = "CONTRATANTE", Score = 3 },
            new() { Type = DocumentType.Contrato, Keyword = "CONTRATADA", Score = 3 },
            new() { Type = DocumentType.Contrato, Keyword = "CLÁUSULA", Score = 2 },
            new() { Type = DocumentType.Contrato, Keyword = "CLAUSULA", Score = 2 },
            new() { Type = DocumentType.Contrato, Keyword = "PREÇO", Score = 2 },
            new() { Type = DocumentType.Contrato, Keyword = "PRAZO DE VIGÊNCIA", Score = 3 },
            new() { Type = DocumentType.Contrato, Keyword = "OBJETO DO CONTRATO", Score = 4 },

            new() { Type = DocumentType.Servico, Keyword = "PRESTAÇÃO DE SERVIÇO", Score = 5 },
            new() { Type = DocumentType.Servico, Keyword = "PRESTACAO DE SERVICO", Score = 5 },
            new() { Type = DocumentType.Servico, Keyword = "SERVIÇOS MÉDICOS", Score = 4 },
            new() { Type = DocumentType.Servico, Keyword = "SERVICOS MEDICOS", Score = 4 },
            new() { Type = DocumentType.Servico, Keyword = "SERVIÇO", Score = 3 },
            new() { Type = DocumentType.Servico, Keyword = "SERVICO", Score = 3 },
            new() { Type = DocumentType.Servico, Keyword = "NOTA DE SERVIÇO", Score = 4 },
            new() { Type = DocumentType.Servico, Keyword = "RPS", Score = 3 },
        };
    }
}
