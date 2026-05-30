using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class SharpenProcessor : IImageProcessingStep
{
    public string Name => "Sharpen";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        var kernel = new float[,]
        {
            {  0, -1,  0 },
            { -1,  5, -1 },
            {  0, -1,  0 }
        };
        using var kernelMat = Mat.FromArray(kernel);
        var output = new Mat();
        Cv2.Filter2D(input, output, -1, kernelMat);
        return output;
    }
}
