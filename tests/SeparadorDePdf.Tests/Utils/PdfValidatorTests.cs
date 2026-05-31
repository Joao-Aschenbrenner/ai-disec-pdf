using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Utils;

public class PdfValidatorTests
{
    [Fact]
    public void IsPdfFile_WithPdfExtension_ReturnsTrue()
    {
        Assert.True(PdfValidator.IsPdfFile("documento.pdf"));
    }

    [Fact]
    public void IsPdfFile_WithUpperCaseExtension_ReturnsTrue()
    {
        Assert.True(PdfValidator.IsPdfFile("documento.PDF"));
    }

    [Fact]
    public void IsPdfFile_WithNonPdfExtension_ReturnsFalse()
    {
        Assert.False(PdfValidator.IsPdfFile("documento.png"));
    }

    [Fact]
    public void IsPdfFile_WithNoExtension_ReturnsFalse()
    {
        Assert.False(PdfValidator.IsPdfFile("documento"));
    }

    [Fact]
    public void IsValidPdf_NonExistentFile_ReturnsFalse()
    {
        Assert.False(PdfValidator.IsValidPdf(@"C:\nonexistent\file.pdf"));
    }

    [Fact]
    public void IsValidPdf_EmptyFilePath_ReturnsFalse()
    {
        Assert.False(PdfValidator.IsValidPdf(""));
    }

    [Fact]
    public void IsPdfFile_NullString_ThrowsNullReferenceException()
    {
        Assert.Throws<NullReferenceException>(() => PdfValidator.IsPdfFile(null!));
    }
}
