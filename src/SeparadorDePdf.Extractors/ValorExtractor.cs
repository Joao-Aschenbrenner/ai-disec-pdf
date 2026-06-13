using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class ValorExtractor
{
    private static readonly Regex ValorRegex = new(
        @"(?:Valor\s*(?:Total|Final|Líquido|a\s*Pagar|da\s*Nota|do\s*Serviço|da\s*NF)?|Total|TOTAL|R\$)\s*:?\s*R?\$?\s*([\d\.,]{4,})",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex ValorSimplesRegex = new(
        @"R\$\s*([\d\.,]{4,})",
        RegexOptions.Compiled);

    public static string? Extract(string text)
    {
        var match = ValorRegex.Match(text);
        if (match.Success)
            return NormalizeValor(match.Groups[1].Value);

        match = ValorSimplesRegex.Match(text);
        if (match.Success)
            return NormalizeValor(match.Groups[1].Value);

        return null;
    }

    private static string NormalizeValor(string raw)
    {
        raw = raw.Trim();
        if (raw.EndsWith(",") || raw.EndsWith("."))
            raw = raw[..^1];

        if (raw.Contains(",") && raw.Contains("."))
        {
            if (raw.LastIndexOf(",") > raw.LastIndexOf("."))
                raw = raw.Replace(".", "").Replace(",", ".");
            else
                raw = raw.Replace(",", "");
        }
        else if (raw.Contains(","))
        {
            raw = raw.Replace(",", ".");
        }

        if (decimal.TryParse(raw, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var valor))
            return valor.ToString("F2", System.Globalization.CultureInfo.InvariantCulture);

        return raw;
    }
}
