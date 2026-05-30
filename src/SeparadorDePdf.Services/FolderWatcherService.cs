using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class FolderWatcherService : IFolderWatcher, IDisposable
{
    private FileSystemWatcher? _watcher;
    private CancellationTokenSource? _cts;
    private Timer? _debounceTimer;
    private readonly object _lock = new();
    private const int DebounceMs = 1000;

    public event EventHandler<string>? FileDetected;

    public bool IsRunning => _watcher is not null && _cts is not null && !_cts.IsCancellationRequested;

    public Task StartAsync(string folderPath, CancellationToken cancellationToken = default)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        FileHelper.EnsureDirectoryExists(folderPath);

        _watcher = new FileSystemWatcher(folderPath, "*.pdf")
        {
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.CreationTime | NotifyFilters.LastWrite,
            IncludeSubdirectories = false,
            EnableRaisingEvents = true
        };

        _watcher.Created += OnFileCreated;
        _watcher.Changed += OnFileChanged;

        return Task.CompletedTask;
    }

    public Task StopAsync()
    {
        if (_watcher is not null)
        {
            _watcher.EnableRaisingEvents = false;
            _watcher.Created -= OnFileCreated;
            _watcher.Changed -= OnFileChanged;
            _watcher.Dispose();
            _watcher = null;
        }

        _cts?.Cancel();
        _debounceTimer?.Dispose();
        _debounceTimer = null;

        return Task.CompletedTask;
    }

    private void OnFileCreated(object sender, FileSystemEventArgs e)
    {
        DebounceNotify(e.FullPath);
    }

    private void OnFileChanged(object sender, FileSystemEventArgs e)
    {
        DebounceNotify(e.FullPath);
    }

    private void DebounceNotify(string filePath)
    {
        lock (_lock)
        {
            _debounceTimer?.Dispose();
            _debounceTimer = new Timer(_ =>
            {
                if (File.Exists(filePath) && PdfValidator.IsPdfFile(filePath))
                {
                    try
                    {
                        using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.None);
                    }
                    catch
                    {
                        return;
                    }

                    FileDetected?.Invoke(this, filePath);
                }
            }, null, DebounceMs, Timeout.Infinite);
        }
    }

    public void Dispose()
    {
        StopAsync().GetAwaiter().GetResult();
        _cts?.Dispose();
    }
}
