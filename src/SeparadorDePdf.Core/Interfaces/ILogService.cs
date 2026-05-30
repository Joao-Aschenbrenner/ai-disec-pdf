using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface ILogService
{
    event EventHandler<LogEntry>? LogAdded;
    void Info(string message, string? filePath = null);
    void Warning(string message, string? filePath = null);
    void Error(string message, string? filePath = null);
    void Debug(string message, string? filePath = null);
    IReadOnlyList<LogEntry> GetLogs();
    void Clear();
}
