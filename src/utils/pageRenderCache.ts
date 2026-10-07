export type PageRenderMode = "fast" | "detail";

/**
 * Reuses a rendered page while its provider retries are in flight. Call
 * clearForPage when that page finishes so completed images do not accumulate.
 */
export class PageRenderCache<Page extends { id: string }, Image> {
  private readonly entries = new Map<string, Promise<Image>>();

  constructor(
    private readonly render: (page: Page, mode: PageRenderMode) => Promise<Image>
  ) {}

  private key(pageId: string, mode: PageRenderMode): string {
    return `${pageId}::${mode}`;
  }

  get(page: Page, mode: PageRenderMode): Promise<Image> {
    const key = this.key(page.id, mode);
    const cached = this.entries.get(key);
    if (cached) return cached;

    let resolveRender!: (image: Image) => void;
    let rejectRender!: (error: unknown) => void;
    const pending = new Promise<Image>((resolve, reject) => {
      resolveRender = resolve;
      rejectRender = reject;
    });
    this.entries.set(key, pending);

    Promise.resolve()
      .then(() => this.render(page, mode))
      .then(resolveRender, error => {
        if (this.entries.get(key) === pending) this.entries.delete(key);
        rejectRender(error);
      });

    return pending;
  }

  clearForPage(pageId: string): void {
    this.entries.delete(this.key(pageId, "fast"));
    this.entries.delete(this.key(pageId, "detail"));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
