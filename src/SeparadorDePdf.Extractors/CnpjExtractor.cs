using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace SeparadorDePdf.Extractors;

public static class CnpjExtractor
{
    private static readonly Regex CnpjRegex = new(@"\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}", RegexOptions.Compiled);

    public static string? Extract(string text)
    {
        var match = CnpjRegex.Match(text);
        if (!match.Success) return null;
        return Normalize(match.Value);
    }

    public static List<string> ExtractAll(string text)
    {
        return CnpjRegex.Matches(text).Select(m => Normalize(m.Value)).Distinct().ToList();
    }

    public static string Normalize(string cnpj)
    {
        var digits = new string(cnpj.Where(char.IsDigit).ToArray());
        return digits.PadLeft(14, '0');
    }

    public static bool IsValid(string cnpj)
    {
        var digits = new string(cnpj.Where(char.IsDigit).ToArray());
        if (digits.Length != 14) return false;
        if (digits.All(c => c == digits[0])) return false;

        int[] mult1 = { 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 };
        int[] mult2 = { 6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 };

        var temp = digits.Substring(0, 12);
        var sum = temp.Select((c, i) => (c - '0') * mult1[i]).Sum();
        var rem = sum % 11;
        var digit1 = rem < 2 ? 0 : 11 - rem;

        if (digits[12] - '0' != digit1) return false;

        temp += digit1;
        sum = temp.Select((c, i) => (c - '0') * mult2[i]).Sum();
        rem = sum % 11;
        var digit2 = rem < 2 ? 0 : 11 - rem;

        return digits[13] - '0' == digit2;
    }
}
