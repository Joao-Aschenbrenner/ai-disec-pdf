using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class ResizeProcessor : IImageProcessingStep
{
    public double ScaleFactor { get; set; } = 2.0;
    public int TargetDpi { get; set; } = 300;
    public string Name => "Resize";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var estimatedDpi = Math.Min(input.Cols, input.Rows) / 8.5;
        if (estimatedDpi >= TargetDpi)
            return input.Clone();

        var newWidth = (int)(input.Cols * ScaleFactor);
        var newHeight = (int)(input.Rows * ScaleFactor);
        var output = new Mat();
        Cv2.Resize(input, output, new Size(newWidth, newHeight), 0, 0, InterpolationFlags.Cubic);
        return output;
    }
}
