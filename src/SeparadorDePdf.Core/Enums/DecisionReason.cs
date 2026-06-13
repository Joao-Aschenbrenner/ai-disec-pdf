namespace SeparadorDePdf.Core.Enums;

public enum DecisionReason
{
    NumberFound,
    NumberNotFound,
    LowConfidence,
    MultipleDocuments,
    ConsolidatedPage,
    FallbackUsed,
    DuplicateFilename,
    UnknownDocument,
    GroupedByHeader,
    GroupedByNumber,
    GroupedByName,
    GroupedByType,
    EmptyOcr,
    NewDocument
}
