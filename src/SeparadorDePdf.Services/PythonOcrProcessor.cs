using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class PythonOcrProcessor : IOcrEngine
{
    private readonly ILogService _logService;
    private readonly string _pythonScriptPath;

    public bool IsAvailable => File.Exists(_pythonScriptPath) && IsPythonAvailable();

    public PythonOcrProcessor(ILogService logService, string? pythonScriptPath = null)
    {
        _logService = logService;
        _pythonScriptPath = pythonScriptPath ?? FindPythonScript();
    }

    public Task<OcrResult> ProcessImageAsync(byte[] imageData, string[] languages, CancellationToken cancellationToken = default)
    {
        return ProcessImageAsync(imageData, cancellationToken);
    }

    public async Task<OcrResult> ProcessImageAsync(byte[] imageData, CancellationToken cancellationToken = default)
    {
        var sw = Stopwatch.StartNew();
        var tempImagePath = Path.Combine(Path.GetTempPath(), $"ocr_{Guid.NewGuid()}.png");
        var tempOutputPath = Path.Combine(Path.GetTempPath(), $"ocr_{Guid.NewGuid()}.json");

        try
        {
            await File.WriteAllBytesAsync(tempImagePath, imageData, cancellationToken);

            var pythonExe = @"C:\Users\USUARIO\AppData\Local\Programs\Python\Python312\python.exe";
            var psi = new ProcessStartInfo
            {
                FileName = pythonExe,
                Arguments = $"\"{_pythonScriptPath}\" \"{tempImagePath}\" \"{tempOutputPath}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null)
                throw new InvalidOperationException("Failed to start Python process");

            await process.WaitForExitAsync(cancellationToken);

            if (process.ExitCode != 0)
            {
                var error = await process.StandardError.ReadToEndAsync();
                _logService?.Error($"Python OCR failed: {error}");
                return new OcrResult { Text = "", MeanConfidence = 0, ProcessingTime = sw.Elapsed };
            }

            if (File.Exists(tempOutputPath))
            {
                var json = await File.ReadAllTextAsync(tempOutputPath, cancellationToken);
                var result = JsonSerializer.Deserialize<PythonOcrResult>(json);
                sw.Stop();

                return new OcrResult
                {
                    Text = result?.Text ?? "",
                    MeanConfidence = (float)(result?.Confidence ?? 0),
                    ProcessingTime = sw.Elapsed,
                    Languages = new[] { "por", "eng" },
                    PageCount = 1
                };
            }

            return new OcrResult { Text = "", MeanConfidence = 0, ProcessingTime = sw.Elapsed };
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logService?.Error(ex, "Python OCR error");
            return new OcrResult { Text = "", MeanConfidence = 0, ProcessingTime = sw.Elapsed };
        }
        finally
        {
            try { if (File.Exists(tempImagePath)) File.Delete(tempImagePath); } catch { }
            try { if (File.Exists(tempOutputPath)) File.Delete(tempOutputPath); } catch { }
        }
    }

    private static string FindPythonScript()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "ocr_processor.py"),
            Path.Combine(AppContext.BaseDirectory, "..", "ocr_processor.py"),
            Path.Combine(AppContext.BaseDirectory, "..", "..", "ocr_processor.py"),
            @"C:\Users\USUARIO\Documents\Separador de PDF\ocr_processor.py"
        };

        foreach (var path in candidates)
        {
            var fullPath = Path.GetFullPath(path);
            if (File.Exists(fullPath))
                return fullPath;
        }

        return Path.Combine(AppContext.BaseDirectory, "ocr_processor.py");
    }

    private static bool IsPythonAvailable()
    {
        try
        {
            var pythonExe = @"C:\Users\USUARIO\AppData\Local\Programs\Python\Python312\python.exe";
            var psi = new ProcessStartInfo(pythonExe, "--version")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };
            using var process = Process.Start(psi);
            process?.WaitForExit(2000);
            return process?.ExitCode == 0;
        }
        catch { return false; }
    }

    private class PythonOcrResult
    {
        public string Text { get; set; } = "";
        public double Confidence { get; set; }
    }
}