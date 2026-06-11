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

    private static string PythonPath =>
        @"C:\Users\USUARIO\AppData\Local\Programs\Python\Python312\python.exe";

    private static string ScriptPath =>
        Path.Combine(AppContext.BaseDirectory, "ocr_processor.py");

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

            var scriptDir = Path.GetDirectoryName(ScriptPath) ?? AppContext.BaseDirectory;
            var scriptFile = ScriptPath;

            if (!File.Exists(scriptFile))
            {
                var srcScript = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "src", "PdfProcessorPython", "ocr_processor.py");
                if (File.Exists(srcScript))
                    scriptFile = srcScript;
                else
                    return ProcessingResult.Fail(pdfPath, $"Script não encontrado: {scriptFile}", sw.Elapsed);
            }

            var psi = new ProcessStartInfo
            {
                FileName = PythonPath,
                Arguments = $"\"{scriptFile}\" \"{pdfPath}\" --json",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(scriptFile) ?? "."
            };

            using var process = new Process { StartInfo = psi };

            var stderr = string.Empty;
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null)
                    stderr += e.Data + "\n";
            };

            progress?.Report(15);
            _logService.Info($"Iniciando OCR Python: {fileName}", pdfPath);

            process.Start();
            process.BeginErrorReadLine();

            var stdout = await process.StandardOutput.ReadToEndAsync(cancellationToken);

            await process.WaitForExitAsync(cancellationToken);

            if (process.ExitCode != 0)
            {
                _logService.Error($"Python OCR falhou (exit {process.ExitCode}): {stderr}", pdfPath);
                return ProcessingResult.Fail(pdfPath, $"Python OCR falhou: {stderr.Trim()}", sw.Elapsed);
            }

            progress?.Report(80);

            var jsonResult = JsonSerializer.Deserialize<PythonOcrResult>(stdout);
            if (jsonResult == null || !jsonResult.Success)
            {
                return ProcessingResult.Fail(pdfPath, jsonResult?.Error ?? "Resultado inválido", sw.Elapsed);
            }

            _logService.Info($"OCR completo: {jsonResult.PageCount} páginas, {jsonResult.TotalChars} chars, {jsonResult.OcrTimeMs}ms OCR", pdfPath);

            var ocrText = jsonResult.TotalText ?? string.Empty;
            progress?.Report(85);

            if (string.IsNullOrWhiteSpace(ocrText))
            {
                _logService.Warning($"OCR falhou - texto vazio: {fileName}", pdfPath);
                var failDoc = new DocumentInfo
                {
                    FilePath = pdfPath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = fileHash,
                    PageCount = jsonResult.PageCount
                };
                await _fileOrganizer.OrganizeAsync(failDoc, outputFolder, cancellationToken);
                sw.Stop();
                return ProcessingResult.Fail(pdfPath, "OCR falhou - texto vazio", sw.Elapsed);
            }

            var classification = await _classifier.ClassifyAsync(ocrText, cancellationToken);
            _logService.Info($"Classificado como {classification.Type} (conf: {classification.Confidence:P0}): {fileName}", pdfPath);

            var extractedData = _extractor.Extract(ocrText, classification.Type);
            progress?.Report(90);

            var document = new DocumentInfo
            {
                FilePath = pdfPath, FileName = fileName, Type = classification.Type,
                OcrText = ocrText,
                OcrConfidence = (float)jsonResult.AvgConfidence,
                ClassificationMethod = classification.Method,
                ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"],
                CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"],
                NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"],
                ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = fileHash,
                PageCount = jsonResult.PageCount
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

public class PythonOcrResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public int PageCount { get; set; }
    public string? TotalText { get; set; }
    public int TotalChars { get; set; }
    public double AvgConfidence { get; set; }
    public int RenderTimeMs { get; set; }
    public int OcrTimeMs { get; set; }
    public int TotalTimeMs { get; set; }
}
