using System;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Classifiers;

public class OnnxDocumentClassifier : IDocumentClassifier, IDisposable
{
    private InferenceSession? _session;
    private readonly string? _modelPath;
    private bool _disposed;

    public bool SupportsOnnx => true;

    public OnnxDocumentClassifier(string? modelPath = null)
    {
        _modelPath = modelPath;
        if (!string.IsNullOrEmpty(modelPath) && System.IO.File.Exists(modelPath))
            LoadModel(modelPath);
    }

    public Task<ClassificationResult> ClassifyAsync(string ocrText, CancellationToken cancellationToken = default)
    {
        if (_session is null)
            return Task.FromResult(new ClassificationResult
            {
                Type = DocumentType.Desconhecido,
                Confidence = 0,
                Method = ClassificationMethod.Onnx
            });

        try
        {
            var tokens = Tokenize(ocrText);
            var inputTensor = new DenseTensor<float>(tokens, new[] { 1, tokens.Length });
            var inputs = new List<NamedOnnxValue>
            {
                NamedOnnxValue.CreateFromTensor("input", inputTensor)
            };

            using var results = _session.Run(inputs);
            var output = results.First().AsEnumerable<float>().ToArray();
            var maxIdx = Array.IndexOf(output, output.Max());
            var docType = (DocumentType)maxIdx;
            var confidence = output[maxIdx];

            return Task.FromResult(new ClassificationResult
            {
                Type = docType,
                Confidence = confidence,
                Method = ClassificationMethod.Onnx
            });
        }
        catch
        {
            return Task.FromResult(new ClassificationResult
            {
                Type = DocumentType.Desconhecido,
                Confidence = 0,
                Method = ClassificationMethod.Onnx
            });
        }
    }

    private void LoadModel(string path)
    {
        _session = new InferenceSession(path);
    }

    private static float[] Tokenize(string text)
    {
        var result = new float[512];
        for (var i = 0; i < Math.Min(text.Length, 512); i++)
            result[i] = text[i] / 255f;
        return result;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _session?.Dispose();
            _disposed = true;
        }
    }
}
