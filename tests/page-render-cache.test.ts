import { describe, expect, it, vi } from "vitest";
import { PageRenderCache } from "../src/utils/pageRenderCache";

describe("page render cache", () => {
  it("renders a page once across retries and releases it after the page ends", async () => {
    const render = vi.fn(async () => "jpeg-data");
    const cache = new PageRenderCache(render);
    const page = { id: "page-1", base64: "pdf" };

    const first = cache.get(page, "fast");
    const retry = cache.get(page, "fast");
    const finalRetry = cache.get(page, "fast");

    expect(retry).toBe(first);
    expect(finalRetry).toBe(first);
    await expect(first).resolves.toBe("jpeg-data");
    expect(render).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);

    cache.clearForPage(page.id);
    expect(cache.size).toBe(0);
  });

  it("retains only the active pages and releases completed pages", async () => {
    const resolvers = new Map<string, (value: string) => void>();
    const render = vi.fn((page: { id: string; base64?: string }) => new Promise<string>(resolve => {
      resolvers.set(page.id, resolve);
    }));
    const cache = new PageRenderCache(render);
    const pages = Array.from({ length: 12 }, (_, i) => ({ id: `page-${i + 1}` }));
    let peakEntries = 0;

    for (let offset = 0; offset < pages.length; offset += 4) {
      const activePages = pages.slice(offset, offset + 4);
      const pending = activePages.map(page => cache.get(page, "detail"));
      await Promise.resolve();
      peakEntries = Math.max(peakEntries, cache.size);
      expect(cache.size).toBe(activePages.length);

      for (let i = 0; i < activePages.length; i++) {
        resolvers.get(activePages[i].id)?.(`jpeg:${activePages[i].id}`);
        await expect(pending[i]).resolves.toBe(`jpeg:${activePages[i].id}`);
        cache.clearForPage(activePages[i].id);
        expect(cache.size).toBe(activePages.length - i - 1);
      }
    }

    expect(render).toHaveBeenCalledTimes(12);
    expect(peakEntries).toBe(4);
    expect(cache.size).toBe(0);
  });

  it("drops a failed render before the next attempt", async () => {
    const render = vi.fn()
      .mockRejectedValueOnce(new Error("render failed"))
      .mockResolvedValueOnce("recovered");
    const cache = new PageRenderCache(render);
    const page = { id: "page-1" };

    await expect(cache.get(page, "fast")).rejects.toThrow("render failed");
    expect(cache.size).toBe(0);
    await expect(cache.get(page, "fast")).resolves.toBe("recovered");
    expect(render).toHaveBeenCalledTimes(2);
  });
});
