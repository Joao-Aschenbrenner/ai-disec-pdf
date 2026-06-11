using OpenCvSharp;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.ImageProcessing.Processors;

namespace SeparadorDePdf.ImageProcessing;

public class ImageProcessor : IImageProcessor
{
    public async Task<byte[]> EnhanceAsync(byte[] imageData, ImageProcessingOptions options, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            using var mat = Cv2.ImDecode(imageData, ImreadModes.Color);
            if (mat.Empty())
                return imageData;

            var current = mat.Clone();
            foreach (var step in CreateSteps(options))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!step.IsEnabled)
                    continue;
                var processed = step.Process(current);
                current.Dispose();
                current = processed;
            }

            Cv2.ImEncode(".png", current, out var result);
            current.Dispose();
            return result;
        }, cancellationToken);
    }

    public bool IsEmptyPage(byte[] imageData, double varianceThreshold = 100.0)
    {
        return Processors.EmptyPageDetector.IsEmptyPage(imageData, varianceThreshold);
    }

    private static List<IImageProcessingStep> CreateSteps(ImageProcessingOptions options)
    {
        return new List<IImageProcessingStep>
        {
            new GrayscaleProcessor { IsEnabled = options.EnableGrayscale },
            new DeskewProcessor { IsEnabled = options.EnableDeskew },
            new DenoiseProcessor { IsEnabled = options.EnableDenoise },
            new ContrastProcessor { IsEnabled = options.EnableContrast, ClipLimit = options.ContrastClipLimit },
            new BrightnessProcessor { IsEnabled = options.EnableBrightness, Alpha = options.BrightnessAlpha, Beta = options.BrightnessBeta },
            new ThresholdProcessor { IsEnabled = options.EnableThreshold },
            new SharpenProcessor { IsEnabled = options.EnableSharpen },
            new ResizeProcessor { IsEnabled = options.EnableResize, ScaleFactor = options.ResizeScale, TargetDpi = options.TargetDpi }
        };
    }
}
