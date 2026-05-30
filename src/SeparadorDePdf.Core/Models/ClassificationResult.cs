using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class ClassificationResult
{
    public DocumentType Type { get; set; } = DocumentType.Desconhecido;
    public float Confidence { get; set; }
    public ClassificationMethod Method { get; set; } = ClassificationMethod.Regex;
    public string MatchedKeyword { get; set; } = string.Empty;
    public int Score { get; set; }

    public bool IsConfident => Confidence >= 0.4f;
}
