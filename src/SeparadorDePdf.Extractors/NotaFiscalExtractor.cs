using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class NotaFiscalExtractor
{
    private static readonly Regex ChaveAcessoRegex = new(@"\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}", RegexOptions.Compiled);
    private static readonly Regex NumeroNotaRegex = new(@"(?:N[°º]?|NOTA|NF)[\s:]*(\d{3,})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string? ExtractChaveAcesso(string text)
    {
        var match = ChaveAcessoRegex.Match(text);
        return match.Success ? new string(match.Value.Where(char.IsDigit).ToArray()) : null;
    }

    public static string? ExtractNumeroNota(string text)
    {
        var match = NumeroNotaRegex.Match(text);
        return match.Success ? match.Groups[1].Value : null;
    }
}
