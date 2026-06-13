using System.Text.Json;

namespace SeparadorDePdf.Tests.GoldenFiles;

public class GoldenFileCase
{
    public string Tipo { get; set; } = "";
    public string? Numero { get; set; }
    public string? Nome { get; set; }
    public string? Valor { get; set; }
    public bool NeedsReview { get; set; }
    public string? ReviewReason { get; set; }
    public string OcrText { get; set; } = "";

    public static GoldenFileCase Load(string expectedJsonPath)
    {
        var json = File.ReadAllText(expectedJsonPath);
        return JsonSerializer.Deserialize<GoldenFileCase>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException($"Failed to deserialize {expectedJsonPath}");
    }
}

public class GoldenFileResult
{
    public bool TipoMatch { get; set; }
    public bool NumeroMatch { get; set; }
    public bool NomeMatch { get; set; }
    public bool ValorMatch { get; set; }
    public bool NeedsReviewMatch { get; set; }
    public bool AllPassed => TipoMatch && NumeroMatch && NomeMatch && ValorMatch && NeedsReviewMatch;

    public List<string> Failures { get; set; } = new();

    public void AddFailure(string field, string expected, string actual)
    {
        Failures.Add($"{field}: expected '{expected}', got '{actual}'");
    }
}
