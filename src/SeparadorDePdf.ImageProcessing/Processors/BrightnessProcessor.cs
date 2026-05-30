using OpenCvSharp;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class BrightnessProcessor : IImageProcessingStep
{
    public double Alpha { get; set; } = 1.0;
    public double Beta { get; set; } = 10.0;
    public string Name => "Brightness";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var output = new Mat();
        Cv2.ConvertScaleAbs(input, output, Alpha, Beta);
        return output;
    }
}
