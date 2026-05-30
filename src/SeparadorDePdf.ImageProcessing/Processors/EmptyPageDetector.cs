using OpenCvSharp;

namespace SeparadorDePdf.ImageProcessing.Processors;

public static class EmptyPageDetector
{
    public static bool IsEmptyPage(byte[] imageData, double varianceThreshold = 100.0)
    {
        using var mat = Cv2.ImDecode(imageData, ImreadModes.Grayscale);
        if (mat.Empty())
            return true;

        var mean = new Mat();
        var stddev = new Mat();
        Cv2.MeanStdDev(mat, mean, stddev);
        var variance = stddev.Get<double>(0) * stddev.Get<double>(0);
        return variance < varianceThreshold;
    }

    public static bool IsEmptyPage(Mat image, double varianceThreshold = 100.0)
    {
        if (image.Empty())
            return true;

        using var gray = image.Channels() == 1 ? image.Clone() : new Mat();
        if (image.Channels() > 1)
            Cv2.CvtColor(image, gray, ColorConversionCodes.BGR2GRAY);

        var mean = new Mat();
        var stddev = new Mat();
        Cv2.MeanStdDev(gray, mean, stddev);
        var variance = stddev.Get<double>(0) * stddev.Get<double>(0);
        return variance < varianceThreshold;
    }
}
