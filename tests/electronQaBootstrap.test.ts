import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// P0.47: modo QA do bootstrap Electron (AI_DISEC_QA=1). Verificações estáticas
// das garantias de isolamento: nenhum serviço auto-iniciado no QA, nenhum
// install/login possível pelo IPC, userData temporária, sandbox ativo no smoke,
// e nenhuma ligação entre o modo QA e a política fail-closed do P0.41.
const root = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Electron QA bootstrap safety", () => {
  it("define o modo QA pela variável AI_DISEC_QA no main process", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain('const isQa = process.env.AI_DISEC_QA === "1"');
  });

  it("não auto-inicia o Laya no QA", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("if (!isQa && getLayaInstallInfo().installed)");
    expect(main).toContain("QA mode: Laya auto-start desabilitado");
  });

  it("usa userData temporária exclusiva no QA e mantém o padrão fora dele", () => {
    const main = read("electron/main.cjs");
    expect(main).toMatch(/if \(isQa\) \{\s*\n\s*const qaDir = path\.join\(os\.tmpdir\(\)/);
    expect(main).toContain('app.setPath("userData", qaDir)');
  });

  it("mantém o sandbox ativo no smoke QA e o comportamento normal fora dele", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain('if (!isQa) app.commandLine.appendSwitch("no-sandbox")');
  });

  it("bloqueia instalações, starts e login Codex via IPC no QA", () => {
    const main = read("electron/main.cjs");
    for (const handler of [
      "laya:install",
      "laya:start",
      "ollama:install",
      "ollama:pull-model",
      "opencode:install",
      "opencode:start",
      "codex:login",
    ]) {
      const handlerIdx = main.indexOf(`ipcMain.handle("${handler}"`);
      expect(handlerIdx, `handler ${handler} presente`).toBeGreaterThan(-1);
      const body = main.slice(handlerIdx, handlerIdx + 400);
      expect(body, `handler ${handler} gateado no QA`).toContain("isQa");
    }
  });

  it("não lê nem apaga auth.json pessoal e não consulta perfis no QA", () => {
    const main = read("electron/main.cjs");
    for (const handler of [
      "codex:check-login",
      "codex:logout",
      "laya:status",
      "opencode:status",
      "ollama:check-installed",
      "ollama:get-hardware",
    ]) {
      const handlerIdx = main.indexOf(`ipcMain.handle("${handler}"`);
      expect(handlerIdx, `handler ${handler} presente`).toBeGreaterThan(-1);
      const body = main.slice(handlerIdx, handlerIdx + 400);
      expect(body, `handler ${handler} gateado no QA`).toContain("isQa");
    }
    // codex:logout não pode excluir ~/.codex/auth.json no QA (gate antes do try).
    const logoutIdx = main.indexOf('ipcMain.handle("codex:logout"');
    expect(main.slice(logoutIdx, logoutIdx + 200)).toContain("QA_DISABLED");
  });

  it("não abre DevTools no smoke QA", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("if (isDev && !isQa) mainWindow.webContents.openDevTools");
  });

  it("não executa o atualizador automático nem em dev nem no QA", () => {
    const main = read("electron/main.cjs");
    expect(main).toContain("if (!isDev && autoUpdater) setupAutoUpdater()");
  });

  it("backend dev usa diretório de dados temporário no QA", () => {
    const dev = read("scripts/electron-dev.cjs");
    expect(dev).toContain('const isQa = process.env.AI_DISEC_QA === "1"');
    expect(dev).toContain("ai-disec-pdf-qa-");
    expect(dev).toContain("env.AI_DISEC_DATA_DIR = qaDataDir");
  });

  it("o modo QA não desbloqueia a política fail-closed do P0.41", () => {
    const trust = read("server/classification/localHttpTrust.ts");
    expect(trust).not.toContain("AI_DISEC_QA");
    expect(trust).not.toContain("process.env");
  });
});
