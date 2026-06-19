const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Carrega .env antes de qualquer coisa
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
} catch (e) {
  console.warn("[main] dotenv not available, using existing env");
}

let mainWindow = null;
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { /* dev mode */ }

const PORT = 3001;
const isDev = process.env.NODE_ENV === "development";

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

async function startServer() {
  if (isDev) {
    console.log("[main] Dev mode - using Vite dev server");
    return true;
  }

  // Muda o diretório de trabalho para a raiz da app (onde está .env e dist/)
  const appDir = path.join(__dirname, "..");
  process.chdir(appDir);
  console.log("[main] Working directory:", process.cwd());

  try {
    const serverPath = path.join(appDir, "dist", "server-module.cjs");
    console.log("[main] Loading server from:", serverPath);
    const { startServer } = require(serverPath);
    await startServer(PORT, false);
    return true;
  } catch (err) {
    console.error("[main] Failed to start server:", err);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    autoHideMenuBar: true,
    title: "AI Disec PDF",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error("[main] Failed to load:", errorCode, errorDescription);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[main] Page loaded successfully");
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.on("closed", () => { mainWindow = null; });

  if (!isDev && autoUpdater) setupAutoUpdater();
}

function setupAutoUpdater() {
  try {
    const settingsPath = path.join(os.homedir(), ".docsplit-ai", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (settings.githubToken) process.env.GH_TOKEN = settings.githubToken;
    }
  } catch (e) {
    console.warn("[updater] Failed to read settings:", e.message);
  }

  autoUpdater.on("checking-for-update", () => console.log("[updater] Checking for updates..."));
  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info.version);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: "info", title: "Atualização disponível",
        message: `Nova versão ${info.version} disponível. Baixar agora?`,
        buttons: ["Baixar", "Agora não"],
        defaultId: 0, cancelId: 1,
      }).then(({ response }) => { if (response === 0) autoUpdater.downloadUpdate(); });
    }
  });
  autoUpdater.on("update-not-available", () => console.log("[updater] Already up-to-date"));
  autoUpdater.on("error", (err) => console.error("[updater] Error:", err.message));
  autoUpdater.on("download-progress", (p) => console.log(`[updater] Download: ${p.percent.toFixed(0)}%`));
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Downloaded:", info.version);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: "info", title: "Atualização pronta",
        message: "Atualização baixada. Reiniciar agora?",
        buttons: ["Reiniciar", "Depois"],
        defaultId: 0, cancelId: 1,
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
    }
  });

  autoUpdater.checkForUpdatesAndNotify();
}

console.log("[main] NODE_ENV:", process.env.NODE_ENV, "isDev:", isDev);

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    console.log("[main] Starting server in main process...");
    const ok = await startServer();
    if (ok) {
      console.log("[main] Server started. Creating window...");
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } else {
      console.error("[main] Server failed, quitting.");
      app.quit();
    }
  } catch (err) {
    console.error("[main] App error:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
