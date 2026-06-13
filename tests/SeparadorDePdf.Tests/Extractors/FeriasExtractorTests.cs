using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class FeriasExtractorTests
{
    [Fact]
    public void ExtractNome_WithNomePrefix_ReturnsName()
    {
        var result = FeriasExtractor.ExtractNome("NOME: MARIA SILVA");
        Assert.Equal("MARIA SILVA", result);
    }

    [Fact]
    public void ExtractNome_WithFuncionarioPrefix_ReturnsName()
    {
        var result = FeriasExtractor.ExtractNome("FUNCIONÁRIO: JOÃO SANTOS");
        Assert.Equal("JOÃO SANTOS", result);
    }

    [Fact]
    public void ExtractNome_NoMatch_ReturnsNull()
    {
        var result = FeriasExtractor.ExtractNome("Texto sem nome");
        Assert.Null(result);
    }

    [Fact]
    public void ExtractNome_EmptyText_ReturnsNull()
    {
        var result = FeriasExtractor.ExtractNome("");
        Assert.Null(result);
    }
}
