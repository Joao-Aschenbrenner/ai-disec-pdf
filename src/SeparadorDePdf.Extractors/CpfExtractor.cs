using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class CpfExtractor
{
    private static readonly Regex CpfRegex = new(@"\d{3}\.?\d{3}\.?\d{3}-?\d{2}", RegexOptions.Compiled);

    public static string? Extract(string text)
    {
        var match = CpfRegex.Match(text);
        if (!match.Success) return null;
        return Normalize(match.Value);
    }

    public static List<string> ExtractAll(string text)
    {
        return CpfRegex.Matches(text).Select(m => Normalize(m.Value)).Distinct().ToList();
    }

    public static string Normalize(string cpf)
    {
        var digits = new string(cpf.Where(char.IsDigit).ToArray());
        return digits.PadLeft(11, '0');
    }
}
