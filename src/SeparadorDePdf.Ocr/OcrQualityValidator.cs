using System.Linq;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Ocr;

public static class OcrQualityValidator
{
    public static bool IsValidResult(OcrResult result)
    {
        if (result.IsEmpty)
            return false;

        if (result.IsLowQuality)
            return false;

        var alphaRatio = result.Text.Count(char.IsLetter) / (double)result.Text.Length;
        if (alphaRatio < 0.3)
            return false;

        return true;
    }
}
