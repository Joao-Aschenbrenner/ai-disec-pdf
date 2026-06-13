using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class ValorExtractorTests
{
    [Theory]
    [InlineData("Valor Total R$ 1.234,56", "1234.56")]
    [InlineData("R$ 5.000,00", "5000.00")]
    [InlineData("TOTAL: R$ 12.345,67", "12345.67")]
    [InlineData("Valor a Pagar: R$ 889,18", "889.18")]
    [InlineData("R$ 1.234.567,89", "1234567.89")]
    public void Extract_WithBrazilianCurrency_ReturnsNormalizedValue(string text, string expected)
    {
        var result = ValorExtractor.Extract(text);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void Extract_NoCurrencyPattern_ReturnsNull()
    {
        var result = ValorExtractor.Extract("Texto sem valor algum");
        Assert.Null(result);
    }

    [Fact]
    public void Extract_EmptyText_ReturnsNull()
    {
        var result = ValorExtractor.Extract("");
        Assert.Null(result);
    }

    [Fact]
    public void Extract_MultipleValues_ReturnsFirst()
    {
        var result = ValorExtractor.Extract("R$ 100,00 e R$ 200,00");
        Assert.NotNull(result);
        Assert.Contains("100", result);
    }
}
