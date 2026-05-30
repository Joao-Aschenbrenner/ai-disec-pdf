using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IDocumentClassifier
{
    Task<ClassificationResult> ClassifyAsync(string ocrText, CancellationToken cancellationToken = default);
    bool SupportsOnnx { get; }
}
