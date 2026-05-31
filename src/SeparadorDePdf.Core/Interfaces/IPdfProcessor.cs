using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IPdfProcessor
{
    Task<ProcessingResult> ProcessAsync(string pdfPath, string outputFolder, CancellationToken cancellationToken = default, IProgress<double>? progress = null);
}
