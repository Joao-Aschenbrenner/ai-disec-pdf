using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class NotaFiscalExtractorTests
{
    [Fact]
    public void ExtractNumeroNota_WithPrefix_ReturnsNumber()
    {
        var result = NotaFiscalExtractor.ExtractNumeroNota("Nota Fiscal Nº 001234");
        Assert.Equal("001234", result);
    }

    [Fact]
    public void ExtractNumeroNota_NoMatch_ReturnsNull()
    {
        Assert.Null(NotaFiscalExtractor.ExtractNumeroNota("texto qualquer"));
    }

    [Fact]
    public void ExtractChaveAcesso_Finds44Digits()
    {
        var chave = "35200612345678901234567890123456789012345678";
        var text = $"Chave de acesso: {chave}";
        var result = NotaFiscalExtractor.ExtractChaveAcesso(text);
        Assert.Equal(chave, result);
    }

    [Fact]
    public void ExtractChaveAcesso_NoMatch_ReturnsNull()
    {
        Assert.Null(NotaFiscalExtractor.ExtractChaveAcesso("texto sem chave"));
    }

    [Fact]
    public void ExtractChaveAcesso_WithFormatting_ReturnsRawDigits()
    {
        var formatted = "3520 0612 3456 7890 1234 5678 9012 3456 7890 1234 5678";
        var result = NotaFiscalExtractor.ExtractChaveAcesso(formatted);
        Assert.Equal("35200612345678901234567890123456789012345678", result);
    }
}
