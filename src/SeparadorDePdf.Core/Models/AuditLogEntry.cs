using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class AuditLogEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string JobId { get; set; } = string.Empty;
    public int Page { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.Now;
    public string Step { get; set; } = string.Empty;
    public DecisionReason Decision { get; set; }
    public string Reason { get; set; } = string.Empty;
    public float? OcrConfidence { get; set; }
    public float? ClassificationConfidence { get; set; }
    public DocumentType? DocumentType { get; set; }
    public int? GroupId { get; set; }
}
