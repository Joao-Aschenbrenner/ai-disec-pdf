using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IProcessingHistoryRepository
{
    Task InitializeAsync();
    Task SaveAsync(ProcessingHistoryEntry entry);
    Task<ProcessingHistoryEntry?> GetByFilePathAsync(string filePath);
    Task<ProcessingHistoryEntry?> GetByHashAsync(string fileHash);
    Task<IEnumerable<ProcessingHistoryEntry>> GetByDateRangeAsync(DateTime from, DateTime to);
    Task<IEnumerable<ProcessingHistoryEntry>> GetByStatusAsync(ProcessingStatus status);
    Task<int> GetErrorCountAsync();
    Task<int> GetSuccessCountAsync();
    Task ClearAsync();
    Task ExportToCsvAsync(string outputPath);
}

public class ProcessingHistoryEntry
{
    public int Id { get; set; }
    public string FilePath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string FileHash { get; set; } = string.Empty;
    public DocumentType DocumentType { get; set; } = DocumentType.Desconhecido;
    public ProcessingStatus Status { get; set; } = ProcessingStatus.Pending;
    public string? NewFileName { get; set; }
    public string? DestinationFolder { get; set; }
    public string? ErrorMessage { get; set; }
    public int RetryCount { get; set; }
    public double ProcessingTimeMs { get; set; }
    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
}
