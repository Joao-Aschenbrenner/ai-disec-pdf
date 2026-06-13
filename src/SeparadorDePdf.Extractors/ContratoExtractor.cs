using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class ContratoExtractor
{
    private static readonly Regex NumeroContratoRegex = new(@"(?:CONTRATO|N[°º])[\s:]*(\d{2,})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ContratanteRegex = new(@"(?:CONTRATANTE|CONTRATADA|PARTES?)[:\s]+([A-ZÀ-Ú ]{3,50})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string? ExtractNumeroContrato(string text)
    {
        var match = NumeroContratoRegex.Match(text);
        return match.Success ? match.Groups[1].Value : null;
    }

    public static string? ExtractContratante(string text)
    {
        var match = ContratanteRegex.Match(text);
        if (!match.Success) return null;
        var nome = match.Groups[1].Value.Trim();
        return string.IsNullOrWhiteSpace(nome) ? null : nome;
    }
}
