using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class ImpostoExtractorTests
{
    [Fact]
    public void ExtractNumero_WithPrefix_ReturnsNumber()
    {
        var result = ImpostoExtractor.ExtractNumeroDocumento("N° DOCUMENTO 1234567890");
        Assert.Equal("1234567890", result);
    }

    [Fact]
    public void ExtractNumero_WithCodigoPrefix_ReturnsNumber()
    {
        var result = ImpostoExtractor.ExtractNumeroDocumento("CÓDIGO 0987654321");
        Assert.Equal("0987654321", result);
    }

    [Fact]
    public void ExtractNumero_NoMatch_ReturnsNull()
    {
        Assert.Null(ImpostoExtractor.ExtractNumeroDocumento("texto qualquer"));
    }

    [Fact]
    public void ExtractNumero_RawNumber_ReturnsMatch()
    {
        var result = ImpostoExtractor.ExtractNumeroDocumento("1234567890123");
        Assert.Equal("1234567890123", result);
    }
}
