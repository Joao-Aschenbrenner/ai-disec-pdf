using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class BatchProcessingService : IBatchProcessor
{
    private readonly IPdfProcessor _pdfProcessor;
    private readonly ILogService _logService;
    private readonly ConcurrentBag<ProcessingResult> _results = new();
    private readonly SemaphoreSlim _semaphore;
    private CancellationTokenSource? _cts;
    private int _successCount;
    private int _errorCount;
    private int _skippedCount;
    private int _processedFiles;

    public int MaxDegreeOfParallelism { get; set; } = Math.Max(1, Environment.ProcessorCount - 1);

    public event EventHandler<ProcessingResult>? FileProcessed;
    public event EventHandler<ProcessingProgress>? ProgressChanged;

    public BatchProcessingService(IPdfProcessor pdfProcessor, ILogService logService)
    {
        _pdfProcessor = pdfProcessor;
        _logService = logService;
        _semaphore = new SemaphoreSlim(MaxDegreeOfParallelism);
    }

    public async Task<BatchResult> ProcessFolderAsync(string inputFolder, string outputFolder, CancellationToken cancellationToken = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var token = _cts.Token;

        var pdfFiles = Directory.GetFiles(inputFolder, "*.pdf", SearchOption.AllDirectories)
            .Where(PdfValidator.IsPdfFile)
            .OrderBy(f => f)
            .ToList();

        if (pdfFiles.Count == 0)
        {
            _logService.Info("Nenhum PDF encontrado na pasta de origem.");
            return new BatchResult();
        }

        _logService.Info($"Iniciando processamento de {pdfFiles.Count} PDFs...");
        _results.Clear();
        ResetCounters();

        var sw = Stopwatch.StartNew();
        var progress = new ProcessingProgress
        {
            TotalFiles = pdfFiles.Count,
            IsRunning = true,
            StartedAt = DateTime.UtcNow
        };

        var parallelOptions = new ParallelOptions
        {
            MaxDegreeOfParallelism = MaxDegreeOfParallelism,
            CancellationToken = token
        };

        await Parallel.ForEachAsync(pdfFiles, parallelOptions, async (pdfPath, ct) =>
        {
            await _semaphore.WaitAsync(ct);
            try
            {
                ct.ThrowIfCancellationRequested();
                MemoryMonitor.CollectIfPressureHigh(80.0);

                var currentFile = Path.GetFileName(pdfPath);
                progress.CurrentFile = currentFile;
                ProgressChanged?.Invoke(this, progress);

                try
                {
                    var result = await _pdfProcessor.ProcessAsync(pdfPath, outputFolder, ct);
                    _results.Add(result);

                    if (result.Status == ProcessingStatus.Completed)
                        Interlocked.Increment(ref _successCount);
                    else if (result.Status == ProcessingStatus.Error)
                        Interlocked.Increment(ref _errorCount);
                    else
                        Interlocked.Increment(ref _skippedCount);

                    FileProcessed?.Invoke(this, result);
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    var failResult = ProcessingResult.Fail(pdfPath, ex.Message, TimeSpan.Zero);
                    _results.Add(failResult);
                    Interlocked.Increment(ref _errorCount);
                    FileProcessed?.Invoke(this, failResult);
                }
                finally
                {
                    Interlocked.Increment(ref _processedFiles);
                    progress.ProcessedFiles = _processedFiles;
                    progress.SuccessCount = _successCount;
                    progress.ErrorCount = _errorCount;
                    progress.SkippedCount = _skippedCount;
                    ProgressChanged?.Invoke(this, progress);
                }
            }
            finally
            {
                _semaphore.Release();
            }
        });

        sw.Stop();
        progress.IsRunning = false;
        progress.EndedAt = DateTime.UtcNow;
        progress.ProcessedFiles = _processedFiles;
        progress.SuccessCount = _successCount;
        progress.ErrorCount = _errorCount;
        progress.SkippedCount = _skippedCount;
        ProgressChanged?.Invoke(this, progress);

        _logService.Info($"Processamento concluído: {_successCount} sucesso, {_errorCount} erros em {sw.Elapsed:hh\\:mm\\:ss}");

        return new BatchResult
        {
            TotalFiles = pdfFiles.Count,
            SuccessCount = _successCount,
            ErrorCount = _errorCount,
            SkippedCount = _skippedCount,
            TotalTime = sw.Elapsed,
            Results = _results.ToList()
        };
    }

    private void ResetCounters()
    {
        _successCount = 0;
        _errorCount = 0;
        _skippedCount = 0;
        _processedFiles = 0;
    }
}
