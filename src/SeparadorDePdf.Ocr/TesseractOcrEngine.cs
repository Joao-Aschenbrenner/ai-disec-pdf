using System;
using System.Diagnostics;
using System.IO;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Ocr;

public class TesseractOcrEngine : IOcrEngine
{
    private readonly OcrEnginePool _enginePool;
    private readonly string _tessDataPath;

    public bool IsAvailable
    {
        get
        {
            try
            {
                var tessDataDir = FindTessDataPath();
                return Directory.Exists(tessDataDir)
                    && File.Exists(Path.Combine(tessDataDir, "por.traineddata"))
                    && File.Exists(Path.Combine(tessDataDir, "eng.traineddata"));
            }
            catch
            {
                return false;
            }
        }
    }

    public TesseractOcrEngine(string? tessDataPath = null)
    {
        _tessDataPath = tessDataPath ?? FindTessDataPath();
        _enginePool = new OcrEnginePool(_tessDataPath, TesseractLanguage.PortugueseAndEnglish);
    }

    public Task<OcrResult> ProcessImageAsync(byte[] imageData, string[] languages, CancellationToken cancellationToken = default)
    {
        return ProcessImageAsync(imageData, cancellationToken);
    }

    public async Task<OcrResult> ProcessImageAsync(byte[] imageData, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sw = Stopwatch.StartNew();

            try
            {
                using var pooledEngine = _enginePool.Rent();
                var engine = pooledEngine.Engine;

                using var pix = Tesseract.Pix.LoadFromMemory(imageData);
                using var page = engine.Process(pix);

                var text = page.GetText() ?? string.Empty;
                var confidence = page.GetMeanConfidence();

                sw.Stop();

                return new OcrResult
                {
                    Text = text,
                    MeanConfidence = confidence * 100f,
                    ProcessingTime = sw.Elapsed,
                    Languages = TesseractLanguage.DefaultArray,
                    PageCount = 1
                };
            }
            catch (Exception ex)
            {
                sw.Stop();
                Debug.WriteLine($"[TesseractOcrEngine] OCR falhou: {ex.Message}");

                return new OcrResult
                {
                    Text = string.Empty,
                    MeanConfidence = 0,
                    ProcessingTime = sw.Elapsed,
                    Languages = TesseractLanguage.DefaultArray,
                    PageCount = 1
                };
            }
        }, cancellationToken);
    }

    private static string FindTessDataPath()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "tessdata"),
            Path.Combine(AppContext.BaseDirectory, "..", "tessdata"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "tessdata"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Tesseract-OCR", "tessdata"),
            "tessdata"
        };

        foreach (var path in candidates)
        {
            var fullPath = Path.GetFullPath(path);
            if (Directory.Exists(fullPath))
                return fullPath;
        }

        return Path.Combine(AppContext.BaseDirectory, "tessdata");
    }

    public void Dispose() => _enginePool.Dispose();
}
