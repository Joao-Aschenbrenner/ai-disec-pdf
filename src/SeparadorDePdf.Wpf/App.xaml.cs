using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.ImageProcessing;
using SeparadorDePdf.Ocr;
using SeparadorDePdf.Services;
using SeparadorDePdf.Utils;
using SeparadorDePdf.Wpf.Services;

namespace SeparadorDePdf.Wpf;

public partial class App : System.Windows.Application
{
    private ServiceProvider? _serviceProvider;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var services = new ServiceCollection();
        ConfigureServices(services);
        _serviceProvider = services.BuildServiceProvider();

        SetupGlobalExceptionHandling();

        var log = _serviceProvider.GetRequiredService<ILogService>();
        log.Info("Aplicacao iniciada");

        try
        {
            await _serviceProvider.GetRequiredService<IProcessingHistoryRepository>().InitializeAsync();
            log.Info("Banco de dados inicializado");
        }
        catch (Exception ex)
        {
            log.Error(ex, "Erro ao inicializar banco de dados");
        }

        var vm = _serviceProvider.GetRequiredService<ViewModels.MainViewModel>();
        log.Info("ViewModel criado");

        var mainWindow = new Views.MainView { DataContext = vm };
        MainWindow = mainWindow;
        mainWindow.Show();

        log.Info("Janela principal aberta");
    }

    private void SetupGlobalExceptionHandling()
    {
        DispatcherUnhandledException += (_, args) =>
        {
            var log = _serviceProvider?.GetService<ILogService>();
            log?.Error(args.Exception, "UI Thread");
            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            var log = _serviceProvider?.GetService<ILogService>();
            if (args.ExceptionObject is Exception ex)
                log?.Error(ex, "AppDomain");
        };

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            var log = _serviceProvider?.GetService<ILogService>();
            log?.Error(args.Exception, "Task");
            args.SetObserved();
        };
    }

    private static void ConfigureServices(IServiceCollection services)
    {
        services.AddSingleton<ILogService, LogService>();
        services.AddSingleton<IImageProcessor, ImageProcessor>();
        services.AddSingleton<IOcrEngine, TesseractOcrEngine>();
        services.AddSingleton<IClassificationCache, OcrCache>();
        services.AddSingleton<RegexDocumentClassifier, RegexDocumentClassifier>();
        services.AddSingleton<IDocumentClassifier, CompositeClassifier>();
        services.AddSingleton<IDataExtractor, RegexDataExtractor>();
        services.AddSingleton<IPdfRenderer, PdfRendererService>();
        services.AddSingleton<IFileOrganizer, FileOrganizerService>();
        services.AddSingleton<IProcessingHistoryRepository, ProcessingHistoryRepository>();
        services.AddSingleton<IPdfProcessor, PythonPdfProcessor>();
        services.AddSingleton<IBatchProcessor, BatchProcessingService>();
        services.AddSingleton<IFolderWatcher, FolderWatcherService>();
        services.AddSingleton<IGroupDetector, GroupDetector>();
        services.AddSingleton<IConsolidatedDocumentDetector, ConsolidatedDocumentDetector>();
        services.AddSingleton<Services.PagePipeline>();
        services.AddSingleton<JobManager>();
        services.AddSingleton<ViewModels.MainViewModel>();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _serviceProvider?.Dispose();
        base.OnExit(e);
    }
}