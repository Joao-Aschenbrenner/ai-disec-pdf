import { describe, expect, it, vi } from "vitest";
import { runAutoRetryCycles } from "../src/utils/autoRetry";

describe("automatic retry cycles", () => {
  it("stops after one cycle recovers zero pages", async () => {
    const retryPage = vi.fn(async () => false);
    const beforeCycle = vi.fn();
    const onFinish = vi.fn();

    const cycles = await runAutoRetryCycles({
      maxCycles: 5,
      getFailedPages: () => ["page-1"],
      canStartPage: () => true,
      beforeCycle,
      retryPage,
      onFinish,
    });

    expect(cycles).toBe(1);
    expect(beforeCycle).toHaveBeenCalledTimes(1);
    expect(retryPage).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("continues when the prior cycle recovers a page", async () => {
    const stillFailed = new Set(["a", "b", "c"]);
    const attempts = new Map<string, number>();
    const cycles: Array<{ cycle: number; failedCount: number }> = [];

    const executed = await runAutoRetryCycles({
      maxCycles: 5,
      getFailedPages: () => [...stillFailed],
      canStartPage: () => true,
      beforeCycle: (cycle, failedCount) => {
        cycles.push({ cycle, failedCount });
      },
      retryPage: async page => {
        const attempt = (attempts.get(page) || 0) + 1;
        attempts.set(page, attempt);
        if (page === "a" && attempt === 1) {
          stillFailed.delete(page);
          return true;
        }
        return false;
      },
    });

    expect(executed).toBe(2);
    expect(cycles).toEqual([
      { cycle: 1, failedCount: 3 },
      { cycle: 2, failedCount: 2 },
    ]);
    expect(attempts.get("a")).toBe(1);
    expect(attempts.get("b")).toBe(2);
    expect(attempts.get("c")).toBe(2);
  });
});
