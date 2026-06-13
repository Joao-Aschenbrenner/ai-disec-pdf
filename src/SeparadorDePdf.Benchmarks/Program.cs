using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Columns;
using BenchmarkDotNet.Configs;
using BenchmarkDotNet.Order;
using BenchmarkDotNet.Reports;
using BenchmarkDotNet.Running;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.Services;

namespace SeparadorDePdf.Benchmarks;

public class Program
{
    static void Main(string[] args)
    {
        var config = DefaultConfig.Instance
            .WithOptions(ConfigOptions.DisableOptimizationsValidator)
            .AddColumn(StatisticColumn.Mean)
            .AddColumn(StatisticColumn.Min)
            .AddColumn(StatisticColumn.Max);

        BenchmarkRunner.Run<PipelineBenchmarks>(config, args);
    }
}

[MemoryDiagnoser]
[SimpleJob(warmupCount: 3, iterationCount: 5)]
public class PipelineBenchmarks
{
    private RegexDocumentClassifier _classifier = null!;
    private RegexDataExtractor _extractor = null!;
    private ConsolidatedDocumentDetector _consolidatedDetector = null!;
    private GroupDetector _groupDetector = null!;

    private string _notaFiscalOcr = null!;
    private string _impostoOcr = null!;
    private string _guiaOcr = null!;
    private string _holeriteOcr = null!;
    private string _feriasOcr = null!;
    private string _contratoOcr = null!;
    private string _reciboOcr = null!;
    private string _servicoOcr = null!;
    private string _consolidadoOcr = null!;

    private List<Core.Models.PageResult> _pages50 = null!;
    private List<Core.Models.PageResult> _pages500 = null!;

    [GlobalSetup]
    public void Setup()
    {
        _classifier = new RegexDocumentClassifier();
        _extractor = new RegexDataExtractor();
        _consolidatedDetector = new ConsolidatedDocumentDetector();
        _groupDetector = new GroupDetector();

        _notaFiscalOcr = "NOTA FISCAL ELETRONICA\nNumero: 182\nEmitente: RI DE MACEDO\nCNPJ: 11.222.333/0001-44\nValor Total R$ 11.308,70\nChave de Acesso: 35240111222333000144550010000018211234567890";
        _impostoOcr = "COMPROVANTE DE PAGAMENTO DE IMPOSTO\nDocumento: DOC12345\nCNPJ: 11.222.333/0001-44\nValor: R$ 2.500,00";
        _guiaOcr = "GUIA DE RECOLHIMENTO\nN° 67890\nCONTRIBUINTE: EMPRESA LTDA\nCNPJ: 12.345.678/0001-99\nValor Total R$ 3.500,00\nGPS - Guia da Previdencia Social";
        _holeriteOcr = "CONTRACHEQUE\nNOME: JOAO SILVA\nFUNCIONARIO: 12345\nSalario Base: R$ 4.500,00\nDescontos: R$ 0,00\nLiquido: R$ 4.500,00";
        _feriasOcr = "CONCESSAO DE FERIAS\nNOME: MARIA SILVA\nCPF: 123.456.789-00\nPeriodo Aquisitivo: 01/01/2024 a 31/12/2024\nValor Total R$ 5.000,00";
        _contratoOcr = "CONTRATO DE PRESTACAO DE SERVICOS\nCONTRATO: 456\nCONTRATANTE: EMPRESA ABC\nOBJETO: Servicos de consultoria\nValor Total R$ 50.000,00\nPRAZO: 12 meses";
        _reciboOcr = "RECIBO\nRECEBEMOS DE JOAO SANTOS\nO valor de R$ 1.200,00\nReferente a prestacao de servicos\nData: 01/01/2024";
        _servicoOcr = "NOTA DE SERVICO\nPRESTADOR: CLINICA SAO PAULO\nCNPJ: 11.222.333/0001-44\nServico Medico\nValor: R$ 800,00";
        _consolidadoOcr = string.Join("\n", Enumerable.Range(0, 10)
            .Select(i => $"CNPJ: 12.345.678/0001-{i:D2}"));

        _pages50 = Enumerable.Range(0, 50).Select(i => new Core.Models.PageResult
        {
            PageNumber = i + 1,
            Numero = $"NF-{1000 + i}",
            Classification = DocumentType.NotaFiscal,
            ClassificationConfidence = 0.9f,
            OcrText = $"NOTA FISCAL {1000 + i}"
        }).ToList();

        _pages500 = Enumerable.Range(0, 500).Select(i => new Core.Models.PageResult
        {
            PageNumber = i + 1,
            Numero = $"NF-{1000 + i}",
            Classification = DocumentType.NotaFiscal,
            ClassificationConfidence = 0.9f,
            OcrText = $"NOTA FISCAL {1000 + i}"
        }).ToList();
    }

    [Benchmark(Description = "OCR Classification")]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_NotaFiscal()
    {
        var result = _classifier.ClassifyAsync(_notaFiscalOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Imposto()
    {
        var result = _classifier.ClassifyAsync(_impostoOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Guia()
    {
        var result = _classifier.ClassifyAsync(_guiaOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Holerite()
    {
        var result = _classifier.ClassifyAsync(_holeriteOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Ferias()
    {
        var result = _classifier.ClassifyAsync(_feriasOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Contrato()
    {
        var result = _classifier.ClassifyAsync(_contratoOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Recibo()
    {
        var result = _classifier.ClassifyAsync(_reciboOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Classification")]
    public DocumentType Classification_Servico()
    {
        var result = _classifier.ClassifyAsync(_servicoOcr).GetAwaiter().GetResult();
        return result.Type;
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_NotaFiscal()
    {
        return _extractor.Extract(_notaFiscalOcr, DocumentType.NotaFiscal);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Imposto()
    {
        return _extractor.Extract(_impostoOcr, DocumentType.Imposto);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Guia()
    {
        return _extractor.Extract(_guiaOcr, DocumentType.Guia);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Holerite()
    {
        return _extractor.Extract(_holeriteOcr, DocumentType.Holerite);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Ferias()
    {
        return _extractor.Extract(_feriasOcr, DocumentType.Ferias);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Contrato()
    {
        return _extractor.Extract(_contratoOcr, DocumentType.Contrato);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Recibo()
    {
        return _extractor.Extract(_reciboOcr, DocumentType.Recibo);
    }

    [Benchmark]
    [BenchmarkCategory("Extraction")]
    public ExtractedData Extraction_Servico()
    {
        return _extractor.Extract(_servicoOcr, DocumentType.Servico);
    }

    [Benchmark]
    [BenchmarkCategory("Grouping")]
    public int GroupDetector_50Pages()
    {
        return _groupDetector.DetectGroups(_pages50).Count;
    }

    [Benchmark]
    [BenchmarkCategory("Grouping")]
    public int GroupDetector_500Pages()
    {
        return _groupDetector.DetectGroups(_pages500).Count;
    }

    [Benchmark]
    [BenchmarkCategory("Consolidated")]
    public bool ConsolidatedDetector_Detects()
    {
        return _consolidatedDetector.IsConsolidated(_consolidadoOcr);
    }
}
