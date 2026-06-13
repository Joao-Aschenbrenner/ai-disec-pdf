using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class DocumentGroup
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int StartPage { get; set; }
    public int EndPage { get; set; }
    public DocumentType DocumentType { get; set; }
    public string? Number { get; set; }
    public string? Name { get; set; }
    public string? Value { get; set; }
    public double Confidence { get; set; }
    public bool NeedsReview { get; set; }
    public string? ReviewReason { get; set; }
    public NeedsReviewReason? ReviewReasonCode { get; set; }
    public List<PageResult> Pages { get; set; } = new();
    public string FileName { get; set; } = string.Empty;
    public string? SavedFilePath { get; set; }

    public int PageCount => Pages.Count;

    public bool HasAllFields => !string.IsNullOrWhiteSpace(Number) &&
                                !string.IsNullOrWhiteSpace(Name) &&
                                !string.IsNullOrWhiteSpace(Value);
}
