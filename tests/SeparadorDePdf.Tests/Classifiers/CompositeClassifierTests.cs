using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Tests.Classifiers;

public class CompositeClassifierTests
{
    [Fact]
    public async Task ClassifyAsync_RegexConfident_ReturnsRegexResult()
    {
        var regex = new RegexDocumentClassifier();
        var composite = new CompositeClassifier(regex);

        var result = await composite.ClassifyAsync("NOTA FISCAL DANFE CHAVE DE ACESSO NFE EMITENTE DESTINATARIO");
        Assert.Equal(DocumentType.NotaFiscal, result.Type);
        Assert.Equal(ClassificationMethod.Regex, result.Method);
    }

    [Fact]
    public async Task ClassifyAsync_RegexNotConfidentNoOnnx_ReturnsRegexResult()
    {
        var regex = new RegexDocumentClassifier();
        var composite = new CompositeClassifier(regex);

        var result = await composite.ClassifyAsync("texto generico");
        Assert.Equal(DocumentType.Desconhecido, result.Type);
    }

    [Fact]
    public void SupportsOnnx_WithoutOnnx_ReturnsFalse()
    {
        var regex = new RegexDocumentClassifier();
        var composite = new CompositeClassifier(regex);
        Assert.False(composite.SupportsOnnx);
    }
}
