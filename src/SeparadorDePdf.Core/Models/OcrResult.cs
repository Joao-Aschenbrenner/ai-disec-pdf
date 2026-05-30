namespace SeparadorDePdf.Core.Models;

public class OcrResult
{
    public string Text { get; set; } = string.Empty;
    public float MeanConfidence { get; set; }
    public TimeSpan ProcessingTime { get; set; }
    public string[] Languages { get; set; } = Array.Empty<string>();
    public int PageCount { get; set; }
    public bool IsEmpty => string.IsNullOrWhiteSpace(Text);
    public bool IsLowQuality => MeanConfidence < 30f && !IsEmpty;
}
