namespace SeparadorDePdf.Core.Models;

public class ProcessingProgress
{
    public int TotalFiles { get; set; }
    public int ProcessedFiles { get; set; }
    public int SuccessCount { get; set; }
    public int ErrorCount { get; set; }
    public int SkippedCount { get; set; }
    public string CurrentFile { get; set; } = string.Empty;
    public double ProgressPercentage => TotalFiles > 0 ? (double)ProcessedFiles / TotalFiles * 100 : 0;
    public bool IsRunning { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public TimeSpan ElapsedTime => (EndedAt ?? DateTime.UtcNow) - (StartedAt ?? DateTime.UtcNow);
}
