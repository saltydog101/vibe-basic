const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  config: {
    setOllamaHost: (host) => ipcRenderer.invoke('config:setOllamaHost', host),
    getOllamaHost: () => ipcRenderer.invoke('config:getOllamaHost'),
  },

  // System
  system: {
    homedir: () => ipcRenderer.invoke('system:homedir'),
    openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  },

  // File System (local)
  fs: {
    list: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
    read: (filePath) => ipcRenderer.invoke('fs:read', filePath),
    write: (filePath, content) => ipcRenderer.invoke('fs:write', filePath, content),
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
    delete: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
    listRecursive: (rootDir, maxFiles) => ipcRenderer.invoke('fs:listRecursive', rootDir, maxFiles),
  },

  // Terminal (local)
  terminal: {
    exec: (command) => ipcRenderer.invoke('terminal:exec', command),
    shell: {
      start: () => ipcRenderer.invoke('terminal:shell:start'),
      write: (data) => ipcRenderer.invoke('terminal:shell:write', data),
      resize: (cols, rows) => ipcRenderer.invoke('terminal:shell:resize', cols, rows),
      onData: (callback) => {
        ipcRenderer.on('terminal:shell:data', (event, data) => callback(data));
      },
      onClosed: (callback) => {
        ipcRenderer.on('terminal:shell:closed', () => callback());
      },
      removeListeners: () => {
        ipcRenderer.removeAllListeners('terminal:shell:data');
        ipcRenderer.removeAllListeners('terminal:shell:closed');
      },
    },
  },

  // Ollama (remote HTTP)
  ollama: {
    list: () => ipcRenderer.invoke('ollama:list'),
    chat: (params) => ipcRenderer.invoke('ollama:chat', params),
    chatStream: (params) => ipcRenderer.invoke('ollama:chat:stream', params),
  },
});
