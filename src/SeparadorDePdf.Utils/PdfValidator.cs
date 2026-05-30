using System;
using System.IO;

namespace SeparadorDePdf.Utils;

public static class PdfValidator
{
    public static bool IsValidPdf(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
                return false;
            if (new FileInfo(filePath).Length == 0)
                return false;
            using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var reader = new StreamReader(stream);
            var header = reader.ReadLine();
            return header is not null && header.StartsWith("%PDF-");
        }
        catch
        {
            return false;
        }
    }

    public static bool IsPdfFile(string filePath)
    {
        return Path.GetExtension(filePath).Equals(".pdf", StringComparison.OrdinalIgnoreCase);
    }
}
