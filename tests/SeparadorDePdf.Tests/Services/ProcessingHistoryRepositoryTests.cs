using Microsoft.Data.Sqlite;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Services;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Services;

public class ProcessingHistoryRepositoryTests : IDisposable
{
    private readonly Mock<ILogService> _logMock;
    private readonly string _dbPath;
    private readonly ProcessingHistoryRepository _repo;

    public ProcessingHistoryRepositoryTests()
    {
        _logMock = new Mock<ILogService>();
        _dbPath = Path.Combine(Path.GetTempPath(), $"test_history_{Guid.NewGuid()}.db");
        _repo = new ProcessingHistoryRepository(_logMock.Object, _dbPath);
    }

    private async Task InitializeAsync()
    {
        await _repo.InitializeAsync();
    }

    private ProcessingHistoryEntry CreateEntry(string suffix = "")
    {
        return new ProcessingHistoryEntry
        {
            FilePath = $@"C:\docs\test{suffix}.pdf",
            FileName = $"test{suffix}.pdf",
            FileHash = $"abc123{suffix}",
            DocumentType = DocumentType.NotaFiscal,
            Status = ProcessingStatus.Completed,
            NewFileName = $"test{suffix}_renamed.pdf",
            DestinationFolder = @"C:\output\Notas",
            ErrorMessage = null,
            RetryCount = 0,
            ProcessingTimeMs = 1500,
            ProcessedAt = DateTime.UtcNow
        };
    }

    [Fact]
    public async Task InitializeAsync_CreatesTable()
    {
        await InitializeAsync();
        Assert.True(File.Exists(_dbPath));
    }

    [Fact]
    public async Task SaveAsync_And_GetByHashAsync_RoundTrip()
    {
        await InitializeAsync();
        var entry = CreateEntry();
        await _repo.SaveAsync(entry);
        Assert.True(entry.Id > 0);

        var loaded = await _repo.GetByHashAsync("abc123");
        Assert.NotNull(loaded);
        Assert.Equal(entry.FilePath, loaded!.FilePath);
        Assert.Equal(DocumentType.NotaFiscal, loaded.DocumentType);
        Assert.Equal(ProcessingStatus.Completed, loaded.Status);
    }

    [Fact]
    public async Task GetByHashAsync_NotFound_ReturnsNull()
    {
        await InitializeAsync();
        var loaded = await _repo.GetByHashAsync("nonexistent");
        Assert.Null(loaded);
    }

    [Fact]
    public async Task GetByFilePathAsync_ReturnsLatest()
    {
        await InitializeAsync();
        var entry1 = CreateEntry();
        entry1.FilePath = @"C:\docs\same.pdf";
        entry1.FileHash = "hash1";
        entry1.Status = ProcessingStatus.Error;
        await _repo.SaveAsync(entry1);

        var entry2 = CreateEntry("_v2");
        entry2.FilePath = @"C:\docs\same.pdf";
        entry2.FileHash = "hash2";
        entry2.Status = ProcessingStatus.Completed;
        await _repo.SaveAsync(entry2);

        var loaded = await _repo.GetByFilePathAsync(@"C:\docs\same.pdf");
        Assert.NotNull(loaded);
        Assert.Equal(ProcessingStatus.Completed, loaded!.Status);
    }

    [Fact]
    public async Task GetByStatusAsync_FiltersCorrectly()
    {
        await InitializeAsync();
        var entry1 = CreateEntry();
        entry1.Status = ProcessingStatus.Completed;
        await _repo.SaveAsync(entry1);
        var entry2 = CreateEntry("_err");
        entry2.Status = ProcessingStatus.Error;
        await _repo.SaveAsync(entry2);

        var completed = await _repo.GetByStatusAsync(ProcessingStatus.Completed);
        Assert.Single(completed);

        var errors = await _repo.GetByStatusAsync(ProcessingStatus.Error);
        Assert.Single(errors);
    }

    [Fact]
    public async Task GetErrorCountAsync_ReturnsCorrectCount()
    {
        await InitializeAsync();
        await _repo.SaveAsync(new ProcessingHistoryEntry
        {
            FilePath = "a.pdf", FileName = "a.pdf", FileHash = "h1",
            DocumentType = DocumentType.Desconhecido, Status = ProcessingStatus.Error,
            ProcessedAt = DateTime.UtcNow
        });
        await _repo.SaveAsync(new ProcessingHistoryEntry
        {
            FilePath = "b.pdf", FileName = "b.pdf", FileHash = "h2",
            DocumentType = DocumentType.Desconhecido, Status = ProcessingStatus.Error,
            ProcessedAt = DateTime.UtcNow
        });
        await _repo.SaveAsync(new ProcessingHistoryEntry
        {
            FilePath = "c.pdf", FileName = "c.pdf", FileHash = "h3",
            DocumentType = DocumentType.Desconhecido, Status = ProcessingStatus.Completed,
            ProcessedAt = DateTime.UtcNow
        });

        var errorCount = await _repo.GetErrorCountAsync();
        Assert.Equal(2, errorCount);
    }

    [Fact]
    public async Task GetSuccessCountAsync_ReturnsCorrectCount()
    {
        await InitializeAsync();
        await _repo.SaveAsync(new ProcessingHistoryEntry
        {
            FilePath = "a.pdf", FileName = "a.pdf", FileHash = "h1",
            DocumentType = DocumentType.Desconhecido, Status = ProcessingStatus.Completed,
            ProcessedAt = DateTime.UtcNow
        });

        var successCount = await _repo.GetSuccessCountAsync();
        Assert.Equal(1, successCount);
    }

    [Fact]
    public async Task ClearAsync_RemovesAllEntries()
    {
        await InitializeAsync();
        var entry = CreateEntry();
        await _repo.SaveAsync(entry);

        await _repo.ClearAsync();

        var loaded = await _repo.GetByHashAsync("abc123");
        Assert.Null(loaded);
    }

    [Fact]
    public async Task GetByDateRangeAsync_ReturnsFilteredResults()
    {
        await InitializeAsync();
        var entry = CreateEntry();
        entry.ProcessedAt = new DateTime(2025, 1, 15, 0, 0, 0, DateTimeKind.Utc);
        await _repo.SaveAsync(entry);

        var inRange = await _repo.GetByDateRangeAsync(
            new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2025, 1, 31, 0, 0, 0, DateTimeKind.Utc));
        Assert.Single(inRange);

        var outOfRange = await _repo.GetByDateRangeAsync(
            new DateTime(2025, 2, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2025, 2, 28, 0, 0, 0, DateTimeKind.Utc));
        Assert.Empty(outOfRange);
    }

    [Fact]
    public async Task ExportToCsvAsync_CreatesFileWithHeader()
    {
        await InitializeAsync();
        var entry = CreateEntry();
        await _repo.SaveAsync(entry);

        var csvPath = Path.Combine(Path.GetTempPath(), $"test_export_{Guid.NewGuid()}.csv");
        try
        {
            await _repo.ExportToCsvAsync(csvPath);
            Assert.True(File.Exists(csvPath));
            var lines = await File.ReadAllLinesAsync(csvPath);
            Assert.True(lines.Length >= 2);
            Assert.Contains("Id;FilePath;FileName", lines[0]);
        }
        finally
        {
            if (File.Exists(csvPath)) File.Delete(csvPath);
        }
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (File.Exists(_dbPath))
            File.Delete(_dbPath);
    }
}
