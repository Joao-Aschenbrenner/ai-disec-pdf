import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Laya desktop integration", () => {
  it("Electron gerencia instalação isolada e lifecycle", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain('const LAYA_VERSION = "0.3.20"');
    expect(main).toContain('ipcMain.handle("laya:status"');
    expect(main).toContain('ipcMain.handle("laya:install"');
    expect(main).toContain('ipcMain.handle("laya:start"');
    expect(main).toContain('ipcMain.handle("laya:stop"');
    expect(main).toContain('["-m", "laya.serve"]');
    expect(main).toContain('LAYA_MODELS: "multilingual"');
    expect(main).toContain('app.on("before-quit"');
  });

  it("preload expoe somente IPCs necessários do Laya", () => {
    const preload = read("electron/preload.cjs");
    expect(preload).toContain('layaStatus: () => ipcRenderer.invoke("laya:status")');
    expect(preload).toContain('layaInstall: () => ipcRenderer.invoke("laya:install")');
    expect(preload).toContain('layaStart: () => ipcRenderer.invoke("laya:start")');
    expect(preload).toContain('layaStop: () => ipcRenderer.invoke("laya:stop")');
    expect(preload).toContain('onLayaProgress');
  });

  it("UI possui painel de status/instalação", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("function LayaSetup()");
    expect(app).toContain("<LayaSetup />");
    expect(app).toContain("Instalar Laya");
    expect(app).toContain("Iniciar Laya");
  });

  it("cliente Laya força checkpoint multilingual", () => {
    const client = read("server/classification/layaClient.ts");
    expect(client).toContain('model: "multilingual"');
  });

  it("health não declara VLM como autoridade de classe", () => {
    const server = read("server/server.ts");
    expect(server).toContain("hard-signatures -> laya -> deterministic fallback/review");
    expect(server).not.toContain('strategy: "hard-signatures -> laya -> VLM candidate');
  });
});
