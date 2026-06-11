using System;
using System.Collections.Generic;
using System.Diagnostics;
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

public class StressTests : IDisposable
{
    private readonly string _testOutputFolder;

    public StressTests()
    {
        _testOutputFolder = Path.Combine(Path.GetTempPath(), "StressTests", Guid.NewGuid().ToString());
        Directory.CreateDirectory(_testOutputFolder);
    }

    private static async IAsyncEnumerable<byte[]> ToAsyncEnumerable(IEnumerable<byte[]> source)
    {
        foreach (var item in source)
            yield return item;
        await Task.CompletedTask;
    }

    [Fact]
    public async Task ConcurrentProcessing_MultiplePdfs_DoesNotDeadlock()
    {
        var pdfPaths = new[] { CreateTempPdf("pdf1"), CreateTempPdf("pdf2"), CreateTempPdf("pdf3") };
        try
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
                .ReturnsAsync(new PdfInfo { FilePath = "test.pdf", IsValid = true, PageCount = 3, FileSizeBytes = 1000 });
            historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);
            rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1 }, new byte[] { 2 }, new byte[] { 3 } }));
            imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
            imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                .ReturnsAsync(new byte[] { 1 });
            ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                .ReturnsAsync(new OcrResult { Text = "Nota Fiscal", MeanConfidence = 85f, Languages = new[] { "por" } });
            classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });
            var extracted = new ExtractedData();
            extracted["NumeroNota"] = "123";
            extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);
            fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                .ReturnsAsync("dest/nota.pdf");
            historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var service = new PdfProcessorService(
                rendererMock.Object, imageProcessorMock.Object, ocrEngineMock.Object,
                classifierMock.Object, extractorMock.Object, fileOrganizerMock.Object,
                cacheMock.Object, historyMock.Object, logServiceMock.Object);

            var tasks = new List<Task<ProcessingResult>>();
            foreach (var pdfPath in pdfPaths)
                tasks.Add(service.ProcessAsync(pdfPath, _testOutputFolder));

            var results = await Task.WhenAll(tasks);

            foreach (var result in results)
            {
                Assert.Equal(ProcessingStatus.Completed, result.Status);
            }
        }
        finally
        {
            foreach (var p in pdfPaths)
                if (File.Exists(p)) File.Delete(p);
        }
    }

    [Fact]
    public async Task Processing_CompletesWithinTime()
    {
        var pdfPath = CreateTempPdf();
        try
        {
            var (_, _, _, _, _, _, _, _, _, service) = CreateServiceWithMocks(3);

            var sw = Stopwatch.StartNew();
            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);
            sw.Stop();

            Assert.InRange(sw.Elapsed.TotalSeconds, 0, 10);
            Assert.Equal(ProcessingStatus.Completed, result.Status);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task Processing_WithCancellationToken_RespectsCancellation()
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
    public async Task Processing_SimulatedLargePdf_CompletesWithinTime()
    {
        var pdfPath = CreateTempPdf();
        try
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

            const int simulatedPageCount = 1000;
            rendererMock.Setup(x => x.GetPdfInfoAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new PdfInfo { FilePath = "test.pdf", IsValid = true, PageCount = simulatedPageCount, FileSizeBytes = 200000000 });
            historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

            var largePageStream = new List<byte[]>();
            for (int i = 0; i < simulatedPageCount; i++)
                largePageStream.Add(new byte[] { (byte)(i % 256) });

            rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Returns(ToAsyncEnumerable(largePageStream));
            imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
            imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                .ReturnsAsync(new byte[] { 1 });
            ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                .ReturnsAsync(new OcrResult { Text = "Nota Fiscal", MeanConfidence = 85f, Languages = new[] { "por" } });
            classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });
            var extracted = new ExtractedData();
            extracted["NumeroNota"] = "123";
            extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);
            fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                .ReturnsAsync("dest/nota.pdf");
            historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var service = new PdfProcessorService(
                rendererMock.Object, imageProcessorMock.Object, ocrEngineMock.Object,
                classifierMock.Object, extractorMock.Object, fileOrganizerMock.Object,
                cacheMock.Object, historyMock.Object, logServiceMock.Object);

            var sw = Stopwatch.StartNew();
            var result = await service.ProcessAsync(pdfPath, _testOutputFolder);
            sw.Stop();

            Assert.Equal(ProcessingStatus.Completed, result.Status);
            Assert.InRange(sw.Elapsed.TotalSeconds, 0, 60);
            rendererMock.Verify(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()), Times.Once);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
    }

    [Fact]
    public async Task Processing_RepeatedCalls_SamePdf_ReturnsConsistentResults()
    {
        var pdfPath = CreateTempPdf();
        try
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
                .ReturnsAsync(new PdfInfo { FilePath = "test.pdf", IsValid = true, PageCount = 2, FileSizeBytes = 1000 });
            historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
            cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);
            rendererMock.Setup(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
                .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1 }, new byte[] { 2 } }));
            imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
            imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                .ReturnsAsync(new byte[] { 1 });
            ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                .ReturnsAsync(new OcrResult { Text = "Nota Fiscal", MeanConfidence = 85f, Languages = new[] { "por" } });
            classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });
            var extracted = new ExtractedData();
            extracted["NumeroNota"] = "123";
            extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);
            fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                .ReturnsAsync("dest/nota.pdf");
            historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

            var service = new PdfProcessorService(
                rendererMock.Object, imageProcessorMock.Object, ocrEngineMock.Object,
                classifierMock.Object, extractorMock.Object, fileOrganizerMock.Object,
                cacheMock.Object, historyMock.Object, logServiceMock.Object);

            var result1 = await service.ProcessAsync(pdfPath, _testOutputFolder);
            var result2 = await service.ProcessAsync(pdfPath, _testOutputFolder);

            Assert.Equal(result1.Status, result2.Status);
            Assert.Equal(result1.ErrorMessage, result2.ErrorMessage);
        }
        finally
        {
            if (File.Exists(pdfPath)) File.Delete(pdfPath);
        }
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
            .ReturnsAsync(new OcrResult { Text = "Nota Fiscal", MeanConfidence = 85f, Languages = new[] { "por" } });

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

    private static string CreateTempPdf(string content = "PDF content")
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}_temp_test.pdf");
        File.WriteAllText(tempPath, content);
        return tempPath;
    }

    public void Dispose()
    {
        if (Directory.Exists(_testOutputFolder))
            Directory.Delete(_testOutputFolder, true);
    }
}
