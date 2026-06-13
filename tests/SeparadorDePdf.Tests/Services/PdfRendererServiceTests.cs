using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Tests.Services;

public class PdfRendererServiceTests
{
    private readonly Mock<ILogService> _logMock;

    public PdfRendererServiceTests()
    {
        _logMock = new Mock<ILogService>();
        _logMock.Setup(x => x.Error(It.IsAny<Exception>(), It.IsAny<string?>()));
        _logMock.Setup(x => x.Error(It.IsAny<string>(), It.IsAny<string?>()));
    }

    private static string CreateMinimalPdf()
    {
        var path = Path.GetTempFileName();
        var pdfBytes = CreateMinimalPdfBytes();
        File.WriteAllBytes(path, pdfBytes);
        return path;
    }

    private static byte[] CreateMinimalPdfBytes()
    {
        var objects = new string[]
        {
            "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
            "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
            "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R>>endobj\n",
            "4 0 obj<</Length 25>>stream\nq\n200 200 100 100 re f\nQ\nendstream\nendobj\n",
        };

        var body = new System.Text.StringBuilder();
        body.Append("%PDF-1.4\n");
        var offsets = new int[objects.Length];
        for (int i = 0; i < objects.Length; i++)
        {
            offsets[i] = body.Length;
            body.Append(objects[i]);
        }

        var xrefOffset = body.Length;
        body.Append("xref\n");
        body.Append($"0 {objects.Length + 1}\n");
        body.Append("0000000000 65535 f \n");
        for (int i = 0; i < objects.Length; i++)
            body.Append($"{offsets[i],10:D10} 00000 n \n");

        body.Append($"trailer<</Size {objects.Length + 1}/Root 1 0 R>>\n");
        body.Append($"startxref\n{xrefOffset}\n%%EOF");

        return System.Text.Encoding.UTF8.GetBytes(body.ToString());
    }

    [Fact]
    public async Task GetPageCountAsync_ValidPdf_ReturnsPageCount()
    {
        var pdfPath = CreateMinimalPdf();
        try
        {
            var service = new PdfRendererService(_logMock.Object);
            var count = await service.GetPageCountAsync(pdfPath);
            Assert.Equal(1, count);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task GetPageCountAsync_InvalidPath_ReturnsZero()
    {
        var service = new PdfRendererService(_logMock.Object);
        var count = await service.GetPageCountAsync(@"C:\nonexistent\file.pdf");
        Assert.Equal(0, count);
    }

    [Fact]
    public async Task IsValidPdfAsync_ValidFile_ReturnsTrue()
    {
        var pdfPath = CreateMinimalPdf();
        try
        {
            var service = new PdfRendererService(_logMock.Object);
            Assert.True(await service.IsValidPdfAsync(pdfPath));
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task IsValidPdfAsync_NonExistentFile_ReturnsFalse()
    {
        var service = new PdfRendererService(_logMock.Object);
        Assert.False(await service.IsValidPdfAsync(@"C:\nonexistent.pdf"));
    }

    [Fact]
    public async Task IsValidPdfAsync_EmptyFile_ReturnsFalse()
    {
        var pdfPath = Path.GetTempFileName();
        try
        {
            var service = new PdfRendererService(_logMock.Object);
            Assert.False(await service.IsValidPdfAsync(pdfPath));
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task RenderPagesAsync_ValidPdf_ReturnsPageCount()
    {
        var pdfPath = CreateMinimalPdf();
        try
        {
            var service = new PdfRendererService(_logMock.Object);
            var pages = await service.RenderPagesAsync(pdfPath, 72);
            Assert.Single(pages);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task RenderPagesAsync_InvalidPath_Throws()
    {
        var service = new PdfRendererService(_logMock.Object);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.RenderPagesAsync(@"C:\nonexistent\file.pdf"));
    }

    [Fact]
    public async Task IsValidPdfAsync_InvalidHeader_ReturnsFalse()
    {
        var pdfPath = Path.GetTempFileName();
        try
        {
            File.WriteAllText(pdfPath, "NOT_A_PDF");
            var service = new PdfRendererService(_logMock.Object);
            Assert.False(await service.IsValidPdfAsync(pdfPath));
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }
}
