using System;
using System.Text.RegularExpressions;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Services;

public class ConsolidatedDocumentDetector : IConsolidatedDocumentDetector
{
    private const int MaxCnpjs = 5;
    private const int MaxCpfs = 5;
    private const int MaxValues = 10;

    private static readonly Regex ValueRegex = new(
        @"R\$\s*[\d\.,]{4,}",
        RegexOptions.Compiled);

    public bool IsConsolidated(string ocrText)
    {
        if (string.IsNullOrWhiteSpace(ocrText) || ocrText.Length < 200)
            return false;

        int cnpjCount = CountPattern(ocrText, @"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}");
        if (cnpjCount > MaxCnpjs) return true;

        int cpfCount = CountPattern(ocrText, @"\d{3}\.\d{3}\.\d{3}-\d{2}");
        if (cpfCount > MaxCpfs) return true;

        int valueCount = ValueRegex.Matches(ocrText).Count;
        if (valueCount > MaxValues) return true;

        return false;
    }

    public string? GetConsolidatedReason(string ocrText)
    {
        if (string.IsNullOrWhiteSpace(ocrText) || ocrText.Length < 200)
            return null;

        int cnpjCount = CountPattern(ocrText, @"\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}");
        if (cnpjCount > MaxCnpjs)
            return $"{cnpjCount} CNPJs detectados (limite: {MaxCnpjs})";

        int cpfCount = CountPattern(ocrText, @"\d{3}\.\d{3}\.\d{3}-\d{2}");
        if (cpfCount > MaxCpfs)
            return $"{cpfCount} CPFs detectados (limite: {MaxCpfs})";

        int valueCount = ValueRegex.Matches(ocrText).Count;
        if (valueCount > MaxValues)
            return $"{valueCount} valores monetários detectados (limite: {MaxValues})";

        return null;
    }

    private static int CountPattern(string text, string pattern)
    {
        return Regex.Matches(text, pattern).Count;
    }
}
