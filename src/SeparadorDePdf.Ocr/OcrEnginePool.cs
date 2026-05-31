using System;
using System.Collections.Concurrent;
using Tesseract;

namespace SeparadorDePdf.Ocr;

public sealed class OcrEnginePool : IDisposable
{
    private readonly ConcurrentBag<TesseractEngine> _pool = new();
    private readonly string _tessDataPath;
    private readonly string _language;
    private readonly int _maxPoolSize;
    private bool _disposed;

    public OcrEnginePool(string tessDataPath, string language = "por+eng", int maxPoolSize = 16)
    {
        _tessDataPath = tessDataPath;
        _language = language;
        _maxPoolSize = maxPoolSize;
    }

    public PooledEngine Rent()
    {
        if (_disposed)
            throw new ObjectDisposedException(nameof(OcrEnginePool));

        if (!_pool.TryTake(out var engine))
            engine = new TesseractEngine(_tessDataPath, _language, EngineMode.Default);

        return new PooledEngine(engine, this);
    }

    internal void Return(TesseractEngine engine)
    {
        if (!_disposed && _pool.Count < _maxPoolSize)
            _pool.Add(engine);
        else
            engine.Dispose();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        while (_pool.TryTake(out var engine))
            engine.Dispose();
    }
}

public sealed class PooledEngine : IDisposable
{
    public TesseractEngine Engine { get; }

    private readonly OcrEnginePool _pool;
    private bool _disposed;

    internal PooledEngine(TesseractEngine engine, OcrEnginePool pool)
    {
        Engine = engine;
        _pool = pool;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pool.Return(Engine);
    }
}
