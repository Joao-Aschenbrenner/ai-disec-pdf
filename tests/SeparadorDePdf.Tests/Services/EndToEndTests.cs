using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Moq;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.Ocr;
using SeparadorDePdf.Services;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Services;

public class EndToEndTests : IDisposable
{
    private readonly string _testOutputFolder;

    public EndToEndTests()
    {
        _testOutputFolder = Path.Combine(Path.GetTempPath(), "EndToEndTests", Guid.NewGuid().ToString());
        Directory.CreateDirectory(_testOutputFolder);
    }

    private static async IAsyncEnumerable<byte[]> ToAsyncEnumerable(IEnumerable<byte[]> source)
    {
        foreach (var item in source)
            yield return item;
        await Task.CompletedTask;
    }

    private (Mock<IPdfRenderer>, Mock<IProcessingHistoryRepository>, Mock<IClassificationCache>,
            Mock<IOcrEngine>, Mock<IImageProcessor>, Mock<IFileOrganizer>,
            Mock<IDocumentClassifier>, Mock<IDataExtractor>, Mock<ILogService>, PdfProcessorService)
        CreateServiceWithMocks(int pageCount = 3)
    {
        var rendererMock = new Mock<IPdfRenderer>();
        var historyMock = new Mock<IProcessingHistoryRepository>();
        var cacheMock = new Mock<IClassificationCache>();
        var ocrEngineMock = new Mock<IOcrEngine>();
        var imageProcessorMock = new Mock<IImageProcessor>();
        var fileOrganizerMock = new Mock<IFileOrganizer>();
        var classifierMock = new Mock<IDocumentClassifier>();
        var extractorMock = new Mock<IDataExtractor>();
        var logServiceMock = new Mock<ILogService>();

        rendererMock.Setup(x => x.GetPdfInfoAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new PdfInfo { FilePath = "test.pdf", IsValid = true, PageCount = pageCount, FileSizeBytes = 1000 });
        historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
        cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

        var pages = new List<byte[]>();
        for (int i = 0; i < pageCount; i++)
            pages.Add(new byte[] { (byte)(i + 1) });
        rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .Returns(ToAsyncEnumerable(pages));

        imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
        imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
            .ReturnsAsync(new byte[] { 1 });

        ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
            .ReturnsAsync(new OcrResult { Text = "Nota Fiscal CNPJ 11.222.333/0001-44", MeanConfidence = 85f, Languages = new[] { "por" } });

        classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
            .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

        var extracted = new ExtractedData();
        extracted["NumeroNota"] = "001234";
        extracted["CnpjEmitente"] = "11.222.333/0001-44";
        extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

        fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
            .ReturnsAsync("dest/nota.pdf");
        historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

        var service = new PdfProcessorService(
            rendererMock.Object, imageProcessorMock.Object, ocrEngineMock.Object,
            classifierMock.Object, extractorMock.Object, fileOrganizerMock.Object,
            cacheMock.Object, historyMock.Object, logServiceMock.Object);

        return (rendererMock, historyMock, cacheMock, ocrEngineMock, imageProcessorMock,
                fileOrganizerMock, classifierMock, extractorMock, logServiceMock, service);
    }

    [Fact]
    public async Task FullPipeline_ProgressReports_AreSequentialAndIncreasing()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (_, _, _, _, _, _, _, _, _, service) = CreateServiceWithMocks(5);

            var progressValues = new List<double>();
            var progress = new Progress<double>(v => progressValues.Add(v));

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder, progress: progress);

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            Assert.NotEmpty(progressValues);
            for (int i = 1; i < progressValues.Count; i++)
                Assert.True(progressValues[i] >= progressValues[i - 1],
                    $"Progress decreased: {progressValues[i - 1]} -> {progressValues[i]}");
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_Cancellation_MidProcessing_Throws()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (rendererMock, _, _, _, _, _, _, _, _, service) = CreateServiceWithMocks(20);

            rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1 }, new byte[] { 2 }, new byte[] { 3 } }));

            using var cts = new CancellationTokenSource();
            var task = service.ProcessAsync(pdfPath, _testOutputFolder, cts.Token);

            cts.Cancel();

            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_InvalidPdf_ReturnsSkipped()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (rendererMock, _, _, _, _, _, _, _, _, service) = CreateServiceWithMocks();
            rendererMock.Setup(x => x.GetPdfInfoAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new PdfInfo { FilePath = "test.pdf", IsValid = false, PageCount = 0, FileSizeBytes = 0, ErrorMessage = "Invalid PDF" });

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(ProcessingStatus.Skipped, result.Status);
            Assert.Contains("inválido", result.ErrorMessage, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_NoPages_ReturnsError()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (rendererMock, _, _, _, _, _, _, _, _, service) = CreateServiceWithMocks(0);

            rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Returns(ToAsyncEnumerable(new List<byte[]>()));

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(ProcessingStatus.Error, result.Status);
            Assert.Contains("Nenhuma página encontrada", result.ErrorMessage);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_PreviouslyProcessed_ReturnsSkipped()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (_, historyMock, _, _, _, _, _, _, _, service) = CreateServiceWithMocks();

            historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>()))
                .ReturnsAsync(new ProcessingHistoryEntry
                {
                    FilePath = pdfPath,
                    Status = ProcessingStatus.Completed,
                    FileHash = "abc123"
                });

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(ProcessingStatus.Skipped, result.Status);
            Assert.Contains("Já processado", result.ErrorMessage);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_OcrTextExtracted_AndClassified()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (_, _, _, ocrEngineMock, _, _, classifierMock, extractorMock, _, service) = CreateServiceWithMocks(2);

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            Assert.NotNull(result.Document);
            ocrEngineMock.Verify(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default), Times.AtLeast(2));
            classifierMock.Verify(x => x.ClassifyAsync(It.IsAny<string>(), default), Times.Once);
            extractorMock.Verify(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal), Times.Once);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task FullPipeline_FileOrganizerAndHistory_SavedOnce()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (_, historyMock, _, _, _, fileOrganizerMock, _, _, _, service) = CreateServiceWithMocks(2);

            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            fileOrganizerMock.Verify(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default), Times.Once);
            historyMock.Verify(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>()), Times.Once);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    private static string CreateTempPdf(string content = "PDF content")
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}_e2e_test.pdf");
        File.WriteAllText(tempPath, content);
        return tempPath;
    }

    public void Dispose()
    {
        if (Directory.Exists(_testOutputFolder))
            Directory.Delete(_testOutputFolder, true);
    }
}
