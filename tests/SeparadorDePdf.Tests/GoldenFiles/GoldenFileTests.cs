using System.Text.Json;

namespace SeparadorDePdf.Tests.GoldenFiles;

public class GoldenFileTests
{
    private readonly GoldenFileRunner _runner = new();
    private readonly string _goldenFilesDir;

    public GoldenFileTests()
    {
        _goldenFilesDir = Path.Combine(AppContext.BaseDirectory, "GoldenFiles");
        if (!Directory.Exists(_goldenFilesDir))
        {
            var testDir = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", ".."));
            _goldenFilesDir = Path.Combine(testDir, "GoldenFiles");
        }
    }

    [Fact]
    public void NotaFiscal_MatchesExpected()
    {
        RunGoldenFile("NotaFiscal");
    }

    [Fact]
    public void Imposto_MatchesExpected()
    {
        RunGoldenFile("Imposto");
    }

    [Fact]
    public void Guia_MatchesExpected()
    {
        RunGoldenFile("Guia");
    }

    [Fact]
    public void Holerite_MatchesExpected()
    {
        RunGoldenFile("Holerite");
    }

    [Fact]
    public void Ferias_MatchesExpected()
    {
        RunGoldenFile("Ferias");
    }

    [Fact]
    public void Contrato_MatchesExpected()
    {
        RunGoldenFile("Contrato");
    }

    [Fact]
    public void Recibo_MatchesExpected()
    {
        RunGoldenFile("Recibo");
    }

    [Fact]
    public void Servico_MatchesExpected()
    {
        RunGoldenFile("Servico");
    }

    [Fact]
    public void Consolidado_MatchesExpected()
    {
        RunGoldenFile("Consolidado");
    }

    [Fact]
    public void Unknown_MatchesExpected()
    {
        RunGoldenFile("Unknown");
    }

    [Fact]
    public void AllGoldenFiles_Exist()
    {
        var types = new[] { "NotaFiscal", "Imposto", "Guia", "Holerite", "Ferias", "Contrato", "Recibo", "Servico", "Consolidado", "Unknown" };
        foreach (var type in types)
        {
            var path = Path.Combine(_goldenFilesDir, type, "expected.json");
            Assert.True(File.Exists(path), $"Golden file missing: {path}");
        }
    }

    private void RunGoldenFile(string typeName)
    {
        var expectedPath = Path.Combine(_goldenFilesDir, typeName, "expected.json");
        Assert.True(File.Exists(expectedPath), $"Golden file not found: {expectedPath}");

        var expected = GoldenFileCase.Load(expectedPath);
        var result = _runner.Run(expected);

        Assert.True(result.AllPassed,
            $"Golden file '{typeName}' failed:\n{string.Join("\n", result.Failures)}");
    }
}
