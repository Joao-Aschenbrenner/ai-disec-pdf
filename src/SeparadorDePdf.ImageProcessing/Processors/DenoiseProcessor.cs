using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class DenoiseProcessor : IImageProcessingStep
{
    public string Name => "Denoise";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var output = new Mat();
        if (input.Channels() == 1)
            Cv2.FastNlMeansDenoising(input, output, 10, 7, 21);
        else
            Cv2.FastNlMeansDenoisingColored(input, output, 10, 10, 7, 21);
        return output;
    }
}
