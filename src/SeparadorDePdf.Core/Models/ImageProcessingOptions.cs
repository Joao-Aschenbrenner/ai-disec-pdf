namespace SeparadorDePdf.Core.Models;

public class ImageProcessingOptions
{
    public bool EnableGrayscale { get; set; } = true;
    public bool EnableDeskew { get; set; } = true;
    public bool EnableDenoise { get; set; } = true;
    public bool EnableContrast { get; set; } = true;
    public bool EnableBrightness { get; set; } = true;
    public bool EnableThreshold { get; set; } = true;
    public bool EnableSharpen { get; set; } = true;
    public bool EnableResize { get; set; } = true;
    public double ContrastClipLimit { get; set; } = 2.0;
    public double BrightnessAlpha { get; set; } = 1.0;
    public double BrightnessBeta { get; set; } = 10.0;
    public int TargetDpi { get; set; } = 300;
    public double ResizeScale { get; set; } = 2.0;
    public double EmptyPageVarianceThreshold { get; set; } = 100.0;

    public static ImageProcessingOptions Default => new();

    public static ImageProcessingOptions Aggressive => new()
    {
        EnableGrayscale = true,
        EnableDeskew = true,
        EnableDenoise = true,
        EnableContrast = true,
        EnableBrightness = true,
        EnableThreshold = true,
        EnableSharpen = true,
        EnableResize = true,
        ContrastClipLimit = 4.0,
        BrightnessAlpha = 1.2,
        BrightnessBeta = 20.0,
        ResizeScale = 3.0
    };
}
