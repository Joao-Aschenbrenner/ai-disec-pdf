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

  it("encerra o serviço OpenCode iniciado pelo app ao sair", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("function stopOpenCodeService()");
    expect(main).toContain('execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]');
    const quitHandler = main.slice(main.indexOf('app.on("before-quit"'));
    expect(quitHandler).toContain("stopOpenCodeService();");
  });

  it("inicia OpenCode e instala seu CLI sem shell de comandos", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("function resolveWindowsNpmCommand()");
    expect(main).toContain("function resolveOpenCodeCommand(executable)");
    expect(main).toContain('spawn(npmCommand.executable, [...npmCommand.argsPrefix, "install", "--global", "opencode-ai"]');
    expect(main).toContain("spawn(command.executable, [...command.argsPrefix, \"serve\"");
    expect(main).toContain("shell: false");
    expect(main).not.toContain("shell: isWindowsCommandShim(executable)");
    expect(main).not.toContain('shell: process.platform === "win32"');
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

  it("cliente Laya HTTP não transporta texto nem credenciais antes da identidade ser verificada", () => {
    // P0.49 (handshake de identidade do Laya): o transporte HTTP só é usado
    // após isLocalHttpTrusted("LAYA_HTTP") retornar true, estabelecido por
    // desafio-resposta contra LAYA_IDENTITY_FINGERPRINT/PUBLIC_KEY.
    const client = read("server/classification/layaClient.ts");
    expect(client).toContain('isLocalHttpTrusted("LAYA_HTTP")');
    expect(client).toContain('getLocalHttpDenial("LAYA_HTTP")');
    expect(client).toContain("verifyLayaIdentity");
  });

  it("health declara Classification V3 e não torna VLM autoridade de classe", () => {
    const server = read("server/server.ts");
    expect(server).toContain('version: "classification-v3"');
    expect(server).toContain('layaRequired: true');
    expect(server).toContain("local-text -> signatures+laya+learning -> sequence -> vision extraction -> final validation");
    expect(server).not.toContain('strategy: "hard-signatures -> laya -> VLM candidate');
  });
});
