using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IOcrEngine
{
    Task<OcrResult> ProcessImageAsync(byte[] imageData, string[] languages, CancellationToken cancellationToken = default);
    Task<OcrResult> ProcessImageAsync(byte[] imageData, CancellationToken cancellationToken = default);
    bool IsAvailable { get; }
}
