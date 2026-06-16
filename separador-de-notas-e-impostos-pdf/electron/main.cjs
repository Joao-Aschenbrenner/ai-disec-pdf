const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn, fork } = require("child_process");

let mainWindow = null;
let serverProcess = null;

const PORT = 3000;
const isDev = process.env.NODE_ENV !== "production";

function startServer() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      const serverPath = path.join(__dirname, "..", "bin", "dev-server.ts");
      serverProcess = spawn("npx.cmd", ["tsx", serverPath], {
        stdio: "pipe",
        env: { ...process.env, PORT: String(PORT), NODE_ENV: "development" },
        shell: true,
      });
    } else {
      const serverPath = path.join(__dirname, "..", "dist", "server.cjs");
      serverProcess = fork(serverPath, [], {
        env: { ...process.env, PORT: String(PORT), NODE_ENV: "production" },
        stdio: "pipe",
      });
    }

    let started = false;
    const onData = (data) => {
      const text = data.toString();
      console.log("[server]", text);
      if (!started && text.includes("Server running")) {
        started = true;
        resolve();
      }
    };

    if (serverProcess.stdout) serverProcess.stdout.on("data", onData);
    if (serverProcess.stderr) serverProcess.stderr.on("data", onData);
    serverProcess.on("error", reject);
    serverProcess.on("exit", (code) => {
      if (!started) reject(new Error(`Server exited with code ${code}`));
    });
    setTimeout(() => {
      if (!started) { started = true; resolve(); }
    }, 10000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "DocSplit AI - Separador Inteligente de PDF",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (serverProcess) serverProcess.kill();
});
