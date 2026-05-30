using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
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

    public async Task<ProcessingResult> ProcessAsync(string pdfPath, string outputFolder, CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var fileName = Path.GetFileName(pdfPath);

        try
        {
            _logService.Info($"Processando: {fileName}", pdfPath);

            if (!PdfValidator.IsValidPdf(pdfPath))
            {
                _logService.Warning($"PDF inválido ou corrompido: {fileName}", pdfPath);
                return ProcessingResult.Skipped(pdfPath, "PDF inválido ou corrompido");
            }

            var fileHash = await HashHelper.ComputeFileHashAsync(pdfPath, cancellationToken);

            var existing = await _historyRepository.GetByHashAsync(fileHash);
            if (existing is not null && existing.Status == ProcessingStatus.Completed)
            {
                _logService.Info($"Já processado anteriormente: {fileName}", pdfPath);
                return ProcessingResult.Skipped(pdfPath, "Já processado");
            }

            var cachedOcr = await _cache.GetAsync(fileHash);
            string ocrText;
            float ocrConfidence;

            if (cachedOcr is not null && OcrQualityValidator.IsValidResult(cachedOcr))
            {
                ocrText = cachedOcr.Text;
                ocrConfidence = cachedOcr.MeanConfidence;
                _logService.Info($"Cache OCR hit: {fileName}", pdfPath);
            }
            else
            {
                var pages = await _pdfRenderer.RenderPagesAsync(pdfPath, 300, cancellationToken);

                if (pages.Count == 0 || pages.All(p => p.Length == 0))
                {
                    _logService.Warning($"Nenhuma página renderizada: {fileName}", pdfPath);
                    return ProcessingResult.Fail(pdfPath, "Nenhuma página renderizada", sw.Elapsed);
                }

                var textParts = new List<string>();
                float totalConfidence = 0;
                int validPages = 0;

                foreach (var pageImage in pages)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (pageImage.Length == 0) continue;

                    if (_imageProcessor.IsEmptyPage(pageImage))
                    {
                        _logService.Debug($"Página vazia detectada em: {fileName}", pdfPath);
                        continue;
                    }

                    var enhancedImage = await _imageProcessor.EnhanceAsync(pageImage, _defaultOptions, cancellationToken);
                    var ocrResult = await _ocrEngine.ProcessImageAsync(enhancedImage, cancellationToken);

                    if (!OcrQualityValidator.IsValidResult(ocrResult))
                    {
                        _logService.Debug($"Retry com opções agressivas: {fileName}", pdfPath);
                        var aggressiveImage = await _imageProcessor.EnhanceAsync(pageImage, _aggressiveOptions, cancellationToken);
                        ocrResult = await _ocrEngine.ProcessImageAsync(aggressiveImage, cancellationToken);
                    }

                    if (!string.IsNullOrWhiteSpace(ocrResult.Text))
                    {
                        textParts.Add(ocrResult.Text);
                        totalConfidence += ocrResult.MeanConfidence;
                        validPages++;
                    }
                }

                ocrText = string.Join("\n", textParts);
                ocrConfidence = validPages > 0 ? totalConfidence / validPages : 0;

                var ocrResultForCache = new OcrResult
                {
                    Text = ocrText,
                    MeanConfidence = ocrConfidence,
                    Languages = new[] { "por", "eng" },
                    PageCount = pages.Count
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
                    PageCount = await _pdfRenderer.GetPageCountAsync(pdfPath, cancellationToken)
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
                FileHash = fileHash, PageCount = await _pdfRenderer.GetPageCountAsync(pdfPath, cancellationToken)
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

    private async Task<ProcessingResult> RetryProcessingAsync(string pdfPath, string outputFolder, Stopwatch sw, Exception originalEx, CancellationToken cancellationToken)
    {
        var fileName = Path.GetFileName(pdfPath);

        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                _logService.Info($"Retry {attempt}/3: {fileName}", pdfPath);
                await Task.Delay((int)Math.Pow(2, attempt) * 1000, cancellationToken);

                var pages = await _pdfRenderer.RenderPagesAsync(pdfPath, 300, cancellationToken);
                var textParts = new List<string>();

                foreach (var pageImage in pages)
                {
                    if (pageImage.Length == 0) continue;
                    var enhancedImage = await _imageProcessor.EnhanceAsync(pageImage, _aggressiveOptions, cancellationToken);
                    var ocrResult = await _ocrEngine.ProcessImageAsync(enhancedImage, cancellationToken);
                    if (!string.IsNullOrWhiteSpace(ocrResult.Text)) textParts.Add(ocrResult.Text);
                }

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
                    PageCount = pages.Count
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
        catch { /* non-critical */ }
    }
}
