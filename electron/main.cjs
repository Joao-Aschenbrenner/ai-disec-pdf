const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, powerMonitor } = require("electron");
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
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { console.warn("[main] electron-updater not available:", e.message); }

let processingBlockerId = null;

ipcMain.on("processing-started", () => {
  if (processingBlockerId === null) {
    processingBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log("[main] Power save blocker started (id:", processingBlockerId, ")");
  }
});

ipcMain.on("processing-ended", () => {
  if (processingBlockerId !== null) {
    powerSaveBlocker.stop(processingBlockerId);
    console.log("[main] Power save blocker stopped");
    processingBlockerId = null;
  }
});

powerMonitor.on("suspend", () => {
  console.log("[main] System suspending...");
});

powerMonitor.on("resume", () => {
  console.log("[main] System resumed");
  // Restart blocker if processing was active and it got lost
  if (processingBlockerId !== null) {
    try { powerSaveBlocker.stop(processingBlockerId); } catch (e) {}
    processingBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    console.log("[main] Power save blocker restarted after resume (id:", processingBlockerId, ")");
  }
});

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
    const settingsPath = path.join(os.homedir(), ".ai-disec-pdf", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (settings.githubToken) process.env.GH_TOKEN = settings.githubToken;
    }
  } catch (e) {
    console.warn("[updater] Failed to read settings:", e.message);
  }

  // Use GitHub provider for auto-updates (public repo, no token needed)
  autoUpdater.setFeedURL({ provider: "github", owner: "Joao-Aschenbrenner", repo: "ai-disec-pdf" });
  console.log("[updater] Feed URL set to: github:Joao-Aschenbrenner/ai-disec-pdf");

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for updates...");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-checking");
    }
  });
  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-available", info.version);
    }
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[updater] Already up-to-date");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-not-available");
    }
  });
  autoUpdater.on("error", (err) => {
    console.error("[updater] Error:", err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-error", err.message);
    }
  });
  autoUpdater.on("download-progress", (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-progress", Math.round(p.percent));
    }
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Downloaded:", info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update-downloaded", info.version);
    }
  });

  // Listen for renderer requests
  ipcMain.on("confirm-update", () => autoUpdater.downloadUpdate());
  ipcMain.on("restart-app", () => autoUpdater.quitAndInstall());
  ipcMain.on("check-for-update", () => autoUpdater.checkForUpdates());

  autoUpdater.checkForUpdates();
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
