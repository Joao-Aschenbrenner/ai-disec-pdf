using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class ReciboExtractorTests
{
    [Fact]
    public void ExtractNome_WithRecebemosDe_ReturnsName()
    {
        var result = ReciboExtractor.ExtractNome("RECEBEMOS DE MARIA SILVA");
        Assert.Equal("MARIA SILVA", result);
    }

    [Fact]
    public void ExtractNome_WithPagoA_ReturnsName()
    {
        var result = ReciboExtractor.ExtractNome("PAGO A JOÃO SANTOS");
        Assert.Equal("JOÃO SANTOS", result);
    }

    [Fact]
    public void ExtractNome_NoMatch_ReturnsNull()
    {
        var result = ReciboExtractor.ExtractNome("Texto sem nome");
        Assert.Null(result);
    }
}
