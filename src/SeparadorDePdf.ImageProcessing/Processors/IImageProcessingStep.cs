using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public interface IImageProcessingStep
{
    Mat Process(Mat input);
    string Name { get; }
    bool IsEnabled { get; set; }
}
