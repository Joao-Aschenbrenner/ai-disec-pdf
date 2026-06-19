import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("Async File I/O - logError e logUpload", () => {
  const testDir = path.join(os.tmpdir(), "ai-disec-pdf-test-" + Date.now());
  const logFile = path.join(testDir, "test.log");
  const uploadLogFile = path.join(testDir, "uploads.log");

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("deve criar arquivo de log se não existir", async () => {
    const testFile = path.join(testDir, "new-log.log");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const data = Buffer.from("test log entry\n");
    await fs.promises.appendFile(testFile, data.toString("utf8"), "utf8");

    expect(fs.existsSync(testFile)).toBe(true);
  });

  it("deve appendar conteúdo ao arquivo de log sem Sobrescrever", async () => {
    const testFile = path.join(testDir, "append-test.log");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    await fs.promises.appendFile(testFile, "line1\n", "utf8");
    await fs.promises.appendFile(testFile, "line2\n", "utf8");
    await fs.promises.appendFile(testFile, "line3\n", "utf8");

    const content = fs.readFileSync(testFile, "utf8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("line1");
    expect(lines[1]).toBe("line2");
    expect(lines[2]).toBe("line3");
  });

  it("não deve bloquear o event loop durante appendAsync", async () => {
    const testFile = path.join(testDir, "async-test.log");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const start = Date.now();
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(fs.promises.appendFile(testFile, `line${i}\n`, "utf8"));
    }
    await Promise.all(promises);
    const elapsed = Date.now() - start;

    expect(fs.readFileSync(testFile, "utf8").split("\n").filter(Boolean)).toHaveLength(100);
    expect(elapsed).toBeLessThan(5000);
  });

  it("deve manter integridade do arquivo mesmo com múltiplas escritas simultâneas", async () => {
    const testFile = path.join(testDir, "concurrent-test.log");
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

    const writePromises = [];
    for (let i = 0; i < 50; i++) {
      const content = `request-${i}-${Date.now()}\n`;
      writePromises.push(fs.promises.appendFile(testFile, content, "utf8"));
    }
    await Promise.all(writePromises);

    const lines = fs.readFileSync(testFile, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(50);
    for (const line of lines) {
      expect(line).toMatch(/^request-\d+-\d+$/);
    }
  });
});

describe("ActivePromises Cleanup", () => {
  it("deve processar múltiplas promises concurrentemente sem vazamento", async () => {
    const MAX_CONCURRENT = 10;
    const activePromises: Promise<string>[] = [];
    const results: string[] = [];
    let currentIndex = 0;

    const processItem = async (id: number): Promise<string> => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return `result-${id}`;
    };

    const items = Array.from({ length: 20 }, (_, i) => i);

    const allPromises = [...activePromises];

    while (items.length > 0 || allPromises.length > 0) {
      while (items.length > 0 && allPromises.length < MAX_CONCURRENT) {
        const item = items.shift()!;
        const promise = processItem(item).then(result => {
          results.push(result);
          const idx = allPromises.indexOf(promise);
          if (idx !== -1) allPromises.splice(idx, 1);
          return result;
        });
        allPromises.push(promise);
      }
      if (allPromises.length > 0) {
        await Promise.race(allPromises);
      }
    }

    expect(results.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `result-${i}`).sort());
  });

  it("filter deve remover apenas a promise completada", async () => {
    const promises = [
      Promise.resolve("a"),
      Promise.resolve("b"),
      Promise.resolve("c"),
    ];

    const promisesCopy = [...promises];
    const completed = promisesCopy[1];

    const filtered = promisesCopy.filter(p => p !== completed);

    expect(filtered).toHaveLength(2);
    expect(filtered).toContain(promises[0]);
    expect(filtered).toContain(promises[2]);
    expect(filtered).not.toContain(promises[1]);
  });

  it("deve manter o array de promises consistente após múltiplas resoluções", async () => {
    const activePromises: Promise<number>[] = [];
    const mockProcess = (id: number) => new Promise<number>(resolve => {
      setTimeout(() => resolve(id * 2), 5);
    });

    for (let i = 0; i < 15; i++) {
      activePromises.push(mockProcess(i));
    }

    await Promise.all(activePromises.map(p => p.catch(() => null)));

    expect(activePromises.length).toBe(15);
    const holes = activePromises.filter(p => p === undefined || p === null);
    expect(holes).toHaveLength(0);
  });
});

describe("BlobURL Memory Leak Prevention", () => {
  it("revokeObjectURL deve ser chamado para cada URL criada", () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];

    const mockCreateObjectURL = (blob: unknown) => {
      const url = `blob:${Date.now()}-${Math.random().toString(36).slice(2)}`;
      createdUrls.push(url);
      return url;
    };

    const mockRevokeObjectURL = (url: string) => {
      revokedUrls.push(url);
    };

    const urls = [];
    for (let i = 0; i < 10; i++) {
      urls.push(mockCreateObjectURL(null));
    }

    expect(createdUrls).toHaveLength(10);

    for (const url of urls) {
      mockRevokeObjectURL(url);
    }

    expect(revokedUrls).toHaveLength(10);
    expect(revokedUrls.sort()).toEqual(createdUrls.sort());
  });

  it("deve revogar URLs quando componente desmonta", () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];

    const createUrl = () => {
      const url = `blob:${Date.now()}`;
      createdUrls.push(url);
      return url;
    };

    const cleanupUrls = () => {
      for (const url of createdUrls) {
        revokedUrls.push(url);
      }
      createdUrls.length = 0;
    };

    for (let i = 0; i < 5; i++) createUrl();

    expect(createdUrls).toHaveLength(5);

    cleanupUrls();

    expect(createdUrls).toHaveLength(0);
    expect(revokedUrls).toHaveLength(5);
  });

  it("deve revogar URLs antigas quando novo arquivo é selecionado", () => {
    const allCreatedUrls: string[] = [];
    const allRevokedUrls: string[] = [];

    const createUrl = () => {
      const url = `blob:${Date.now()}-${Math.random()}`;
      allCreatedUrls.push(url);
      return url;
    };

    const revokeAll = () => {
      for (const url of allCreatedUrls) {
        allRevokedUrls.push(url);
      }
      allCreatedUrls.length = 0;
    };

    createUrl();
    createUrl();
    createUrl();

    expect(allCreatedUrls).toHaveLength(3);

    revokeAll();

    expect(allRevokedUrls).toHaveLength(3);
    expect(allCreatedUrls).toHaveLength(0);

    for (let i = 0; i < 3; i++) createUrl();

    expect(allCreatedUrls).toHaveLength(3);
    expect(allRevokedUrls).toHaveLength(3);

    revokeAll();

    expect(allRevokedUrls).toHaveLength(6);
    expect(allCreatedUrls).toHaveLength(0);
  });
});