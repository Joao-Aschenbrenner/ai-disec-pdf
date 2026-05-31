using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Utils;

public class FileHelperTests
{
    [Theory]
    [InlineData("arquivo normal.pdf", "arquivo_normal.pdf")]
    [InlineData("arquivo   com   espacos.pdf", "arquivo_com_espacos.pdf")]
    [InlineData("arquivo<invalido>.pdf", "arquivo_invalido_.pdf")]
    [InlineData("", "documento")]
    [InlineData("   ", "documento")]
    [InlineData("nome*com|caracteres:especiais", "nome_com_caracteres_especiais")]
    [InlineData("Múltiplos___underlines", "Múltiplos_underlines")]
    [InlineData("_leading_trailing_", "leading_trailing")]
    public void SanitizeFileName_ProducesExpectedResults(string input, string expected)
    {
        var result = FileHelper.SanitizeFileName(input);
        Assert.Equal(expected, result);
    }

    [Fact]
    public void ResolveConflict_NoConflict_ReturnsOriginalPath()
    {
        var dir = Path.Combine(Path.GetTempPath(), "FileHelperTests");
        Directory.CreateDirectory(dir);
        try
        {
            var result = FileHelper.ResolveConflict(dir, "test.pdf");
            Assert.Equal(Path.Combine(dir, "test.pdf"), result);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void ResolveConflict_WithConflict_ReturnsNumberedPath()
    {
        var dir = Path.Combine(Path.GetTempPath(), "FileHelperTests_Conflict");
        Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllText(Path.Combine(dir, "test.pdf"), "content");
            var result = FileHelper.ResolveConflict(dir, "test.pdf");
            Assert.Equal(Path.Combine(dir, "test_1.pdf"), result);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void EnsureDirectoryExists_CreatesDirectory()
    {
        var dir = Path.Combine(Path.GetTempPath(), "FileHelperTests_Ensure_" + Guid.NewGuid());
        try
        {
            FileHelper.EnsureDirectoryExists(dir);
            Assert.True(Directory.Exists(dir));
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir);
        }
    }

    [Fact]
    public void EnsureDirectoryExists_ExistingDirectory_DoesNotThrow()
    {
        var dir = Path.Combine(Path.GetTempPath(), "FileHelperTests_Existing_" + Guid.NewGuid());
        Directory.CreateDirectory(dir);
        try
        {
            FileHelper.EnsureDirectoryExists(dir);
            Assert.True(Directory.Exists(dir));
        }
        finally
        {
            Directory.Delete(dir);
        }
    }

    [Fact]
    public void GetRelativePath_WithBasePath_ReturnsRelative()
    {
        var result = FileHelper.GetRelativePath(
            @"C:\base\folder",
            @"C:\base\folder\sub\file.pdf");
        Assert.Equal(@"sub\file.pdf", result);
    }

    [Fact]
    public void GetRelativePath_WithoutBasePath_ReturnsFullPath()
    {
        var result = FileHelper.GetRelativePath(
            @"C:\base\folder",
            @"D:\other\file.pdf");
        Assert.Equal(@"D:\other\file.pdf", result);
    }
}
