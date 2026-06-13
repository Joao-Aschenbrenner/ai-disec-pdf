using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
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

    public async IAsyncEnumerable<byte[]> RenderPagesStreamingAsync(string pdfPath, int dpi = 300, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var threadId = Thread.CurrentThread.ManagedThreadId;
        _logService?.Info($"[RenderPagesStreamingAsync] Thread={threadId} Starting: {pdfPath}");

        PdfDocument? document = null;
        try
        {
            var openSw = Stopwatch.StartNew();
            document = await Task.Run(() => PdfDocument.Open(pdfPath), cancellationToken);
            openSw.Stop();
            _logService?.Info($"[RenderPagesStreamingAsync] Thread={threadId} Document opened in {openSw.ElapsedMilliseconds}ms, Pages={document.NumberOfPages}");

            for (int i = 1; i <= document.NumberOfPages; i++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var pageThreadId = Thread.CurrentThread.ManagedThreadId;
                _logService?.Info($"[RenderPagesStreamingAsync] Thread={pageThreadId} Starting render page {i}/{document.NumberOfPages}");
                var pageSw = Stopwatch.StartNew();

                byte[] pageData;
                try
                {
                    using var skBitmap = document.GetPageAsSKBitmap(i, dpi);
                    using var pngData = skBitmap.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100);
                    pageData = pngData.ToArray();
                }
                catch (Exception ex)
                {
                    _logService?.Error(ex, $"Falha ao renderizar página {i} de: {pdfPath}");
                    pageData = Array.Empty<byte>();
                }

                pageSw.Stop();
                _logService?.Info($"[RenderPagesStreamingAsync] Thread={pageThreadId} Completed render page {i}/{document.NumberOfPages} in {pageSw.ElapsedMilliseconds}ms, Size={pageData.Length} bytes");

                yield return pageData;
            }
        }
        finally
        {
            document?.Dispose();
        }
    }

    public async Task<PdfInfo> GetPdfInfoAsync(string pdfPath, CancellationToken cancellationToken = default)
    {
        var threadId = Thread.CurrentThread.ManagedThreadId;
        _logService?.Info($"[GetPdfInfoAsync] Thread={threadId} Starting: {pdfPath}");
        var sw = Stopwatch.StartNew();
        var fileInfo = new FileInfo(pdfPath);

        try
        {
            var pageCount = await Task.Run(() =>
            {
                var innerThreadId = Thread.CurrentThread.ManagedThreadId;
                _logService?.Info($"[GetPdfInfoAsync] Task.Run Thread={innerThreadId} Opening PDF");
                using var document = PdfDocument.Open(pdfPath);
                _logService?.Info($"[GetPdfInfoAsync] Task.Run Thread={innerThreadId} PDF opened, Pages={document.NumberOfPages}");
                return document.NumberOfPages;
            }, cancellationToken);

            sw.Stop();
            _logService?.Info($"[GetPdfInfoAsync] Thread={threadId} Completed in {sw.ElapsedMilliseconds}ms, Pages={pageCount}, Size={fileInfo.Length}");
            return new PdfInfo
            {
                FilePath = pdfPath,
                PageCount = pageCount,
                FileSizeBytes = fileInfo.Length,
                IsValid = true,
                LoadTime = sw.Elapsed
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logService?.Info($"[GetPdfInfoAsync] Thread={threadId} Failed in {sw.ElapsedMilliseconds}ms");
            _logService?.Error(ex, $"Falha ao obter info do PDF: {pdfPath}");
            return new PdfInfo
            {
                FilePath = pdfPath,
                IsValid = false,
                ErrorMessage = ex.Message,
                FileSizeBytes = fileInfo.Length,
                LoadTime = sw.Elapsed
            };
        }
    }

    public async Task<int> GetPageCountAsync(string pdfPath, CancellationToken cancellationToken = default)
    {
        var threadId = Thread.CurrentThread.ManagedThreadId;
        _logService?.Info($"[GetPageCountAsync] Thread={threadId} Starting: {pdfPath}");
        var sw = Stopwatch.StartNew();

        var result = await Task.Run(() =>
        {
            var innerThreadId = Thread.CurrentThread.ManagedThreadId;
            _logService?.Info($"[GetPageCountAsync] Task.Run Thread={innerThreadId} Opening PDF");
            try
            {
                using var document = PdfDocument.Open(pdfPath);
                _logService?.Info($"[GetPageCountAsync] Task.Run Thread={innerThreadId} PDF opened, Pages={document.NumberOfPages}");
                return document.NumberOfPages;
            }
            catch (Exception ex)
            {
                _logService?.Error(ex, $"Falha ao obter contagem de páginas: {pdfPath}");
                return 0;
            }
        }, cancellationToken);

        sw.Stop();
        _logService?.Info($"[GetPageCountAsync] Thread={threadId} Completed in {sw.ElapsedMilliseconds}ms, Pages={result}");
        return result;
    }

    public async Task<bool> IsValidPdfAsync(string pdfPath, CancellationToken cancellationToken = default)
    {
        var threadId = Thread.CurrentThread.ManagedThreadId;
        _logService?.Info($"[IsValidPdfAsync] Thread={threadId} Starting: {pdfPath}");
        var sw = Stopwatch.StartNew();

        var result = await Task.Run(() =>
        {
            var innerThreadId = Thread.CurrentThread.ManagedThreadId;
            _logService?.Info($"[IsValidPdfAsync] Task.Run Thread={innerThreadId} Validating PDF");
            try
            {
                if (!File.Exists(pdfPath))
                    return false;

                if (new FileInfo(pdfPath).Length == 0)
                    return false;

                using var document = PdfDocument.Open(pdfPath);
                _logService?.Info($"[IsValidPdfAsync] Task.Run Thread={innerThreadId} PDF opened, Pages={document.NumberOfPages}");
                return document.NumberOfPages > 0;
            }
            catch (Exception ex)
            {
                _logService?.Error(ex, $"Falha ao validar PDF: {pdfPath}");
                return false;
            }
        }, cancellationToken);

        sw.Stop();
        _logService?.Info($"[IsValidPdfAsync] Thread={threadId} Completed in {sw.ElapsedMilliseconds}ms, Valid={result}");
        return result;
    }
}
