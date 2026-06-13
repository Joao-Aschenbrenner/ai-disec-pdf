using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Classifiers;
using Xunit;

namespace SeparadorDePdf.Tests.Classifiers;

public class NewDocumentTypesClassifierTests
{
    private readonly RegexDocumentClassifier _classifier = new();

    [Theory]
    [InlineData("FÉRIAS ABONO PECUNIÁRIO 1/3 CONSTITUCIONAL", DocumentType.Ferias)]
    [InlineData("FERIAS PERÍODO AQUISITIVO 2024", DocumentType.Ferias)]
    public async Task ClassifyAsync_FeriasText_ReturnsFerias(string text, DocumentType expected)
    {
        var result = await _classifier.ClassifyAsync(text);
        Assert.Equal(expected, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Theory]
    [InlineData("RECIBO RECEBEMOS DE VALOR RECEBIDO", DocumentType.Recibo)]
    [InlineData("RECIBO QUITAÇÃO PAGO A MARIA", DocumentType.Recibo)]
    public async Task ClassifyAsync_ReciboText_ReturnsRecibo(string text, DocumentType expected)
    {
        var result = await _classifier.ClassifyAsync(text);
        Assert.Equal(expected, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Theory]
    [InlineData("GPS GUIA DE RECOLHIMENTO CÓDIGO DE PAGAMENTO", DocumentType.Guia)]
    [InlineData("GRU VALOR TOTAL DA GUIA", DocumentType.Guia)]
    public async Task ClassifyAsync_GuiaText_ReturnsGuia(string text, DocumentType expected)
    {
        var result = await _classifier.ClassifyAsync(text);
        Assert.Equal(expected, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Theory]
    [InlineData("CONTRATO CLÁUSULA OBJETO DO CONTRATO", DocumentType.Contrato)]
    [InlineData("CONTRATANTE CONTRATADA PRAZO DE VIGÊNCIA", DocumentType.Contrato)]
    public async Task ClassifyAsync_ContratoText_ReturnsContrato(string text, DocumentType expected)
    {
        var result = await _classifier.ClassifyAsync(text);
        Assert.Equal(expected, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Theory]
    [InlineData("PRESTAÇÃO DE SERVIÇO RPS NOTA DE SERVIÇO", DocumentType.Servico)]
    [InlineData("SERVIÇOS MÉDICOS PRESTADOR", DocumentType.Servico)]
    public async Task ClassifyAsync_ServicoText_ReturnsServico(string text, DocumentType expected)
    {
        var result = await _classifier.ClassifyAsync(text);
        Assert.Equal(expected, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Fact]
    public async Task ClassifyAsync_GuiVsImposto_GpsGuiaWins()
    {
        var result = await _classifier.ClassifyAsync("GPS GUIA DE RECOLHIMENTO DARF");
        Assert.Equal(DocumentType.Guia, result.Type);
    }
}
