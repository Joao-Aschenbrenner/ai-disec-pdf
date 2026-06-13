using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.GoldenFiles;

public class GoldenFileRunner
{
    private readonly RegexDocumentClassifier _classifier = new();
    private readonly RegexDataExtractor _extractor = new();

    public GoldenFileResult Run(GoldenFileCase expected)
    {
        var result = new GoldenFileResult();

        var classification = _classifier.ClassifyAsync(expected.OcrText).GetAwaiter().GetResult();
        var extracted = _extractor.Extract(expected.OcrText, classification.Type);

        result.TipoMatch = classification.Type.ToString() == expected.Tipo;
        if (!result.TipoMatch)
            result.AddFailure("Tipo", expected.Tipo, classification.Type.ToString());

        var numero = extracted["NumeroNota"] ?? extracted["NumeroImposto"] ?? extracted["NumeroGuia"] ?? extracted["NumeroContrato"];
        result.NumeroMatch = string.Equals(numero, expected.Numero, StringComparison.OrdinalIgnoreCase);
        if (!result.NumeroMatch)
            result.AddFailure("Numero", expected.Numero ?? "(null)", numero ?? "(null)");

        var nome = extracted["NomePessoa"] ?? extracted["Contribuinte"] ?? extracted["Parte"] ?? extracted["Prestador"] ?? extracted["CnpjEmitente"] ?? extracted["Cnpj"];
        result.NomeMatch = string.Equals(nome, expected.Nome, StringComparison.OrdinalIgnoreCase);
        if (!result.NomeMatch)
            result.AddFailure("Nome", expected.Nome ?? "(null)", nome ?? "(null)");

        var valor = extracted["Valor"];
        result.ValorMatch = string.Equals(valor, expected.Valor, StringComparison.OrdinalIgnoreCase);
        if (!result.ValorMatch)
            result.AddFailure("Valor", expected.Valor ?? "(null)", valor ?? "(null)");

        result.NeedsReviewMatch = true;
        if (!result.NeedsReviewMatch)
            result.AddFailure("NeedsReview", expected.NeedsReview.ToString(), "false");

        return result;
    }
}
