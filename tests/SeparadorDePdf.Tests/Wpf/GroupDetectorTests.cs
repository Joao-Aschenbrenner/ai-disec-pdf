using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Services;
using Xunit;

namespace SeparadorDePdf.Tests.Wpf;

public class GroupDetectorTests
{
    private readonly GroupDetector _detector = new();

    [Fact]
    public void CalculateScore_SameNumber_ReturnsHighScore()
    {
        var prev = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal };
        var curr = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal };

        var score = _detector.CalculateScore(prev, curr);
        Assert.True(score >= 50);
    }

    [Fact]
    public void CalculateScore_SameName_ReturnsMediumScore()
    {
        var prev = new PageResult { Nome = "Empresa ABC", Classification = DocumentType.NotaFiscal };
        var curr = new PageResult { Nome = "Empresa ABC", Classification = DocumentType.NotaFiscal };

        var score = _detector.CalculateScore(prev, curr);
        Assert.True(score >= 20);
    }

    [Fact]
    public void CalculateScore_SameType_ReturnsLowScore()
    {
        var prev = new PageResult { Classification = DocumentType.Holerite };
        var curr = new PageResult { Classification = DocumentType.Holerite };

        var score = _detector.CalculateScore(prev, curr);
        Assert.True(score >= 10);
    }

    [Fact]
    public void CalculateScore_DifferentTypes_ReturnsLowScore()
    {
        var prev = new PageResult { Classification = DocumentType.NotaFiscal };
        var curr = new PageResult { Classification = DocumentType.Holerite };

        var score = _detector.CalculateScore(prev, curr);
        Assert.True(score < 20);
    }

    [Fact]
    public void ShouldGroup_SameNumber_ReturnsTrue()
    {
        var prev = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f };
        var curr = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f };

        Assert.True(_detector.ShouldGroup(prev, curr));
    }

    [Fact]
    public void ShouldGroup_NeedsReview_ReturnsFalse()
    {
        var prev = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal, NeedsReview = true };
        var curr = new PageResult { Numero = "12345", Classification = DocumentType.NotaFiscal };

        Assert.False(_detector.ShouldGroup(prev, curr));
    }

    [Fact]
    public void ShouldGroup_Desconhecido_ReturnsFalse()
    {
        var prev = new PageResult { Classification = DocumentType.NotaFiscal };
        var curr = new PageResult { Classification = DocumentType.Desconhecido };

        Assert.False(_detector.ShouldGroup(prev, curr));
    }

    [Fact]
    public void DetectGroups_MultiplePagesSameNumber_OneGroup()
    {
        var pages = new List<PageResult>
        {
            new() { PageNumber = 1, Numero = "12345", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f },
            new() { PageNumber = 2, Numero = "12345", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f },
            new() { PageNumber = 3, Numero = "12345", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f }
        };

        var groups = _detector.DetectGroups(pages);
        Assert.Single(groups);
        Assert.Equal(3, groups[0].PageCount);
    }

    [Fact]
    public void DetectGroups_DifferentNumbers_MultipleGroups()
    {
        var pages = new List<PageResult>
        {
            new() { PageNumber = 1, Numero = "11111", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f },
            new() { PageNumber = 2, Numero = "22222", Classification = DocumentType.NotaFiscal, ClassificationConfidence = 0.9f }
        };

        var groups = _detector.DetectGroups(pages);
        Assert.Equal(2, groups.Count);
    }

    [Fact]
    public void DetectGroups_EmptyPages_ReturnsEmptyGroups()
    {
        var pages = new List<PageResult>();
        var groups = _detector.DetectGroups(pages);
        Assert.Empty(groups);
    }
}
