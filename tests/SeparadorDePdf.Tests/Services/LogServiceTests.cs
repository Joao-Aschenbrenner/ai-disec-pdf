using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Services;

public class LogServiceTests
{
    private readonly LogService _logService;

    public LogServiceTests()
    {
        _logService = new LogService();
    }

    [Fact]
    public void Info_AddsLogEntry()
    {
        _logService.Info("test message");
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.Equal("test message", logs[0].Message);
        Assert.Equal(LogLevel.Info, logs[0].Level);
    }

    [Fact]
    public void Warning_AddsLogEntry()
    {
        _logService.Warning("warning message");
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.Equal(LogLevel.Warning, logs[0].Level);
    }

    [Fact]
    public void Error_String_AddsLogEntry()
    {
        _logService.Error("error message");
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.Equal(LogLevel.Error, logs[0].Level);
    }

    [Fact]
    public void Error_Exception_AddsLogEntryWithDetails()
    {
        var ex = new InvalidOperationException("test exception");
        _logService.Error(ex);
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.Equal("test exception", logs[0].Message);
        Assert.NotNull(logs[0].ExceptionDetails);
        Assert.Contains("InvalidOperationException", logs[0].ExceptionDetails);
    }

    [Fact]
    public void Error_Exception_WithFilePath()
    {
        var ex = new Exception("file error");
        _logService.Error(ex, @"C:\test.pdf");
        var logs = _logService.GetLogs();
        Assert.Equal(@"C:\test.pdf", logs[0].FilePath);
        Assert.NotNull(logs[0].ExceptionDetails);
    }

    [Fact]
    public void Debug_AddsLogEntry()
    {
        _logService.Debug("debug message");
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.Equal(LogLevel.Debug, logs[0].Level);
    }

    [Fact]
    public void LogAdded_EventFires()
    {
        LogEntry? captured = null;
        _logService.LogAdded += (_, entry) => captured = entry;
        _logService.Info("event test");
        Assert.NotNull(captured);
        Assert.Equal("event test", captured!.Message);
    }

    [Fact]
    public void GetLogs_ReturnsSnapshot()
    {
        _logService.Info("first");
        _logService.Info("second");
        var logs1 = _logService.GetLogs();
        _logService.Info("third");
        var logs2 = _logService.GetLogs();
        Assert.Equal(2, logs1.Count);
        Assert.Equal(3, logs2.Count);
    }

    [Fact]
    public void Clear_RemovesAllLogs()
    {
        _logService.Info("test");
        _logService.Clear();
        Assert.Empty(_logService.GetLogs());
    }

    [Fact]
    public void LogEntry_HasTimestamp()
    {
        var before = DateTime.Now.AddSeconds(-1);
        _logService.Info("timestamp test");
        var after = DateTime.Now.AddSeconds(1);
        var logs = _logService.GetLogs();
        Assert.Single(logs);
        Assert.True(logs[0].Timestamp >= before);
        Assert.True(logs[0].Timestamp <= after);
    }
}
