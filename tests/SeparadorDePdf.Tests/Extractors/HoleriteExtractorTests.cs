using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class HoleriteExtractorTests
{
    [Fact]
    public void ExtractNome_WithNomePrefix_ReturnsName()
    {
        var result = HoleriteExtractor.ExtractNome("NOME: JOÃO SILVA");
        Assert.Equal("JOÃO SILVA", result);
    }

    [Fact]
    public void ExtractNome_WithFuncionarioPrefix_ReturnsName()
    {
        var result = HoleriteExtractor.ExtractNome("FUNCIONÁRIO: MARIA SANTOS");
        Assert.Equal("MARIA SANTOS", result);
    }

    [Fact]
    public void ExtractNome_NoMatch_ReturnsNull()
    {
        Assert.Null(HoleriteExtractor.ExtractNome("texto qualquer sem nome"));
    }
}
