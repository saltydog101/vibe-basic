const { app, BrowserWindow, ipcMain, net, dialog } = require('electron');
const path = require('path');
const os = require('os');
const LocalManager = require('./local-manager');
const SSHManager = require('./ssh-manager');

let mainWindow;
let localManager;
let sshManager;
let ollamaHost = 'http://192.168.10.160:11434';
let activeOllamaReq = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Vibe IDE',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// --- HTTP helper for Ollama API calls ---
function ollamaFetch(endpoint, body, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const url = `${ollamaHost}${endpoint}`;
    const postData = body ? JSON.stringify(body) : null;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 11434,
      path: urlObj.pathname,
      method: postData ? 'POST' : 'GET',
      headers: {},
    };

    if (postData) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const http = require('http');
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Ollama request timed out after ${timeout}ms`));
    }, timeout);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        clearTimeout(timer);
        activeOllamaReq = null;
        resolve(data);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      activeOllamaReq = null;
      reject(err);
    });

    activeOllamaReq = req;

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

app.whenReady().then(() => {
  localManager = new LocalManager();
  sshManager = new SSHManager();
  createWindow();

  // --- Config ---
  ipcMain.handle('config:setOllamaHost', async (event, host) => {
    ollamaHost = host;
    return { success: true };
  });

  ipcMain.handle('config:getOllamaHost', async () => {
    return { host: ollamaHost };
  });

  // --- File Explorer (local) ---
  ipcMain.handle('fs:list', async (event, dirPath) => {
    try {
      const items = await localManager.listDirectory(dirPath);
      return { success: true, items };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:read', async (event, filePath) => {
    try {
      const content = await localManager.readFile(filePath);
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:write', async (event, filePath, content) => {
    try {
      await localManager.writeFile(filePath, content);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:mkdir', async (event, dirPath) => {
    try {
      await localManager.mkdir(dirPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fs:delete', async (event, targetPath) => {
    try {
      await localManager.deletePath(targetPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Terminal / Command Execution (local) ---
  ipcMain.handle('terminal:exec', async (event, command) => {
    try {
      const result = await localManager.exec(command);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Interactive local shell
  ipcMain.handle('terminal:shell:start', async () => {
    try {
      localManager.startShell(
        (data) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal:shell:data', data);
          }
        },
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('terminal:shell:closed');
          }
        }
      );
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('terminal:shell:write', async (event, data) => {
    try {
      localManager.writeToShell(data);
      return { success: true };
    } catch (err) {
      return { success: false, error: 'No active shell' };
    }
  });

  ipcMain.handle('terminal:shell:resize', async (event, cols, rows) => {
    localManager.resizeShell(cols, rows);
    return { success: true };
  });

  // --- Ollama API (direct HTTP to remote server) ---
  ipcMain.handle('ollama:list', async () => {
    try {
      const raw = await ollamaFetch('/api/tags', null, 10000);
      const data = JSON.parse(raw);
      return { success: true, models: data.models || [] };
    } catch (err) {
      return { success: false, error: `Cannot reach Ollama at ${ollamaHost}: ${err.message}` };
    }
  });

  ipcMain.handle('ollama:chat', async (event, { model, messages, options, images, timeout }) => {
    try {
      const reqTimeout = timeout || 600000; // default 10 minutes
      console.log('[ollama:chat] Sending request to', ollamaHost, 'model:', model, 'messages:', messages.length, 'num_ctx:', options?.num_ctx || 'default', 'timeout:', reqTimeout);
      const body = { model, messages, stream: false };
      if (options) body.options = options;
      const raw = await ollamaFetch('/api/chat', body, reqTimeout);
      console.log('[ollama:chat] Got response, length:', raw?.length, 'first 200 chars:', raw?.substring(0, 200));

      if (!raw || raw.trim() === '') {
        return { success: false, error: 'Empty response from Ollama' };
      }

      try {
        const data = JSON.parse(raw);
        if (data.error) {
          return { success: false, error: `Ollama error: ${data.error}` };
        }
        console.log('[ollama:chat] Parsed OK, content length:', data.message?.content?.length, 'has thinking:', !!data.message?.thinking);
        return { success: true, message: data.message };
      } catch (parseErr) {
        return { success: false, error: `Failed to parse Ollama response: ${raw.substring(0, 500)}` };
      }
    } catch (err) {
      console.error('[ollama:chat] Error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ollama:chat:stream', async (event, { model, messages, options }) => {
    try {
      const body = { model, messages, stream: true };
      if (options) body.options = options;
      const raw = await ollamaFetch('/api/chat', body, 300000);

      if (!raw || raw.trim() === '') {
        return { success: false, error: 'Empty response from Ollama' };
      }

      const lines = raw.trim().split('\n');
      let fullContent = '';
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.error) {
            return { success: false, error: `Ollama error: ${obj.error}` };
          }
          if (obj.message?.content) {
            fullContent += obj.message.content;
          }
        } catch (e) { /* skip malformed lines */ }
      }
      return { success: true, message: { role: 'assistant', content: fullContent } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Cancel active Ollama request ---
  ipcMain.handle('ollama:cancel', async () => {
    if (activeOllamaReq) {
      console.log('[ollama:cancel] Destroying active request');
      activeOllamaReq.destroy();
      activeOllamaReq = null;
      return { success: true };
    }
    return { success: false, error: 'No active request' };
  });

  // --- Screenshot capture ---
  ipcMain.handle('system:screenshot', async () => {
    const { execSync } = require('child_process');
    const tmpFile = path.join(os.tmpdir(), `vibe-screenshot-${Date.now()}.png`);
    try {
      execSync(`scrot -s "${tmpFile}"`, { timeout: 30000 });
      const imgBuffer = require('fs').readFileSync(tmpFile);
      const base64 = imgBuffer.toString('base64');
      require('fs').unlinkSync(tmpFile);
      return { success: true, base64, mimeType: 'image/png' };
    } catch (err) {
      // Clean up if file was created
      try { require('fs').unlinkSync(tmpFile); } catch (_) {}
      if (err.status === null) {
        return { success: false, error: 'Screenshot cancelled' };
      }
      return { success: false, error: err.message };
    }
  });

  // --- Get home directory ---
  ipcMain.handle('system:homedir', () => {
    return { homedir: os.homedir() };
  });

  // --- Open Folder dialog ---
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return { success: true, path: result.filePaths[0] };
  });

  // --- Recursive file listing for quick file picker ---
  ipcMain.handle('fs:listRecursive', async (event, rootDir, maxFiles) => {
    try {
      const files = [];
      const limit = maxFiles || 5000;
      const walkSync = (dir, depth) => {
        if (files.length >= limit || depth > 15) return;
        let entries;
        try {
          entries = require('fs').readdirSync(dir, { withFileTypes: true });
        } catch (_) { return; }
        for (const entry of entries) {
          if (files.length >= limit) break;
          if (entry.name.startsWith('.')) continue;
          if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
          const fullPath = require('path').join(dir, entry.name);
          if (entry.isDirectory()) {
            walkSync(fullPath, depth + 1);
          } else {
            files.push(fullPath);
          }
        }
      };
      walkSync(rootDir, 0);
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
});

app.on('window-all-closed', () => {
  localManager.killShell();
  app.quit();
});
