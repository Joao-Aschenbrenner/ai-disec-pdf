import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { formatProcessingElapsed } from "../src/utils/processingTimer";

describe("formatProcessingElapsed (cronômetro do processamento)", () => {
  // Seção 17 do LOCAL_AUDIT: MM:SS
  it.each([
    [0, "00:00"],
    [1000, "00:01"],
    [59_000, "00:59"],
    [60_000, "01:00"],
    [3_599_000, "59:59"],
  ])("MM:SS: %i ms → %s", (ms, expected) => {
    expect(formatProcessingElapsed(ms)).toBe(expected);
  });

  // Seção 18: HH:MM:SS
  it.each([
    [3_600_000, "01:00:00"],
    [3_661_000, "01:01:01"],
    [7_200_000, "02:00:00"],
    [8_142_000, "02:15:42"],
  ])("HH:MM:SS: %i ms → %s", (ms, expected) => {
    expect(formatProcessingElapsed(ms)).toBe(expected);
  });

  it("valores negativos são clampeados a 00:00", () => {
    expect(formatProcessingElapsed(-5000)).toBe("00:00");
  });
});

describe("Timer baseado em Date.now() (contract do wiring)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("acumula através de pausa/restart sem drift (Date.now não tick counting)", () => {
    const nowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000_000)   // start
      .mockReturnValueOnce(1_002_000)   // stop (2s ativo)
      .mockReturnValueOnce(3_000_000)   // resume (depois de qualquer intervalo)
      .mockReturnValueOnce(3_005_000);  // stop (5s ativo)

    const accumulatedRef = { current: 0 };
    let startedAt: number | null = null;

    const start = () => {
      if (startedAt === null) startedAt = Date.now();
    };
    const stop = () => {
      if (startedAt !== null) {
        accumulatedRef.current += Date.now() - startedAt;
        startedAt = null;
      }
    };

    start();
    stop();
    start();
    stop();

    // Pausa de 29 Minutos entre runs NÃO entra no acumulado.
    expect(accumulatedRef.current).toBe(7_000);
  });
});