using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Extractors;
using Xunit;

namespace SeparadorDePdf.Tests.Extractors;

public class RegexDataExtractorNewTypesTests
{
    private readonly RegexDataExtractor _extractor = new();

    [Fact]
    public void Extract_Ferias_ExtractsNomeAndCpf()
    {
        var text = "NOME: MARIA SILVA\nCPF: 123.456.789-00\nValor Total R$ 5.000,00";
        var data = _extractor.Extract(text, DocumentType.Ferias);

        Assert.Equal("MARIA SILVA", data["NomePessoa"]);
        Assert.Equal("12345678900", data["Cpf"]);
        Assert.Equal("5000.00", data["Valor"]);
    }

    [Fact]
    public void Extract_Recibo_ExtractsNomeAndValor()
    {
        var text = "RECEBEMOS DE JOÃO SANTOS\nR$ 1.200,00";
        var data = _extractor.Extract(text, DocumentType.Recibo);

        Assert.Equal("JOÃO SANTOS", data["NomePessoa"]);
        Assert.Equal("1200.00", data["Valor"]);
    }

    [Fact]
    public void Extract_Guia_ExtractsNumeroAndContribuinte()
    {
        var text = "N° 67890\nCONTRIBUINTE: EMPRESA LTDA\nCNPJ: 12.345.678/0001-99\nR$ 3.500,00";
        var data = _extractor.Extract(text, DocumentType.Guia);

        Assert.Equal("67890", data["NumeroGuia"]);
        Assert.Equal("EMPRESA LTDA", data["Contribuinte"]);
        Assert.Equal("12345678000199", data["Cnpj"]);
        Assert.Equal("3500.00", data["Valor"]);
    }

    [Fact]
    public void Extract_Contrato_ExtractsNumeroAndParte()
    {
        var text = "CONTRATO: 456\nCONTRATANTE: EMPRESA ABC\nR$ 50.000,00";
        var data = _extractor.Extract(text, DocumentType.Contrato);

        Assert.Equal("456", data["NumeroContrato"]);
        Assert.Equal("EMPRESA ABC", data["Parte"]);
        Assert.Equal("50000.00", data["Valor"]);
    }

    [Fact]
    public void Extract_Servico_ExtractsPrestadorAndValor()
    {
        var text = "PRESTADOR: CLÍNICA SÃO PAULO\nR$ 800,00";
        var data = _extractor.Extract(text, DocumentType.Servico);

        Assert.Equal("CLÍNICA SÃO PAULO", data["Prestador"]);
        Assert.Equal("800.00", data["Valor"]);
    }

    [Fact]
    public void Extract_Desconhecido_ReturnsEmptyData()
    {
        var data = _extractor.Extract("qualquer texto", DocumentType.Desconhecido);
        Assert.Empty(data.Fields);
    }
}
