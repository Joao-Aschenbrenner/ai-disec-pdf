using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class GrayscaleProcessor : IImageProcessingStep
{
    public string Name => "Grayscale";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        if (input.Channels() == 1)
            return input.Clone();

        var output = new Mat();
        Cv2.CvtColor(input, output, ColorConversionCodes.BGR2GRAY);
        return output;
    }
}
