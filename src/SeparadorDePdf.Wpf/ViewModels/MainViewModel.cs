using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
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
    private readonly IDocumentClassifier _classifier;
    private readonly IDataExtractor _extractor;
    private readonly IFileOrganizer _fileOrganizer;
    private readonly IProcessingHistoryRepository _historyRepository;
    private readonly ILogService _logService;
    private readonly HttpClient _http;

    private CancellationTokenSource? _cts;
    private string? _fileHash;
    private string? _ocrJobId;
    private OcrApiResult? _ocrResult;

    private const string ApiBase = "http://localhost:8000";

    [ObservableProperty] private string _inputFilePath = string.Empty;
    [ObservableProperty] private string _outputFolder = string.Empty;
    [ObservableProperty] private bool _isProcessing;
    [ObservableProperty] private double _progressPercentage;
    [ObservableProperty] private int _successCount;
    [ObservableProperty] private int _errorCount;
    [ObservableProperty] private string _currentFile = string.Empty;
    [ObservableProperty] private string _statusText = "Pronto";

    [ObservableProperty] private string _step1Status = "Aguardando PDF...";
    [ObservableProperty] private string _step2Status = "Aguardando pre-processamento...";
    [ObservableProperty] private string _step3Status = "Aguardando OCR...";

    [ObservableProperty] private bool _canPreProcess = true;
    [ObservableProperty] private bool _canRunOcr;
    [ObservableProperty] private bool _canSeparate;

    public ObservableCollection<LogEntry> Logs { get; } = new();

    public MainViewModel(
        IDocumentClassifier classifier,
        IDataExtractor extractor,
        IFileOrganizer fileOrganizer,
        IProcessingHistoryRepository historyRepository,
        ILogService logService)
    {
        _classifier = classifier;
        _extractor = extractor;
        _fileOrganizer = fileOrganizer;
        _historyRepository = historyRepository;
        _logService = logService;
        _http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        _logService.LogAdded += OnLogAdded;
    }

    [RelayCommand(CanExecute = nameof(CanStartPreProcess))]
    private async Task PreProcessAsync()
    {
        var sw = Stopwatch.StartNew();
        IsProcessing = true;
        _cts = new CancellationTokenSource();
        bool success = false;
        ResetCounters();
        StatusText = "Pre-processando...";
        Step1Status = "Iniciando validacao...";
        CanPreProcess = false;
        CanRunOcr = false;
        CanSeparate = false;
        _ocrResult = null;
        _fileHash = null;

        _logService.Info($"[PRE-PROCESSAR] === INICIO [{Path.GetFileName(InputFilePath)}] ===", InputFilePath);

        try
        {
            if (string.IsNullOrWhiteSpace(InputFilePath) || string.IsNullOrWhiteSpace(OutputFolder))
            {
                _logService.Warning("[PRE-PROCESSAR] Arquivo ou pasta nao selecionados", InputFilePath);
                MessageBox.Show("Selecione o arquivo PDF e a pasta de destino.", "Atencao", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            if (!File.Exists(InputFilePath))
            {
                _logService.Error("[PRE-PROCESSAR] Arquivo nao encontrado", InputFilePath);
                MessageBox.Show("Arquivo PDF nao encontrado.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            if (!Directory.Exists(OutputFolder))
            {
                _logService.Error($"[PRE-PROCESSAR] Pasta nao existe: {OutputFolder}", InputFilePath);
                MessageBox.Show("Pasta de destino nao existe.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }

            ProgressPercentage = 5;
            var fileName = Path.GetFileName(InputFilePath);
            CurrentFile = fileName;

            _logService.Info("[PRE-PROCESSAR] Calculando hash...", InputFilePath);
            Step1Status = "Calculando hash...";
            using var fs = new FileStream(InputFilePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);

            _fileHash = await HashHelper.ComputeFileHashAsync(InputFilePath, _cts.Token);
            Step1Status = $"Hash: {_fileHash[..12]}...";
            ProgressPercentage = 15;
            _logService.Info($"[PRE-PROCESSAR] Hash calculado: {_fileHash[..12]}...", InputFilePath);

            _logService.Info("[PRE-PROCESSAR] Verificando historico...", InputFilePath);
            Step1Status = "Verificando historico...";
            var existing = await _historyRepository.GetByHashAsync(_fileHash);

            if (existing is not null && existing.Status == ProcessingStatus.Completed)
            {
                _logService.Info("[PRE-PROCESSAR] Arquivo ja processado anteriormente", InputFilePath);
                Step1Status = $"Processado: {existing.DocumentType}";
                StatusText = "Arquivo ja processado";
                MessageBox.Show($"Este arquivo ja foi processado em {existing.ProcessedAt:yyyy-MM-dd} como {existing.DocumentType}.", "Informacao", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var fileInfo = new FileInfo(InputFilePath);
            var sizeMB = fileInfo.Length / (1024.0 * 1024.0);
            Step1Status = $"Pronto: {fileName} ({sizeMB:F1} MB)";
            ProgressPercentage = 20;

            CanRunOcr = true;
            StatusText = "Pre-processamento concluido";
            success = true;
        }
        catch (OperationCanceledException)
        {
            _logService.Warning("[PRE-PROCESSAR] Cancelado pelo usuario", InputFilePath);
            Step1Status = "Cancelado";
            StatusText = "Cancelado";
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "[PRE-PROCESSAR] Erro durante o pre-processamento");
            Step1Status = $"Erro: {ex.Message}";
            StatusText = $"Erro: {ex.Message}";
            ErrorCount = 1;
            MessageBox.Show($"Erro durante pre-processamento:\n{ex.Message}", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            IsProcessing = false;
            CanPreProcess = true;
            sw.Stop();
            _logService.Info($"[PRE-PROCESSAR] === FIM [Tempo: {sw.ElapsedMilliseconds}ms, Sucesso: {success}] ===", InputFilePath);
        }
    }

    private bool CanStartPreProcess() => !IsProcessing && !string.IsNullOrWhiteSpace(InputFilePath) && !string.IsNullOrWhiteSpace(OutputFolder);

    [RelayCommand]
    private async Task RunOcrAsync()
    {
        if (string.IsNullOrWhiteSpace(InputFilePath) || string.IsNullOrWhiteSpace(_fileHash))
        {
            MessageBox.Show("Execute o pre-processamento primeiro.", "Atencao", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        IsProcessing = true;
        _cts = new CancellationTokenSource();
        ResetCounters();
        StatusText = "Enviando para Docker OCR...";
        Step2Status = "Enviando PDF...";
        CanRunOcr = false;
        var swTotal = Stopwatch.StartNew();

        try
        {
            ProgressPercentage = 25;
            _logService.Info("[OCR] === INICIO DO OCR ===", InputFilePath);
            _logService.Info($"[OCR] Arquivo: {Path.GetFileName(InputFilePath)}", InputFilePath);
            _logService.Info("[OCR] Lendo arquivo em memoria...", InputFilePath);

            // Upload
            using var content = new MultipartFormDataContent();
            var fileBytes = await File.ReadAllBytesAsync(InputFilePath, _cts.Token);
            var sizeMB = fileBytes.Length / 1024.0 / 1024.0;
            _logService.Info($"[OCR] Arquivo lido: {sizeMB:F1} MB ({fileBytes.Length:N0} bytes)", InputFilePath);
            var fileContent = new ByteArrayContent(fileBytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            content.Add(fileContent, "file", Path.GetFileName(InputFilePath));

            _logService.Info($"[OCR] Enviando para {ApiBase}/ocr ...", InputFilePath);
            var swUpload = Stopwatch.StartNew();
            var response = await _http.PostAsync($"{ApiBase}/ocr?dpi=300&languages=por+eng", content, _cts.Token);
            response.EnsureSuccessStatusCode();
            swUpload.Stop();
            _logService.Info($"[OCR] Upload concluido em {swUpload.ElapsedMilliseconds}ms", InputFilePath);

            var json = await response.Content.ReadAsStringAsync(_cts.Token);
            var uploadResult = JsonSerializer.Deserialize<UploadResponse>(json);
            _ocrJobId = uploadResult?.JobId ?? throw new InvalidOperationException("No job_id in response");

            Step2Status = $"Job: {_ocrJobId} - Processando...";
            ProgressPercentage = 30;
            _logService.Info($"[OCR] Job ID: {_ocrJobId} - aguardando resultado...", InputFilePath);

            // Poll with dynamic progress
            var startTime = Stopwatch.StartNew();
            const int maxWaitMs = 60 * 60 * 1000;
            const double ocrStartPct = 30;
            const double ocrEndPct = 73;
            const double estimatedOcrSeconds = 120;
            var lastLogPageCount = 0;

            while (startTime.ElapsedMilliseconds < maxWaitMs)
            {
                _cts.Token.ThrowIfCancellationRequested();

                var pollResponse = await _http.GetAsync($"{ApiBase}/ocr/{_ocrJobId}", _cts.Token);
                pollResponse.EnsureSuccessStatusCode();

                var pollJson = await pollResponse.Content.ReadAsStringAsync(_cts.Token);
                var result = JsonSerializer.Deserialize<OcrApiResult>(pollJson);

                if (result is null)
                    throw new InvalidOperationException("Resposta invalida da API OCR");

                if (result.Status == "done")
                {
                    _ocrResult = result;
                    swTotal.Stop();
                    Step2Status = $"Concluido: {result.PageCount} pags, {result.TotalChars} chars, {result.AvgConfidence:F0}% conf";
                    ProgressPercentage = 75;
                    _logService.Info($"[OCR] === OCR CONCLUIDO ===", InputFilePath);
                    _logService.Info($"[OCR] Paginas: {result.PageCount}", InputFilePath);
                    _logService.Info($"[OCR] Total caracteres: {result.TotalChars:N0}", InputFilePath);
                    _logService.Info($"[OCR] Confianca media: {result.AvgConfidence:F1}%", InputFilePath);
                    _logService.Info($"[OCR] Tempo renderizacao: {result.RenderTimeMs}ms", InputFilePath);
                    _logService.Info($"[OCR] Tempo OCR: {result.OcrTimeMs}ms", InputFilePath);
                    _logService.Info($"[OCR] Tempo total API: {result.TotalTimeMs}ms", InputFilePath);
                    _logService.Info($"[OCR] Tempo total local: {swTotal.ElapsedMilliseconds}ms", InputFilePath);

                    CanSeparate = true;
                    StatusText = "OCR concluido";
                    break;
                }

                if (result.Status == "error")
                {
                    swTotal.Stop();
                    _logService.Error($"[OCR] API retornou erro: {result.Error}", InputFilePath);
                    throw new InvalidOperationException($"Erro na API OCR: {result.Error}");
                }

                // Estimate progress
                var elapsed = startTime.Elapsed.TotalSeconds;
                var t = Math.Min(1.0, elapsed / estimatedOcrSeconds);
                var curve = t < 0.5 ? 2 * t * t : 1 - Math.Pow(-2 * t + 2, 2) / 2;
                ProgressPercentage = ocrStartPct + curve * (ocrEndPct - ocrStartPct);

                var pageText = result.PageCount > 0 ? $"{result.PageCount} pags" : "iniciando...";
                Step2Status = $"Processando... {pageText} ({elapsed:F0}s)";

                if (result.PageCount > 0 && result.PageCount != lastLogPageCount)
                {
                    _logService.Info($"[OCR] Progresso: {result.PageCount} paginas processadas ({elapsed:F0}s)", InputFilePath);
                    lastLogPageCount = result.PageCount;
                }

                await Task.Delay(1500, _cts.Token);
            }
        }
        catch (OperationCanceledException)
        {
            _logService.Warning("[OCR] Cancelado pelo usuario", InputFilePath);
            Step2Status = "Cancelado";
            StatusText = "Cancelado";
        }
        catch (Exception ex)
        {
            swTotal.Stop();
            _logService.Error($"[OCR] Erro: {ex.Message} (tempo: {swTotal.ElapsedMilliseconds}ms)", InputFilePath);
            Step2Status = $"Erro: {ex.Message}";
            StatusText = $"Erro: {ex.Message}";
            ErrorCount = 1;
            CanRunOcr = true;
        }
        finally
        {
            IsProcessing = false;
            CanRunOcr = _ocrResult is null;
        }
    }

    [RelayCommand]
    private async Task SeparateAsync()
    {
        if (_ocrResult is null || string.IsNullOrWhiteSpace(_fileHash) || string.IsNullOrWhiteSpace(OutputFolder))
        {
            MessageBox.Show("Execute o OCR primeiro.", "Atencao", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (!Directory.Exists(OutputFolder))
        {
            MessageBox.Show("Pasta de destino nao existe.", "Erro", MessageBoxButton.OK, MessageBoxImage.Error);
            return;
        }

        IsProcessing = true;
        _cts = new CancellationTokenSource();
        ResetCounters();
        StatusText = "Classificando e separando...";
        Step3Status = "Classificando documento...";
        CanSeparate = false;

        try
        {
            var fileName = Path.GetFileName(InputFilePath);
            var swSep = Stopwatch.StartNew();
            ProgressPercentage = 80;
            _logService.Info("[SEPARAR] === INICIO DA SEPARACAO ===", InputFilePath);

            var ocrText = _ocrResult.TotalText ?? string.Empty;

            if (string.IsNullOrWhiteSpace(ocrText))
            {
                _logService.Warning("[SEPARAR] OCR retornou texto vazio", InputFilePath);
                Step3Status = "OCR retornou texto vazio";
                StatusText = "Erro: texto OCR vazio";
                var failDoc = new DocumentInfo
                {
                    FilePath = InputFilePath, FileName = fileName, Type = DocumentType.Desconhecido,
                    OcrText = string.Empty, FileHash = _fileHash,
                    PageCount = _ocrResult.PageCount
                };
                await _fileOrganizer.OrganizeAsync(failDoc, OutputFolder, _cts.Token);
                ErrorCount = 1;
                return;
            }

            _logService.Info($"[SEPARAR] Texto OCR: {ocrText.Length:N0} caracteres", InputFilePath);
            _logService.Info("[SEPARAR] Classificando documento...", InputFilePath);
            var classification = await _classifier.ClassifyAsync(ocrText, _cts.Token);
            Step3Status = $"Tipo: {classification.Type} (conf: {classification.Confidence:P0})";
            ProgressPercentage = 85;
            _logService.Info($"[SEPARAR] Classificacao: {classification.Type} (confianca: {classification.Confidence:P0}, metodo: {classification.Method})", InputFilePath);

            _logService.Info("[SEPARAR] Extraindo dados...", InputFilePath);
            var extractedData = _extractor.Extract(ocrText, classification.Type);
            _logService.Info($"[SEPARAR] Nota: {extractedData["NumeroNota"]}, CNPJ: {extractedData["CnpjEmitente"]}, CPF: {extractedData["Cpf"]}", InputFilePath);
            _logService.Info($"[SEPARAR] Nome: {extractedData["NomePessoa"]}, Chave: {extractedData["ChaveAcesso"]}", InputFilePath);

            var document = new DocumentInfo
            {
                FilePath = InputFilePath, FileName = fileName, Type = classification.Type,
                OcrText = ocrText,
                OcrConfidence = (float)_ocrResult.AvgConfidence,
                ClassificationMethod = classification.Method,
                ClassificationConfidence = classification.Confidence,
                NumeroNota = extractedData["NumeroNota"],
                CnpjEmitente = extractedData["CnpjEmitente"],
                Cpf = extractedData["Cpf"],
                NomePessoa = extractedData["NomePessoa"],
                NumeroImposto = extractedData["NumeroImposto"],
                ChaveAcesso = extractedData["ChaveAcesso"],
                FileHash = _fileHash,
                PageCount = _ocrResult.PageCount
            };

            _logService.Info($"[SEPARAR] Organizando arquivos em: {OutputFolder}", InputFilePath);
            await _fileOrganizer.OrganizeAsync(document, OutputFolder, _cts.Token);
            ProgressPercentage = 95;
            _logService.Info($"[SEPARAR] Arquivo movido: {document.NewFileName} -> {document.DestinationFolder}", InputFilePath);

            _logService.Info("[SEPARAR] Salvando historico...", InputFilePath);
            await _historyRepository.SaveAsync(new ProcessingHistoryEntry
            {
                FilePath = document.FilePath, FileName = document.FileName, FileHash = document.FileHash,
                DocumentType = document.Type, Status = ProcessingStatus.Completed,
                NewFileName = document.NewFileName, DestinationFolder = document.DestinationFolder,
                ProcessingTimeMs = swSep.Elapsed.TotalMilliseconds, ProcessedAt = DateTime.UtcNow
            });

            swSep.Stop();
            ProgressPercentage = 100;
            SuccessCount = 1;
            Step3Status = $"Movido: {document.NewFileName}";
            StatusText = $"Concluido: {document.Type}";
            _logService.Info($"[SEPARAR] === SEPARACAO CONCLUIDA em {swSep.ElapsedMilliseconds}ms ===", InputFilePath);
        }
        catch (OperationCanceledException)
        {
            Step3Status = "Cancelado";
            StatusText = "Cancelado";
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "Erro na separacao");
            Step3Status = $"Erro: {ex.Message}";
            StatusText = $"Erro: {ex.Message}";
            ErrorCount = 1;
        }
        finally
        {
            IsProcessing = false;
            CanSeparate = true;
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
            InputFilePath = dialog.FileName;
            Step1Status = "Aguardando pre-processamento...";
            Step2Status = "Aguardando pre-processamento...";
            Step3Status = "Aguardando OCR...";
            CanRunOcr = false;
            CanSeparate = false;
            _ocrResult = null;
            _fileHash = null;
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
            await _historyRepository.ExportToCsvAsync(savePath);
            _logService.Info($"Logs exportados para: {savePath}");
            MessageBox.Show($"Logs exportados para:\n{savePath}", "Exportacao", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            _logService.Error(ex, "Erro ao exportar logs");
        }
    }

    [RelayCommand]
    private async Task ClearHistoryAsync()
    {
        var result = MessageBox.Show("Deseja limpar todo o historico?", "Confirmar", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result == MessageBoxResult.Yes)
        {
            await _historyRepository.ClearAsync();
            _logService.Info("Historico limpo.");
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
        _http?.Dispose();
    }

    private class UploadResponse
    {
        [JsonPropertyName("job_id")] public string JobId { get; set; } = "";
        [JsonPropertyName("status")] public string Status { get; set; } = "";
    }

    private class OcrApiResult
    {
        [JsonPropertyName("job_id")] public string JobId { get; set; } = "";
        [JsonPropertyName("status")] public string Status { get; set; } = "";
        [JsonPropertyName("pdf_name")] public string PdfName { get; set; } = "";
        [JsonPropertyName("page_count")] public int PageCount { get; set; }
        [JsonPropertyName("total_text")] public string? TotalText { get; set; }
        [JsonPropertyName("total_chars")] public int TotalChars { get; set; }
        [JsonPropertyName("avg_confidence")] public double AvgConfidence { get; set; }
        [JsonPropertyName("render_time_ms")] public int RenderTimeMs { get; set; }
        [JsonPropertyName("ocr_time_ms")] public int OcrTimeMs { get; set; }
        [JsonPropertyName("total_time_ms")] public int TotalTimeMs { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
    }
}