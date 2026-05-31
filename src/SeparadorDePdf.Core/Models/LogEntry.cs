namespace SeparadorDePdf.Core.Models;

public class LogEntry
{
    public DateTime Timestamp { get; set; } = DateTime.Now;
    public string Message { get; set; } = string.Empty;
    public LogLevel Level { get; set; } = LogLevel.Info;
    public string? FilePath { get; set; }
    public string? ExceptionDetails { get; set; }
}

public enum LogLevel
{
    Debug,
    Info,
    Warning,
    Error
}
