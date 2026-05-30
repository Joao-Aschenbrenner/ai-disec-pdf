using System;
using System.IO;
using System.Text.RegularExpressions;

namespace SeparadorDePdf.Utils;

public static class FileHelper
{
    private static readonly char[] InvalidChars = Path.GetInvalidFileNameChars();

    public static string SanitizeFileName(string fileName)
    {
        // Remove invalid chars, replace spaces with underscores, remove multiple underscores
        var name = fileName;
        foreach (var c in InvalidChars)
            name = name.Replace(c, '_');
        name = name.Replace(' ', '_');
        name = Regex.Replace(name, "_+", "_");
        name = name.Trim('_');
        return string.IsNullOrWhiteSpace(name) ? "documento" : name;
    }

    public static string ResolveConflict(string folder, string fileName)
    {
        var fullPath = Path.Combine(folder, fileName);
        if (!File.Exists(fullPath))
            return fullPath;

        var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        int counter = 1;
        while (File.Exists(Path.Combine(folder, $"{nameWithoutExt}_{counter}{ext}")))
            counter++;
        return Path.Combine(folder, $"{nameWithoutExt}_{counter}{ext}");
    }

    public static string GetRelativePath(string basePath, string fullPath)
    {
        if (fullPath.StartsWith(basePath))
            return fullPath.Substring(basePath.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return fullPath;
    }

    public static void EnsureDirectoryExists(string path)
    {
        if (!Directory.Exists(path))
            Directory.CreateDirectory(path);
    }
}
