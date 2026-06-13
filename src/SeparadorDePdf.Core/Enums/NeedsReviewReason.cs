namespace SeparadorDePdf.Core.Enums;

public enum NeedsReviewReason
{
    LowOcrConfidence,
    MissingNumber,
    MissingValue,
    MissingName,
    UnknownDocument,
    ConsolidatedDocument,
    ConflictingFields,
    DuplicateDetection,
    EmptyOcr
}
