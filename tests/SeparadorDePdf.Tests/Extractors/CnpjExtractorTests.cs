using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class CnpjExtractorTests
{
    [Theory]
    [InlineData("CNPJ 11.222.333/0001-44", "11222333000144")]
    [InlineData("11222333000144", "11222333000144")]
    [InlineData("CNPJ: 11.222.333/0001-44", "11222333000144")]
    public void Extract_FindsCnpj(string text, string expected)
    {
        var result = CnpjExtractor.Extract(text);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void Extract_NoCnpj_ReturnsNull()
    {
        Assert.Null(CnpjExtractor.Extract("texto sem cnpj"));
    }

    [Fact]
    public void ExtractAll_ReturnsAllMatches()
    {
        var text = "CNPJ 11.222.333/0001-44 e 55.666.777/0001-88";
        var results = CnpjExtractor.ExtractAll(text);
        Assert.Equal(2, results.Count);
        Assert.Contains("11222333000144", results);
        Assert.Contains("55666777000188", results);
    }

    [Theory]
    [InlineData("11.222.333/0001-81", true)]
    [InlineData("11.222.333/0001-45", false)]
    [InlineData("00.000.000/0000-00", false)]
    public void IsValid_ValidatesCheckDigits(string cnpj, bool expected)
    {
        Assert.Equal(expected, CnpjExtractor.IsValid(cnpj));
    }

    [Theory]
    [InlineData("11222333000144", "11222333000144")]
    [InlineData("11.222.333/0001-44", "11222333000144")]
    [InlineData("", "00000000000000")]
    [InlineData(null, "00000000000000")]
    public void Normalize_FormatsCorrectly(string? input, string expected)
    {
        Assert.Equal(expected, CnpjExtractor.Normalize(input ?? ""));
    }
}
