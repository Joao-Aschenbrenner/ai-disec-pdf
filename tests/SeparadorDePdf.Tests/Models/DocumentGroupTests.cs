using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using Xunit;

namespace SeparadorDePdf.Tests.Models;

public class DocumentGroupTests
{
    [Fact]
    public void PageCount_SinglePage_ReturnsOne()
    {
        var group = new DocumentGroup
        {
            Pages = { new PageResult { PageNumber = 1 } }
        };
        Assert.Equal(1, group.PageCount);
    }

    [Fact]
    public void PageCount_MultiplePages_ReturnsCount()
    {
        var group = new DocumentGroup
        {
            Pages =
            {
                new PageResult { PageNumber = 1 },
                new PageResult { PageNumber = 2 },
                new PageResult { PageNumber = 3 }
            }
        };
        Assert.Equal(3, group.PageCount);
    }

    [Fact]
    public void HasAllFields_AllPresent_ReturnsTrue()
    {
        var group = new DocumentGroup
        {
            Number = "12345",
            Name = "Empresa",
            Value = "1000.00"
        };
        Assert.True(group.HasAllFields);
    }

    [Fact]
    public void HasAllFields_MissingNumber_ReturnsFalse()
    {
        var group = new DocumentGroup
        {
            Name = "Empresa",
            Value = "1000.00"
        };
        Assert.False(group.HasAllFields);
    }

    [Fact]
    public void HasAllFields_MissingValue_ReturnsFalse()
    {
        var group = new DocumentGroup
        {
            Number = "12345",
            Name = "Empresa"
        };
        Assert.False(group.HasAllFields);
    }

    [Fact]
    public void DefaultValues_AreCorrect()
    {
        var group = new DocumentGroup();
        Assert.NotEqual(Guid.Empty, group.Id);
        Assert.False(group.NeedsReview);
        Assert.Empty(group.Pages);
        Assert.Equal(string.Empty, group.FileName);
    }

    [Fact]
    public void Id_IsUnique()
    {
        var g1 = new DocumentGroup();
        var g2 = new DocumentGroup();
        Assert.NotEqual(g1.Id, g2.Id);
    }
}
