using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class ImpostoExtractor
{
    private static readonly Regex NumeroDocumentoRegex = new(@"(?:N[°º]|DOCUMENTO|C[ÓO]DIGO|NÚMERO)[\s:]*(\d{4,})", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex DarfNumeroRegex = new(@"(\d{10,17})", RegexOptions.Compiled);

    public static string? ExtractNumeroDocumento(string text)
    {
        var match = NumeroDocumentoRegex.Match(text);
        if (match.Success) return match.Groups[1].Value;

        match = DarfNumeroRegex.Match(text);
        return match.Success ? match.Groups[1].Value : null;
    }
}
