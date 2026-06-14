using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Timers;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Wpf.Models;
using SeparadorDePdf.Wpf.Services;

namespace SeparadorDePdf.Wpf.ViewModels;

public partial class MainViewModel : ObservableObject, IDisposable
{
    private readonly JobManager _jobManager;
    private readonly ILogService _logService;
    private readonly DispatcherTimer _logFlushTimer;
    private readonly DispatcherTimer _uiKeepAliveTimer;
    private readonly System.Timers.Timer _spinnerTimer;
    private readonly List<LogEntry> _logBuffer = new();
    private readonly object _logBufferLock = new();
    private bool _logBufferDirty;

    [ObservableProperty] private string _inputFilePath = string.Empty;
    [ObservableProperty] private bool _isProcessing;
    [ObservableProperty] private double _progressPercentage;
    [ObservableProperty] private int _successCount;
    [ObservableProperty] private int _errorCount;
    [ObservableProperty] private int _groupsCreated;
    [ObservableProperty] private string _currentFile = string.Empty;
    [ObservableProperty] private string _statusText = "Pronto";
    [ObservableProperty] private bool _canCancel;
    [ObservableProperty] private bool _canDownload;
    [ObservableProperty] private bool _isStep1Active;
    [ObservableProperty] private bool _isStep2Active;
    [ObservableProperty] private bool _isStep3Active;

    [ObservableProperty] private string _step1Status = "Aguardando PDF...";
    [ObservableProperty] private string _step2Status = "";
    [ObservableProperty] private string _step3Status = "";
    [ObservableProperty] private int _pagesProcessed;
    [ObservableProperty] private int _totalPages;
    [ObservableProperty] private int _pagesFailed;
    [ObservableProperty] private string _pipelineStatusMessage = "";
    [ObservableProperty] private string _estimatedTimeRemaining = "";
    [ObservableProperty] private string _elapsedTime = "";
    [ObservableProperty] private int _spinnerAngle;
    [ObservableProperty] private bool _showLoadingDots = true;

    public ObservableCollection<LogEntry> Logs { get; } = new();

    public MainViewModel(JobManager jobManager, ILogService logService)
    {
        _jobManager = jobManager;
        _logService = logService;
        _logService.LogAdded += OnLogAdded;
        _jobManager.ProgressChanged += OnJobProgress;
        _jobManager.JobCompleted += OnJobCompleted;

        _logFlushTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(150)
        };
        _logFlushTimer.Tick += FlushLogBuffer;
        _logFlushTimer.Start();

        _uiKeepAliveTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(50)
        };
        _uiKeepAliveTimer.Tick += (s, e) =>
        {
            if (IsProcessing)
            {
                var frame = new DispatcherFrame();
                Dispatcher.PushFrame(frame);
            }
        };
        _uiKeepAliveTimer.Start();

        _spinnerTimer = new System.Timers.Timer(50);
        _spinnerTimer.Elapsed += (s, e) =>
        {
            if (IsProcessing)
            {
                SpinnerAngle = (SpinnerAngle + 15) % 360;
                ShowLoadingDots = !ShowLoadingDots;
            }
        };
        _spinnerTimer.Start();
    }

    private void OnJobProgress(object? sender, JobInfo job)
    {
        Application.Current.Dispatcher.BeginInvoke(() =>
        {
            IsProcessing = true;
            CanCancel = true;
            CanDownload = false;
            CurrentFile = job.FileName;
            Step1Status = job.Step1Status;
            Step2Status = job.Step2Status;
            Step3Status = job.Step3Status;
            ProgressPercentage = job.OverallProgress;
            PagesProcessed = job.PagesProcessed;
            TotalPages = job.TotalPages;
            PagesFailed = job.PagesFailed;
            GroupsCreated = job.GroupsCreated;
            PipelineStatusMessage = job.PipelineStatusMessage;
            EstimatedTimeRemaining = job.EstimatedTimeRemaining;
            ElapsedTime = job.ElapsedTime;

            IsStep1Active = job.CurrentStep == JobStep.PreProcessing;
            IsStep2Active = job.CurrentStep == JobStep.Processing;
            IsStep3Active = job.CurrentStep == JobStep.Saving;

            StatusText = job.CurrentStep switch
            {
                JobStep.PreProcessing => "Pré-processando...",
                JobStep.Processing => "Processando...",
                JobStep.Saving => "Salvando...",
                _ => StatusText
            };
        }, DispatcherPriority.Background);
    }

    private void OnJobCompleted(object? sender, JobInfo job)
    {
        Application.Current.Dispatcher.BeginInvoke(() =>
        {
            IsProcessing = false;
            CanCancel = false;
            IsStep1Active = false;
            IsStep2Active = false;
            IsStep3Active = false;
            ProgressPercentage = job.OverallProgress;
            SuccessCount = job.SuccessCount;
            ErrorCount = job.ErrorCount;
            PagesProcessed = job.PagesProcessed;
            TotalPages = job.TotalPages;
            PagesFailed = job.PagesFailed;
            GroupsCreated = job.GroupsCreated;
            PipelineStatusMessage = job.PipelineStatusMessage;
            ElapsedTime = job.ElapsedTime;

            switch (job.CurrentStep)
            {
                case JobStep.Completed:
                    StatusText = job.ResultSummary ?? "Concluído";
                    CanDownload = !string.IsNullOrEmpty(job.ZipPath) && File.Exists(job.ZipPath);
                    break;
                case JobStep.Cancelled:
                    StatusText = "Cancelado";
                    break;
                case JobStep.Failed:
                    StatusText = $"Erro: {job.ErrorMessage}";
                    break;
            }

            FlushLogBufferNow();
        }, DispatcherPriority.Normal);
    }

    [RelayCommand(CanExecute = nameof(CanStartJob))]
    private void StartJob()
    {
        if (string.IsNullOrWhiteSpace(InputFilePath))
        {
            _logService.Warning("[INICIAR] Selecione o PDF");
            MessageBox.Show("Selecione o arquivo PDF.", "Atenção", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (!File.Exists(InputFilePath))
        {
            MessageBox.Show("Arquivo PDF não encontrado.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        ResetState();
        CanDownload = false;
        _logService.Info($"[INICIAR] === INÍCIO [{Path.GetFileName(InputFilePath)}] ===", InputFilePath);
        _jobManager.StartJob(InputFilePath);
        IsProcessing = true;
        StatusText = "Iniciando...";
    }

    private bool CanStartJob() => !IsProcessing && !string.IsNullOrWhiteSpace(InputFilePath);

    [RelayCommand]
    private void CancelJob()
    {
        _logService.Warning("[CANCELAR] Cancelando job...", InputFilePath);
        _jobManager.CancelJob();
        StatusText = "Cancelando...";
        CanCancel = false;
    }

    [RelayCommand]
    private void DownloadZip()
    {
        var job = _jobManager.CurrentJob;
        if (job?.ZipPath == null || !File.Exists(job.ZipPath))
        {
            MessageBox.Show("Arquivo ZIP não encontrado.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Salvar arquivo ZIP",
            Filter = "Arquivos ZIP (*.zip)|*.zip",
            FileName = $"documentos_separados_{DateTime.Now:yyyyMMdd_HHmmss}.zip"
        };

        if (dialog.ShowDialog() == true)
        {
            try
            {
                File.Copy(job.ZipPath, dialog.FileName, true);
                _logService.Info($"[DOWNLOAD] ZIP salvo: {dialog.FileName}");
                MessageBox.Show($"Arquivo salvo em:\n{dialog.FileName}", "Sucesso", MessageBoxButton.OK, MessageBoxImage.Information);

                CleanupTempFolder(job);
            }
            catch (Exception ex)
            {
                _logService.Error(ex, "[DOWNLOAD] Erro ao salvar ZIP");
                MessageBox.Show($"Erro ao salvar: {ex.Message}", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }

    [RelayCommand]
    private void BrowseInputFile()
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Selecione o arquivo PDF",
            Filter = "Arquivos PDF (*.pdf)|*.pdf",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog() == true)
        {
            _logService.Info($"[BROWSE] PDF: {dialog.FileName}", dialog.FileName);
            InputFilePath = dialog.FileName;
            Step1Status = "Aguardando início...";
            Step2Status = "";
            Step3Status = "";
            ResetProgress();
        }
    }

    [RelayCommand]
    private async Task ExportLogsAsync()
    {
        try
        {
            var path = Path.Combine(Path.GetTempPath(), "SeparadorDePdf");
            Directory.CreateDirectory(path);
            var savePath = Path.Combine(path, $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
            await File.WriteAllLinesAsync(savePath, Logs.Select(l => $"{l.Timestamp:HH:mm:ss};{l.Level};{l.Message}"));
            _logService.Info($"Logs exportados para: {savePath}");
            MessageBox.Show($"Logs exportados para:\n{savePath}", "Exportação", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "Erro ao exportar logs");
        }
    }

    [RelayCommand]
    private void ClearHistory()
    {
        Logs.Clear();
        _logService.Info("Logs limpos.");
    }

    private void OnLogAdded(object? sender, LogEntry entry)
    {
        lock (_logBufferLock)
        {
            _logBuffer.Add(entry);
            _logBufferDirty = true;
        }
    }

    private void FlushLogBuffer(object? sender, EventArgs e)
    {
        FlushLogBufferNow();
    }

    private void FlushLogBufferNow()
    {
        LogEntry[] entries;
        lock (_logBufferLock)
        {
            if (!_logBufferDirty || _logBuffer.Count == 0)
                return;
            entries = _logBuffer.ToArray();
            _logBuffer.Clear();
            _logBufferDirty = false;
        }

        Application.Current.Dispatcher.BeginInvoke(() =>
        {
            foreach (var entry in entries)
                Logs.Add(entry);
            while (Logs.Count > 5000)
                Logs.RemoveAt(0);
        }, DispatcherPriority.Background);
    }

    private void ResetState()
    {
        ProgressPercentage = 0;
        SuccessCount = 0;
        ErrorCount = 0;
        GroupsCreated = 0;
        EstimatedTimeRemaining = "";
        ElapsedTime = "";
        Step1Status = "Iniciando...";
        Step2Status = "";
        Step3Status = "";
        IsStep1Active = true;
        IsStep2Active = false;
        IsStep3Active = false;
        ResetProgress();
    }

    private void ResetProgress()
    {
        PagesProcessed = 0;
        TotalPages = 0;
        PagesFailed = 0;
        PipelineStatusMessage = "";
    }

    private void CleanupTempFolder(JobInfo job)
    {
        try
        {
            if (Directory.Exists(job.TempFolder))
                Directory.Delete(job.TempFolder, true);
        }
        catch { /* best effort cleanup */ }
    }

    partial void OnInputFilePathChanged(string value) => StartJobCommand.NotifyCanExecuteChanged();
    partial void OnIsProcessingChanged(bool value) => StartJobCommand.NotifyCanExecuteChanged();

    public void Dispose()
    {
        _logFlushTimer.Stop();
        _logFlushTimer.Tick -= FlushLogBuffer;
        _uiKeepAliveTimer.Stop();
        _spinnerTimer.Stop();
        _spinnerTimer.Dispose();
        _jobManager.ProgressChanged -= OnJobProgress;
        _jobManager.JobCompleted -= OnJobCompleted;
        _logService.LogAdded -= OnLogAdded;
        _jobManager.Dispose();
    }
}
