using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class PythonPdfProcessor : IPdfProcessor
{
    private readonly IDocumentClassifier _classifier;
    private readonly IDataExtractor _extractor;
    private readonly IFileOrganizer _fileOrganizer;
    private readonly IProcessingHistoryRepository _historyRepository;
    private readonly ILogService _logService;
    private readonly HttpClient _http;

    private const string ApiBase = "http://localhost:8000";

    public PythonPdfProcessor(
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        IFileOrganizer fileOrganizer,
        IProcessingHistoryRepository historyRepository,
        ILogService logService)
    {
        _classifier = classifier;
        _extractor = extractor;
        _fileOrganizer = fileOrganizer;
        _historyRepository = historyRepository;
        _logService = logService;
        _http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
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
            _logService.Info($"Processando (Docker OCR): {fileName}", pdfPath);
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

            // Step 1: Upload PDF to API
            _logService.Info($"Enviando PDF para Docker OCR: {fileName}", pdfPath);
            var jobId = await UploadPdfAsync(pdfPath, cancellationToken);
            progress?.Report(20);

            // Step 2: Wait for result
            _logService.Info($"Aguardando resultado OCR: {fileName}", pdfPath);
            var result = await PollForResultAsync(jobId, progress, cancellationToken);
            progress?.Report(80);

            _logService.Info($"OCR completo: {result.PageCount} páginas, {result.TotalChars} chars, {result.AvgConfidence}% confiança", pdfPath);

            var ocrText = result.TotalText ?? string.Empty;

            if (string.IsNullOrWhiteSpace(ocrText))
            {
                _logService.Warning($"OCR falhou - texto vazio: {fileName}", pdfPath);
                var failDoc = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = fileHash,
                    PageCount = result.PageCount
                };
                await _fileOrganizer.OrganizeAsync(failDoc, outputFolder, cancellationToken);
                sw.Stop();
                return ProcessingResult.Fail(pdfPath, "OCR falhou - texto vazio", sw.Elapsed);
            }

            // Step 3: Classify, extract, organize
            var classification = await _classifier.ClassifyAsync(ocrText, cancellationToken);
            _logService.Info($"Classificado como {classification.Type} (conf: {classification.Confidence:P0}): {fileName}", pdfPath);

            var extractedData = _extractor.Extract(ocrText, classification.Type);
            progress?.Report(90);

            var document = new DocumentInfo
            {
                FilePath = pdfPath, FileName = fileName, Type = classification.Type,
                OcrText = ocrText,
                OcrConfidence = (float)result.AvgConfidence,
                ClassificationMethod = classification.Method,
                ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"],
                CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"],
                NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"],
                ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = fileHash,
                PageCount = result.PageCount
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

    private async Task<string> UploadPdfAsync(string pdfPath, CancellationToken ct)
    {
        using var content = new MultipartFormDataContent();
        var fileBytes = await File.ReadAllBytesAsync(pdfPath);
        var fileContent = new ByteArrayContent(fileBytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        content.Add(fileContent, "file", Path.GetFileName(pdfPath));

        var response = await _http.PostAsync($"{ApiBase}/ocr?dpi=300&languages=por+eng", content, ct);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        var uploadResult = JsonSerializer.Deserialize<UploadResponse>(json);
        return uploadResult?.JobId ?? throw new InvalidOperationException("No job_id in response");
    }

    private async Task<OcrApiResult> PollForResultAsync(string jobId, IProgress<double>? progress, CancellationToken ct)
    {
        var startTime = Stopwatch.StartNew();
        const int maxWaitMs = 60 * 60 * 1000; // 1 hour max

        while (startTime.ElapsedMilliseconds < maxWaitMs)
        {
            ct.ThrowIfCancellationRequested();

            var response = await _http.GetAsync($"{ApiBase}/ocr/{jobId}", ct);
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            var result = JsonSerializer.Deserialize<OcrApiResult>(json);

            if (result is null)
                throw new InvalidOperationException("Invalid response from OCR API");

            if (result.Status == "done")
            {
                // Report progress based on page processing (approximate)
                progress?.Report(75);
                return result;
            }

            if (result.Status == "error")
                throw new InvalidOperationException($"OCR API error: {result.Error}");

            // Estimate progress: assume ~70% of time is OCR processing
            if (result.PageCount > 0 && result.Status == "processing")
                progress?.Report(20 + Math.Min(55, (double)result.PageCount / result.PageCount * 55));

            await Task.Delay(2000, ct); // Poll every 2 seconds
        }

        throw new TimeoutException("OCR processing timed out after 1 hour");
    }

    private class UploadResponse
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = "";
        [JsonPropertyName("status")]
        public string Status { get; set; } = "";
    }

    private class OcrApiResult
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = "";
        [JsonPropertyName("status")]
        public string Status { get; set; } = "";
        [JsonPropertyName("pdf_name")]
        public string PdfName { get; set; } = "";
        [JsonPropertyName("page_count")]
        public int PageCount { get; set; }
        [JsonPropertyName("total_text")]
        public string? TotalText { get; set; }
        [JsonPropertyName("total_chars")]
        public int TotalChars { get; set; }
        [JsonPropertyName("avg_confidence")]
        public double AvgConfidence { get; set; }
        [JsonPropertyName("render_time_ms")]
        public int RenderTimeMs { get; set; }
        [JsonPropertyName("ocr_time_ms")]
        public int OcrTimeMs { get; set; }
        [JsonPropertyName("total_time_ms")]
        public int TotalTimeMs { get; set; }
        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }
}
