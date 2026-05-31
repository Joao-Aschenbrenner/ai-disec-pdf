using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Tests.Utils;

public class HashHelperTests
{
    [Fact]
    public async Task ComputeFileHashAsync_WithKnownContent_ReturnsExpectedHash()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path, "Hello World");
            var hash = await HashHelper.ComputeFileHashAsync(path);
            Assert.Equal(64, hash.Length);
            Assert.Matches("^[a-f0-9]{64}$", hash);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task ComputeFileHashAsync_SameContent_SameHash()
    {
        var path1 = Path.GetTempFileName();
        var path2 = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path1, "Same content");
            await File.WriteAllTextAsync(path2, "Same content");
            var hash1 = await HashHelper.ComputeFileHashAsync(path1);
            var hash2 = await HashHelper.ComputeFileHashAsync(path2);
            Assert.Equal(hash1, hash2);
        }
        finally
        {
            File.Delete(path1);
            File.Delete(path2);
        }
    }

    [Fact]
    public async Task ComputeFileHashAsync_DifferentContent_DifferentHash()
    {
        var path1 = Path.GetTempFileName();
        var path2 = Path.GetTempFileName();
        try
        {
            await File.WriteAllTextAsync(path1, "Content A");
            await File.WriteAllTextAsync(path2, "Content B");
            var hash1 = await HashHelper.ComputeFileHashAsync(path1);
            var hash2 = await HashHelper.ComputeFileHashAsync(path2);
            Assert.NotEqual(hash1, hash2);
        }
        finally
        {
            File.Delete(path1);
            File.Delete(path2);
        }
    }

    [Fact]
    public async Task ComputeFileHashAsync_EmptyFile_ReturnsHash()
    {
        var path = Path.GetTempFileName();
        try
        {
            var hash = await HashHelper.ComputeFileHashAsync(path);
            Assert.Equal(64, hash.Length);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void ComputeHash_WithKnownData_ReturnsExpectedLength()
    {
        var data = "test"u8.ToArray();
        var hash = HashHelper.ComputeHash(data);
        Assert.Equal(64, hash.Length);
        Assert.Matches("^[a-f0-9]{64}$", hash);
    }

    [Fact]
    public void ComputeHash_SameData_SameHash()
    {
        var data = "same"u8.ToArray();
        Assert.Equal(HashHelper.ComputeHash(data), HashHelper.ComputeHash(data));
    }
}
