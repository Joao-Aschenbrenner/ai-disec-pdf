using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SeparadorDePdf.Core.Interfaces;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Rendering.Skia;

namespace SeparadorDePdf.Services;

public class PdfRendererService : IPdfRenderer
{
    public async Task<List<byte[]>> RenderPagesAsync(string pdfPath, int dpi = 300, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            var pages = new List<byte[]>();

            try
            {
                using var document = PdfDocument.Open(pdfPath);

                for (int i = 1; i <= document.NumberOfPages; i++)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    try
                    {
                        using var skBitmap = document.GetPageAsSKBitmap(i, dpi);
                        using var pngData = skBitmap.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
                        pages.Add(pngData.ToArray());
                    }
                    catch
                    {
                        pages.Add(Array.Empty<byte>());
                    }
                }
            }
            catch
            {
                throw;
            }

            return pages;
        }, cancellationToken);
    }

    public async Task<int> GetPageCountAsync(string pdfPath, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            try
            {
                using var document = PdfDocument.Open(pdfPath);
                return document.NumberOfPages;
            }
            catch
            {
                return 0;
            }
        }, cancellationToken);
    }

    public bool IsValidPdf(string pdfPath)
    {
        try
        {
            if (!File.Exists(pdfPath))
                return false;

            if (new FileInfo(pdfPath).Length == 0)
                return false;

            using var document = PdfDocument.Open(pdfPath);
            return document.NumberOfPages > 0;
        }
        catch
        {
            return false;
        }
    }
}
