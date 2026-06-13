using System.Diagnostics;
using System.Text.Json;

namespace SeparadorDePdf.Tests;

public class PerformanceMetrics
{
    public string Version { get; set; } = "";
    public DateTime Timestamp { get; set; }
    public int TotalTests { get; set; }
    public int PassedTests { get; set; }
    public int FailedTests { get; set; }
    public double TestDurationMs { get; set; }
    public int GoldenFilesPassed { get; set; }
    public int GoldenFilesFailed { get; set; }
    public double OcrTimeMs { get; set; }
    public double ClassificationTimeMs { get; set; }
    public double ExtractionTimeMs { get; set; }
    public double GroupingTimeMs { get; set; }
    public double TotalTimeMs { get; set; }
    public long RamMaxMb { get; set; }
    public bool QualityGatePassed { get; set; }
    public List<string> QualityGateFailures { get; set; } = new();

    public static void Save(PerformanceMetrics metrics, string path)
    {
        var json = JsonSerializer.Serialize(metrics, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }

    public static PerformanceMetrics Load(string path)
    {
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<PerformanceMetrics>(json) ?? new PerformanceMetrics();
    }
}

public class QualityReportGenerator
{
    public static void Generate(PerformanceMetrics metrics, string outputPath)
    {
        var gateColor = metrics.QualityGatePassed ? "#22c55e" : "#ef4444";
        var gateStatus = metrics.QualityGatePassed ? "PASS" : "FAIL";
        var failedColor = metrics.FailedTests > 0 ? "fail" : "pass";
        var gfFailedColor = metrics.GoldenFilesFailed > 0 ? "fail" : "pass";
        var passPercent = metrics.TotalTests > 0 ? (double)metrics.PassedTests / metrics.TotalTests * 100 : 0;

        var failuresHtml = "";
        if (metrics.QualityGateFailures.Count > 0)
        {
            failuresHtml = "<h2>Falhas da Quality Gate</h2><div class='failures'>";
            foreach (var f in metrics.QualityGateFailures)
                failuresHtml += "<div class='failure-item'>" + EscapeHtml(f) + "</div>";
            failuresHtml += "</div>";
        }

        var html = "<!DOCTYPE html>" + "\n"
            + "<html lang='pt-BR'>" + "\n"
            + "<head>" + "\n"
            + "  <meta charset='UTF-8'/>" + "\n"
            + "  <title>Separador PDF - Quality Report</title>" + "\n"
            + "  <style>" + "\n"
            + "    * { margin:0; padding:0; box-sizing:border-box; }" + "\n"
            + "    body { font-family:'Segoe UI',sans-serif; background:#0f172a; color:#e2e8f0; padding:2rem; }" + "\n"
            + "    .container { max-width:1200px; margin:0 auto; }" + "\n"
            + "    h1 { color:#38bdf8; font-size:2rem; margin-bottom:.5rem; }" + "\n"
            + "    h2 { color:#94a3b8; font-size:1.2rem; margin:1.5rem 0 1rem; border-bottom:1px solid #334155; padding-bottom:.5rem; }" + "\n"
            + "    .subtitle { color:#64748b; margin-bottom:2rem; }" + "\n"
            + "    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:1rem; margin:1rem 0; }" + "\n"
            + "    .card { background:#1e293b; border-radius:12px; padding:1.5rem; border:1px solid #334155; }" + "\n"
            + "    .card-label { color:#94a3b8; font-size:.85rem; text-transform:uppercase; letter-spacing:.05em; }" + "\n"
            + "    .card-value { color:#f1f5f9; font-size:2rem; font-weight:700; margin-top:.25rem; }" + "\n"
            + "    .card-value.pass { color:#22c55e; }" + "\n"
            + "    .card-value.fail { color:#ef4444; }" + "\n"
            + "    .gate { background:#1e293b; border-radius:12px; padding:2rem; border:2px solid " + gateColor + "; margin:2rem 0; text-align:center; }" + "\n"
            + "    .gate-title { font-size:1.5rem; font-weight:700; color:" + gateColor + "; }" + "\n"
            + "    .gate-status { font-size:3rem; margin:1rem 0; }" + "\n"
            + "    .bar { background:#334155; border-radius:4px; height:8px; margin-top:.5rem; overflow:hidden; }" + "\n"
            + "    .bar-fill { height:100%; border-radius:4px; background:#22c55e; }" + "\n"
            + "    .failures { background:#1e293b; border-radius:12px; padding:1.5rem; border:1px solid #334155; margin:1rem 0; }" + "\n"
            + "    .failure-item { color:#fca5a5; padding:.5rem 0; border-bottom:1px solid #334155; }" + "\n"
            + "    .failure-item:last-child { border-bottom:none; }" + "\n"
            + "    .timestamp { color:#64748b; font-size:.85rem; margin-top:2rem; }" + "\n"
            + "  </style>" + "\n"
            + "</head>" + "\n"
            + "<body>" + "\n"
            + "<div class='container'>" + "\n"
            + "  <h1>Separador PDF - Quality Report</h1>" + "\n"
            + "  <p class='subtitle'>Versao " + EscapeHtml(metrics.Version) + " | Gerado em " + metrics.Timestamp.ToString("dd/MM/yyyy HH:mm:ss") + "</p>" + "\n"
            + "  <div class='gate'>" + "\n"
            + "    <div class='gate-title'>QUALITY GATE</div>" + "\n"
            + "    <div class='gate-status'>" + gateStatus + "</div>" + "\n"
            + "  </div>" + "\n"
            + "  <h2>Testes</h2>" + "\n"
            + "  <div class='grid'>" + "\n"
            + "    <div class='card'><div class='card-label'>Total</div><div class='card-value'>" + metrics.TotalTests + "</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Aprovados</div><div class='card-value pass'>" + metrics.PassedTests + "</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Falhados</div><div class='card-value " + failedColor + "'>" + metrics.FailedTests + "</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Duracao</div><div class='card-value'>" + metrics.TestDurationMs.ToString("F0") + "ms</div></div>" + "\n"
            + "  </div>" + "\n"
            + "  <div class='bar'><div class='bar-fill' style='width:" + passPercent.ToString("F1") + "%'></div></div>" + "\n"
            + "  <h2>Golden Files</h2>" + "\n"
            + "  <div class='grid'>" + "\n"
            + "    <div class='card'><div class='card-label'>Aprovados</div><div class='card-value pass'>" + metrics.GoldenFilesPassed + "</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Falhados</div><div class='card-value " + gfFailedColor + "'>" + metrics.GoldenFilesFailed + "</div></div>" + "\n"
            + "  </div>" + "\n"
            + "  <h2>Performance</h2>" + "\n"
            + "  <div class='grid'>" + "\n"
            + "    <div class='card'><div class='card-label'>Classificacao</div><div class='card-value'>" + metrics.ClassificationTimeMs.ToString("F1") + "ms</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Extracao</div><div class='card-value'>" + metrics.ExtractionTimeMs.ToString("F1") + "ms</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Agrupamento</div><div class='card-value'>" + metrics.GroupingTimeMs.ToString("F1") + "ms</div></div>" + "\n"
            + "    <div class='card'><div class='card-label'>Total</div><div class='card-value'>" + metrics.TotalTimeMs.ToString("F1") + "ms</div></div>" + "\n"
            + "  </div>" + "\n"
            + "  <h2>Memoria</h2>" + "\n"
            + "  <div class='grid'>" + "\n"
            + "    <div class='card'><div class='card-label'>RAM Maxima</div><div class='card-value'>" + metrics.RamMaxMb + "MB</div></div>" + "\n"
            + "  </div>" + "\n"
            + failuresHtml + "\n"
            + "  <p class='timestamp'>Gerado automaticamente pelo SeparadorDePdf Quality Gate</p>" + "\n"
            + "</div>" + "\n"
            + "</body>" + "\n"
            + "</html>";

        File.WriteAllText(outputPath, html);
    }

    private static string EscapeHtml(string text)
    {
        return text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");
    }
}

public class QualityGate
{
    private readonly List<string> _failures = new();

    public void CheckTests(int total, int passed)
    {
        if (total == 0)
            _failures.Add("Nenhum teste executado");
        else if (passed < total)
            _failures.Add($"Testes falhados: {total - passed}/{total}");
    }

    public void CheckGoldenFiles(int total, int passed)
    {
        if (total == 0)
            _failures.Add("Nenhum Golden File encontrado");
        else if (passed < total)
            _failures.Add($"Golden Files falhados: {total - passed}/{total}");
    }

    public void CheckPerformance(double classificationMs, double extractionMs, double groupingMs)
    {
        if (classificationMs > 100)
            _failures.Add($"Classificacao lenta: {classificationMs:F1}ms (meta: <100ms)");
        if (extractionMs > 50)
            _failures.Add($"Extracao lenta: {extractionMs:F1}ms (meta: <50ms)");
        if (groupingMs > 100)
            _failures.Add($"Agrupamento lento: {groupingMs:F1}ms (meta: <100ms)");
    }

    public bool IsPassed => _failures.Count == 0;
    public List<string> Failures => _failures;
}
