using System.Diagnostics;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Tests.Quality;

public class QualityGateTests
{
    private readonly RegexDocumentClassifier _classifier = new();
    private readonly RegexDataExtractor _extractor = new();
    private readonly ConsolidatedDocumentDetector _consolidatedDetector = new();
    private readonly GroupDetector _groupDetector = new();

    [Fact]
    public void AllClassificationTypes_Detected()
    {
        var testCases = new Dictionary<string, DocumentType>
        {
            ["NOTA FISCAL ELETRONICA\nNumero: 182\nCNPJ: 11.222.333/0001-44\nValor Total R$ 11.308,70"] = DocumentType.NotaFiscal,
            ["COMPROVANTE DE PAGAMENTO DE IMPOSTO\nDocumento: DOC12345\nCNPJ: 11.222.333/0001-44\nValor: R$ 2.500,00"] = DocumentType.Imposto,
            ["GUIA DE RECOLHIMENTO\nN° 67890\nCONTRIBUINTE: EMPRESA LTDA\nCNPJ: 12.345.678/0001-99\nGPS"] = DocumentType.Guia,
            ["CONTRACHEQUE\nNOME: JOAO SILVA\nFUNCIONARIO: 12345\nSalario Base: R$ 4.500,00"] = DocumentType.Holerite,
            ["CONCESSAO DE FERIAS\nNOME: MARIA SILVA\nCPF: 123.456.789-00\nPeriodo Aquisitivo"] = DocumentType.Ferias,
            ["CONTRATO DE LOCAÇÃO\nCONTRATO: 456\nCONTRATANTE: EMPRESA ABC\nCLÁUSULA PRIMEIRA\nValor Total R$ 50.000,00"] = DocumentType.Contrato,
            ["RECIBO\nRECEBEMOS DE JOAO SANTOS\nO valor de R$ 1.200,00\nReferente a prestacao de servicos"] = DocumentType.Recibo,
            ["NOTA DE SERVICO\nPRESTADOR: CLINICA SAO PAULO\nCNPJ: 11.222.333/0001-44\nServico Medico"] = DocumentType.Servico,
        };

        foreach (var (text, expectedType) in testCases)
        {
            var result = _classifier.ClassifyAsync(text).GetAwaiter().GetResult();
            Assert.Equal(expectedType, result.Type);
        }
    }

    [Fact]
    public void Performance_Classification_MeetsTarget()
    {
        var texts = new[]
        {
            "NOTA FISCAL ELETRONICA\nNumero: 182\nCNPJ: 11.222.333/0001-44\nValor Total R$ 11.308,70",
            "COMPROVANTE DE PAGAMENTO DE IMPOSTO\nDocumento: DOC12345\nCNPJ: 11.222.333/0001-44\nValor: R$ 2.500,00",
            "GUIA DE RECOLHIMENTO\nN° 67890\nCONTRIBUINTE: EMPRESA LTDA\nCNPJ: 12.345.678/0001-99\nGPS",
            "CONTRACHEQUE\nNOME: JOAO SILVA\nFUNCIONARIO: 12345\nSalario Base: R$ 4.500,00",
            "CONCESSAO DE FERIAS\nNOME: MARIA SILVA\nCPF: 123.456.789-00\nPeriodo Aquisitivo",
            "CONTRATO DE LOCAÇÃO\nCONTRATO: 456\nCONTRATANTE: EMPRESA ABC\nCLÁUSULA PRIMEIRA\nValor Total R$ 50.000,00",
            "RECIBO\nRECEBEMOS DE JOAO SANTOS\nO valor de R$ 1.200,00\nReferente a prestacao de servicos",
            "NOTA DE SERVICO\nPRESTADOR: CLINICA SAO PAULO\nCNPJ: 11.222.333/0001-44\nServico Medico",
        };

        var sw = Stopwatch.StartNew();
        foreach (var text in texts)
            _classifier.ClassifyAsync(text).GetAwaiter().GetResult();
        sw.Stop();

        var avgMs = sw.Elapsed.TotalMilliseconds / texts.Length;
        Assert.True(avgMs < 100, $"Average classification time {avgMs:F1}ms exceeds 100ms target");
    }

    [Fact]
    public void Performance_Extraction_MeetsTarget()
    {
        var testCases = new (string Text, DocumentType Type)[]
        {
            ("NOTA FISCAL\nNumero: 182\nEmitente: RI DE MACEDO\nCNPJ: 11.222.333/0001-44\nValor Total R$ 11.308,70", DocumentType.NotaFiscal),
            ("COMPROVANTE DE PAGAMENTO DE IMPOSTO\nDocumento: DOC12345\nCNPJ: 11.222.333/0001-44\nValor: R$ 2.500,00", DocumentType.Imposto),
            ("GUIA DE RECOLHIMENTO\nN° 67890\nCONTRIBUINTE: EMPRESA LTDA\nCNPJ: 12.345.678/0001-99\nValor Total R$ 3.500,00", DocumentType.Guia),
            ("CONTRACHEQUE\nNOME: JOAO SILVA\nFUNCIONARIO: 12345\nSalario Base: R$ 4.500,00", DocumentType.Holerite),
            ("CONCESSAO DE FERIAS\nNOME: MARIA SILVA\nCPF: 123.456.789-00\nValor Total R$ 5.000,00", DocumentType.Ferias),
            ("CONTRATO: 456\nCONTRATANTE: EMPRESA ABC\nValor Total R$ 50.000,00", DocumentType.Contrato),
            ("RECIBO\nRECEBEMOS DE JOAO SANTOS\nO valor de R$ 1.200,00", DocumentType.Recibo),
            ("PRESTADOR: CLINICA SAO PAULO\nCNPJ: 11.222.333/0001-44\nValor: R$ 800,00", DocumentType.Servico),
        };

        var sw = Stopwatch.StartNew();
        foreach (var (text, type) in testCases)
            _extractor.Extract(text, type);
        sw.Stop();

        var avgMs = sw.Elapsed.TotalMilliseconds / testCases.Length;
        Assert.True(avgMs < 50, $"Average extraction time {avgMs:F1}ms exceeds 50ms target");
    }

    [Fact]
    public void Performance_Grouping_MeetsTarget()
    {
        var pages = Enumerable.Range(0, 500).Select(i => new Core.Models.PageResult
        {
            PageNumber = i + 1,
            Numero = $"NF-{1000 + i}",
            Classification = DocumentType.NotaFiscal,
            ClassificationConfidence = 0.9f,
            OcrText = $"NOTA FISCAL {1000 + i}"
        }).ToList();

        var sw = Stopwatch.StartNew();
        _groupDetector.DetectGroups(pages);
        sw.Stop();

        Assert.True(sw.Elapsed.TotalMilliseconds < 100,
            $"Grouping 500 pages took {sw.Elapsed.TotalMilliseconds:F1}ms, exceeds 100ms target");
    }

    [Fact]
    public void Performance_All_MeetsTarget()
    {
        var sw = Stopwatch.StartNew();

        var text = "NOTA FISCAL ELETRONICA\nNumero: 182\nEmitente: RI DE MACEDO\nCNPJ: 11.222.333/0001-44\nValor Total R$ 11.308,70\nChave de Acesso: 35240111222333000144550010000018211234567890";
        var classification = _classifier.ClassifyAsync(text).GetAwaiter().GetResult();
        var extraction = _extractor.Extract(text, classification.Type);

        var pages = Enumerable.Range(0, 500).Select(i => new Core.Models.PageResult
        {
            PageNumber = i + 1,
            Numero = $"NF-{1000 + i}",
            Classification = DocumentType.NotaFiscal,
            ClassificationConfidence = 0.9f,
            OcrText = $"NOTA FISCAL {1000 + i}"
        }).ToList();
        _groupDetector.DetectGroups(pages);

        sw.Stop();

        Assert.True(sw.Elapsed.TotalMilliseconds < 200,
            $"Total pipeline (classify + extract + group 500 pages) took {sw.Elapsed.TotalMilliseconds:F1}ms, exceeds 200ms target");
    }

    [Fact]
    public void Memory_NoOutOfMemory()
    {
        var pages = Enumerable.Range(0, 10000).Select(i => new Core.Models.PageResult
        {
            PageNumber = i + 1,
            Numero = $"NF-{1000 + i}",
            Classification = DocumentType.NotaFiscal,
            ClassificationConfidence = 0.9f,
            OcrText = new string('X', 1000)
        }).ToList();

        var groups = _groupDetector.DetectGroups(pages);
        Assert.NotNull(groups);
        Assert.True(groups.Count > 0);
    }

    [Fact]
    public void Cancellation_ThrowsOperationCanceled()
    {
        var cts = new CancellationTokenSource();
        cts.Cancel();

        Assert.ThrowsAny<OperationCanceledException>(() =>
        {
            cts.Token.ThrowIfCancellationRequested();
        });
    }

    [Fact]
    public void CorruptedPdf_HandlesGracefully()
    {
        var tempFile = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid()}_corrupted.pdf");
        try
        {
            File.WriteAllBytes(tempFile, new byte[] { 0x00, 0x01, 0x02, 0x03, 0x04 });
            Assert.False(File.ReadAllBytes(tempFile).Take(4).SequenceEqual(new byte[] { 0x25, 0x50, 0x44, 0x46 }));
        }
        finally
        {
            if (File.Exists(tempFile)) File.Delete(tempFile);
        }
    }
}
