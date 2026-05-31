using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Tests.Models;

public class ProcessingResultTests
{
    [Fact]
    public void Success_SetsCorrectStatusAndDocument()
    {
        var doc = new DocumentInfo { FilePath = @"C:\test.pdf", FileName = "test.pdf" };
        var result = ProcessingResult.Success(doc, TimeSpan.FromSeconds(5));

        Assert.Equal(ProcessingStatus.Completed, result.Status);
        Assert.Same(doc, result.Document);
        Assert.Equal(TimeSpan.FromSeconds(5), result.ProcessingTime);
        Assert.Equal(@"C:\test.pdf", result.FilePath);
    }

    [Fact]
    public void Fail_SetsCorrectStatusAndMessage()
    {
        var result = ProcessingResult.Fail(@"C:\test.pdf", "OCR failed", TimeSpan.FromSeconds(3), 2);

        Assert.Equal(ProcessingStatus.Error, result.Status);
        Assert.Equal("OCR failed", result.ErrorMessage);
        Assert.Equal(TimeSpan.FromSeconds(3), result.ProcessingTime);
        Assert.Equal(2, result.RetryCount);
    }

    [Fact]
    public void Fail_DefaultRetryCount_IsZero()
    {
        var result = ProcessingResult.Fail(@"C:\test.pdf", "error", TimeSpan.Zero);

        Assert.Equal(0, result.RetryCount);
    }

    [Fact]
    public void Skipped_SetsCorrectStatus()
    {
        var result = ProcessingResult.Skipped(@"C:\test.pdf", "Already processed");

        Assert.Equal(ProcessingStatus.Skipped, result.Status);
        Assert.Equal("Already processed", result.ErrorMessage);
        Assert.Equal(@"C:\test.pdf", result.FilePath);
    }

    [Fact]
    public void ProcessingResult_HasUtcProcessedAt()
    {
        var before = DateTime.UtcNow.AddSeconds(-1);
        var result = ProcessingResult.Success(new DocumentInfo(), TimeSpan.Zero);
        var after = DateTime.UtcNow.AddSeconds(1);

        Assert.InRange(result.ProcessedAt, before, after);
        Assert.Equal(DateTimeKind.Utc, result.ProcessedAt.Kind);
    }
}

public class ProcessingProgressTests
{
    [Fact]
    public void ProgressPercentage_WithTotalFiles_ReturnsCorrectValue()
    {
        var progress = new ProcessingProgress { TotalFiles = 10, ProcessedFiles = 5 };
        Assert.Equal(50.0, progress.ProgressPercentage);
    }

    [Fact]
    public void ProgressPercentage_WithZeroTotal_ReturnsZero()
    {
        var progress = new ProcessingProgress { TotalFiles = 0, ProcessedFiles = 5 };
        Assert.Equal(0.0, progress.ProgressPercentage);
    }

    [Fact]
    public void ProgressPercentage_AllProcessed_Returns100()
    {
        var progress = new ProcessingProgress { TotalFiles = 10, ProcessedFiles = 10 };
        Assert.Equal(100.0, progress.ProgressPercentage);
    }

    [Fact]
    public void ElapsedTime_WithStartAndEnd_CalculatesCorrectly()
    {
        var start = DateTime.UtcNow.AddMinutes(-5);
        var end = DateTime.UtcNow;
        var progress = new ProcessingProgress { StartedAt = start, EndedAt = end };

        Assert.True(progress.ElapsedTime.TotalMinutes >= 4.9);
        Assert.True(progress.ElapsedTime.TotalMinutes <= 5.1);
    }
}
