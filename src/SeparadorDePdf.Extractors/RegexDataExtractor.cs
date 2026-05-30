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
        return data;
    }

    private ExtractedData ExtractHolerite(string text)
    {
        var data = new ExtractedData();
        var nome = HoleriteExtractor.ExtractNome(text);
        if (nome is not null) data["NomePessoa"] = nome;
        var cpf = CpfExtractor.Extract(text);
        if (cpf is not null) data["Cpf"] = cpf;
        return data;
    }

    private ExtractedData ExtractImposto(string text)
    {
        var data = new ExtractedData();
        var numero = ImpostoExtractor.ExtractNumeroDocumento(text);
        if (numero is not null) data["NumeroImposto"] = numero;
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        return data;
    }

    private ExtractedData ExtractPlanilha(string text)
    {
        var data = new ExtractedData();
        var cnpj = CnpjExtractor.Extract(text);
        if (cnpj is not null) data["Cnpj"] = cnpj;
        return data;
    }
}
