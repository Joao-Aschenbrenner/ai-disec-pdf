using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Tests.Models;

public class ImageProcessingOptionsTests
{
    [Fact]
    public void Default_CreatesNewInstanceEachAccess()
    {
        var opt1 = ImageProcessingOptions.Default;
        var opt2 = ImageProcessingOptions.Default;
        Assert.NotSame(opt1, opt2);
    }

    [Fact]
    public void Aggressive_CreatesNewInstanceEachAccess()
    {
        var opt1 = ImageProcessingOptions.Aggressive;
        var opt2 = ImageProcessingOptions.Aggressive;
        Assert.NotSame(opt1, opt2);
    }

    [Fact]
    public void Default_HasAllOptionsEnabled()
    {
        var opt = ImageProcessingOptions.Default;
        Assert.True(opt.EnableGrayscale);
        Assert.True(opt.EnableDeskew);
        Assert.True(opt.EnableDenoise);
        Assert.True(opt.EnableContrast);
        Assert.True(opt.EnableBrightness);
        Assert.True(opt.EnableThreshold);
        Assert.True(opt.EnableSharpen);
        Assert.True(opt.EnableResize);
    }

    [Fact]
    public void Aggressive_HasHigherValues()
    {
        var opt = ImageProcessingOptions.Aggressive;
        Assert.True(opt.ContrastClipLimit > ImageProcessingOptions.Default.ContrastClipLimit);
        Assert.True(opt.ResizeScale > ImageProcessingOptions.Default.ResizeScale);
    }
}
