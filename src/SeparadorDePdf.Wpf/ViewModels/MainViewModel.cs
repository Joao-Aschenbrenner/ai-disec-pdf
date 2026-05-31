using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;
using SeparadorDePdf.Utils;

namespace SeparadorDePdf.Wpf.ViewModels;

public partial class MainViewModel : ObservableObject, IDisposable
{
    private readonly IPdfProcessor _pdfProcessor;
    private readonly ILogService _logService;
    private readonly IProcessingHistoryRepository _historyRepository;
    private CancellationTokenSource? _cts;

    [ObservableProperty]
    private string _inputFilePath = string.Empty;

    [ObservableProperty]
    private string _outputFolder = string.Empty;

    [ObservableProperty]
    private bool _isProcessing;

    [ObservableProperty]
    private double _progressPercentage;

    [ObservableProperty]
    private int _successCount;

    [ObservableProperty]
    private int _errorCount;

    [ObservableProperty]
    private string _currentFile = string.Empty;

    [ObservableProperty]
    private string _statusText = "Pronto";

    public ObservableCollection<LogEntry> Logs { get; } = new();

    public MainViewModel(
        IPdfProcessor pdfProcessor,
        ILogService logService,
        IProcessingHistoryRepository historyRepository)
    {
        _pdfProcessor = pdfProcessor;
        _logService = logService;
        _historyRepository = historyRepository;

        _logService.LogAdded += OnLogAdded;
    }

    private bool CanStartProcessing() => !IsProcessing;

    [RelayCommand(CanExecute = nameof(CanStartProcessing))]
    private async Task StartProcessingAsync()
    {
        if (string.IsNullOrWhiteSpace(InputFilePath) || string.IsNullOrWhiteSpace(OutputFolder))
        {
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

        IsProcessing = true;
        StatusText = "Processando...";
        _cts = new CancellationTokenSource();
        ResetCounters();
        ProgressPercentage = 0;
        SuccessCount = 0;
        ErrorCount = 0;
        CurrentFile = Path.GetFileName(InputFilePath);

        var progress = new Progress<double>(value =>
        {
            Application.Current.Dispatcher.Invoke(() => ProgressPercentage = value);
        });

        try
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew();

            var result = await _pdfProcessor.ProcessAsync(InputFilePath, OutputFolder, _cts.Token, progress);

            stopwatch.Stop();

            ProgressPercentage = 100;

            if (result.Status == ProcessingStatus.Completed)
            {
                SuccessCount = 1;
                StatusText = $"Concluído com sucesso em {stopwatch.Elapsed:mm\\:ss}";
            }
            else if (result.Status == ProcessingStatus.Error)
            {
                ErrorCount = 1;
                StatusText = $"Erro: {result.ErrorMessage}";
                MessageBox.Show($"Erro ao processar:\n{result.ErrorMessage}", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            else
            {
                StatusText = "Arquivo ignorado (já processado anteriormente)";
            }
        }
        catch (OperationCanceledException)
        {
            _logService.Warning("Processamento cancelado pelo usuário.");
            StatusText = "Processamento cancelado.";
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "Erro durante processamento");
            StatusText = $"Erro: {ex.Message}";
            ErrorCount = 1;
            MessageBox.Show($"Erro durante processamento:\n{ex.Message}", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            IsProcessing = false;
            _cts?.Dispose();
            _cts = null;
        }
    }

    [RelayCommand(CanExecute = nameof(IsProcessing))]
    private void StopProcessing()
    {
        _cts?.Cancel();
        StatusText = "Cancelando...";
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
            InputFilePath = dialog.FileName;
    }

    [RelayCommand]
    private void BrowseOutputFolder()
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Selecione a pasta de destino"
        };
        if (dialog.ShowDialog() == true)
            OutputFolder = dialog.FolderName;
    }

    [RelayCommand]
    private async Task ExportLogsAsync()
    {
        try
        {
            var savePath = Path.Combine(OutputFolder, $"logs_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
            await _historyRepository.ExportToCsvAsync(savePath);
            _logService.Info($"Logs exportados para: {savePath}");
            MessageBox.Show($"Logs exportados para:\n{savePath}", "Exportação", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "Erro ao exportar logs");
            MessageBox.Show($"Erro ao exportar logs:\n{ex.Message}", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    [RelayCommand]
    private async Task ClearHistoryAsync()
    {
        var result = MessageBox.Show("Deseja limpar todo o histórico?", "Confirmar", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result == MessageBoxResult.Yes)
        {
            await _historyRepository.ClearAsync();
            _logService.Info("Histórico limpo.");
        }
    }

    private void OnLogAdded(object? sender, LogEntry entry)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            Logs.Add(entry);
            if (Logs.Count > 5000) Logs.RemoveAt(0);
        });
    }

    private void ResetCounters()
    {
        SuccessCount = 0;
        ErrorCount = 0;
        ProgressPercentage = 0;
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _logService.LogAdded -= OnLogAdded;
    }
}
