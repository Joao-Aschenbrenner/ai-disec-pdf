using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class GuiaExtractorTests
{
    [Fact]
    public void ExtractNumeroGuia_WithNumeroPrefix_ReturnsNumber()
    {
        var result = GuiaExtractor.ExtractNumeroGuia("N° 12345");
        Assert.Equal("12345", result);
    }

    [Fact]
    public void ExtractNumeroGuia_WithCodigoPrefix_ReturnsNumber()
    {
        var result = GuiaExtractor.ExtractNumeroGuia("CÓDIGO: 67890");
        Assert.Equal("67890", result);
    }

    [Fact]
    public void ExtractNumeroGuia_NoMatch_ReturnsNull()
    {
        var result = GuiaExtractor.ExtractNumeroGuia("Texto sem número");
        Assert.Null(result);
    }

    [Fact]
    public void ExtractContribuinte_WithContribuintePrefix_ReturnsName()
    {
        var result = GuiaExtractor.ExtractContribuinte("CONTRIBUINTE: EMPRESA LTDA");
        Assert.Equal("EMPRESA LTDA", result);
    }

    [Fact]
    public void ExtractContribuinte_NoMatch_ReturnsNull()
    {
        var result = GuiaExtractor.ExtractContribuinte("Texto sem contribuinte");
        Assert.Null(result);
    }
}
