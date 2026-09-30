/**
 * Cronômetro total do processamento — formatter puro.
 *
 * Baseado em Date.now() no chamador (não em elapsed += 1): minimização da
 * janela/throttling pode atrasar ticks, e o delta real entre timestamps não
 * sofre drift.
 *
 * Formato: abaixo de 1h → MM:SS (00:00, 01:00, 59:59); a partir de 1h →
 * HH:MM:SS (01:00:00, 02:15:42).
 */
export function formatProcessingElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${mm}:${ss}`
    : `${mm}:${ss}`;
}