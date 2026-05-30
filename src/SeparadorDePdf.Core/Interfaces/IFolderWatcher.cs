namespace SeparadorDePdf.Core.Interfaces;

public interface IFolderWatcher
{
    event EventHandler<string>? FileDetected;
    Task StartAsync(string folderPath, CancellationToken cancellationToken = default);
    Task StopAsync();
    bool IsRunning { get; }
}
