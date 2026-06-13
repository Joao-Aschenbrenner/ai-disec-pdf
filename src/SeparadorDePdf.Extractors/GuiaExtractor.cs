using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class GuiaExtractor
{
    private static readonly Regex NumeroGuiaRegex = new(@"(?:N[°º]|DOCUMENTO|C[ÓO]DIGO|NÚMERO|CONTROLE)[\s:]*(\d{4,})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex ContribuinteRegex = new(@"(?:CONTRIBUINTE|NOME|EMPRESA|TOMADOR)[:\s]+([A-ZÀ-Ú ]{3,50})", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public static string? ExtractNumeroGuia(string text)
    {
        var match = NumeroGuiaRegex.Match(text);
        return match.Success ? match.Groups[1].Value : null;
    }

    public static string? ExtractContribuinte(string text)
    {
        var match = ContribuinteRegex.Match(text);
        if (!match.Success) return null;
        var nome = match.Groups[1].Value.Trim();
        return string.IsNullOrWhiteSpace(nome) ? null : nome;
    }
}
