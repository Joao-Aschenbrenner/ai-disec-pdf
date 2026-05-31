using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Tests.Services;

public class BatchProcessingServiceTests
{
    private readonly Mock<IPdfProcessor> _processorMock;
    private readonly Mock<ILogService> _logMock;
    private readonly BatchProcessingService _service;

    public BatchProcessingServiceTests()
    {
        _processorMock = new Mock<IPdfProcessor>();
        _logMock = new Mock<ILogService>();
        _logMock.Setup(x => x.Info(It.IsAny<string>(), It.IsAny<string?>()));
        _logMock.Setup(x => x.Error(It.IsAny<string>(), It.IsAny<string?>()));
        _service = new BatchProcessingService(_processorMock.Object, _logMock.Object)
        {
            MaxDegreeOfParallelism = 1
        };
    }

    [Fact]
    public async Task ProcessFolderAsync_NoFiles_ReturnsEmptyResult()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(tempDir);
        try
        {
            var result = await _service.ProcessFolderAsync(tempDir, @"C:\output");
            Assert.Equal(0, result.TotalFiles);
        }
        finally
        {
            Directory.Delete(tempDir);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_AllSucceed_ReturnsCorrectCounts()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        var outputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString() + "_out");
        Directory.CreateDirectory(inputDir);
        Directory.CreateDirectory(outputDir);
        try
        {
            for (int i = 0; i < 3; i++)
            {
                var pdfPath = Path.Combine(inputDir, $"doc{i}.pdf");
                await File.WriteAllTextAsync(pdfPath, $"%PDF-1.4\ncontent{i}");
            }

            _processorMock.Setup(x => x.ProcessAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ReturnsAsync((string path, string _, CancellationToken _, IProgress<double>? _) =>
                    ProcessingResult.Success(new DocumentInfo
                    {
                        FilePath = path,
                        FileName = Path.GetFileName(path),
                        Type = DocumentType.NotaFiscal
                    }, TimeSpan.FromSeconds(1)));

            var result = await _service.ProcessFolderAsync(inputDir, outputDir);

            Assert.Equal(3, result.TotalFiles);
            Assert.Equal(3, result.SuccessCount);
            Assert.Equal(0, result.ErrorCount);
            Assert.Equal(0, result.SkippedCount);
        }
        finally
        {
            Directory.Delete(inputDir, true);
            Directory.Delete(outputDir, true);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_WithErrors_ReturnsCorrectCounts()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(inputDir);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(inputDir, "a.pdf"), "%PDF-1.4\nok");
            await File.WriteAllTextAsync(Path.Combine(inputDir, "b.pdf"), "%PDF-1.4\nfail");

            _processorMock.Setup(x => x.ProcessAsync(It.Is<string>(p => p.EndsWith("a.pdf")), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ReturnsAsync(ProcessingResult.Success(new DocumentInfo { FileName = "a.pdf" }, TimeSpan.FromSeconds(1)));

            _processorMock.Setup(x => x.ProcessAsync(It.Is<string>(p => p.EndsWith("b.pdf")), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ThrowsAsync(new InvalidOperationException("Falha"));

            var result = await _service.ProcessFolderAsync(inputDir, @"C:\output");

            Assert.Equal(2, result.TotalFiles);
            Assert.Equal(1, result.SuccessCount);
            Assert.Equal(1, result.ErrorCount);
        }
        finally
        {
            Directory.Delete(inputDir, true);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_FileProcessedEventFires()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(inputDir);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(inputDir, "a.pdf"), "%PDF-1.4\n");
            await File.WriteAllTextAsync(Path.Combine(inputDir, "b.pdf"), "%PDF-1.4\n");

            _processorMock.Setup(x => x.ProcessAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ReturnsAsync((string path, string _, CancellationToken _, IProgress<double>? _) =>
                    ProcessingResult.Success(new DocumentInfo
                    {
                        FilePath = path,
                        FileName = Path.GetFileName(path),
                        Type = DocumentType.NotaFiscal
                    }, TimeSpan.FromSeconds(1)));

            var firedCount = 0;
            _service.FileProcessed += (_, _) => Interlocked.Increment(ref firedCount);

            await _service.ProcessFolderAsync(inputDir, @"C:\output");

            Assert.Equal(2, firedCount);
        }
        finally
        {
            Directory.Delete(inputDir, true);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_ProgressChangedEventFires()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(inputDir);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(inputDir, "a.pdf"), "%PDF-1.4\n");

            _processorMock.Setup(x => x.ProcessAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ReturnsAsync(ProcessingResult.Success(new DocumentInfo { FileName = "a.pdf" }, TimeSpan.FromSeconds(1)));

            var progressEvents = new List<ProcessingProgress>();
            _service.ProgressChanged += (_, p) => progressEvents.Add(p);

            await _service.ProcessFolderAsync(inputDir, @"C:\output");

            Assert.NotEmpty(progressEvents);
            Assert.Contains(progressEvents, p => p.ProcessedFiles == 1);
        }
        finally
        {
            Directory.Delete(inputDir, true);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_WithSkipped_ReturnsCorrectCounts()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(inputDir);
        try
        {
            await File.WriteAllTextAsync(Path.Combine(inputDir, "a.pdf"), "%PDF-1.4\n");

            _processorMock.Setup(x => x.ProcessAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .ReturnsAsync(ProcessingResult.Skipped("a.pdf", "Já processado"));

            var result = await _service.ProcessFolderAsync(inputDir, @"C:\output");

            Assert.Equal(1, result.TotalFiles);
            Assert.Equal(1, result.SkippedCount);
            Assert.Equal(0, result.SuccessCount);
        }
        finally
        {
            Directory.Delete(inputDir, true);
        }
    }

    [Fact]
    public async Task ProcessFolderAsync_Cancellation_StopsEarly()
    {
        var inputDir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(inputDir);
        try
        {
            for (int i = 0; i < 10; i++)
                await File.WriteAllTextAsync(Path.Combine(inputDir, $"doc{i}.pdf"), "%PDF-1.4\n");

            var barrier = new Barrier(2);
            _processorMock.Setup(x => x.ProcessAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>(), It.IsAny<IProgress<double>?>()))
                .Returns(async (string path, string _, CancellationToken ct, IProgress<double>? _) =>
                {
                    barrier.SignalAndWait(ct);
                    await Task.Delay(5000, ct);
                    return ProcessingResult.Success(new DocumentInfo { FileName = Path.GetFileName(path) }, TimeSpan.Zero);
                });

            using var cts = new CancellationTokenSource();
            var task = _service.ProcessFolderAsync(inputDir, @"C:\output", cts.Token);
            barrier.SignalAndWait();
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
        }
        finally
        {
            Directory.Delete(inputDir, true);
        }
    }
}
