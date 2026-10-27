export interface AutoRetryOptions<Page> {
  maxCycles: number;
  getFailedPages: () => Page[];
  canStartPage: () => boolean;
  beforeCycle?: (cycle: number, failedCount: number) => Promise<void> | void;
  retryPage: (page: Page) => Promise<boolean>;
  onFinish?: () => void;
}

/**
 * Retries failed pages in bounded cycles, stopping when a whole cycle makes
 * no progress. A later cycle sees only pages still reported as failed.
 */
export async function runAutoRetryCycles<Page>(
  options: AutoRetryOptions<Page>
): Promise<number> {
  let cyclesExecuted = 0;

  try {
    for (let cycle = 1; cycle <= options.maxCycles; cycle++) {
      const failedPages = options.getFailedPages();
      if (failedPages.length === 0) break;

      cyclesExecuted++;
      await options.beforeCycle?.(cycle, failedPages.length);

      let recovered = 0;
      for (const page of failedPages) {
        if (!options.canStartPage()) break;
        if (await options.retryPage(page)) recovered++;
      }

      if (recovered === 0) break;
    }
  } finally {
    options.onFinish?.();
  }

  return cyclesExecuted;
}
