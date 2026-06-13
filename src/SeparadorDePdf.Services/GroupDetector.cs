using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Services;

public class GroupDetector : IGroupDetector
{
    private const int GroupThreshold = 60;

    private static readonly Regex PageNumberRegex = new(
        @"(?:p[áa]g(?:ina)?\.?\s*(\d+)\s*(?:de|\/)\s*(\d+)|(\d+)\s*(?:de|\/)\s*(\d+))",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex ContinuationRegex = new(
        @"(?:continua[çc][aã]o|anexo\s*\d|p[áa]g(?:ina)?\.?\s*\d|folha\s*\d|fl\.?\s*\d)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public int CalculateScore(PageResult previous, PageResult current)
    {
        int score = 0;

        if (!string.IsNullOrWhiteSpace(previous.Numero) &&
            previous.Numero.Equals(current.Numero, StringComparison.OrdinalIgnoreCase))
            score += 50;

        if (!string.IsNullOrWhiteSpace(previous.Nome) &&
            previous.Nome.Equals(current.Nome, StringComparison.OrdinalIgnoreCase))
            score += 20;

        if (previous.Classification == current.Classification &&
            previous.Classification != DocumentType.Desconhecido)
            score += 10;

        if (HasTextContinuity(previous.OcrText, current.OcrText))
            score += 30;

        if (HasHeaderRepetition(previous.OcrText, current.OcrText))
            score += 15;

        return score;
    }

    public bool ShouldGroup(PageResult previous, PageResult current)
    {
        if (previous.NeedsReview || current.NeedsReview)
            return false;

        if (current.Classification == DocumentType.Desconhecido)
            return false;

        return CalculateScore(previous, current) >= GroupThreshold;
    }

    public List<DocumentGroup> DetectGroups(List<PageResult> pages)
    {
        var groups = new List<DocumentGroup>();
        DocumentGroup? currentGroup = null;

        for (int i = 0; i < pages.Count; i++)
        {
            var page = pages[i];

            if (currentGroup == null)
            {
                currentGroup = CreateNewGroup(page, i);
                groups.Add(currentGroup);
                continue;
            }

            var previousPage = currentGroup.Pages.Last();
            var score = CalculateScore(previousPage, page);

            if (ShouldGroup(previousPage, page))
            {
                currentGroup.Pages.Add(page);
                currentGroup.EndPage = i;
                currentGroup.Confidence = (currentGroup.Confidence + page.ClassificationConfidence) / 2;

                if (!string.IsNullOrWhiteSpace(page.Numero) && string.IsNullOrWhiteSpace(currentGroup.Number))
                    currentGroup.Number = page.Numero;
                if (!string.IsNullOrWhiteSpace(page.Nome) && string.IsNullOrWhiteSpace(currentGroup.Name))
                    currentGroup.Name = page.Nome;
                if (!string.IsNullOrWhiteSpace(page.Valor) && string.IsNullOrWhiteSpace(currentGroup.Value))
                    currentGroup.Value = page.Valor;
            }
            else
            {
                currentGroup = CreateNewGroup(page, i);
                groups.Add(currentGroup);
            }
        }

        return groups;
    }

    private static DocumentGroup CreateNewGroup(PageResult page, int index)
    {
        return new DocumentGroup
        {
            StartPage = index,
            EndPage = index,
            DocumentType = page.Classification,
            Number = page.Numero,
            Name = page.Nome,
            Value = page.Valor,
            Confidence = page.ClassificationConfidence,
            NeedsReview = page.NeedsReview,
            ReviewReason = page.ReviewReason,
            Pages = new List<PageResult> { page }
        };
    }

    private static bool HasTextContinuity(string text1, string text2)
    {
        if (string.IsNullOrWhiteSpace(text1) || string.IsNullOrWhiteSpace(text2))
            return false;

        var match1 = PageNumberRegex.Match(text1);
        var match2 = PageNumberRegex.Match(text2);

        if (match1.Success && match2.Success)
        {
            int page1 = GetPageNumber(match1);
            int page2 = GetPageNumber(match2);

            if (page1 > 0 && page2 > 0 && page2 == page1 + 1)
                return true;
        }

        if (ContinuationRegex.IsMatch(text2))
            return true;

        return false;
    }

    private static int GetPageNumber(Match match)
    {
        for (int i = 1; i < match.Groups.Count; i++)
        {
            if (match.Groups[i].Success && int.TryParse(match.Groups[i].Value, out int num))
                return num;
        }
        return 0;
    }

    private static bool HasHeaderRepetition(string text1, string text2)
    {
        if (string.IsNullOrWhiteSpace(text1) || string.IsNullOrWhiteSpace(text2))
            return false;

        var cnpj1 = CnpjExtractor.Extract(text1);
        var cnpj2 = CnpjExtractor.Extract(text2);

        if (!string.IsNullOrWhiteSpace(cnpj1) && !string.IsNullOrWhiteSpace(cnpj2) && cnpj1 == cnpj2)
            return true;

        var header1 = text1.Length > 500 ? text1[..500] : text1;
        var header2 = text2.Length > 500 ? text2[..500] : text2;

        return header1.Equals(header2, StringComparison.OrdinalIgnoreCase);
    }
}
