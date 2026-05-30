using System;
using System.IO;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Services;

public class FileOrganizerService : IFileOrganizer
{
    public async Task<string> OrganizeAsync(DocumentInfo document, string outputFolder, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            var subFolder = GetDestinationSubFolder(document.Type);
            var destinationDir = Path.Combine(outputFolder, subFolder);
            FileHelper.EnsureDirectoryExists(destinationDir);

            var newFileName = BuildNewFileName(document);
            newFileName = FileHelper.SanitizeFileName(newFileName);

            if (!newFileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                newFileName += ".pdf";

            var destinationPath = FileHelper.ResolveConflict(destinationDir, newFileName);
            File.Copy(document.FilePath, destinationPath, overwrite: false);

            document.NewFileName = Path.GetFileName(destinationPath);
            document.DestinationFolder = destinationDir;

            return destinationPath;
        }, cancellationToken);
    }

    public string BuildNewFileName(DocumentInfo document)
    {
        return document.Type switch
        {
            DocumentType.NotaFiscal => BuildNotaFiscalName(document),
            DocumentType.PlanilhaBalanco => "planilhabalanco",
            DocumentType.Holerite => BuildHoleriteName(document),
            DocumentType.Imposto => BuildImpostoName(document),
            _ => Path.GetFileNameWithoutExtension(document.FileName)
        };
    }

    public string GetDestinationSubFolder(DocumentType documentType)
    {
        return documentType switch
        {
            DocumentType.NotaFiscal => "Notas",
            DocumentType.PlanilhaBalanco => "Planilhas",
            DocumentType.Holerite => "Holerites",
            DocumentType.Imposto => "Impostos",
            _ => "Erro"
        };
    }

    private static string BuildNotaFiscalName(DocumentInfo doc)
    {
        var numero = doc.NumeroNota ?? "SEM_NUMERO";
        var cnpj = doc.CnpjEmitente ?? "SEM_CNPJ";
        return $"N_{numero}-{cnpj}";
    }

    private static string BuildHoleriteName(DocumentInfo doc)
    {
        var nome = doc.NomePessoa ?? "SEM_NOME";
        return nome.Replace(' ', '_').ToUpperInvariant();
    }

    private static string BuildImpostoName(DocumentInfo doc)
    {
        var numero = doc.NumeroImposto ?? "SEM_NUMERO";
        return $"IMPOSTO_{numero}";
    }
}
