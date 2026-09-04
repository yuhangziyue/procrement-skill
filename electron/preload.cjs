// 渲染进程唯一的对外通道。只暴露具名调用，不暴露 fs / SQL。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("xiaocai", {
  isDesktop: true,
  platform: process.platform,
  call: (name, ...args) => ipcRenderer.invoke("xiaocai:call", name, args),
  dbPath: () => ipcRenderer.invoke("xiaocai:dbPath"),
  dataDir: () => ipcRenderer.invoke("xiaocai:dataDir"),
  revealDb: () => ipcRenderer.invoke("xiaocai:reveal"),
  saveFile: (name, data) => ipcRenderer.invoke("xiaocai:saveFile", { name, data }),
});
