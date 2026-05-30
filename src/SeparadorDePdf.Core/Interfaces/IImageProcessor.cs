using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IImageProcessor
{
    Task<byte[]> EnhanceAsync(byte[] imageData, ImageProcessingOptions options, CancellationToken cancellationToken = default);
    bool IsEmptyPage(byte[] imageData, double varianceThreshold = 100.0);
}
