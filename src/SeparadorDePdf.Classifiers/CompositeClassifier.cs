using System;
using SeparadorDePdf.Core.Enums;
using SeparadorDePdf.Core.Interfaces;
using SeparadorDePdf.Core.Models;

namespace SeparadorDePdf.Classifiers;

public class CompositeClassifier : IDocumentClassifier
{
    private readonly RegexDocumentClassifier _regexClassifier;
    private readonly OnnxDocumentClassifier? _onnxClassifier;

    public bool SupportsOnnx => _onnxClassifier is not null;

    public CompositeClassifier(RegexDocumentClassifier regexClassifier, OnnxDocumentClassifier? onnxClassifier = null)
    {
        _regexClassifier = regexClassifier;
        _onnxClassifier = onnxClassifier;
    }

    public async Task<ClassificationResult> ClassifyAsync(string ocrText, CancellationToken cancellationToken = default)
    {
        var regexResult = await _regexClassifier.ClassifyAsync(ocrText, cancellationToken);

        if (regexResult.IsConfident)
            return regexResult;

        if (_onnxClassifier is not null)
        {
            var onnxResult = await _onnxClassifier.ClassifyAsync(ocrText, cancellationToken);
            if (onnxResult.IsConfident && onnxResult.Confidence > regexResult.Confidence)
                return onnxResult;
        }

        return regexResult;
    }
}
