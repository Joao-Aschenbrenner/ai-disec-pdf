using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class ContrastProcessor : IImageProcessingStep
{
    public double ClipLimit { get; set; } = 2.0;
    public string Name => "Contrast (CLAHE)";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var gray = input.Channels() == 1 ? input.Clone() : new Mat();
        if (input.Channels() > 1)
            Cv2.CvtColor(input, gray, ColorConversionCodes.BGR2GRAY);

        using var clahe = Cv2.CreateCLAHE(ClipLimit, new Size(8, 8));
        var output = new Mat();
        clahe.Apply(gray, output);
        gray.Dispose();
        return output;
    }
}
