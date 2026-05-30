using OpenCvSharp;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.ImageProcessing.Processors;

namespace SeparadorDePdf.ImageProcessing;

public class ImageProcessor : IImageProcessor
{
    private readonly List<IImageProcessingStep> _steps;

    public ImageProcessor()
    {
        _steps = new List<IImageProcessingStep>
        {
            new GrayscaleProcessor(),
            new DeskewProcessor(),
            new DenoiseProcessor(),
            new ContrastProcessor(),
            new BrightnessProcessor(),
            new ThresholdProcessor(),
            new SharpenProcessor(),
            new ResizeProcessor()
        };
    }

    public async Task<byte[]> EnhanceAsync(byte[] imageData, ImageProcessingOptions options, CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();

            using var mat = Cv2.ImDecode(imageData, ImreadModes.Color);
            if (mat.Empty())
                return imageData;

            var current = mat.Clone();
            foreach (var step in _steps)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!step.IsEnabled)
                    continue;

                ApplyStepOptions(step, options);
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

    private void ApplyStepOptions(IImageProcessingStep step, ImageProcessingOptions options)
    {
        step.IsEnabled = step switch
        {
            GrayscaleProcessor => options.EnableGrayscale,
            DeskewProcessor => options.EnableDeskew,
            DenoiseProcessor => options.EnableDenoise,
            ContrastProcessor => options.EnableContrast,
            BrightnessProcessor => options.EnableBrightness,
            ThresholdProcessor => options.EnableThreshold,
            SharpenProcessor => options.EnableSharpen,
            ResizeProcessor => options.EnableResize,
            _ => step.IsEnabled
        };

        if (step is ContrastProcessor contrast)
            contrast.ClipLimit = options.ContrastClipLimit;

        if (step is BrightnessProcessor brightness)
        {
            brightness.Alpha = options.BrightnessAlpha;
            brightness.Beta = options.BrightnessBeta;
        }

        if (step is ResizeProcessor resize)
        {
            resize.ScaleFactor = options.ResizeScale;
            resize.TargetDpi = options.TargetDpi;
        }
    }
}
