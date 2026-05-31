using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Ocr;

namespace SeparadorDePdf.Tests.Ocr;

public class OcrCacheTests
{
    private readonly OcrCache _cache = new();

    private static OcrResult MakeResult(string text, float confidence = 80f) => new()
    {
        Text = text, MeanConfidence = confidence, Languages = new[] { "por" }, PageCount = 1
    };

    [Fact]
    public async Task SetAsync_GetAsync_RoundTrip()
    {
        await _cache.SetAsync("key1", MakeResult("value1"));
        var result = await _cache.GetAsync("key1");
        Assert.NotNull(result);
        Assert.Equal("value1", result!.Text);
    }

    [Fact]
    public async Task GetAsync_MissingKey_ReturnsNull()
    {
        var result = await _cache.GetAsync("nonexistent");
        Assert.Null(result);
    }

    [Fact]
    public async Task ContainsAsync_WithExistingKey_ReturnsTrue()
    {
        await _cache.SetAsync("key1", MakeResult("value1"));
        Assert.True(await _cache.ContainsAsync("key1"));
    }

    [Fact]
    public async Task ContainsAsync_WithMissingKey_ReturnsFalse()
    {
        Assert.False(await _cache.ContainsAsync("nonexistent"));
    }

    [Fact]
    public async Task ClearAsync_RemovesAllEntries()
    {
        await _cache.SetAsync("key1", MakeResult("value1"));
        await _cache.SetAsync("key2", MakeResult("value2"));
        await _cache.ClearAsync();

        Assert.Null(await _cache.GetAsync("key1"));
        Assert.Null(await _cache.GetAsync("key2"));
    }
}
