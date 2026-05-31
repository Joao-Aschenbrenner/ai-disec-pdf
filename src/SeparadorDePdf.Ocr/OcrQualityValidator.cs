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

        if (string.IsNullOrEmpty(result.Text))
            return false;

        var text = result.Text.Trim();
        if (text.Length == 0)
            return false;

        var alphaRatio = text.Count(char.IsLetter) / (double)text.Length;
        if (alphaRatio < 0.15)
            return false;

        return true;
    }
}
