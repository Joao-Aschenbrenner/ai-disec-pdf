using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class ServicoExtractorTests
{
    [Fact]
    public void ExtractPrestador_WithPrestadorPrefix_ReturnsName()
    {
        var result = ServicoExtractor.ExtractPrestador("PRESTADOR: CLÍNICA SÃO PAULO");
        Assert.Equal("CLÍNICA SÃO PAULO", result);
    }

    [Fact]
    public void ExtractPrestador_WithFornecedorPrefix_ReturnsName()
    {
        var result = ServicoExtractor.ExtractPrestador("FORNECEDOR: LABORATÓRIO XYZ");
        Assert.Equal("LABORATÓRIO XYZ", result);
    }

    [Fact]
    public void ExtractPrestador_NoMatch_ReturnsNull()
    {
        var result = ServicoExtractor.ExtractPrestador("Texto sem prestador");
        Assert.Null(result);
    }
}
