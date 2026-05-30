using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IFileOrganizer
{
    Task<string> OrganizeAsync(DocumentInfo document, string outputFolder, CancellationToken cancellationToken = default);
    string BuildNewFileName(DocumentInfo document);
    string GetDestinationSubFolder(SeparadorDePdf.Core.Enums.DocumentType documentType);
}
