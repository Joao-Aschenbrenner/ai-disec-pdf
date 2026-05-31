using System;
using System.Diagnostics;
using System.Runtime;

namespace SeparadorDePdf.Utils;

public static class MemoryMonitor
{
    private static readonly object _lock = new();

    public static double GetMemoryUsagePercentage()
    {
        var process = Process.GetCurrentProcess();
        var workingSet = process.WorkingSet64;
        var gcInfo = GC.GetGCMemoryInfo();
        var totalAvailable = gcInfo.TotalAvailableMemoryBytes;
        return (double)workingSet / totalAvailable * 100.0;
    }

    public static bool IsMemoryPressureHigh(double threshold = 80.0)
    {
        return GetMemoryUsagePercentage() > threshold;
    }

    public static void CollectIfPressureHigh(double threshold = 90.0)
    {
        lock (_lock)
        {
            if (IsMemoryPressureHigh(threshold))
            {
                GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, false);
                GC.WaitForPendingFinalizers();
            }
        }
    }
}
