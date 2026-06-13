using SeparadorDePdf.Services;
using Xunit;

namespace SeparadorDePdf.Tests.Wpf;

public class ConsolidatedDocumentDetectorTests
{
    private readonly ConsolidatedDocumentDetector _detector = new();

    [Fact]
    public void IsConsolidated_ManyCnpjs_ReturnsTrue()
    {
        var text = string.Join("\n", Enumerable.Range(0, 10)
            .Select(i => $"CNPJ: 12.345.678/0001-{i:D2}"));
        Assert.True(_detector.IsConsolidated(text));
    }

    [Fact]
    public void IsConsolidated_ManyCpfs_ReturnsTrue()
    {
        var text = string.Join("\n", Enumerable.Range(0, 12)
            .Select(i => $"CPF: 123.456.789-{i:D2}"));
        Assert.True(_detector.IsConsolidated(text));
    }

    [Fact]
    public void IsConsolidated_ManyValues_ReturnsTrue()
    {
        var text = string.Join("\n", Enumerable.Range(0, 20)
            .Select(i => $"R$ {i}.000,00"));
        Assert.True(_detector.IsConsolidated(text));
    }

    [Fact]
    public void IsConsolidated_ShortText_ReturnsFalse()
    {
        Assert.False(_detector.IsConsolidated("Texto curto"));
    }

    [Fact]
    public void IsConsolidated_EmptyText_ReturnsFalse()
    {
        Assert.False(_detector.IsConsolidated(""));
    }

    [Fact]
    public void IsConsolidated_NormalDocument_ReturnsFalse()
    {
        var text = "NOTA FISCAL\nCNPJ: 12.345.678/0001-99\nValor Total R$ 1.234,56";
        Assert.False(_detector.IsConsolidated(text));
    }

    [Fact]
    public void GetConsolidatedReason_ManyCnpjs_ReturnsReason()
    {
        var text = string.Join("\n", Enumerable.Range(0, 10)
            .Select(i => $"CNPJ: 12.345.678/0001-{i:D2}"));
        var reason = _detector.GetConsolidatedReason(text);
        Assert.NotNull(reason);
        Assert.Contains("CNPJs", reason);
    }

    [Fact]
    public void GetConsolidatedReason_NormalDocument_ReturnsNull()
    {
        var text = "NOTA FISCAL\nCNPJ: 12.345.678/0001-99\nValor Total R$ 1.234,56";
        Assert.Null(_detector.GetConsolidatedReason(text));
    }
}
