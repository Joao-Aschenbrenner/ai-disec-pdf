using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Utils;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Rendering.Skia;

namespace SeparadorDePdf.Services;

public class PdfRendererService : IPdfRenderer
{
    private readonly ILogService _logService;

    public PdfRendererService(ILogService logService)
    {
        _logService = logService;
    }

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
                    catch (Exception ex)
                    {
                        _logService?.Error(ex, $"Falha ao renderizar página {i} de: {pdfPath}");
                        pages.Add(Array.Empty<byte>());
                    }
                }
            }
            catch (Exception ex)
            {
                _logService?.Error(ex, $"Falha ao abrir PDF para renderização: {pdfPath}");
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
            catch (Exception ex)
            {
                _logService?.Error(ex, $"Falha ao obter contagem de páginas: {pdfPath}");
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
        catch (Exception ex)
        {
            _logService?.Error(ex, $"Falha ao validar PDF: {pdfPath}");
            return false;
        }
    }
}
