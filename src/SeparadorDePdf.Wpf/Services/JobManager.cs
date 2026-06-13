using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;
using SeparadorDePdf.Wpf.Models;

namespace SeparadorDePdf.Wpf.Services;

public class JobManager : IDisposable
{
    private readonly PagePipeline _pagePipeline;
    private readonly IProcessingHistoryRepository _historyRepository;
    private readonly ILogService _logService;
    private readonly IPdfRenderer _pdfRenderer;
    private readonly IOcrEngine _ocrEngine;

    private CancellationTokenSource? _cts;
    private const int OcrDpi = 200;

    public JobInfo? CurrentJob { get; private set; }
    public bool IsRunning => _cts is not null && !_cts.IsCancellationRequested;

    public event EventHandler<JobInfo>? ProgressChanged;
    public event EventHandler<JobInfo>? JobCompleted;

    public JobManager(
        PagePipeline pagePipeline,
        IProcessingHistoryRepository historyRepository,
        ILogService logService,
        IPdfRenderer pdfRenderer,
        IOcrEngine ocrEngine)
    {
        _pagePipeline = pagePipeline;
        _historyRepository = historyRepository;
        _logService = logService;
        _pdfRenderer = pdfRenderer;
        _ocrEngine = ocrEngine;
    }

    public void StartJob(string inputFilePath)
    {
        if (IsRunning) return;

        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        var job = new JobInfo
        {
            InputFilePath = inputFilePath,
            CurrentStep = JobStep.PreProcessing
        };
        CurrentJob = job;

        _ = Task.Run(() => RunPipelineAsync(job, token), token);
    }

    public void CancelJob()
    {
        _cts?.Cancel();
    }

    private async Task RunPipelineAsync(JobInfo job, CancellationToken ct)
    {
        var swTotal = Stopwatch.StartNew();
        var progressSync = new object();
        var lastProgressReport = DateTime.MinValue;

        try
        {
            Directory.CreateDirectory(job.TempFolder);

            await PreProcessAsync(job, ct);
            if (ct.IsCancellationRequested) { SetCancelled(job); return; }

            job.CurrentStep = JobStep.Processing;
            ReportProgress(job);

            var pageProgress = new Progress<PagePipelineProgress>(p =>
            {
                lock (progressSync)
                {
                    job.TotalPages = p.TotalPages;
                    job.PagesProcessed = p.PagesProcessed;
                    job.PagesFailed = p.PagesFailed;
                    job.PipelineStatusMessage = p.Status;
                    job.OverallProgress = p.ProgressPercent;

                    var elapsed = swTotal.Elapsed;
                    job.ElapsedTime = FormatTime(elapsed);

                    if (p.CurrentPage > 0 && elapsed.TotalSeconds > 5)
                    {
                        var secPerPage = elapsed.TotalSeconds / p.CurrentPage;
                        var remaining = (p.TotalPages - p.CurrentPage) * secPerPage;
                        job.EstimatedTimeRemaining = remaining > 0 ? FormatTime(TimeSpan.FromSeconds(remaining)) : "";
                    }

                    var now = DateTime.UtcNow;
                    if ((now - lastProgressReport).TotalMilliseconds >= 500 || p.ProgressPercent >= 100)
                    {
                        lastProgressReport = now;
                        ReportProgress(job);
                    }
                }
            });

            var groups = await _pagePipeline.ProcessAllPagesAsync(
                job.InputFilePath, job.TempFolder, OcrDpi, pageProgress, ct);

            if (ct.IsCancellationRequested) { SetCancelled(job); return; }

            job.Step3Status = "Criando arquivo ZIP...";
            ReportProgress(job);

            var zipPath = Path.Combine(job.TempFolder, "resultado.zip");
            CreateZipFromGroups(groups, zipPath, ct);
            job.ZipPath = zipPath;

            swTotal.Stop();
            var totalPages = groups.Sum(g => g.PageCount);
            var reviewCount = groups.Count(g => g.NeedsReview);

            job.SuccessCount = groups.Count;
            job.ErrorCount = reviewCount;
            job.PagesProcessed = totalPages;
            job.PagesFailed = reviewCount;
            job.GroupsCreated = groups.Count;
            job.OverallProgress = 100;
            job.ElapsedTime = FormatTime(swTotal.Elapsed);
            job.CurrentStep = JobStep.Completed;

            var fileHash = await HashHelper.ComputeFileHashAsync(job.InputFilePath, ct);
            foreach (var group in groups)
            {
                try
                {
                    await _historyRepository.SaveAsync(new ProcessingHistoryEntry
                    {
                        FilePath = job.InputFilePath,
                        FileName = job.FileName,
                        FileHash = fileHash,
                        DocumentType = group.DocumentType,
                        Status = group.NeedsReview ? ProcessingStatus.Error : ProcessingStatus.Completed,
                        NewFileName = group.FileName,
                        DestinationFolder = job.TempFolder,
                        ProcessedAt = DateTime.UtcNow
                    });
                }
                catch { /* best effort history save */ }
            }

            var totalMs = swTotal.ElapsedMilliseconds;
            var pagesPerSec = totalMs > 0 ? (double)totalPages / totalMs * 1000 : 0;
            job.ResultSummary = $"{groups.Count} documentos ({totalPages} páginas) em {job.ElapsedTime} ({pagesPerSec:F1} págs/s)";
            job.Step1Status = $"{totalPages} páginas lidas";
            job.Step3Status = $"Pronto! Clique em BAIXAR para salvar o ZIP";
            _logService.Info($"[JOB] Concluído: {job.ResultSummary}", job.InputFilePath);
        }
        catch (OperationCanceledException)
        {
            SetCancelled(job);
        }
        catch (Exception ex)
        {
            swTotal.Stop();
            job.CurrentStep = JobStep.Failed;
            job.ErrorMessage = ex.Message;
            job.ElapsedTime = FormatTime(swTotal.Elapsed);
            _logService.Error(ex, $"[JOB] Falha: {job.FileName}");
        }
        finally
        {
            ReportProgress(job);
            JobCompleted?.Invoke(this, job);
            _cts?.Dispose();
            _cts = null;
        }
    }

    private static void CreateZipFromGroups(System.Collections.Generic.List<DocumentGroup> groups, string zipPath, CancellationToken ct)
    {
        if (File.Exists(zipPath))
            File.Delete(zipPath);

        using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
        foreach (var group in groups)
        {
            ct.ThrowIfCancellationRequested();
            if (string.IsNullOrEmpty(group.SavedFilePath) || !File.Exists(group.SavedFilePath))
                continue;

            var entryName = FileHelper.SanitizeFileName(group.FileName);
            if (!entryName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                entryName += ".pdf";

            zip.CreateEntryFromFile(group.SavedFilePath, entryName, CompressionLevel.Optimal);
        }
    }

    private async Task PreProcessAsync(JobInfo job, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        job.CurrentStep = JobStep.PreProcessing;
        job.Step1Status = "Validando arquivo...";
        _logService.Info($"[PRE-PROCESS] Iniciando: {job.FileName}", job.InputFilePath);
        ReportProgress(job);

        if (!File.Exists(job.InputFilePath))
            throw new InvalidOperationException("Arquivo PDF não encontrado");

        if (!_pdfRenderer.IsValidPdf(job.InputFilePath))
            throw new InvalidOperationException("Arquivo PDF inválido ou corrompido");

        if (!_ocrEngine.IsAvailable)
            throw new InvalidOperationException(
                "Tesseract OCR não está disponível. " +
                "Certifique-se de que a pasta tessdata/ existe com os arquivos por.traineddata e eng.traineddata.");

        job.OverallProgress = 5;
        job.Step1Status = "Obtendo metadados...";
        ReportProgress(job);

        var pageCount = await _pdfRenderer.GetPageCountAsync(job.InputFilePath, ct);
        job.TotalPages = pageCount;
        job.OverallProgress = 10;
        job.Step1Status = $"{pageCount} páginas encontradas";
        job.Step2Status = $"0/{pageCount} páginas processadas";
        _logService.Info($"[PRE-PROCESS] PDF válido: {pageCount} páginas", job.InputFilePath);
        ReportProgress(job);
    }

    private void SetCancelled(JobInfo job)
    {
        job.CurrentStep = JobStep.Cancelled;
        job.Step1Status = "Cancelado";
        job.Step2Status = "Cancelado";
        job.Step3Status = "Cancelado";
        _logService.Warning($"[JOB] Cancelado: {job.FileName}", job.InputFilePath);
    }

    private void ReportProgress(JobInfo job)
    {
        ProgressChanged?.Invoke(this, job);
    }

    private static string FormatTime(TimeSpan ts)
    {
        return ts.TotalHours >= 1
            ? $"{ts.Hours}h {ts.Minutes}min {ts.Seconds}s"
            : ts.Minutes > 0
                ? $"{ts.Minutes}min {ts.Seconds}s"
                : $"{ts.Seconds}s";
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _cts?.Dispose();
    }
}
