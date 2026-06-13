using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class ReciboExtractor
{
    private static readonly Regex NomeRegex = new(@"(?:NOME|RECEBEMOS\s+(?:DE|DO)|PAGO\s+(?:A|PARA)|REFERENTE\s+A)[:\s]+([A-ZÀ-Ú ]{3,50})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string? ExtractNome(string text)
    {
        var match = NomeRegex.Match(text);
        if (!match.Success) return null;
        var nome = match.Groups[1].Value.Trim();
        return string.IsNullOrWhiteSpace(nome) ? null : nome;
    }
}
