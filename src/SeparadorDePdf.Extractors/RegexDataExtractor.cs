using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Extractors;

public class RegexDataExtractor : IDataExtractor
{
    public ExtractedData Extract(string ocrText, DocumentType documentType)
    {
        return documentType switch
        {
            DocumentType.NotaFiscal => ExtractNotaFiscal(ocrText),
            DocumentType.Holerite => ExtractHolerite(ocrText),
            DocumentType.Imposto => ExtractImposto(ocrText),
            DocumentType.PlanilhaBalanco => ExtractPlanilha(ocrText),
            DocumentType.Ferias => ExtractFerias(ocrText),
            DocumentType.Recibo => ExtractRecibo(ocrText),
            DocumentType.Guia => ExtractGuia(ocrText),
            DocumentType.Contrato => ExtractContrato(ocrText),
            DocumentType.Servico => ExtractServico(ocrText),
            _ => new ExtractedData()
        };
    }

    private ExtractedData ExtractNotaFiscal(string text)
    {
        var data = new ExtractedData();
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["CnpjEmitente"] = cnpj;
        var numero = NotaFiscalExtractor.ExtractNumeroNota(text);
        if (numero is not null) data["NumeroNota"] = numero;
        var chave = NotaFiscalExtractor.ExtractChaveAcesso(text);
        if (chave is not null) data["ChaveAcesso"] = chave;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractHolerite(string text)
    {
        var data = new ExtractedData();
        var nome = HoleriteExtractor.ExtractNome(text);
        if (nome is not null) data["NomePessoa"] = nome;
        var cpf = CpfExtractor.Extract(text);
        if (cpf is not null) data["Cpf"] = cpf;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractImposto(string text)
    {
        var data = new ExtractedData();
        var numero = ImpostoExtractor.ExtractNumeroDocumento(text);
        if (numero is not null) data["NumeroImposto"] = numero;
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractPlanilha(string text)
    {
        var data = new ExtractedData();
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractFerias(string text)
    {
        var data = new ExtractedData();
        var nome = FeriasExtractor.ExtractNome(text);
        if (nome is not null) data["NomePessoa"] = nome;
        var cpf = CpfExtractor.Extract(text);
        if (cpf is not null) data["Cpf"] = cpf;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractRecibo(string text)
    {
        var data = new ExtractedData();
        var nome = ReciboExtractor.ExtractNome(text);
        if (nome is not null) data["NomePessoa"] = nome;
        var cpf = CpfExtractor.Extract(text);
        if (cpf is not null) data["Cpf"] = cpf;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractGuia(string text)
    {
        var data = new ExtractedData();
        var numero = GuiaExtractor.ExtractNumeroGuia(text);
        if (numero is not null) data["NumeroGuia"] = numero;
        var contribuinte = GuiaExtractor.ExtractContribuinte(text);
        if (contribuinte is not null) data["Contribuinte"] = contribuinte;
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        var cpf = CpfExtractor.Extract(text);
        if (cpf is not null) data["Cpf"] = cpf;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractContrato(string text)
    {
        var data = new ExtractedData();
        var numero = ContratoExtractor.ExtractNumeroContrato(text);
        if (numero is not null) data["NumeroContrato"] = numero;
        var parte = ContratoExtractor.ExtractContratante(text);
        if (parte is not null) data["Parte"] = parte;
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }

    private ExtractedData ExtractServico(string text)
    {
        var data = new ExtractedData();
        var prestador = ServicoExtractor.ExtractPrestador(text);
        if (prestador is not null) data["Prestador"] = prestador;
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        var valor = ValorExtractor.Extract(text);
        if (valor is not null) data["Valor"] = valor;
        return data;
    }
}
