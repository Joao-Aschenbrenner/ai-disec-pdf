using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Tests.Wpf;

public class PageResultTests
{
    [Fact]
    public void HasAllFields_ReturnsTrue_WhenAllFieldsPresent()
    {
        var result = new PageResult
        {
            Numero = "123",
            Nome = "Test",
            Valor = "100"
        };
        Assert.True(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenNumeroMissing()
    {
        var result = new PageResult
        {
            Numero = null,
            Nome = "Test",
            Valor = "100"
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenNomeMissing()
    {
        var result = new PageResult
        {
            Numero = "123",
            Nome = null,
            Valor = "100"
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenValorMissing()
    {
        var result = new PageResult
        {
            Numero = "123",
            Nome = "Test",
            Valor = null
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenAllNull()
    {
        var result = new PageResult();
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenWhitespace()
    {
        var result = new PageResult
        {
            Numero = "  ",
            Nome = "  ",
            Valor = "  "
        };
        Assert.False(result.HasAllFields);
    }

    [Fact]
    public void DefaultClassification_IsDesconhecido()
    {
        var result = new PageResult();
        Assert.Equal(DocumentType.Desconhecido, result.Classification);
    }

    [Fact]
    public void Success_DefaultsFalse()
    {
        var result = new PageResult();
        Assert.False(result.Success);
    }

    [Fact]
    public void NeedsReview_DefaultsFalse()
    {
        var result = new PageResult();
        Assert.False(result.NeedsReview);
    }
}

public class DocumentGroupTests
{
    [Fact]
    public void PageCount_ReturnsCountOfPages()
    {
        var group = new DocumentGroup
        {
            Pages = { new PageResult(), new PageResult(), new PageResult() }
        };
        Assert.Equal(3, group.PageCount);
    }

    [Fact]
    public void PageCount_ReturnsZero_WhenNoPages()
    {
        var group = new DocumentGroup();
        Assert.Equal(0, group.PageCount);
    }

    [Fact]
    public void HasAllFields_ReturnsTrue_WhenAllPresent()
    {
        var group = new DocumentGroup
        {
            Number = "123",
            Name = "Test",
            Value = "100"
        };
        Assert.True(group.HasAllFields);
    }

    [Fact]
    public void HasAllFields_ReturnsFalse_WhenNumberMissing()
    {
        var group = new DocumentGroup
        {
            Number = null,
            Name = "Test",
            Value = "100"
        };
        Assert.False(group.HasAllFields);
    }

    [Fact]
    public void Id_IsGeneratedAutomatically()
    {
        var group = new DocumentGroup();
        Assert.NotEqual(Guid.Empty, group.Id);
    }

    [Fact]
    public void Id_IsUnique()
    {
        var g1 = new DocumentGroup();
        var g2 = new DocumentGroup();
        Assert.NotEqual(g1.Id, g2.Id);
    }

    [Fact]
    public void StartPage_DefaultsToZero()
    {
        var group = new DocumentGroup();
        Assert.Equal(0, group.StartPage);
    }

    [Fact]
    public void FileName_DefaultsToEmpty()
    {
        var group = new DocumentGroup();
        Assert.Equal(string.Empty, group.FileName);
    }

    [Fact]
    public void NeedsReview_DefaultsFalse()
    {
        var group = new DocumentGroup();
        Assert.False(group.NeedsReview);
    }
}
