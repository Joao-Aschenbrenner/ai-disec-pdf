using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
using Moq;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Ocr;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.Services;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Services
{
    public class PdfProcessorServiceTests : IDisposable
    {
        private readonly Mock<IPdfRenderer> _rendererMock;
        private readonly Mock<IProcessingHistoryRepository> _historyMock;
        private readonly Mock<IClassificationCache> _cacheMock;
        private readonly Mock<IOcrEngine> _ocrEngineMock;
        private readonly Mock<IImageProcessor> _imageProcessorMock;
        private readonly Mock<IFileOrganizer> _fileOrganizerMock;
        private readonly Mock<IDocumentClassifier> _classifierMock;
        private readonly Mock<IDataExtractor> _extractorMock;
        private readonly Mock<ILogService> _logServiceMock;
        private readonly PdfProcessorService _service;
        private readonly string _testOutputFolder;

        public PdfProcessorServiceTests()
        {
            _rendererMock = new Mock<IPdfRenderer>();
            _historyMock = new Mock<IProcessingHistoryRepository>();
            _cacheMock = new Mock<IClassificationCache>();
            _ocrEngineMock = new Mock<IOcrEngine>();
            _imageProcessorMock = new Mock<IImageProcessor>();
            _fileOrganizerMock = new Mock<IFileOrganizer>();
            _classifierMock = new Mock<IDocumentClassifier>();
            _extractorMock = new Mock<IDataExtractor>();
            _logServiceMock = new Mock<ILogService>();

            _service = new PdfProcessorService(
                _rendererMock.Object,
                _imageProcessorMock.Object,
                _ocrEngineMock.Object,
                _classifierMock.Object,
                _extractorMock.Object,
                _fileOrganizerMock.Object,
                _cacheMock.Object,
                _historyMock.Object,
                _logServiceMock.Object);

            _testOutputFolder = Path.Combine(Path.GetTempPath(), "PdfProcessorTests", Guid.NewGuid().ToString());
            Directory.CreateDirectory(_testOutputFolder);
        }

        [Fact]
        public async Task ProcessAsync_InvalidPdf_ReturnsSkipped()
        {
            var pdfPath = CreateTempPdf("NOT_A_PDF");
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = false, FileSizeBytes = 0 });

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Skipped, result.Status);
                Assert.Equal(pdfPath, result.FilePath);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_AlreadyProcessed_ReturnsSkipped()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>()))
                    .ReturnsAsync(new ProcessingHistoryEntry { Status = ProcessingStatus.Completed });

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Skipped, result.Status);
                Assert.Equal(pdfPath, result.FilePath);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_NoPagesFound_ReturnsFail()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 0, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Error, result.Status);
                Assert.Contains("Nenhuma página encontrada", result.ErrorMessage);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_UsingCachedOcr_Succeeds()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 2, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
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

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                Assert.NotNull(result.Document);
                Assert.Equal(DocumentType.NotaFiscal, result.Document.Type);
                _cacheMock.Verify(x => x.GetAsync(It.IsAny<string>()), Times.Once);
                _rendererMock.Verify(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), default), Times.Never);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_FullPipeline_Succeeds()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, default))
                    .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1, 2, 3 } }));

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

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                _imageProcessorMock.Verify(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default), Times.AtLeastOnce);
                _ocrEngineMock.Verify(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default), Times.AtLeastOnce);
                _cacheMock.Verify(x => x.SetAsync(It.IsAny<string>(), It.IsAny<OcrResult>()), Times.Once);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_OcrEmptyText_ReturnsFail()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, default))
                    .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1, 2, 3 } }));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 4, 5, 6 });

                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .ReturnsAsync(new OcrResult { Text = "", MeanConfidence = 0 });

                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Error, result.Status);
                Assert.Contains("Nenhuma página processada", result.ErrorMessage);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_EmptyPage_ReturnsSkipped()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, default))
                    .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1, 2, 3 } }));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(true);

                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Error, result.Status);
                Assert.Contains("Nenhuma página processada", result.ErrorMessage);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_CancellationToken_CancelsProcessing()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 10, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                var pageStream = new List<byte[]>
                {
                    new byte[] { 1, 2, 3 },
                    new byte[] { 4, 5, 6 },
                    new byte[] { 7, 8, 9 },
                    new byte[] { 10, 11, 12 },
                    new byte[] { 13, 14, 15 }
                };

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(pageStream));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                var ocrResults = new List<OcrResult>
                {
                    new OcrResult { Text = "Página 1", MeanConfidence = 90f },
                    new OcrResult { Text = "Página 2", MeanConfidence = 85f },
                    new OcrResult { Text = "Página 3", MeanConfidence = 80f },
                    new OcrResult { Text = "Página 4", MeanConfidence = 75f },
                    new OcrResult { Text = "Página 5", MeanConfidence = 70f }
                };
                var ocrIndex = 0;
                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .Returns(() => Task.FromResult(ocrResults[Interlocked.Increment(ref ocrIndex) - 1]));

                var cts = new CancellationTokenSource();
                var task = _service.ProcessAsync(pdfPath, _testOutputFolder, cts.Token);

                cts.Cancel();

                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_WithLargePageCount_UsesStreaming()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                const int largePageCount = 1000;
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = largePageCount, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                var pageStream = new List<byte[]>
                {
                    new byte[] { 1, 2, 3 },
                    new byte[] { 4, 5, 6 }
                };

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(pageStream));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .ReturnsAsync(new OcrResult { Text = "Página", MeanConfidence = 80f });

                _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                    .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

                var extracted = new ExtractedData();
                extracted["NumeroNota"] = "123";
                _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

                _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                    .ReturnsAsync("dest/nota.pdf");
                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                _rendererMock.Verify(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()), Times.Once);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_MultiplePages_ProcessesAllPages()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                const int pageCount = 5;
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = pageCount, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                var pageStream = new List<byte[]>
                {
                    new byte[] { 1 },
                    new byte[] { 2 },
                    new byte[] { 3 },
                    new byte[] { 4 },
                    new byte[] { 5 }
                };

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(pageStream));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                var ocrIndex = 0;
                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .Returns(() => Task.FromResult(new OcrResult
                    {
                        Text = $"Página {++ocrIndex}",
                        MeanConfidence = 80f + ocrIndex * 2
                    }));

                _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                    .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

                var extracted = new ExtractedData();
                extracted["NumeroNota"] = "123";
                _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

                _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                    .ReturnsAsync("dest/nota.pdf");
                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                _ocrEngineMock.Verify(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default), Times.Exactly(pageCount));
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_UsesCache_WhenAvailable()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync(new OcrResult
                {
                    Text = "Nota Fiscal CNPJ 11.222.333/0001-44",
                    MeanConfidence = 85f,
                    Languages = new[] { "por" },
                    PageCount = 1
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

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                _rendererMock.Verify(x => x.RenderPagesStreamingAsync(It.IsAny<string>(), It.IsAny<int>(), default), Times.Never);
                _cacheMock.Verify(x => x.GetAsync(It.IsAny<string>()), Times.Once);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_ValidatesOcrQuality_AndRetries()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1, 2, 3 } }));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .ReturnsAsync(new OcrResult { Text = "", MeanConfidence = 0 });

                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Error, result.Status);
                _ocrEngineMock.Verify(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default), Times.Exactly(2));
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_ProgressReportsPerPage()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                const int pageCount = 3;
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = pageCount, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                var pageStream = new List<byte[]>
                {
                    new byte[] { 1 },
                    new byte[] { 2 },
                    new byte[] { 3 }
                };

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(pageStream));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                var ocrIndex = 0;
                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .Returns(() => Task.FromResult(new OcrResult
                    {
                        Text = $"Página {++ocrIndex}",
                        MeanConfidence = 80f + ocrIndex * 2
                    }));

                _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                    .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

                var extracted = new ExtractedData();
                extracted["NumeroNota"] = "123";
                _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

                _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                    .ReturnsAsync("dest/nota.pdf");
                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var progressReports = new List<double>();
                var progress = new Progress<double>(value => progressReports.Add(value));

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder, progress: progress);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                Assert.InRange(progressReports.Count, 3, 10);
                Assert.All(progressReports, p => Assert.InRange(p, 2, 100));
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        [Fact]
        public async Task ProcessAsync_RetriesWithAggressiveOptions_OnPoorOcr()
        {
            var pdfPath = CreateTempPdf();
            try
            {
                _rendererMock.Setup(x => x.GetPdfInfoAsync(pdfPath, It.IsAny<CancellationToken>()))
                    .ReturnsAsync(new PdfInfo { FilePath = pdfPath, IsValid = true, PageCount = 1, FileSizeBytes = 1000 });
                _historyMock.Setup(x => x.GetByHashAsync(It.IsAny<string>())).ReturnsAsync((ProcessingHistoryEntry?)null);
                _cacheMock.Setup(x => x.GetAsync(It.IsAny<string>())).ReturnsAsync((OcrResult?)null);

                _rendererMock.Setup(x => x.RenderPagesStreamingAsync(pdfPath, 300, It.IsAny<CancellationToken>()))
                    .Returns(ToAsyncEnumerable(new List<byte[]> { new byte[] { 1, 2, 3 } }));

                _imageProcessorMock.Setup(x => x.IsEmptyPage(It.IsAny<byte[]>(), It.IsAny<double>())).Returns(false);
                _imageProcessorMock.Setup(x => x.EnhanceAsync(It.IsAny<byte[]>(), It.IsAny<ImageProcessingOptions>(), default))
                    .ReturnsAsync(new byte[] { 1 });

                var ocrCallCount = 0;
                _ocrEngineMock.Setup(x => x.ProcessImageAsync(It.IsAny<byte[]>(), default))
                    .Returns(() =>
                    {
                        ocrCallCount++;
                        if (ocrCallCount == 1)
                            return Task.FromResult(new OcrResult { Text = "", MeanConfidence = 0 });
                        else
                            return Task.FromResult(new OcrResult { Text = "Texto válido", MeanConfidence = 90f });
                    });

                _classifierMock.Setup(x => x.ClassifyAsync(It.IsAny<string>(), default))
                    .ReturnsAsync(new ClassificationResult { Type = DocumentType.NotaFiscal, Confidence = 0.9f });

                var extracted = new ExtractedData();
                extracted["NumeroNota"] = "123";
                _extractorMock.Setup(x => x.Extract(It.IsAny<string>(), DocumentType.NotaFiscal)).Returns(extracted);

                _fileOrganizerMock.Setup(x => x.OrganizeAsync(It.IsAny<DocumentInfo>(), It.IsAny<string>(), default))
                    .ReturnsAsync("dest/nota.pdf");
                _historyMock.Setup(x => x.SaveAsync(It.IsAny<ProcessingHistoryEntry>())).Returns(Task.CompletedTask);

                var result = await _service.ProcessAsync(pdfPath, _testOutputFolder);

                Assert.Equal(ProcessingStatus.Completed, result.Status);
                Assert.Equal(2, ocrCallCount);
            }
            finally
            {
                if (File.Exists(pdfPath))
                    File.Delete(pdfPath);
            }
        }

        private string CreateTempPdf(string content = "PDF content")
        {
            var tempPath = Path.Combine(Path.GetTempPath(), "temp_test.pdf");
            File.WriteAllText(tempPath, content);
            return tempPath;
        }

        private static async IAsyncEnumerable<byte[]> ToAsyncEnumerable(IEnumerable<byte[]> source)
        {
            foreach (var item in source)
                yield return item;
            await Task.CompletedTask;
        }

        public void Dispose()
        {
            if (Directory.Exists(_testOutputFolder))
                Directory.Delete(_testOutputFolder, true);
        }
    }
}