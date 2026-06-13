using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IConsolidatedDocumentDetector
{
    bool IsConsolidated(string ocrText);
    string? GetConsolidatedReason(string ocrText);
}
