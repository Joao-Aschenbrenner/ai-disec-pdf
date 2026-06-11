namespace SeparadorDePdf.Core.Models;

public class PdfInfo
{
    public required string FilePath { get; init; }
    public int PageCount { get; init; }
    public long FileSizeBytes { get; init; }
    public string FileHash { get; init; } = string.Empty;
    public TimeSpan LoadTime { get; init; }
    public bool IsValid { get; init; }
    public string? ErrorMessage { get; init; }
}