using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Classifiers;

public class ClassificationRule
{
    public DocumentType Type { get; set; }
    public string Keyword { get; set; } = string.Empty;
    public int Score { get; set; }
    public bool IsRegex { get; set; }
    public System.Text.RegularExpressions.Regex? CompiledRegex { get; set; }
}
