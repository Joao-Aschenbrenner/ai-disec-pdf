using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using Xunit;

namespace SeparadorDePdf.Tests.Models;

public class PageResultTests
{
    [Fact]
    public void HasAllFields_AllPresent_ReturnsTrue()
    {
        var result = new PageResult
        {
            Numero = "12345",
            Nome = "Empresa",
            Valor = "1000.00"
        };
        Assert.True(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_MissingNumero_ReturnsFalse()
    {
        var result = new PageResult
        {
            Nome = "Empresa",
            Valor = "1000.00"
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_MissingNome_ReturnsFalse()
    {
        var result = new PageResult
        {
            Numero = "12345",
            Valor = "1000.00"
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_MissingValor_ReturnsFalse()
    {
        var result = new PageResult
        {
            Numero = "12345",
            Nome = "Empresa"
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_AllEmpty_ReturnsFalse()
    {
        var result = new PageResult();
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void DefaultValues_AreCorrect()
    {
        var result = new PageResult();
        Assert.Equal(DocumentType.Desconhecido, result.Classification);
        Assert.False(result.Success);
        Assert.False(result.NeedsReview);
        Assert.Equal(string.Empty, result.OcrText);
        Assert.Equal(string.Empty, result.SuggestedFileName);
    }
}
