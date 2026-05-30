using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Core.Interfaces;

public interface IClassificationCache
{
    Task<OcrResult?> GetAsync(string fileHash);
    Task SetAsync(string fileHash, OcrResult result);
    Task<bool> ContainsAsync(string fileHash);
    Task ClearAsync();
}
