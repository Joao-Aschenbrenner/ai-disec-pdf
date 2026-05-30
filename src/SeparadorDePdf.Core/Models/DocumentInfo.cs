using SeparadorDePdf.Core.Enums;

namespace SeparadorDePdf.Core.Models;

public class DocumentInfo
{
    public string FilePath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public DocumentType Type { get; set; } = DocumentType.Desconhecido;
    public string OcrText { get; set; } = string.Empty;
    public float OcrConfidence { get; set; }
    public ClassificationMethod ClassificationMethod { get; set; } = ClassificationMethod.Regex;
    public float ClassificationConfidence { get; set; }
    public string? NumeroNota { get; set; }
    public string? CnpjEmitente { get; set; }
    public string? Cpf { get; set; }
    public string? NomePessoa { get; set; }
    public string? NumeroImposto { get; set; }
    public string? ChaveAcesso { get; set; }
    public string NewFileName { get; set; } = string.Empty;
    public string DestinationFolder { get; set; } = string.Empty;
    public int PageCount { get; set; }
    public bool IsEmptyPage { get; set; }
    public string FileHash { get; set; } = string.Empty;
}
