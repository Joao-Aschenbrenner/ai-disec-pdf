using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class ThresholdProcessor : IImageProcessingStep
{
    public string Name => "Threshold";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var gray = input.Channels() == 1 ? input.Clone() : new Mat();
        if (input.Channels() > 1)
            Cv2.CvtColor(input, gray, ColorConversionCodes.BGR2GRAY);

        var output = new Mat();
        try
        {
            Cv2.AdaptiveThreshold(gray, output, 255, AdaptiveThresholdTypes.GaussianC, ThresholdTypes.Binary, 31, 10);
        }
        catch
        {
            Cv2.Threshold(gray, output, 0, 255, ThresholdTypes.Binary | ThresholdTypes.Otsu);
        }
        gray.Dispose();
        return output;
    }
}
