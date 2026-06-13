using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Utils;

public class FileHelperTests
{
    private readonly string _testFolder;

    public FileHelperTests()
    {
        _testFolder = Path.Combine(Path.GetTempPath(), "SeparadorDePdfTests", Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_testFolder);
    }

    public void Dispose()
    {
        if (Directory.Exists(_testFolder))
            Directory.Delete(_testFolder, true);
    }

    [Fact]
    public void SanitizeFileName_RemovesInvalidChars()
    {
        var result = FileHelper.SanitizeFileName("file<name>.pdf");
        Assert.DoesNotContain("<", result);
        Assert.DoesNotContain(">", result);
        Assert.EndsWith(".pdf", result);
    }

    [Fact]
    public void SanitizeFileName_ReplacesSpacesWithUnderscores()
    {
        var result = FileHelper.SanitizeFileName("my file name.pdf");
        Assert.DoesNotContain(" ", result);
        Assert.Contains("_", result);
    }

    [Fact]
    public void SanitizeFileName_CollapsesMultipleUnderscores()
    {
        var result = FileHelper.SanitizeFileName("a___b.pdf");
        Assert.DoesNotContain("___", result);
    }

    [Fact]
    public void SanitizeFileName_ReturnsDocumento_WhenEmpty()
    {
        var result = FileHelper.SanitizeFileName("");
        Assert.Equal("documento", result);
    }

    [Fact]
    public void SanitizeFileName_ReturnsDocumento_WhenOnlyInvalidChars()
    {
        var result = FileHelper.SanitizeFileName("<>:\"/\\|?*");
        Assert.Equal("documento", result);
    }

    [Fact]
    public void SanitizeFileName_TrimsTrailingUnderscores()
    {
        var result = FileHelper.SanitizeFileName("file__.pdf");
        Assert.False(result.EndsWith("_"), "Result should not end with underscore");
    }

    [Fact]
    public void ResolveConflict_ReturnsOriginal_WhenNoConflict()
    {
        var result = FileHelper.ResolveConflict(_testFolder, "test.pdf");
        Assert.Equal(Path.Combine(_testFolder, "test.pdf"), result);
    }

    [Fact]
    public void ResolveConflict_AppendsCounter_WhenFileExists()
    {
        File.WriteAllText(Path.Combine(_testFolder, "test.pdf"), "content");
        var result = FileHelper.ResolveConflict(_testFolder, "test.pdf");
        Assert.Equal(Path.Combine(_testFolder, "test_1.pdf"), result);
    }

    [Fact]
    public void ResolveConflict_IncrementsCounter_WhenMultipleExist()
    {
        File.WriteAllText(Path.Combine(_testFolder, "test.pdf"), "content");
        File.WriteAllText(Path.Combine(_testFolder, "test_1.pdf"), "content");
        var result = FileHelper.ResolveConflict(_testFolder, "test.pdf");
        Assert.Equal(Path.Combine(_testFolder, "test_2.pdf"), result);
    }

    [Fact]
    public void GetRelativePath_ReturnsRelative_WhenUnderBase()
    {
        var result = FileHelper.GetRelativePath("/base", "/base/sub/file.txt");
        Assert.Equal("sub/file.txt", result);
    }

    [Fact]
    public void GetRelativePath_ReturnsFull_WhenNotUnderBase()
    {
        var result = FileHelper.GetRelativePath("/other", "/base/file.txt");
        Assert.Equal("/base/file.txt", result);
    }

    [Fact]
    public void EnsureDirectoryExists_CreatesDirectory()
    {
        var path = Path.Combine(_testFolder, "newdir");
        FileHelper.EnsureDirectoryExists(path);
        Assert.True(Directory.Exists(path));
    }

    [Fact]
    public void EnsureDirectoryExists_DoesNotThrow_WhenExists()
    {
        FileHelper.EnsureDirectoryExists(_testFolder);
        Assert.True(Directory.Exists(_testFolder));
    }
}
