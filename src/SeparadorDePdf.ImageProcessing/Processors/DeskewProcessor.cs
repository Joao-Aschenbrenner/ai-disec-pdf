using System;
using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public class DeskewProcessor : IImageProcessingStep
{
    public string Name => "Deskew";
    public bool IsEnabled { get; set; } = true;

    public Mat Process(Mat input)
    {
        using var binary = new Mat();
        if (input.Channels() > 1)
            Cv2.CvtColor(input, binary, ColorConversionCodes.BGR2GRAY);
        else
            input.CopyTo(binary);

        Cv2.Threshold(binary, binary, 0, 255, ThresholdTypes.BinaryInv | ThresholdTypes.Otsu);

        var lines = Cv2.HoughLinesP(binary, 1, Math.PI / 180, 100, 100, 10);
        if (lines is null || lines.Length == 0)
            return input.Clone();

        double totalAngle = 0;
        int count = 0;
        foreach (var line in lines)
        {
            var angle = Math.Atan2(line.P2.Y - line.P1.Y, line.P2.X - line.P1.X) * 180 / Math.PI;
            if (Math.Abs(angle) < 45)
            {
                totalAngle += angle;
                count++;
            }
        }

        if (count == 0)
            return input.Clone();

        var medianAngle = totalAngle / count;
        if (Math.Abs(medianAngle) < 0.5)
            return input.Clone();

        var center = new Point2f(input.Cols / 2f, input.Rows / 2f);
        var rotationMatrix = Cv2.GetRotationMatrix2D(center, medianAngle, 1.0);
        var output = new Mat();
        Cv2.WarpAffine(input, output, rotationMatrix, input.Size(), InterpolationFlags.Cubic, BorderTypes.Replicate);
        return output;
    }
}
