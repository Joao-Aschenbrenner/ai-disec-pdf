using System;
using CommunityToolkit.Mvvm.ComponentModel;

namespace SeparadorDePdf.Wpf.Models;

public enum JobStep
{
    Idle,
    PreProcessing,
    Processing,
    Completed,
    Failed,
    Cancelled
}

public partial class JobInfo : ObservableObject
{
    public string JobId { get; } = Guid.NewGuid().ToString("N")[..12];
    public string InputFilePath { get; set; } = string.Empty;
    public string FileName => System.IO.Path.GetFileName(InputFilePath);
    public string TempFolder => System.IO.Path.Combine(System.IO.Path.GetTempPath(), "SeparadorDePdf", JobId);

    [ObservableProperty] private JobStep _currentStep = JobStep.Idle;
    [ObservableProperty] private double _overallProgress;
    [ObservableProperty] private string _step1Status = "Aguardando PDF...";
    [ObservableProperty] private string _step2Status = "";
    [ObservableProperty] private string _step3Status = "";
    [ObservableProperty] private int _pagesProcessed;
    [ObservableProperty] private int _totalPages;
    [ObservableProperty] private int _pagesFailed;
    [ObservableProperty] private string _pipelineStatusMessage = "";
    [ObservableProperty] private string _estimatedTimeRemaining = "";
    [ObservableProperty] private string _elapsedTime = "";
    [ObservableProperty] private int _successCount;
    [ObservableProperty] private int _errorCount;
    [ObservableProperty] private int _groupsCreated;
    [ObservableProperty] private string? _errorMessage;
    [ObservableProperty] private string? _resultSummary;
    [ObservableProperty] private string? _zipPath;
}
