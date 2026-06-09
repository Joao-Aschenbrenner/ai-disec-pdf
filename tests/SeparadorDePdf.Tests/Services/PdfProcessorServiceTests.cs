using Moq;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Tests.Services;

public static class AsyncEnumerableHelper
{
    public static async IAsyncEnumerable<T> ToAsyncEnumerable<T>(this IEnumerable<T> source)
    {
        foreach (var item in source)
            yield return item;
    }
}

public class PdfProcessorServiceTests
{
    private readonly Mock<IPdfRenderer> _rendererMock;
    private readonly Mock<IImageProcessor> _imageProcessorMock;
    private readonly Mock<IOcrEngine> _ocrEngineMock;
    private readonly Mock<IDocumentClassifier> _classifierMock;
    private readonly Mock<IDataExtractor> _extractorMock;
    private readonly Mock<IFileOrganizer> _fileOrganizerMock;
    private readonly Mock<IClassificationCache> _cacheMock;
    private readonly Mock<IProcessingHistoryRepository> _historyMock;
    private readonly Mock<ILogService> _logMock;
    private readonly PdfProcessorService _service;

    public PdfProcessorServiceTests()
    {
        _rendererMock = new Mock<IPdfRenderer>();
        _imageProcessorMock = new Mock<IImageProcessor>();
        _ocrEngineMock = new Mock<IOcrEngine>();
        _classifierMock = new Mock<IDocumentClassifier>();
        _extractorMock = new Mock<IDataExtractor>();
        _fileOrganizerMock = new Mock<IFileOrganizer>();
        _cacheMock = new Mock<IClassificationCache>();
        _historyMock = new Mock<IProcessingHistoryRepository>();
        _logMock = new Mock<ILogService>();

        _logMock.Setup(x => x.Info(It.IsAny<string>(), It.IsAny<string?>()));
        _logMock.Setup(x => x.Warning(It.IsAny<string>(), It.IsAny<string?>()));
        _logMock.Setup(x => x.Error(It.IsAny<string>(), It.IsAny<string?>()));
        _logMock.Setup(x => x.Debug(It.IsAny<string>(), It.IsAny<string?>()));

        _service = new PdfProcessorService(
            _rendererMock.Object,
            _imageProcessorMock.Object,
            _ocrEngineMock.Object,
            _classifierMock.Object,
            _extractorMock.Object,
            _fileOrganizerMock.Object,
            _cacheMock.Object,
            _historyMock.Object,
            _logMock.Object);
    }

    private string CreateTempPdf(string? header = null, string content = "fake pdf")
    {
        var path = Path.GetTempFileName();
        File.WriteAllText(path, (header ?? "%PDF-1.4") + "\n" + content);
        return path;
    }

    [Fact]
    public async Task ProcessAsync_InvalidPdf_ReturnsSkipped()
    {
        var pdfPath = CreateTempPdf("NOT_A_PDF");
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(false);

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Skipped, result.Status);
            Assert.Equal(pdfPath, result.FilePath);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task ProcessAsync_AlreadyProcessed_ReturnsSkipped()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(true);
            _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>()))
                .ReturnsAsync(new ProcessingHistoryEntry { Status = ProcessingStatus.Completed });

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Skipped, result.Status);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task ProcessAsync_NoPagesFound_ReturnsFail()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(true);
            _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);
            _rendererMock.Setup(x => x.GetPageCountAsync(pdfPath, default))
                .ReturnsAsync(0);

            _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Error, result.Status);
            Assert.Contains("Nenhuma página encontrada", result.ErrorMessage);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task ProcessAsync_UsingCachedOcr_Succeeds()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(true);
            _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            _rendererMock.Setup(x => x.GetPageCountAsync(pdfPath, default)).ReturnsAsync(2);

            _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync(new OcrResult
            {
                Text = "Nota Fiscal CNPJ 11.222.333/0001-44 valor R$ 1.000,00",
                MeanConfidence = 85f,
                Languages = new[] { "por" },
                PageCount = 2
            });

            _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

            var extracted = new ExtractedData();
            extracted["NumeroNota"] = "123";
            extracted["CnpjEmitente"] = "11.222.333/0001-44";
            _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

            _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                .ReturnsAsync("dest/nota.pdf");
            _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            Assert.NotNull(result.Document);
            Assert.Equal(DocumentType.NotaFiscal, result.Document.Type);
            _cacheMock.Verify(x => x.GetAsync(It.IsAny<string>()), Times.Once);
            _rendererMock.Verify(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), default), Times.Never);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task ProcessAsync_FullPipeline_Succeeds()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(true);
            _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            _rendererMock.Setup(x => x.GetPageCountAsync(pdfPath, default)).ReturnsAsync(1);

            _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

            _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, default))
                .Returns(new List<byte[]> { new byte[] { 1, 2, 3 } }.ToAsyncEnumerable());

            _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
            _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                .ReturnsAsync(new byte[] { 4, 5, 6 });

            _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                .ReturnsAsync(new OcrResult { Text = "Nota Fiscal CNPJ 11.222.333/0001-44", MeanConfidence = 80f });

            _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

            var extracted = new ExtractedData();
            extracted["NumeroNota"] = "001234";
            extracted["CnpjEmitente"] = "11.222.333/0001-44";
            _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

            _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                .ReturnsAsync("dest/nota.pdf");
            _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            _imageProcessorMock.Verify(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default), Times.AtLeastOnce);
            _ocrEngineMock.Verify(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default), Times.AtLeastOnce);
            _cacheMock.Verify(x => x.SetAsync(It.IsAny<string>(), It.IsAny<OcrResult>()), Times.Once);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task ProcessAsync_OcrEmptyText_ReturnsFail()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            _rendererMock.Setup(x => x.IsValidPdf(pdfPath)).Returns(true);
            _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            _rendererMock.Setup(x => x.GetPageCountAsync(pdfPath, default)).ReturnsAsync(1);
            _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

            _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, default))
                .Returns(new List<byte[]> { new byte[] { 1, 2, 3 } }.ToAsyncEnumerable());

            _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
            _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                .ReturnsAsync(new byte[] { 4, 5, 6 });

            _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                .ReturnsAsync(new OcrResult { Text = "", MeanConfidence = 0 });

            _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var result = await _service.ProcessAsync(pdfPath, @"C:\output");

            Assert.Equal(ProcessingStatus.Error, result.Status);
            Assert.Contains("Nenhuma página processada", result.ErrorMessage);
        }
        finally
        {
            File.Delete(pdfPath);
        }
    }
}
