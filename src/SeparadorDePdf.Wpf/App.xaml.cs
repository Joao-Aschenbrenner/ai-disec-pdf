using System;
using System.IO;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Classifiers;
using SeparadorDePdf.Extractors;
using SeparadorDePdf.ImageProcessing;
using SeparadorDePdf.Ocr;
using SeparadorDePdf.Services;
using SeparadorDePdf.Utils;

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

        var historyRepo = _serviceProvider.GetRequiredService<IProcessingHistoryRepository>();
        await historyRepo.InitializeAsync();

        var mainWindow = new Views.MainView
        {
            DataContext = _serviceProvider.GetRequiredService<ViewModels.MainViewModel>()
        };
        mainWindow.Show();
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
        services.AddSingleton<IPdfProcessor, PdfProcessorService>();
        services.AddSingleton<IBatchProcessor, BatchProcessingService>();
        services.AddSingleton<IFolderWatcher, FolderWatcherService>();
        services.AddSingleton<ViewModels.MainViewModel>();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _serviceProvider?.Dispose();
        base.OnExit(e);
    }
}
