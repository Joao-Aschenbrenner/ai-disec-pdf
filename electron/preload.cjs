const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  startProcessing: () => ipcRenderer.send("processing-started"),
  endProcessing: () => ipcRenderer.send("processing-ended"),
  onUpdateAvailable: (fn) => {
    const cb = (_event, version) => fn(version);
    ipcRenderer.on("update-available", cb);
    return () => ipcRenderer.removeListener("update-available", cb);
  },
  onUpdateProgress: (fn) => {
    const cb = (_event, percent) => fn(percent);
    ipcRenderer.on("update-progress", cb);
    return () => ipcRenderer.removeListener("update-progress", cb);
  },
  onUpdateDownloaded: (fn) => {
    const cb = (_event, version) => fn(version);
    ipcRenderer.on("update-downloaded", cb);
    return () => ipcRenderer.removeListener("update-downloaded", cb);
  },
  onUpdateError: (fn) => {
    const cb = (_event, message) => fn(message);
    ipcRenderer.on("update-error", cb);
    return () => ipcRenderer.removeListener("update-error", cb);
  },
  confirmDownload: () => ipcRenderer.send("confirm-update"),
  restartApp: () => ipcRenderer.send("restart-app"),
});
