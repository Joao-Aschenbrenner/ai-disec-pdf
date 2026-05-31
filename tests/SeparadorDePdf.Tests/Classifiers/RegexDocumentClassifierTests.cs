using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Tests.Classifiers;

public class RegexDocumentClassifierTests
{
    private readonly RegexDocumentClassifier _classifier;

    public RegexDocumentClassifierTests()
    {
        _classifier = new RegexDocumentClassifier();
    }

    [Fact]
    public async Task ClassifyAsync_NullText_ReturnsDesconhecido()
    {
        var result = await _classifier.ClassifyAsync(null!);
        Assert.Equal(DocumentType.Desconhecido, result.Type);
        Assert.Equal(0, result.Confidence);
    }

    [Fact]
    public async Task ClassifyAsync_EmptyText_ReturnsDesconhecido()
    {
        var result = await _classifier.ClassifyAsync("");
        Assert.Equal(DocumentType.Desconhecido, result.Type);
    }

    [Fact]
    public async Task ClassifyAsync_NotaFiscal_ReturnsNotaFiscal()
    {
        var result = await _classifier.ClassifyAsync("NOTA FISCAL DANFE CHAVE DE ACESSO 35200612345678901234567890123456789012345678");
        Assert.Equal(DocumentType.NotaFiscal, result.Type);
        Assert.True(result.Confidence > 0);
        Assert.Equal(ClassificationMethod.Regex, result.Method);
    }

    [Fact]
    public async Task ClassifyAsync_Holerite_ReturnsHolerite()
    {
        var result = await _classifier.ClassifyAsync("HOLERITE RECIBO DE PAGAMENTO VENCIMENTOS DESCONTOS INSS FGTS");
        Assert.Equal(DocumentType.Holerite, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Fact]
    public async Task ClassifyAsync_Imposto_ReturnsImposto()
    {
        var result = await _classifier.ClassifyAsync("DARF SIMPLES NACIONAL RECEITA FEDERAL IMPOSTO ICMS ISS");
        Assert.Equal(DocumentType.Imposto, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Fact]
    public async Task ClassifyAsync_Planilha_ReturnsPlanilha()
    {
        var result = await _classifier.ClassifyAsync("PLANILHA BALANCO DEMONSTRACAO RESULTADO");
        Assert.Equal(DocumentType.PlanilhaBalanco, result.Type);
        Assert.True(result.Confidence > 0);
    }

    [Fact]
    public async Task ClassifyAsync_NoKeywords_ReturnsDesconhecido()
    {
        var result = await _classifier.ClassifyAsync("texto comum sem palavras chave de documento fiscal");
        Assert.Equal(DocumentType.Desconhecido, result.Type);
        Assert.Equal(0, result.Confidence);
    }

    [Fact]
    public async Task ClassifyAsync_HighestScoreWins()
    {
        var result = await _classifier.ClassifyAsync("HOLERITE NOTA FISCAL");
        Assert.Equal(DocumentType.Holerite, result.Type);
    }

    [Fact]
    public async Task ClassifyAsync_CaseInsensitive()
    {
        var result = await _classifier.ClassifyAsync("nota fiscal danfe");
        Assert.Equal(DocumentType.NotaFiscal, result.Type);
    }

    [Fact]
    public async Task ClassifyAsync_ChaveAcessoRegex_Matches()
    {
        var result = await _classifier.ClassifyAsync("3520 0612 3456 7890 1234 5678 9012 3456 7890 1234 5678");
        Assert.Equal(DocumentType.NotaFiscal, result.Type);
    }
}
