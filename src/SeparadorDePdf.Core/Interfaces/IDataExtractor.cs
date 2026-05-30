using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IDataExtractor
{
    ExtractedData Extract(string ocrText, DocumentType documentType);
}
