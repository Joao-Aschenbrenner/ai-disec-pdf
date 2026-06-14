using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class DirectPdfProcessor : IPdfProcessor
{
    private readonly IPdfRenderer _renderer;
    private readonly IImageProcessor _imageProcessor;
    private readonly IOcrEngine _ocrEngine;
    private readonly IDocumentClassifier _classifier;
    private readonly IDataExtractor _extractor;
    private readonly IFileOrganizer _fileOrganizer;
    private readonly IClassificationCache _cache;
    private readonly IProcessingHistoryRepository _historyRepository;
    private readonly ILogService _logService;

    public DirectPdfProcessor(
        IPdfRenderer renderer,
        IImageProcessor imageProcessor,
        IOcrEngine ocrEngine,
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        IFileOrganizer fileOrganizer,
        IClassificationCache cache,
        IProcessingHistoryRepository historyRepository,
        ILogService logService)
    {
        _renderer = renderer;
        _imageProcessor = imageProcessor;
        _ocrEngine = ocrEngine;
        _classifier = classifier;
        _extractor = extractor;
        _fileOrganizer = fileOrganizer;
        _cache = cache;
        _historyRepository = historyRepository;
        _logService = logService;
    }

    public async Task<ProcessingResult> ProcessAsync(
        string pdfPath, string outputFolder,
        CancellationToken cancellationToken = default,
        IProgress<double>? progress = null)
    {
        var sw = Stopwatch.StartNew();
        var fileName = Path.GetFileName(pdfPath);

        try
        {
            _logService.Info($"Processando (Direct OCR): {fileName}", pdfPath);
            progress?.Report(2);

            if (!File.Exists(pdfPath))
                return ProcessingResult.Fail(pdfPath, "Arquivo não encontrado", sw.Elapsed);

            var fileHash = await HashHelper.ComputeFileHashAsync(pdfPath, cancellationToken);
            progress?.Report(5);

            var existing = await _historyRepository.GetByHashAsync(fileHash);
            if (existing is not null && existing.Status == ProcessingStatus.Completed)
            {
                _logService.Info($"Já processado anteriormente: {fileName}", pdfPath);
                return ProcessingResult.Skipped(pdfPath, "Já processado");
            }

            progress?.Report(10);

            // Step 1: Get PDF info
            var pdfInfo = await _renderer.GetPdfInfoAsync(pdfPath, cancellationToken);
            if (!pdfInfo.IsValid || pdfInfo.PageCount == 0)
                return ProcessingResult.Fail(pdfPath, "PDF inválido ou sem páginas", sw.Elapsed);

            progress?.Report(15);

            // Step 2: OCR all pages
            var ocrTexts = new List<string>();
            var totalConfidence = 0f;
            var validPages = 0;

            await foreach (var pageImage in _renderer.RenderPagesStreamingAsync(pdfPath, 300, cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (pageImage.Length == 0)
                    continue;

                // Enhance image
                var enhanced = await _imageProcessor.EnhanceAsync(pageImage, new ImageProcessingOptions(), cancellationToken);

                // Check if empty page
                if (_imageProcessor.IsEmptyPage(enhanced, 0.99))
                {
                    ocrTexts.Add(string.Empty);
                    continue;
                }

                // Check cache
                var imageHash = HashHelper.ComputeHash(enhanced);
                var cached = await _cache.GetAsync(imageHash);
                string ocrText;

                if (cached is not null)
                {
                    ocrText = cached.Text;
                    totalConfidence += cached.MeanConfidence;
                    validPages++;
                }
                else
                {
                    var ocrResult = await _ocrEngine.ProcessImageAsync(enhanced, cancellationToken);
                    ocrText = ocrResult.Text;
                    totalConfidence += ocrResult.MeanConfidence;
                    validPages++;
                    await _cache.SetAsync(imageHash, ocrResult);
                }

                ocrTexts.Add(ocrText);
            }

            progress?.Report(60);

            var combinedOcrText = string.Join("\n", ocrTexts);
            var avgConfidence = validPages > 0 ? totalConfidence / validPages : 0f;

            if (string.IsNullOrWhiteSpace(combinedOcrText))
            {
                _logService.Warning($"OCR falhou - texto vazio: {fileName}", pdfPath);
                var failDoc = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = fileHash,
                    PageCount = pdfInfo.PageCount
                };
                await _fileOrganizer.OrganizeAsync(failDoc, outputFolder, cancellationToken);
                sw.Stop();
                return ProcessingResult.Fail(pdfPath, "OCR falhou - texto vazio", sw.Elapsed);
            }

            // Step 3: Classify, extract, organize
            var classification = await _classifier.ClassifyAsync(combinedOcrText, cancellationToken);
            _logService.Info($"Classificado como {classification.Type} (conf: {classification.Confidence:P0}): {fileName}", pdfPath);

            var extractedData = _extractor.Extract(combinedOcrText, classification.Type);
            progress?.Report(90);

            var document = new DocumentInfo
            {
                FilePath = pdfPath, FileName = fileName, Type = classification.Type,
                OcrText = combinedOcrText,
                OcrConfidence = avgConfidence,
                ClassificationMethod = classification.Method,
                ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"],
                CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"],
                NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"],
                ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = fileHash,
                PageCount = pdfInfo.PageCount
            };

            await _fileOrganizer.OrganizeAsync(document, outputFolder, cancellationToken);
            sw.Stop();
            _logService.Info($"Movido: {document.NewFileName} -> {document.DestinationFolder}", pdfPath);

            await _historyRepository.SaveAsync(new ProcessingHistoryEntry
            {
                FilePath = document.FilePath, FileName = document.FileName, FileHash = document.FileHash,
                DocumentType = document.Type, Status = ProcessingStatus.Completed,
                NewFileName = document.NewFileName, DestinationFolder = document.DestinationFolder,
                ProcessingTimeMs = sw.Elapsed.TotalMilliseconds, ProcessedAt = DateTime.UtcNow
            });

            progress?.Report(100);
            return ProcessingResult.Success(document, sw.Elapsed);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            sw.Stop();
            _logService.Error($"Erro processando {fileName}: {ex.Message}", pdfPath);
            return ProcessingResult.Fail(pdfPath, ex.Message, sw.Elapsed);
        }
    }
}