const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

// Carrega .env antes de qualquer coisa
try {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
} catch (e) {
  console.warn("[main] dotenv not available, using existing env");
}

let mainWindow = null;

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
