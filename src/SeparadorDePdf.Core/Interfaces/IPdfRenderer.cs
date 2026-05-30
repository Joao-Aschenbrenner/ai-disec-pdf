namespace SeparadorDePdf.Core.Interfaces;

public interface IPdfRenderer
{
    Task<List<byte[]>> RenderPagesAsync(string pdfPath, int dpi = 300, CancellationToken cancellationToken = default);
    Task<int> GetPageCountAsync(string pdfPath, CancellationToken cancellationToken = default);
    bool IsValidPdf(string pdfPath);
}
