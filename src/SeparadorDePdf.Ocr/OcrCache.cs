using System;
using System.Collections.Concurrent;
using System.Linq;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Ocr;

public class OcrCache : IClassificationCache
{
    private readonly ConcurrentDictionary<string, OcrResult> _cache = new();
    private const int MaxCacheSize = 500;

    public Task<OcrResult?> GetAsync(string fileHash)
    {
        _cache.TryGetValue(fileHash, out var result);
        return Task.FromResult(result);
    }

    public Task SetAsync(string fileHash, OcrResult result)
    {
        if (_cache.Count >= MaxCacheSize && !_cache.ContainsKey(fileHash))
        {
            var oldestKey = _cache.Keys.FirstOrDefault() ?? fileHash;
            _cache.TryRemove(oldestKey, out _);
        }

        _cache[fileHash] = result;
        return Task.CompletedTask;
    }

    public Task<bool> ContainsAsync(string fileHash)
    {
        return Task.FromResult(_cache.ContainsKey(fileHash));
    }

    public Task ClearAsync()
    {
        _cache.Clear();
        return Task.CompletedTask;
    }
}
