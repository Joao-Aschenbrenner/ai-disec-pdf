using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Ocr;

namespace SeparadorDePdf.Tests.Ocr;

public class OcrQualityValidatorTests
{
    [Fact]
    public void IsValidResult_NullText_ReturnsFalse()
    {
        var result = new OcrResult { Text = null!, MeanConfidence = 80f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_EmptyText_ReturnsFalse()
    {
        var result = new OcrResult { Text = "", MeanConfidence = 80f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_WhitespaceText_ReturnsFalse()
    {
        var result = new OcrResult { Text = "   \n  \t  ", MeanConfidence = 80f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_LowConfidence_ReturnsFalse()
    {
        var result = new OcrResult { Text = "Some meaningful text here", MeanConfidence = 20f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_NoLetters_ReturnsFalse()
    {
        var result = new OcrResult { Text = "12345 67890 12345", MeanConfidence = 80f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_ValidTextAndConfidence_ReturnsTrue()
    {
        var result = new OcrResult
        {
            Text = "This is a valid OCR result with enough letters to pass the threshold.",
            MeanConfidence = 75f
        };
        Assert.True(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_LowAlphaRatio_ReturnsFalse()
    {
        var result = new OcrResult { Text = "123456789 A", MeanConfidence = 80f };
        Assert.False(OcrQualityValidator.IsValidResult(result));
    }

    [Fact]
    public void IsValidResult_BorderlineConfidence_ReturnsTrue()
    {
        var result = new OcrResult
        {
            Text = "Texto com letras suficientes para passar no teste de qualidade",
            MeanConfidence = 30f
        };
        Assert.True(OcrQualityValidator.IsValidResult(result));
    }
}

public class OcrResultTests
{
    [Fact]
    public void IsEmpty_WithEmptyText_ReturnsTrue()
    {
        var result = new OcrResult { Text = "" };
        Assert.True(result.IsEmpty);
    }

    [Fact]
    public void IsEmpty_WithWhitespace_ReturnsTrue()
    {
        var result = new OcrResult { Text = "   " };
        Assert.True(result.IsEmpty);
    }

    [Fact]
    public void IsEmpty_WithText_ReturnsFalse()
    {
        var result = new OcrResult { Text = "hello" };
        Assert.False(result.IsEmpty);
    }

    [Fact]
    public void IsLowQuality_WithLowConfidence_ReturnsTrue()
    {
        var result = new OcrResult { Text = "hello", MeanConfidence = 20f };
        Assert.True(result.IsLowQuality);
    }

    [Fact]
    public void IsLowQuality_WithEmptyText_ReturnsFalse()
    {
        var result = new OcrResult { Text = "", MeanConfidence = 20f };
        Assert.False(result.IsLowQuality);
    }

    [Fact]
    public void Languages_Default_IsEmpty()
    {
        var result = new OcrResult();
        Assert.Empty(result.Languages);
    }
}
