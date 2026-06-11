using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Channels;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Ocr;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class PdfProcessorService : IPdfProcessor
{
    private readonly IPdfRenderer _pdfRenderer;
    private readonly IImageProcessor _imageProcessor;
    private readonly IOcrEngine _ocrEngine;
    private readonly IDocumentClassifier _classifier;
    private readonly IDataExtractor _extractor;
    private readonly IFileOrganizer _fileOrganizer;
    private readonly IClassificationCache _cache;
    private readonly IProcessingHistoryRepository _historyRepository;
    private readonly ILogService _logService;
    private readonly ImageProcessingOptions _defaultOptions;
    private readonly ImageProcessingOptions _aggressiveOptions;

    public PdfProcessorService(
        IPdfRenderer pdfRenderer,
        IImageProcessor imageProcessor,
        IOcrEngine ocrEngine,
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        IFileOrganizer fileOrganizer,
        IClassificationCache cache,
        IProcessingHistoryRepository historyRepository,
        ILogService logService)
    {
        _pdfRenderer = pdfRenderer;
        _imageProcessor = imageProcessor;
        _ocrEngine = ocrEngine;
        _classifier = classifier;
        _extractor = extractor;
        _fileOrganizer = fileOrganizer;
        _cache = cache;
        _historyRepository = historyRepository;
        _logService = logService;
        _defaultOptions = ImageProcessingOptions.Default;
        _aggressiveOptions = ImageProcessingOptions.Aggressive;
    }

    public async Task<ProcessingResult> ProcessAsync(string pdfPath, string outputFolder, CancellationToken cancellationToken = default, IProgress<double>? progress = null)
    {
        var sw = Stopwatch.StartNew();
        var fileName = Path.GetFileName(pdfPath);

        try
        {
            _logService.Info($"Processando: {fileName}", pdfPath);
            progress?.Report(2);

            await Task.Yield();

            var pdfInfo = await _pdfRenderer.GetPdfInfoAsync(pdfPath, cancellationToken);
            progress?.Report(5);

            if (!pdfInfo.IsValid)
            {
                _logService.Warning($"PDF inválido ou corrompido: {fileName}", pdfPath);
                return ProcessingResult.Skipped(pdfPath, "PDF inválido ou corrompido");
            }

            _logService.Info($"PDF aberto: {pdfInfo.PageCount} páginas ({pdfInfo.FileSizeBytes / 1024 / 1024} MB) em {pdfInfo.LoadTime.TotalSeconds:F1}s", pdfPath);

            var fileHash = await HashHelper.ComputeFileHashAsync(pdfPath, cancellationToken);
            progress?.Report(10);

            var existing = await _historyRepository.GetByHashAsync(fileHash);
            if (existing is not null && existing.Status == ProcessingStatus.Completed)
            {
                _logService.Info($"Já processado anteriormente: {fileName}", pdfPath);
                return ProcessingResult.Skipped(pdfPath, "Já processado");
            }

            var pageCount = pdfInfo.PageCount;

            var cachedOcr = await _cache.GetAsync(fileHash);
            string ocrText;
            float ocrConfidence;

            if (cachedOcr is not null && OcrQualityValidator.IsValidResult(cachedOcr))
            {
                ocrText = cachedOcr.Text;
                ocrConfidence = cachedOcr.MeanConfidence;
                _logService.Info($"Cache OCR hit: {fileName}", pdfPath);
                progress?.Report(90);
            }
            else
            {
                progress?.Report(20);

                if (pageCount == 0)
                {
                    _logService.Warning($"Nenhuma página encontrada: {fileName}", pdfPath);
                    return ProcessingResult.Fail(pdfPath, "Nenhuma página encontrada", sw.Elapsed);
                }

                var (textParts, confidences) = await ProcessPagesInParallelAsync(pdfPath, pageCount, fileName, cancellationToken, progress);

                if (textParts.Count == 0)
                {
                    _logService.Warning($"Nenhuma página processada: {fileName}", pdfPath);
                    return ProcessingResult.Fail(pdfPath, "Nenhuma página processada", sw.Elapsed);
                }

                ocrText = string.Join("\n", textParts);
                ocrConfidence = confidences.Count > 0 ? confidences.Average() : 0;

                var ocrResultForCache = new OcrResult
                {
                    Text = ocrText,
                    MeanConfidence = ocrConfidence,
                    Languages = new[] { "por", "eng" },
                    PageCount = pageCount
                };
                await _cache.SetAsync(fileHash, ocrResultForCache);
            }

            if (string.IsNullOrWhiteSpace(ocrText))
            {
                _logService.Warning($"OCR falhou - texto vazio: {fileName}", pdfPath);
                var doc = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = fileHash,
                    PageCount = pageCount
                };
                await _fileOrganizer.OrganizeAsync(doc, outputFolder, cancellationToken);
                sw.Stop();
                await SaveHistory(doc, ProcessingStatus.Error, "OCR falhou - texto vazio", sw, 0);
                return ProcessingResult.Fail(pdfPath, "OCR falhou - texto vazio", sw.Elapsed);
            }

            var classification = await _classifier.ClassifyAsync(ocrText, cancellationToken);
            _logService.Info($"Classificado como {classification.Type} (conf: {classification.Confidence:P0}): {fileName}", pdfPath);

            var extractedData = _extractor.Extract(ocrText, classification.Type);

            var document = new DocumentInfo
            {
                FilePath = pdfPath, FileName = fileName, Type = classification.Type,
                OcrText = ocrText, OcrConfidence = ocrConfidence,
                ClassificationMethod = classification.Method, ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"], CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"], NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"], ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = fileHash, PageCount = pageCount
            };

            await _fileOrganizer.OrganizeAsync(document, outputFolder, cancellationToken);
            sw.Stop();
            _logService.Info($"Movido: {document.NewFileName} -> {document.DestinationFolder}", pdfPath);
            await SaveHistory(document, ProcessingStatus.Completed, null, sw, 0);
            return ProcessingResult.Success(document, sw.Elapsed);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            sw.Stop();
            _logService.Error($"Erro processando {fileName}: {ex.Message}", pdfPath);
            return await RetryProcessingAsync(pdfPath, outputFolder, sw, ex, cancellationToken);
        }
    }

    private async Task<(List<string> Texts, List<float> Confidences)> ProcessPagesInParallelAsync(string pdfPath, int pageCount, string fileName, CancellationToken cancellationToken, IProgress<double>? progress)
    {
        var channel = Channel.CreateBounded<(int Index, byte[] Data)>(
            new BoundedChannelOptions(Math.Max(Environment.ProcessorCount * 2, 8))
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleWriter = true
            });

        var producer = Task.Run(async () =>
        {
            try
            {
                int index = 0;
                await foreach (var pageImage in _pdfRenderer.RenderPagesStreamingAsync(pdfPath, 300, cancellationToken))
                {
                    await channel.Writer.WriteAsync((index++, pageImage), cancellationToken);
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _logService.Error(ex, $"Erro no produtor de páginas: {fileName}");
            }
            finally
            {
                channel.Writer.Complete();
            }
        }, cancellationToken);

        var textParts = new string[pageCount];
        var confidences = new float[pageCount];
        var processedCount = 0;
        var lastReportedProgress = 20.0;
        var progressLock = new object();

        var parallelOptions = new ParallelOptions
        {
            MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount - 1),
            CancellationToken = cancellationToken
        };

        await Parallel.ForEachAsync(
            channel.Reader.ReadAllAsync(cancellationToken),
            parallelOptions,
            async (page, _) =>
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (page.Data is null || page.Data.Length == 0) return;

                if (_imageProcessor.IsEmptyPage(page.Data))
                {
                    _logService.Debug($"Página vazia: {fileName}");
                    Interlocked.Increment(ref processedCount);
                    return;
                }

                var enhancedImage = await _imageProcessor.EnhanceAsync(page.Data, _defaultOptions, cancellationToken);
                var ocrResult = await _ocrEngine.ProcessImageAsync(enhancedImage, cancellationToken);
                if (ocrResult is null) return;

                if (!OcrQualityValidator.IsValidResult(ocrResult))
                {
                    _logService.Debug($"Retry agressivo: {fileName}");
                    var aggressiveImage = await _imageProcessor.EnhanceAsync(page.Data, _aggressiveOptions, cancellationToken);
                    ocrResult = await _ocrEngine.ProcessImageAsync(aggressiveImage, cancellationToken);
                    if (ocrResult is null) return;
                }

                textParts[page.Index] = ocrResult.Text ?? string.Empty;
                confidences[page.Index] = ocrResult.MeanConfidence;

                var completed = Interlocked.Increment(ref processedCount);
                var pct = 20 + (double)completed / pageCount * 70;
                lock (progressLock)
                {
                    if (pct > lastReportedProgress)
                    {
                        lastReportedProgress = pct;
                        progress?.Report(pct);
                    }
                }
            });

        await producer;

        var result = new List<string>(pageCount);
        var resultConfidences = new List<float>(pageCount);
        for (int i = 0; i < pageCount; i++)
        {
            if (!string.IsNullOrWhiteSpace(textParts[i]))
            {
                result.Add(textParts[i]);
                resultConfidences.Add(confidences[i]);
            }
        }

        return (result, resultConfidences);
    }

    private async Task<ProcessingResult> RetryProcessingAsync(string pdfPath, string outputFolder, Stopwatch sw, Exception originalEx, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(pdfPath);

        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                _logService.Info($"Retry {attempt}/3: {fileName}", pdfPath);
                await Task.Delay((int)Math.Pow(2, attempt) * 1000, cancellationToken);

                var pdfInfo = await _pdfRenderer.GetPdfInfoAsync(pdfPath, cancellationToken);
                var pageCount = pdfInfo.PageCount;

                var (textParts, _) = await ProcessPagesInParallelAsync(pdfPath, pageCount, fileName, cancellationToken, null);

                var ocrText = string.Join("\n", textParts);
                if (string.IsNullOrWhiteSpace(ocrText)) continue;

                var classification = await _classifier.ClassifyAsync(ocrText, cancellationToken);
                var extractedData = _extractor.Extract(ocrText, classification.Type);

                var document = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = classification.Type, OcrText = ocrText,
                    ClassificationMethod = classification.Method, ClassificationConfidence = classification.Confidence,
                    NumeroNota = extractedData["NumeroNota"], CnpjEmitente = extractedData["CnpjEmitente"],
                    Cpf = extractedData["Cpf"], NomePessoa = extractedData["NomePessoa"],
                    NumeroImposto = extractedData["NumeroImposto"], ChaveAcesso = extractedData["ChaveAcesso"],
                    FileHash = await HashHelper.ComputeFileHashAsync(pdfPath, cancellationToken),
                    PageCount = pageCount
                };

                await _fileOrganizer.OrganizeAsync(document, outputFolder, cancellationToken);
                sw.Stop();
                _logService.Info($"Retry sucesso: {document.NewFileName}", pdfPath);
                await SaveHistory(document, ProcessingStatus.Completed, null, sw, attempt);
                return ProcessingResult.Success(document, sw.Elapsed);
            }
            catch (OperationCanceledException) { throw; }
            catch { continue; }
        }

        var failDoc = new DocumentInfo { FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido };
        await _fileOrganizer.OrganizeAsync(failDoc, outputFolder, cancellationToken);
        sw.Stop();
        await SaveHistory(failDoc, ProcessingStatus.Error, originalEx.Message, sw, 3);
        return ProcessingResult.Fail(pdfPath, originalEx.Message, sw.Elapsed, 3);
    }

    private async Task SaveHistory(DocumentInfo doc, ProcessingStatus status, string? error, Stopwatch sw, int retryCount)
    {
        try
        {
            await _historyRepository.SaveAsync(new ProcessingHistoryEntry
            {
                FilePath = doc.FilePath, FileName = doc.FileName, FileHash = doc.FileHash,
                DocumentType = doc.Type, Status = status, NewFileName = doc.NewFileName,
                DestinationFolder = doc.DestinationFolder, ErrorMessage = error,
                RetryCount = retryCount, ProcessingTimeMs = sw.Elapsed.TotalMilliseconds,
                ProcessedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex) { _logService.Error(ex, "Falha ao salvar histórico (não crítico)"); }
    }
}
