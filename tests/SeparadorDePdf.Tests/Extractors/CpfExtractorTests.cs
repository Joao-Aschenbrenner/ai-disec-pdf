using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class CpfExtractorTests
{
    [Theory]
    [InlineData("CPF 123.456.789-09", "12345678909")]
    [InlineData("12345678909", "12345678909")]
    [InlineData("CPF: 123.456.789-09", "12345678909")]
    public void Extract_FindsCpf(string text, string expected)
    {
        var result = CpfExtractor.Extract(text);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void Extract_NoCpf_ReturnsNull()
    {
        Assert.Null(CpfExtractor.Extract("texto sem cpf"));
    }

    [Fact]
    public void ExtractAll_ReturnsAllMatches()
    {
        var text = "CPF 123.456.789-09 e 987.654.321-00";
        var results = CpfExtractor.ExtractAll(text);
        Assert.Equal(2, results.Count);
    }

    [Theory]
    [InlineData("12345678909", "12345678909")]
    [InlineData("123.456.789-09", "12345678909")]
    [InlineData("", "00000000000")]
    public void Normalize_FormatsCorrectly(string? input, string expected)
    {
        Assert.Equal(expected, CpfExtractor.Normalize(input ?? ""));
    }
}
