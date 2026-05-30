using System;

namespace SeparadorDePdf.Utils;

public static class RetryPolicy
{
    public static async Task<T> ExecuteAsync<T>(Func<Task<T>> action, int maxRetries = 3, int baseDelayMs = 1000, CancellationToken cancellationToken = default)
    {
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                return await action();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception) when (attempt < maxRetries)
            {
                var delay = baseDelayMs * (int)Math.Pow(2, attempt);
                await Task.Delay(delay, cancellationToken);
            }
        }

        throw new InvalidOperationException("Retry policy exhausted");
    }

    public static async Task ExecuteAsync(Func<Task> action, int maxRetries = 3, int baseDelayMs = 1000, CancellationToken cancellationToken = default)
    {
        await ExecuteAsync(async () =>
        {
            await action();
            return true;
        }, maxRetries, baseDelayMs, cancellationToken);
    }
}
