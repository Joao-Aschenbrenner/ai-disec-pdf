using System;
using System.Collections.Generic;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Utils;

public class LogService : ILogService
{
    private readonly List<LogEntry> _logs = new();
    private readonly object _lock = new();
    private const int MaxLogs = 10000;

    public event EventHandler<LogEntry>? LogAdded;

    public void Info(string message, string? filePath = null) => AddLog(LogLevel.Info, message, filePath);
    public void Warning(string message, string? filePath = null) => AddLog(LogLevel.Warning, message, filePath);
    public void Error(string message, string? filePath = null) => AddLog(LogLevel.Error, message, filePath);
    public void Error(Exception exception, string? filePath = null)
    {
        var message = exception.Message;
        var details = exception.ToString();
        var entry = new LogEntry
        {
            Timestamp = DateTime.Now,
            Message = message,
            Level = LogLevel.Error,
            FilePath = filePath,
            ExceptionDetails = details
        };
        lock (_lock)
        {
            _logs.Add(entry);
            if (_logs.Count > MaxLogs)
                _logs.RemoveAt(0);
        }
        LogAdded?.Invoke(this, entry);
    }
    public void Debug(string message, string? filePath = null) => AddLog(LogLevel.Debug, message, filePath);

    private void AddLog(LogLevel level, string message, string? filePath)
    {
        var entry = new LogEntry
        {
            Timestamp = DateTime.Now,
            Message = message,
            Level = level,
            FilePath = filePath
        };

        lock (_lock)
        {
            _logs.Add(entry);
            if (_logs.Count > MaxLogs)
                _logs.RemoveAt(0);
        }

        Task.Run(() => LogAdded?.Invoke(this, entry));
    }

    public IReadOnlyList<LogEntry> GetLogs()
    {
        lock (_lock)
        {
            return _logs.ToArray();
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _logs.Clear();
        }
    }
}
