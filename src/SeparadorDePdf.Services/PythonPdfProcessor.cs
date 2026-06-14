using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
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
    private readonly string _pythonScriptPath;

    public PythonPdfProcessor(
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        IFileOrganizer fileOrganizer,
        IProcessingHistoryRepository historyRepository,
        ILogService logService,
        string? pythonScriptPath = null)
    {
        _classifier = classifier;
        _extractor = extractor;
        _fileOrganizer = fileOrganizer;
        _historyRepository = historyRepository;
        _logService = logService;
        _pythonScriptPath = pythonScriptPath ?? FindPythonScript();
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
            _logService.Info($"Processando (Python OCR): {fileName}", pdfPath);
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

            // Call Python script to process PDF
            _logService.Info($"Chamando Python OCR: {fileName}", pdfPath);
            var pythonResult = await RunPythonOcrAsync(pdfPath, cancellationToken);
            progress?.Report(70);

            if (!pythonResult.Success || string.IsNullOrWhiteSpace(pythonResult.TotalText))
            {
                _logService.Warning($"Python OCR falhou: {pythonResult.Error ?? "texto vazio"}", pdfPath);
                var failDoc = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = fileHash,
                    PageCount = pythonResult.PageCount
                };
                await _fileOrganizer.OrganizeAsync(failDoc, outputFolder, cancellationToken);
                sw.Stop();
                return ProcessingResult.Fail(pdfPath, pythonResult.Error ?? "OCR falhou - texto vazio", sw.Elapsed);
            }

            var combinedOcrText = pythonResult.TotalText;
            var avgConfidence = pythonResult.AvgConfidence;

            // Step 3: Classify, extract, organize
            var classification = await _classifier.ClassifyAsync(combinedOcrText, cancellationToken);
            _logService.Info($"Classificado como {classification.Type} (conf: {classification.Confidence:P0}): {fileName}", pdfPath);

            var extractedData = _extractor.Extract(combinedOcrText, classification.Type);
            progress?.Report(90);

            var document = new DocumentInfo
            {
                FilePath = pdfPath, FileName = fileName, Type = classification.Type,
                OcrText = combinedOcrText,
                OcrConfidence = (float)avgConfidence,
                ClassificationMethod = classification.Method,
                ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"],
                CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"],
                NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"],
                ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = fileHash,
                PageCount = pythonResult.PageCount
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

    private async Task<PythonPdfResult> RunPythonOcrAsync(string pdfPath, CancellationToken ct)
    {
        var tempOutputPath = Path.Combine(Path.GetTempPath(), $"python_ocr_{Guid.NewGuid()}.json");

        try
        {
            var pythonExe = @"C:\Users\USUARIO\AppData\Local\Programs\Python\Python312\python.exe";
            var psi = new ProcessStartInfo
            {
                FileName = pythonExe,
                Arguments = $"\"{_pythonScriptPath}\" \"{pdfPath}\" \"{tempOutputPath}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null)
                throw new InvalidOperationException("Failed to start Python process");

            await process.WaitForExitAsync(ct);

            if (process.ExitCode != 0)
            {
                var error = await process.StandardError.ReadToEndAsync();
                _logService?.Error($"Python process failed: {error}");
                return new PythonPdfResult { Success = false, Error = error };
            }

            if (File.Exists(tempOutputPath))
            {
                var json = await File.ReadAllTextAsync(tempOutputPath, ct);
                var result = JsonSerializer.Deserialize<PythonPdfResult>(json);
                return result ?? new PythonPdfResult { Success = false, Error = "Failed to parse result" };
            }

            _logService?.Warning($"Output file not found: {tempOutputPath}");

            return new PythonPdfResult { Success = false, Error = "No output file" };
        }
        catch (Exception ex)
        {
            return new PythonPdfResult { Success = false, Error = ex.Message };
        }
        finally
        {
            try { if (File.Exists(tempOutputPath)) File.Delete(tempOutputPath); } catch { }
        }
    }

    private static string FindPythonScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "pdf_processor.py"),
            Path.Combine(AppContext.BaseDirectory, "..", "pdf_processor.py"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "pdf_processor.py"),
            @"C:\Users\USUARIO\Documents\Separador de PDF\pdf_processor.py"
        };

        foreach (var path in candidates)
        {
            var fullPath = Path.GetFullPath(path);
            if (File.Exists(fullPath))
                return fullPath;
        }

        return Path.Combine(AppContext.BaseDirectory, "pdf_processor.py");
    }

    private class PythonPdfResult
    {
        [System.Text.Json.Serialization.JsonPropertyName("success")]
        public bool Success { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("error")]
        public string? Error { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("total_text")]
        public string? TotalText { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("page_count")]
        public int PageCount { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("avg_confidence")]
        public double AvgConfidence { get; set; }
        [System.Text.Json.Serialization.JsonPropertyName("total_chars")]
        public int TotalChars { get; set; }
    }
}