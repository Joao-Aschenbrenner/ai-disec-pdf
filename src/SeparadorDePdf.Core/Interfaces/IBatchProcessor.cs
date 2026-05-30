using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IBatchProcessor
{
    Task<BatchResult> ProcessFolderAsync(string inputFolder, string outputFolder, CancellationToken cancellationToken = default);
    event EventHandler<ProcessingResult>? FileProcessed;
    event EventHandler<ProcessingProgress>? ProgressChanged;
    int MaxDegreeOfParallelism { get; set; }
}

public class BatchResult
{
    public int TotalFiles { get; set; }
    public int SuccessCount { get; set; }
    public int ErrorCount { get; set; }
    public int SkippedCount { get; set; }
    public TimeSpan TotalTime { get; set; }
    public List<ProcessingResult> Results { get; set; } = new();
}
