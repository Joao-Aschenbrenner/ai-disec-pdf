using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class ContratoExtractorTests
{
    [Fact]
    public void ExtractNumeroContrato_WithContratoPrefix_ReturnsNumber()
    {
        var result = ContratoExtractor.ExtractNumeroContrato("CONTRATO: 456");
        Assert.Equal("456", result);
    }

    [Fact]
    public void ExtractNumeroContrato_WithNPrefix_ReturnsNumber()
    {
        var result = ContratoExtractor.ExtractNumeroContrato("N° 789");
        Assert.Equal("789", result);
    }

    [Fact]
    public void ExtractNumeroContrato_NoMatch_ReturnsNull()
    {
        var result = ContratoExtractor.ExtractNumeroContrato("Texto sem contrato");
        Assert.Null(result);
    }

    [Fact]
    public void ExtractContratante_WithContratantePrefix_ReturnsName()
    {
        var result = ContratoExtractor.ExtractContratante("CONTRATANTE: EMPRESA ABC");
        Assert.Equal("EMPRESA ABC", result);
    }

    [Fact]
    public void ExtractContratante_NoMatch_ReturnsNull()
    {
        var result = ContratoExtractor.ExtractContratante("Texto sem contratante");
        Assert.Null(result);
    }
}
