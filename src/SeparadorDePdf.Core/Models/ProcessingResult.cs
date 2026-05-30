using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class ProcessingResult
{
    public string FilePath { get; set; } = string.Empty;
    public ProcessingStatus Status { get; set; } = ProcessingStatus.Pending;
    public DocumentInfo? Document { get; set; }
    public string? ErrorMessage { get; set; }
    public TimeSpan ProcessingTime { get; set; }
    public int RetryCount { get; set; }
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;

    public static ProcessingResult Success(DocumentInfo document, TimeSpan processingTime)
    {
        return new ProcessingResult
        {
            FilePath = document.FilePath,
            Status = ProcessingStatus.Completed,
            Document = document,
            ProcessingTime = processingTime,
            ProcessedAt = DateTime.UtcNow
        };
    }

    public static ProcessingResult Fail(string filePath, string error, TimeSpan processingTime, int retryCount = 0)
    {
        return new ProcessingResult
        {
            FilePath = filePath,
            Status = ProcessingStatus.Error,
            ErrorMessage = error,
            ProcessingTime = processingTime,
            RetryCount = retryCount,
            ProcessedAt = DateTime.UtcNow
        };
    }

    public static ProcessingResult Skipped(string filePath, string reason)
    {
        return new ProcessingResult
        {
            FilePath = filePath,
            Status = ProcessingStatus.Skipped,
            ErrorMessage = reason,
            ProcessedAt = DateTime.UtcNow
        };
    }
}
