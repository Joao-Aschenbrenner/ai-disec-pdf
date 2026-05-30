using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class ProcessingHistoryRepository : IProcessingHistoryRepository
{
    private readonly string _connectionString;
    private readonly AsyncLock _lock = new();

    public ProcessingHistoryRepository(string? dbPath = null)
    {
        dbPath ??= Path.Combine(AppContext.BaseDirectory, "processing_history.db");
        FileHelper.EnsureDirectoryExists(Path.GetDirectoryName(dbPath)!);
        _connectionString = $"Data Source={dbPath}";
    }

    public async Task InitializeAsync()
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = @"
            CREATE TABLE IF NOT EXISTS ProcessingHistory (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                FilePath TEXT NOT NULL,
                FileName TEXT NOT NULL,
                FileHash TEXT NOT NULL,
                DocumentType INTEGER NOT NULL,
                Status INTEGER NOT NULL,
                NewFileName TEXT,
                DestinationFolder TEXT,
                ErrorMessage TEXT,
                RetryCount INTEGER DEFAULT 0,
                ProcessingTimeMs REAL DEFAULT 0,
                ProcessedAt TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_filepath ON ProcessingHistory(FilePath);
            CREATE INDEX IF NOT EXISTS idx_hash ON ProcessingHistory(FileHash);
            CREATE INDEX IF NOT EXISTS idx_status ON ProcessingHistory(Status);
        ";
        await command.ExecuteNonQueryAsync();
    }

    public async Task SaveAsync(ProcessingHistoryEntry entry)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = @"
            INSERT INTO ProcessingHistory
                (FilePath, FileName, FileHash, DocumentType, Status, NewFileName, DestinationFolder, ErrorMessage, RetryCount, ProcessingTimeMs, ProcessedAt)
            VALUES
                (@filePath, @fileName, @fileHash, @docType, @status, @newFileName, @destFolder, @errorMsg, @retryCount, @procTimeMs, @processedAt);
            SELECT last_insert_rowid();
        ";

        command.Parameters.AddWithValue("@filePath", entry.FilePath);
        command.Parameters.AddWithValue("@fileName", entry.FileName);
        command.Parameters.AddWithValue("@fileHash", entry.FileHash);
        command.Parameters.AddWithValue("@docType", (int)entry.DocumentType);
        command.Parameters.AddWithValue("@status", (int)entry.Status);
        command.Parameters.AddWithValue("@newFileName", (object?)entry.NewFileName ?? DBNull.Value);
        command.Parameters.AddWithValue("@destFolder", (object?)entry.DestinationFolder ?? DBNull.Value);
        command.Parameters.AddWithValue("@errorMsg", (object?)entry.ErrorMessage ?? DBNull.Value);
        command.Parameters.AddWithValue("@retryCount", entry.RetryCount);
        command.Parameters.AddWithValue("@procTimeMs", entry.ProcessingTimeMs);
        command.Parameters.AddWithValue("@processedAt", entry.ProcessedAt.ToString("O"));

        var result = await command.ExecuteScalarAsync();
        entry.Id = Convert.ToInt32(result);
    }

    public async Task<ProcessingHistoryEntry?> GetByFilePathAsync(string filePath)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM ProcessingHistory WHERE FilePath = @filePath ORDER BY ProcessedAt DESC LIMIT 1";
        command.Parameters.AddWithValue("@filePath", filePath);

        using var reader = await command.ExecuteReaderAsync();
        if (await reader.ReadAsync())
            return MapEntry(reader);

        return null;
    }

    public async Task<ProcessingHistoryEntry?> GetByHashAsync(string fileHash)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM ProcessingHistory WHERE FileHash = @fileHash ORDER BY ProcessedAt DESC LIMIT 1";
        command.Parameters.AddWithValue("@fileHash", fileHash);

        using var reader = await command.ExecuteReaderAsync();
        if (await reader.ReadAsync())
            return MapEntry(reader);

        return null;
    }

    public async Task<IEnumerable<ProcessingHistoryEntry>> GetByDateRangeAsync(DateTime from, DateTime to)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM ProcessingHistory WHERE ProcessedAt >= @from AND ProcessedAt <= @to ORDER BY ProcessedAt DESC";
        command.Parameters.AddWithValue("@from", from.ToString("O"));
        command.Parameters.AddWithValue("@to", to.ToString("O"));

        return await ReadAllEntries(command);
    }

    public async Task<IEnumerable<ProcessingHistoryEntry>> GetByStatusAsync(ProcessingStatus status)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM ProcessingHistory WHERE Status = @status ORDER BY ProcessedAt DESC";
        command.Parameters.AddWithValue("@status", (int)status);

        return await ReadAllEntries(command);
    }

    public async Task<int> GetErrorCountAsync()
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM ProcessingHistory WHERE Status = @status";
        command.Parameters.AddWithValue("@status", (int)ProcessingStatus.Error);

        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }

    public async Task<int> GetSuccessCountAsync()
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM ProcessingHistory WHERE Status = @status";
        command.Parameters.AddWithValue("@status", (int)ProcessingStatus.Completed);

        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }

    public async Task ClearAsync()
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM ProcessingHistory";
        await command.ExecuteNonQueryAsync();
    }

    public async Task ExportToCsvAsync(string outputPath)
    {
        using var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();

        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM ProcessingHistory ORDER BY ProcessedAt DESC";

        using var reader = await command.ExecuteReaderAsync();
        using var writer = new StreamWriter(outputPath);

        await writer.WriteLineAsync("Id;FilePath;FileName;FileHash;DocumentType;Status;NewFileName;DestinationFolder;ErrorMessage;RetryCount;ProcessingTimeMs;ProcessedAt");

        while (await reader.ReadAsync())
        {
            var line = string.Join(";",
                reader["Id"],
                reader["FilePath"],
                reader["FileName"],
                reader["FileHash"],
                reader["DocumentType"],
                reader["Status"],
                reader["NewFileName"] ?? "",
                reader["DestinationFolder"] ?? "",
                reader["ErrorMessage"] ?? "",
                reader["RetryCount"],
                reader["ProcessingTimeMs"],
                reader["ProcessedAt"]);

            await writer.WriteLineAsync(line);
        }
    }

    private static ProcessingHistoryEntry MapEntry(SqliteDataReader reader)
    {
        return new ProcessingHistoryEntry
        {
            Id = Convert.ToInt32(reader["Id"]),
            FilePath = reader["FilePath"].ToString() ?? "",
            FileName = reader["FileName"].ToString() ?? "",
            FileHash = reader["FileHash"].ToString() ?? "",
            DocumentType = (DocumentType)Convert.ToInt32(reader["DocumentType"]),
            Status = (ProcessingStatus)Convert.ToInt32(reader["Status"]),
            NewFileName = reader["NewFileName"] as string,
            DestinationFolder = reader["DestinationFolder"] as string,
            ErrorMessage = reader["ErrorMessage"] as string,
            RetryCount = Convert.ToInt32(reader["RetryCount"]),
            ProcessingTimeMs = Convert.ToDouble(reader["ProcessingTimeMs"]),
            ProcessedAt = DateTime.Parse(reader["ProcessedAt"].ToString()!)
        };
    }

    private static async Task<List<ProcessingHistoryEntry>> ReadAllEntries(SqliteCommand command)
    {
        var entries = new List<ProcessingHistoryEntry>();
        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            entries.Add(MapEntry(reader));
        return entries;
    }
}
