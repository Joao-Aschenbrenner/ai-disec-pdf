const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  startProcessing: () => ipcRenderer.send("processing-started"),
  endProcessing: () => ipcRenderer.send("processing-ended"),
});
