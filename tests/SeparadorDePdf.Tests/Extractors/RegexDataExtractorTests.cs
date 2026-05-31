using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Extractors;

namespace SeparadorDePdf.Tests.Extractors;

public class RegexDataExtractorTests
{
    private readonly RegexDataExtractor _extractor = new();

    [Fact]
    public void Extract_NullText_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => _extractor.Extract(null!, DocumentType.NotaFiscal));
    }

    [Fact]
    public void Extract_UnknownType_ReturnsEmptyData()
    {
        var result = _extractor.Extract("some text", DocumentType.Desconhecido);
        Assert.NotNull(result);
        Assert.Empty(result.Fields);
    }

    [Fact]
    public void Extract_NotaFiscal_ExtractsCnpjAndNumeroAndChave()
    {
        var text = """
        NOTA FISCAL ELETRÔNICA
        Nº 001234
        CNPJ: 11.222.333/0001-44
        CHAVE DE ACESSO: 3520 1234 5678 9012 3456 7890 1234 5678 9012 3456 7890 1234
        """;
        var result = _extractor.Extract(text, DocumentType.NotaFiscal);

        Assert.NotEmpty(result.Fields);
        Assert.True(result.HasField("CnpjEmitente"));
        Assert.True(result.HasField("NumeroNota"));
        Assert.True(result.HasField("ChaveAcesso"));
    }

    [Fact]
    public void Extract_Holerite_ExtractsNomeAndCpf()
    {
        var text = """
        HOLERITE
        Nome: João da Silva
        CPF: 123.456.789-00
        """;
        var result = _extractor.Extract(text, DocumentType.Holerite);

        Assert.True(result.HasField("NomePessoa"));
        Assert.True(result.HasField("Cpf"));
    }

    [Fact]
    public void Extract_Imposto_ExtractsNumeroAndCnpj()
    {
        var text = """
        DARF
        Número do Documento: 1234567890
        CNPJ: 11.222.333/0001-44
        """;
        var result = _extractor.Extract(text, DocumentType.Imposto);

        Assert.True(result.HasField("NumeroImposto"));
        Assert.True(result.HasField("Cnpj"));
    }

    [Fact]
    public void Extract_PlanilhaBalanco_ExtractsCnpj()
    {
        var text = "CNPJ 11.222.333/0001-44 BALANCO 2024";
        var result = _extractor.Extract(text, DocumentType.PlanilhaBalanco);

        Assert.True(result.HasField("Cnpj"));
    }

    [Fact]
    public void Extract_NotaFiscal_WithNoMatches_ReturnsEmptyData()
    {
        var result = _extractor.Extract("random text without any patterns", DocumentType.NotaFiscal);
        Assert.Empty(result.Fields);
    }
}
