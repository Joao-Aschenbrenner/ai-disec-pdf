using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
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

    [ObservableProperty] private string _inputFilePath = string.Empty;
    [ObservableProperty] private string _outputFolder = string.Empty;
    [ObservableProperty] private bool _isProcessing;
    [ObservableProperty] private double _progressPercentage;
    [ObservableProperty] private int _successCount;
    [ObservableProperty] private int _errorCount;
    [ObservableProperty] private int _groupsCreated;
    [ObservableProperty] private string _currentFile = string.Empty;
    [ObservableProperty] private string _statusText = "Pronto";
    [ObservableProperty] private bool _canCancel;

    [ObservableProperty] private string _step1Status = "Aguardando PDF...";
    [ObservableProperty] private string _step2Status = "";
    [ObservableProperty] private string _step3Status = "";
    [ObservableProperty] private int _pagesProcessed;
    [ObservableProperty] private int _totalPages;
    [ObservableProperty] private int _pagesFailed;
    [ObservableProperty] private string _pipelineStatusMessage = "";
    [ObservableProperty] private string _estimatedTimeRemaining = "";
    [ObservableProperty] private string _elapsedTime = "";

    public ObservableCollection<LogEntry> Logs { get; } = new();

    public MainViewModel(JobManager jobManager, ILogService logService)
    {
        _jobManager = jobManager;
        _logService = logService;
        _logService.LogAdded += OnLogAdded;
        _jobManager.ProgressChanged += OnJobProgress;
        _jobManager.JobCompleted += OnJobCompleted;
    }

    private void OnJobProgress(object? sender, JobInfo job)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            IsProcessing = true;
            CanCancel = true;
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

            StatusText = job.CurrentStep switch
            {
                JobStep.PreProcessing => "Pré-processando...",
                JobStep.Processing => "Processando...",
                _ => StatusText
            };
        });
    }

    private void OnJobCompleted(object? sender, JobInfo job)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            IsProcessing = false;
            CanCancel = false;
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
                    break;
                case JobStep.Cancelled:
                    StatusText = "Cancelado";
                    break;
                case JobStep.Failed:
                    StatusText = $"Erro: {job.ErrorMessage}";
                    break;
            }
        });
    }

    [RelayCommand(CanExecute = nameof(CanStartJob))]
    private void StartJob()
    {
        if (string.IsNullOrWhiteSpace(InputFilePath) || string.IsNullOrWhiteSpace(OutputFolder))
        {
            _logService.Warning("[INICIAR] Selecione o PDF e a pasta de destino");
            MessageBox.Show("Selecione o arquivo PDF e a pasta de destino.", "Atenção", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (!File.Exists(InputFilePath))
        {
            MessageBox.Show("Arquivo PDF não encontrado.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        if (!Directory.Exists(OutputFolder))
        {
            MessageBox.Show("Pasta de destino não existe.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        ResetState();
        _logService.Info($"[INICIAR] === INÍCIO [{Path.GetFileName(InputFilePath)}] ===", InputFilePath);
        _jobManager.StartJob(InputFilePath, OutputFolder);
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
    private void BrowseOutputFolder()
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog { Title = "Selecione a pasta de destino" };
        if (dialog.ShowDialog() == true)
        {
            OutputFolder = dialog.FolderName;
        }
    }

    [RelayCommand]
    private async Task ExportLogsAsync()
    {
        try
        {
            var path = string.IsNullOrWhiteSpace(OutputFolder) ? AppContext.BaseDirectory : OutputFolder;
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
        Application.Current.Dispatcher.Invoke(() =>
        {
            Logs.Add(entry);
            if (Logs.Count > 5000) Logs.RemoveAt(0);
        });
    }

    private void ResetState()
    {
        ProgressPercentage = 0;
        SuccessCount = 0;
        ErrorCount = 0;
        GroupsCreated = 0;
        EstimatedTimeRemaining = "";
        ElapsedTime = "";
        Step1Status = "Validando...";
        Step2Status = "";
        Step3Status = "";
        ResetProgress();
    }

    private void ResetProgress()
    {
        PagesProcessed = 0;
        TotalPages = 0;
        PagesFailed = 0;
        PipelineStatusMessage = "";
    }

    partial void OnInputFilePathChanged(string value) => StartJobCommand.NotifyCanExecuteChanged();
    partial void OnIsProcessingChanged(bool value) => StartJobCommand.NotifyCanExecuteChanged();

    public void Dispose()
    {
        _jobManager.ProgressChanged -= OnJobProgress;
        _jobManager.JobCompleted -= OnJobCompleted;
        _logService.LogAdded -= OnLogAdded;
        _jobManager.Dispose();
    }
}
