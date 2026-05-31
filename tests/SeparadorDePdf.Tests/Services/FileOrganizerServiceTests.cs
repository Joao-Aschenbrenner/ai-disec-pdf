using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Tests.Services;

public class FileOrganizerServiceTests
{
    private readonly FileOrganizerService _service = new();

    [Fact]
    public void GetDestinationSubFolder_NotaFiscal_ReturnsNotas()
    {
        Assert.Equal("Notas", _service.GetDestinationSubFolder(DocumentType.NotaFiscal));
    }

    [Fact]
    public void GetDestinationSubFolder_Holerite_ReturnsHolerites()
    {
        Assert.Equal("Holerites", _service.GetDestinationSubFolder(DocumentType.Holerite));
    }

    [Fact]
    public void GetDestinationSubFolder_Imposto_ReturnsImpostos()
    {
        Assert.Equal("Impostos", _service.GetDestinationSubFolder(DocumentType.Imposto));
    }

    [Fact]
    public void GetDestinationSubFolder_PlanilhaBalanco_ReturnsPlanilhas()
    {
        Assert.Equal("Planilhas", _service.GetDestinationSubFolder(DocumentType.PlanilhaBalanco));
    }

    [Fact]
    public void GetDestinationSubFolder_Unknown_ReturnsErro()
    {
        Assert.Equal("Erro", _service.GetDestinationSubFolder(DocumentType.Desconhecido));
    }

    [Fact]
    public void BuildNewFileName_NotaFiscal_WithNumberAndCnpj()
    {
        var doc = new DocumentInfo
        {
            Type = DocumentType.NotaFiscal,
            NumeroNota = "001234",
            CnpjEmitente = "11.222.333/0001-44"
        };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("N_001234-11.222.333/0001-44", name);
    }

    [Fact]
    public void BuildNewFileName_NotaFiscal_MissingFields_FallsBack()
    {
        var doc = new DocumentInfo { Type = DocumentType.NotaFiscal };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("N_SEM_NUMERO-SEM_CNPJ", name);
    }

    [Fact]
    public void BuildNewFileName_Holerite_WithName()
    {
        var doc = new DocumentInfo
        {
            Type = DocumentType.Holerite,
            NomePessoa = "João da Silva"
        };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("JOÃO_DA_SILVA", name);
    }

    [Fact]
    public void BuildNewFileName_Holerite_MissingName_FallsBack()
    {
        var doc = new DocumentInfo { Type = DocumentType.Holerite };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("SEM_NOME", name);
    }

    [Fact]
    public void BuildNewFileName_Imposto_WithNumber()
    {
        var doc = new DocumentInfo
        {
            Type = DocumentType.Imposto,
            NumeroImposto = "1234567890"
        };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("IMPOSTO_1234567890", name);
    }

    [Fact]
    public void BuildNewFileName_Imposto_MissingNumber_FallsBack()
    {
        var doc = new DocumentInfo { Type = DocumentType.Imposto };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("IMPOSTO_SEM_NUMERO", name);
    }

    [Fact]
    public void BuildNewFileName_PlanilhaBalanco_ReturnsFixedName()
    {
        var doc = new DocumentInfo { Type = DocumentType.PlanilhaBalanco };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("planilhabalanco", name);
    }

    [Fact]
    public void BuildNewFileName_Unknown_ReturnsFileNameWithoutExtension()
    {
        var doc = new DocumentInfo
        {
            Type = DocumentType.Desconhecido,
            FileName = "documento.pdf"
        };
        var name = _service.BuildNewFileName(doc);
        Assert.Equal("documento", name);
    }

    [Fact]
    public async Task OrganizeAsync_CopiesFileToCorrectLocation()
    {
        var sourceDir = Path.Combine(Path.GetTempPath(), "FileOrgSource_" + Guid.NewGuid());
        var outputDir = Path.Combine(Path.GetTempPath(), "FileOrgDest_" + Guid.NewGuid());
        Directory.CreateDirectory(sourceDir);
        try
        {
            var sourcePath = Path.Combine(sourceDir, "nota.pdf");
            await File.WriteAllTextAsync(sourcePath, "fake pdf content");

            var doc = new DocumentInfo
            {
                FilePath = sourcePath,
                FileName = "nota.pdf",
                Type = DocumentType.NotaFiscal,
                NumeroNota = "123",
                CnpjEmitente = "11.222.333/0001-44"
            };

            var destPath = await _service.OrganizeAsync(doc, outputDir);

            Assert.True(File.Exists(destPath));
            Assert.Contains("Notas", destPath);
            Assert.Contains("N_123-11.222.333_0001-44", destPath);
            Assert.EndsWith(".pdf", destPath);
            Assert.Equal(destPath, Path.Combine(doc.DestinationFolder, doc.NewFileName));
        }
        finally
        {
            if (Directory.Exists(sourceDir)) Directory.Delete(sourceDir, true);
            if (Directory.Exists(outputDir)) Directory.Delete(outputDir, true);
        }
    }

    [Fact]
    public async Task OrganizeAsync_WithConflict_AddsNumberSuffix()
    {
        var sourceDir = Path.Combine(Path.GetTempPath(), "FileOrgConflictSrc_" + Guid.NewGuid());
        var outputDir = Path.Combine(Path.GetTempPath(), "FileOrgConflictDst_" + Guid.NewGuid());
        Directory.CreateDirectory(sourceDir);
        Directory.CreateDirectory(Path.Combine(outputDir, "Notas"));
        try
        {
            var sourcePath = Path.Combine(sourceDir, "nota.pdf");
            await File.WriteAllTextAsync(sourcePath, "fake pdf content");

            var firstDest = Path.Combine(outputDir, "Notas", "N_SEM_NUMERO-SEM_CNPJ.pdf");
            await File.WriteAllTextAsync(firstDest, "existing");

            var doc = new DocumentInfo
            {
                FilePath = sourcePath,
                FileName = "nota.pdf",
                Type = DocumentType.NotaFiscal
            };

            var destPath = await _service.OrganizeAsync(doc, outputDir);

            Assert.Equal(Path.Combine(outputDir, "Notas", "N_SEM_NUMERO-SEM_CNPJ_1.pdf"), destPath);
        }
        finally
        {
            if (Directory.Exists(sourceDir)) Directory.Delete(sourceDir, true);
            if (Directory.Exists(outputDir)) Directory.Delete(outputDir, true);
        }
    }
}
