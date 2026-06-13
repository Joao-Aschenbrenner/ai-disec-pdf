using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class ServicoExtractor
{
    private static readonly Regex PrestadorRegex = new(@"(?:PRESTADOR|FORNECEDOR|EMITENTE|TOMADOR|NOME)[:\s]+([A-ZÀ-Ú ]{3,50})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string? ExtractPrestador(string text)
    {
        var match = PrestadorRegex.Match(text);
        if (!match.Success) return null;
        var nome = match.Groups[1].Value.Trim();
        return string.IsNullOrWhiteSpace(nome) ? null : nome;
    }
}
