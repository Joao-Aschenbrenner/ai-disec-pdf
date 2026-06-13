using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;
using SeparadorDePdf.Wpf.Models;
using SkiaSharp;

namespace SeparadorDePdf.Wpf.Services;

public class PagePipeline
{
    private readonly IPdfRenderer _pdfRenderer;
    private readonly IOcrEngine _ocrEngine;
    private readonly IDocumentClassifier _classifier;
    private readonly IDataExtractor _extractor;
    private readonly ILogService _logService;
    private readonly IGroupDetector _groupDetector;
    private readonly IConsolidatedDocumentDetector _consolidatedDetector;
    private readonly IClassificationCache? _ocrCache;
    private readonly IImageProcessor? _imageProcessor;

    public List<AuditLogEntry> AuditLog { get; } = new();

    public PagePipeline(
        IPdfRenderer pdfRenderer,
        IOcrEngine ocrEngine,
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        ILogService logService,
        IGroupDetector groupDetector,
        IConsolidatedDocumentDetector consolidatedDetector,
        IClassificationCache? ocrCache = null,
        IImageProcessor? imageProcessor = null)
    {
        _pdfRenderer = pdfRenderer;
        _ocrEngine = ocrEngine;
        _classifier = classifier;
        _extractor = extractor;
        _logService = logService;
        _groupDetector = groupDetector;
        _consolidatedDetector = consolidatedDetector;
        _ocrCache = ocrCache;
        _imageProcessor = imageProcessor;
    }

    public async Task<List<DocumentGroup>> ProcessAllPagesAsync(
        string pdfPath,
        string outputFolder,
        int dpi,
        IProgress<PagePipelineProgress>? progress,
        CancellationToken ct)
    {
        AuditLog.Clear();
        _logService.Info($"[PIPELINE] Iniciando processamento: {Path.GetFileName(pdfPath)}", pdfPath);

        var pageCount = await _pdfRenderer.GetPageCountAsync(pdfPath, ct);
        _logService.Info($"[PIPELINE] PDF tem {pageCount} páginas", pdfPath);

        progress?.Report(new PagePipelineProgress
        {
            TotalPages = pageCount,
            CurrentPage = 0,
            Status = "Processando páginas...",
            Step = PipelineStep.PreProcessing
        });

        var pageResults = new List<PageResult>();

        await foreach (var pageImage in _pdfRenderer.RenderPagesStreamingAsync(pdfPath, dpi, ct))
        {
            int pageNum = pageResults.Count + 1;
            ct.ThrowIfCancellationRequested();

            var sw = Stopwatch.StartNew();
            _logService.Info($"[PIPELINE] Página {pageNum}/{pageCount} - iniciando", pdfPath);

            var result = new PageResult { PageNumber = pageNum };

            try
            {
                if (pageImage.Length == 0)
                {
                    result.ErrorMessage = "Falha ao renderizar página";
                    result.Success = false;
                    AddAudit(pageNum, "Render", DecisionReason.EmptyOcr, "Página vazia");
                    _logService.Warning($"[PIPELINE] Página {pageNum} - renderização falhou", pdfPath);
                    pageResults.Add(result);
                    continue;
                }

                var processedImage = pageImage;
                if (_imageProcessor is not null)
                {
                    try
                    {
                        processedImage = await _imageProcessor.EnhanceAsync(pageImage, ImageProcessingOptions.Default, ct);
                        AddAudit(pageNum, "PreProcessing", DecisionReason.NewDocument, "Imagem pré-processada");
                    }
                    catch (Exception ex)
                    {
                        _logService.Warning($"[PIPELINE] Página {pageNum} - pré-processamento falhou, usando original: {ex.Message}", pdfPath);
                    }
                }

                var imageHash = ComputeHash(processedImage);
                OcrResult? cachedOcr = null;

                if (_ocrCache is not null)
                {
                    cachedOcr = await _ocrCache.GetAsync(imageHash);
                    if (cachedOcr is not null)
                        AddAudit(pageNum, "OCR", DecisionReason.FallbackUsed, $"Cache hit ({cachedOcr.Text.Length} chars)");
                }

                OcrResult ocrResult;
                if (cachedOcr is not null)
                {
                    ocrResult = cachedOcr;
                }
                else
                {
                    progress?.Report(new PagePipelineProgress
                    {
                        TotalPages = pageCount,
                        CurrentPage = pageNum,
                        Status = $"Página {pageNum}/{pageCount} - OCR...",
                        Step = PipelineStep.Ocr,
                        PagesProcessed = pageResults.Count(r => r.Success),
                        PagesFailed = pageResults.Count(r => !r.Success)
                    });

                    ocrResult = await _ocrEngine.ProcessImageAsync(processedImage, ct);

                    if (_ocrCache is not null)
                        await _ocrCache.SetAsync(imageHash, ocrResult);
                }

                result.OcrText = ocrResult.Text;
                result.OcrConfidence = ocrResult.MeanConfidence;
                sw.Stop();
                _logService.Info($"[PIPELINE] Página {pageNum} - OCR: {ocrResult.Text.Length} chars, conf: {ocrResult.MeanConfidence:F0}% ({sw.ElapsedMilliseconds}ms)", pdfPath);

                if (string.IsNullOrWhiteSpace(ocrResult.Text))
                {
                    result.Classification = DocumentType.Desconhecido;
                    result.NeedsReview = true;
                    result.ReviewReason = "OCR vazio";
                    AddAudit(pageNum, "OCR", DecisionReason.EmptyOcr, "Texto OCR vazio");
                    _logService.Warning($"[PIPELINE] Página {pageNum} - OCR vazio, marcado para revisão", pdfPath);
                }
                else
                {
                    if (_consolidatedDetector.IsConsolidated(ocrResult.Text))
                    {
                        var reason = _consolidatedDetector.GetConsolidatedReason(ocrResult.Text);
                        result.Classification = DocumentType.Desconhecido;
                        result.NeedsReview = true;
                        result.ReviewReason = $"Consolidado: {reason}";
                        AddAudit(pageNum, "Classify", DecisionReason.ConsolidatedPage, reason ?? "Página consolidada");
                        _logService.Warning($"[PIPELINE] Página {pageNum} - Consolidado detectado: {reason}", pdfPath);
                    }
                    else
                    {
                        progress?.Report(new PagePipelineProgress
                        {
                            TotalPages = pageCount,
                            CurrentPage = pageNum,
                            Status = $"Página {pageNum}/{pageCount} - Classificando...",
                            Step = PipelineStep.Classifying,
                            PagesProcessed = pageResults.Count(r => r.Success),
                            PagesFailed = pageResults.Count(r => !r.Success)
                        });

                        var classification = await Task.Run(() => _classifier.ClassifyAsync(ocrResult.Text, ct), ct);
                        result.Classification = classification.Type;
                        result.ClassificationConfidence = classification.Confidence;
                        _logService.Info($"[PIPELINE] Página {pageNum} - Classificado: {classification.Type} (conf: {classification.Confidence:P0})", pdfPath);

                        var data = await Task.Run(() => _extractor.Extract(ocrResult.Text, classification.Type), ct);
                        result.Numero = data["NumeroNota"] ?? data["NumeroImposto"] ?? data["NumeroGuia"] ?? data["NumeroContrato"];
                        result.Nome = data["NomePessoa"] ?? data["Contribuinte"] ?? data["Parte"] ?? data["Prestador"] ?? data["CnpjEmitente"] ?? data["Cpf"] ?? data["Cnpj"];
                        result.Valor = data["Valor"];

                        AddAudit(pageNum, "Classify", GetDecisionReason(result), BuildDecisionDetail(result));
                        _logService.Info($"[PIPELINE] Página {pageNum} - Extraído: nº={result.Numero ?? "(n/a)"}, nome={result.Nome ?? "(n/a)"}, valor={result.Valor ?? "(n/a)"}", pdfPath);
                    }

                    if (ocrResult.MeanConfidence < 75f)
                    {
                        result.NeedsReview = true;
                        result.ReviewReason = $"Baixa confiança OCR: {ocrResult.MeanConfidence:F0}%";
                        AddAudit(pageNum, "Review", DecisionReason.LowConfidence, result.ReviewReason);
                    }
                    else if (result.ClassificationConfidence < 0.4f && !result.NeedsReview)
                    {
                        result.NeedsReview = true;
                        result.ReviewReason = $"Classificação incerta: {result.Classification} ({result.ClassificationConfidence:P0})";
                        AddAudit(pageNum, "Review", DecisionReason.LowConfidence, result.ReviewReason);
                    }
                    else if (!result.HasAllFields && ocrResult.Text.Length > 100 && !result.NeedsReview)
                    {
                        result.NeedsReview = true;
                        result.ReviewReason = "Campos insuficientes extraídos";
                        AddAudit(pageNum, "Review", DecisionReason.FallbackUsed, result.ReviewReason);
                    }
                }

                result.Success = true;
                result.ProcessingTimeMs = sw.ElapsedMilliseconds;
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                sw.Stop();
                result.ErrorMessage = ex.Message;
                result.Success = false;
                result.ProcessingTimeMs = sw.ElapsedMilliseconds;
                AddAudit(pageNum, "Error", DecisionReason.UnknownDocument, ex.Message);
                _logService.Error($"[PIPELINE] Página {pageNum} - Erro: {ex.Message}", pdfPath);
            }

            pageResults.Add(result);

            progress?.Report(new PagePipelineProgress
            {
                TotalPages = pageCount,
                CurrentPage = pageNum,
                Status = $"Página {pageNum}/{pageCount} - Concluída",
                Step = PipelineStep.Complete,
                PagesProcessed = pageResults.Count(r => r.Success),
                PagesFailed = pageResults.Count(r => !r.Success)
            });
        }

        _logService.Info("[PIPELINE] Detectando agrupamentos...", pdfPath);
        var groups = _groupDetector.DetectGroups(pageResults);

        progress?.Report(new PagePipelineProgress
        {
            TotalPages = pageCount,
            CurrentPage = pageCount,
            Status = "Salvando documentos...",
            Step = PipelineStep.Saving,
            PagesProcessed = pageResults.Count(r => r.Success),
            PagesFailed = pageResults.Count(r => !r.Success),
            GroupsCreated = groups.Count
        });

        for (int g = 0; g < groups.Count; g++)
        {
            var group = groups[g];
            ct.ThrowIfCancellationRequested();

            group.FileName = BuildGroupFileName(group, g + 1);

            var groupPageImages = await RenderPagesForGroupAsync(pdfPath, dpi, group.StartPage, group.EndPage, ct);

            var destPath = await SaveGroupAsPdfAsync(groupPageImages, outputFolder, group.FileName, ct);
            group.FileName = Path.GetFileName(destPath);

            foreach (var page in group.Pages)
                page.DestinationPath = destPath;

            AddAudit(group.StartPage + 1, "Save", DecisionReason.FallbackUsed,
                $"Grupo {g + 1}/{groups.Count}: {group.PageCount} páginas, tipo={group.DocumentType}, arquivo={group.FileName}");

            _logService.Info($"[PIPELINE] Grupo {g + 1}/{groups.Count}: {group.PageCount} páginas → {group.FileName}", pdfPath);
        }

        var successCount = pageResults.Count(r => r.Success);
        var reviewCount = groups.Count(g => g.NeedsReview);
        _logService.Info($"[PIPELINE] Finalizado: {successCount} páginas, {groups.Count} documentos, {reviewCount} para revisão", pdfPath);

        return groups;
    }

    private async Task<List<byte[]>> RenderPagesForGroupAsync(string pdfPath, int dpi, int startPage, int endPage, CancellationToken ct)
    {
        var images = new List<byte[]>();
        int pageIndex = 0;
        await foreach (var pageImage in _pdfRenderer.RenderPagesStreamingAsync(pdfPath, dpi, ct))
        {
            pageIndex++;
            if (pageIndex >= startPage && pageIndex <= endPage)
            {
                images.Add(pageImage);
                if (pageIndex >= endPage) break;
            }
        }
        return images;
    }

    private async Task<string> SaveGroupAsPdfAsync(List<byte[]> pageImages, string outputFolder, string fileName, CancellationToken ct)
    {
        return await Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();

            fileName = FileHelper.SanitizeFileName(fileName);
            if (!fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                fileName += ".pdf";

            var destPath = FileHelper.ResolveConflict(outputFolder, fileName);

            using var pdfStream = File.OpenWrite(destPath);
            using var pdfDocument = SKDocument.CreatePdf(pdfStream);

            foreach (var pageImage in pageImages)
            {
                using var inputStream = new SKMemoryStream(pageImage);
                using var bitmap = SKBitmap.Decode(inputStream);

                if (bitmap is null) continue;

                var pageWidth = bitmap.Width;
                var pageHeight = bitmap.Height;

                using var pdfPage = pdfDocument.BeginPage(pageWidth, pageHeight);
                pdfPage.DrawBitmap(bitmap, 0, 0);
                pdfDocument.EndPage();
            }

            pdfDocument.Close();
            return destPath;
        }, ct);
    }

    private async Task<string> SavePageAsPdfAsync(byte[] pageImage, string outputFolder, string fileName, CancellationToken ct)
    {
        return await Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();

            fileName = FileHelper.SanitizeFileName(fileName);
            if (!fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                fileName += ".pdf";

            var destPath = FileHelper.ResolveConflict(outputFolder, fileName);

            using var inputStream = new SKMemoryStream(pageImage);
            using var original = SKBitmap.Decode(inputStream);
            using var image = SKImage.FromBitmap(original);
            using var data = image.Encode(SKEncodedImageFormat.Jpeg, 85);

            using var pdfStream = File.OpenWrite(destPath);
            using var pdfDocument = SKDocument.CreatePdf(pdfStream);
            var pageWidth = original.Width;
            var pageHeight = original.Height;

            using var pdfPage = pdfDocument.BeginPage(pageWidth, pageHeight);
            pdfPage.DrawBitmap(original, 0, 0);
            pdfDocument.EndPage();
            pdfDocument.Close();

            return destPath;
        }, ct);
    }

    private string BuildGroupFileName(DocumentGroup group, int groupIndex)
    {
        var numero = Sanitize(group.Number);
        var nome = Sanitize(group.Name);
        var valor = Sanitize(group.Value);
        var typeLabel = GetTypeLabel(group.DocumentType);

        if (group.NeedsReview)
            return $"{typeLabel}_revisao_{groupIndex:D3}.pdf";

        if (!string.IsNullOrWhiteSpace(numero) && !string.IsNullOrWhiteSpace(nome) && !string.IsNullOrWhiteSpace(valor))
            return $"{numero}_{nome}_{valor}.pdf";

        if (!string.IsNullOrWhiteSpace(nome) && !string.IsNullOrWhiteSpace(valor))
            return $"{typeLabel}_{nome}_{valor}.pdf";

        if (!string.IsNullOrWhiteSpace(numero) && !string.IsNullOrWhiteSpace(valor))
            return $"{numero}_{typeLabel}_{valor}.pdf";

        if (!string.IsNullOrWhiteSpace(valor))
            return $"{typeLabel}_{typeLabel}_{valor}.pdf";

        if (group.PageCount > 1)
            return $"{typeLabel}_multiplo_{groupIndex:D3}.pdf";

        return $"{typeLabel}_{group.StartPage + 1:D3}.pdf";
    }

    private static string GetTypeLabel(DocumentType type)
    {
        return type switch
        {
            DocumentType.NotaFiscal => "nota",
            DocumentType.Holerite => "holerite",
            DocumentType.Imposto => "imposto",
            DocumentType.PlanilhaBalanco => "planilha",
            DocumentType.Ferias => "ferias",
            DocumentType.Recibo => "recibo",
            DocumentType.Guia => "guia",
            DocumentType.Contrato => "contrato",
            DocumentType.Servico => "servico",
            _ => "documento"
        };
    }

    private static string Sanitize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        value = value.Trim().Replace("/", "-").Replace("\\", "-").Replace(":", "-");
        value = new string(value.Where(c => !Path.GetInvalidFileNameChars().Contains(c)).ToArray());
        return value.Length > 50 ? value[..50] : value;
    }

    private static string ComputeHash(byte[] data)
    {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(data);
        return Convert.ToHexString(hash);
    }

    private void AddAudit(int page, string step, DecisionReason decision, string reason)
    {
        AuditLog.Add(new AuditLogEntry
        {
            Page = page,
            Step = step,
            Decision = decision,
            Reason = reason,
            Timestamp = DateTime.Now
        });
    }

    private static DecisionReason GetDecisionReason(PageResult result)
    {
        if (!string.IsNullOrWhiteSpace(result.Numero))
            return DecisionReason.NumberFound;

        if (result.Classification == DocumentType.Desconhecido)
            return DecisionReason.UnknownDocument;

        return DecisionReason.NumberNotFound;
    }

    private static string BuildDecisionDetail(PageResult result)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(result.Numero)) parts.Add($"nº={result.Numero}");
        if (!string.IsNullOrWhiteSpace(result.Nome)) parts.Add($"nome={result.Nome}");
        if (!string.IsNullOrWhiteSpace(result.Valor)) parts.Add($"valor={result.Valor}");
        return parts.Count > 0 ? string.Join(", ", parts) : "Nenhum campo extraído";
    }
}

public enum PipelineStep
{
    PreProcessing,
    Ocr,
    Classifying,
    Saving,
    Complete
}

public class PagePipelineProgress
{
    public int TotalPages { get; set; }
    public int CurrentPage { get; set; }
    public int PagesProcessed { get; set; }
    public int PagesFailed { get; set; }
    public int GroupsCreated { get; set; }
    public string Status { get; set; } = "";
    public PipelineStep Step { get; set; }
    public double ProgressPercent => TotalPages > 0 ? (double)CurrentPage / TotalPages * 100 : 0;
}
