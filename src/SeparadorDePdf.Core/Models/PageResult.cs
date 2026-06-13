using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class PageResult
{
    public int PageNumber { get; set; }
    public string OcrText { get; set; } = string.Empty;
    public float OcrConfidence { get; set; }
    public DocumentType Classification { get; set; } = DocumentType.Desconhecido;
    public float ClassificationConfidence { get; set; }
    public string? Numero { get; set; }
    public string? Nome { get; set; }
    public string? Valor { get; set; }
    public string SuggestedFileName { get; set; } = string.Empty;
    public string? DestinationPath { get; set; }
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
    public long ProcessingTimeMs { get; set; }

    public bool NeedsReview { get; set; }
    public string? ReviewReason { get; set; }

    public bool HasAllFields => !string.IsNullOrWhiteSpace(Numero) && !string.IsNullOrWhiteSpace(Nome) && !string.IsNullOrWhiteSpace(Valor);
}
