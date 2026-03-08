// ============================================================
// Vibe IDE - Renderer Process (Local-first mode)
// ============================================================

// Terminal and FitAddon captured before Monaco AMD loader
// Monaco loaded via AMD loader (global `monaco`)
const Terminal = window.__Terminal?.Terminal || window.Terminal;
const FitAddon = window.__FitAddon?.FitAddon || window.FitAddon;

// ---- State ----
const state = {
  workingDir: '',
  currentBrowseDir: '',
  currentFile: null,
  openFiles: new Map(),
  activeTab: null,
  chatHistory: [],
  ollamaHost: 'http://192.168.10.160:11434',
  agenticMode: true,
  autoRoute: true,
  showRouting: true,
  modelRoles: {
    router: { model: 'qwen3:4b', num_ctx: 2048 },
    planner: { model: 'qwen3:32b', num_ctx: 16384 },
    coder: { model: 'qwen3-coder-next:latest', num_ctx: 32768 },
    vision: { model: 'minicpm-v:latest', num_ctx: 2048 },
  },
  ollamaConnected: false,
  editor: null,
  terminal: null,
  fitAddon: null,
  refreshTimer: null,
  fileIndex: [],
  fileIndexDirty: true,
  quickPickerSelectedIndex: 0,
  pendingScreenshot: null,
  markdownPreviewFile: null,
  markdownPreviewTimer: null,
};

// ---- DOM Refs ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  settingsModal: $('#settings-modal'),
  settingsOllamaHost: $('#setting-ollama-host'),
  settingsModelRouter: $('#setting-model-router'),
  settingsCtxRouter: $('#setting-ctx-router'),
  settingsModelPlanner: $('#setting-model-planner'),
  settingsCtxPlanner: $('#setting-ctx-planner'),
  settingsModelCoder: $('#setting-model-coder'),
  settingsCtxCoder: $('#setting-ctx-coder'),
  settingsModelVision: $('#setting-model-vision'),
  settingsCtxVision: $('#setting-ctx-vision'),
  settingsAutoRoute: $('#setting-auto-route'),
  settingsShowRouting: $('#setting-show-routing'),
  settingsWorkDir: $('#setting-work-dir'),
  settingsError: $('#settings-error'),
  btnSettingsSave: $('#btn-settings-save'),
  btnSettingsCancel: $('#btn-settings-cancel'),
  app: $('#app'),
  btnSave: $('#btn-save'),
  btnOllamaModels: $('#btn-ollama-models'),
  btnSettings: $('#btn-settings'),
  ollamaStatus: $('#ollama-status'),
  currentFilePath: $('#current-file-path'),
  fileModified: $('#file-modified'),
  fileTree: $('#file-tree'),
  btnNewFile: $('#btn-new-file'),
  btnNewFolder: $('#btn-new-folder'),
  btnRefresh: $('#btn-refresh'),
  tabBar: $('#tab-bar'),
  editorContainer: $('#editor-container'),
  terminalContainer: $('#terminal-container'),
  btnClearTerminal: $('#btn-clear-terminal'),
  chatMessages: $('#chat-messages'),
  chatInput: $('#chat-input'),
  btnSendChat: $('#btn-send-chat'),
  agenticMode: $('#agentic-mode'),
  modelSelect: $('#model-select'),
  statusLeft: $('#status-left'),
  statusCenter: $('#status-center'),
  statusRight: $('#status-right'),
  statusbar: $('#statusbar'),
  sidebarResizer: $('#sidebar-resizer'),
  terminalResizer: $('#terminal-resizer'),
  chatResizer: $('#chat-resizer'),
  btnOpenFolder: $('#btn-open-folder'),
  btnApplyAll: $('#btn-apply-all'),
  btnScreenshot: $('#btn-screenshot'),
  btnCancelChat: $('#btn-cancel-chat'),
  screenshotPreview: $('#screenshot-preview'),
  screenshotImg: $('#screenshot-img'),
  btnRemoveScreenshot: $('#btn-remove-screenshot'),
  quickPicker: $('#quick-picker'),
  quickPickerInput: $('#quick-picker-input'),
  quickPickerResults: $('#quick-picker-results'),
  quickPickerBackdrop: $('.quick-picker-backdrop'),
  contextMenu: $('#context-menu'),
  ctxPreviewMd: $('#ctx-preview-md'),
  ctxOpenFile: $('#ctx-open-file'),
  ctxDelete: $('#ctx-delete'),
  markdownPreview: $('#markdown-preview'),
  markdownPreviewContent: $('#markdown-preview-content'),
};

// ---- App Init (immediate, no connection needed) ----
async function initApp() {
  // Get home directory from main process
  const { homedir } = await window.api.system.homedir();
  state.workingDir = homedir;
  state.currentBrowseDir = homedir;

  dom.app.classList.remove('hidden');
  dom.statusLeft.textContent = `Local: ${homedir}`;
  dom.statusbar.classList.remove('disconnected');

  initEditor();
  await initTerminal();
  await loadFileTree(state.workingDir);
  setupResizers();

  // Try connecting to Ollama
  await checkOllamaConnection();
  await loadOllamaModels();

  // Auto-refresh file explorer every 5 seconds
  state.refreshTimer = setInterval(() => {
    refreshFileTree();
  }, 5000);

  addSystemMessage(`Vibe IDE ready. Local files at ${homedir}. Ollama: ${state.ollamaHost}. Coder: ${state.modelRoles.coder.model}, Planner: ${state.modelRoles.planner.model}, Router: ${state.modelRoles.router.model}, Vision: ${state.modelRoles.vision.model}. Auto-route: ${state.autoRoute ? 'ON' : 'OFF'}.`);
}

async function checkOllamaConnection() {
  const result = await window.api.ollama.list();
  if (result.success) {
    state.ollamaConnected = true;
    dom.ollamaStatus.textContent = 'Ollama ✓';
    dom.ollamaStatus.style.background = 'var(--success)';
  } else {
    state.ollamaConnected = false;
    dom.ollamaStatus.textContent = 'Ollama ✗';
    dom.ollamaStatus.style.background = 'var(--danger)';
  }
}

// ---- Settings Modal ----
dom.btnSettings.addEventListener('click', () => {
  dom.settingsOllamaHost.value = state.ollamaHost;
  dom.settingsModelRouter.value = state.modelRoles.router.model;
  dom.settingsCtxRouter.value = state.modelRoles.router.num_ctx;
  dom.settingsModelPlanner.value = state.modelRoles.planner.model;
  dom.settingsCtxPlanner.value = state.modelRoles.planner.num_ctx;
  dom.settingsModelCoder.value = state.modelRoles.coder.model;
  dom.settingsCtxCoder.value = state.modelRoles.coder.num_ctx;
  dom.settingsModelVision.value = state.modelRoles.vision.model;
  dom.settingsCtxVision.value = state.modelRoles.vision.num_ctx;
  dom.settingsAutoRoute.checked = state.autoRoute;
  dom.settingsShowRouting.checked = state.showRouting;
  dom.settingsWorkDir.value = state.workingDir;
  dom.settingsError.textContent = '';
  dom.settingsModal.classList.remove('hidden');
});

dom.btnSettingsCancel.addEventListener('click', () => {
  dom.settingsModal.classList.add('hidden');
});

dom.btnSettingsSave.addEventListener('click', async () => {
  const newHost = dom.settingsOllamaHost.value.trim();
  const newWorkDir = dom.settingsWorkDir.value.trim();

  if (newHost && newHost !== state.ollamaHost) {
    state.ollamaHost = newHost;
    await window.api.config.setOllamaHost(newHost);
  }

  // Model roles
  state.modelRoles.router.model = dom.settingsModelRouter.value.trim() || state.modelRoles.router.model;
  state.modelRoles.router.num_ctx = parseInt(dom.settingsCtxRouter.value) || 2048;
  state.modelRoles.planner.model = dom.settingsModelPlanner.value.trim() || state.modelRoles.planner.model;
  state.modelRoles.planner.num_ctx = parseInt(dom.settingsCtxPlanner.value) || 16384;
  state.modelRoles.coder.model = dom.settingsModelCoder.value.trim() || state.modelRoles.coder.model;
  state.modelRoles.coder.num_ctx = parseInt(dom.settingsCtxCoder.value) || 32768;
  state.modelRoles.vision.model = dom.settingsModelVision.value.trim() || state.modelRoles.vision.model;
  state.modelRoles.vision.num_ctx = parseInt(dom.settingsCtxVision.value) || 2048;
  state.autoRoute = dom.settingsAutoRoute.checked;
  state.showRouting = dom.settingsShowRouting.checked;

  if (newWorkDir && newWorkDir !== state.workingDir) {
    state.workingDir = newWorkDir;
    state.currentBrowseDir = newWorkDir;
    dom.statusLeft.textContent = `Local: ${newWorkDir}`;
    await loadFileTree(newWorkDir);
  }

  await checkOllamaConnection();
  await loadOllamaModels();

  dom.settingsModal.classList.add('hidden');
  addSystemMessage(`Settings updated. Router: ${state.modelRoles.router.model}, Planner: ${state.modelRoles.planner.model}, Coder: ${state.modelRoles.coder.model}, Vision: ${state.modelRoles.vision.model}, Auto-route: ${state.autoRoute}`);
});

// ---- Editor ----
function initEditor() {
  if (state.editor) {
    state.editor.dispose();
  }

  state.editor = monaco.editor.create(dom.editorContainer, {
    value: '// Welcome to Vibe IDE\n// Open a file from the explorer to start editing\n// Use the AI assistant to generate and edit code\n',
    language: 'plaintext',
    theme: 'vs-dark',
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 14,
    lineNumbers: 'on',
    minimap: { enabled: true },
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
  });

  state.editor.onDidChangeModelContent(() => {
    if (state.currentFile && state.openFiles.has(state.currentFile)) {
      const fileInfo = state.openFiles.get(state.currentFile);
      if (!fileInfo.modified) {
        fileInfo.modified = true;
        updateTabModified(state.currentFile, true);
        dom.fileModified.classList.remove('hidden');
      }
    }
  });

  state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    saveCurrentFile();
  });
}

function getLanguageFromPath(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', pyw: 'python',
    rb: 'ruby', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', scala: 'scala',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    json: 'json', jsonc: 'json',
    xml: 'xml', svg: 'xml',
    yaml: 'yaml', yml: 'yaml',
    md: 'markdown', markdown: 'markdown',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    sql: 'sql',
    dockerfile: 'dockerfile',
    toml: 'ini', ini: 'ini', cfg: 'ini',
    lua: 'lua', php: 'php', r: 'r', swift: 'swift',
    vue: 'html', svelte: 'html',
  };
  return map[ext] || 'plaintext';
}

async function openFile(filePath) {
  if (state.openFiles.has(filePath)) {
    switchToTab(filePath);
    return;
  }

  setStatus('center', `Loading ${filePath}...`);
  const result = await window.api.fs.read(filePath);
  if (!result.success) {
    setStatus('center', `Error: ${result.error}`);
    return;
  }

  const lang = getLanguageFromPath(filePath);
  const model = monaco.editor.createModel(result.content, lang);

  state.openFiles.set(filePath, {
    model,
    modified: false,
    originalContent: result.content,
  });

  createTab(filePath);
  switchToTab(filePath);
  setStatus('center', '');
}

async function saveCurrentFile() {
  if (!state.currentFile) return;
  const fileInfo = state.openFiles.get(state.currentFile);
  if (!fileInfo) return;

  const content = fileInfo.model.getValue();
  setStatus('center', 'Saving...');

  const result = await window.api.fs.write(state.currentFile, content);
  if (result.success) {
    fileInfo.modified = false;
    fileInfo.originalContent = content;
    updateTabModified(state.currentFile, false);
    dom.fileModified.classList.add('hidden');
    setStatus('center', 'Saved');
    setTimeout(() => setStatus('center', ''), 2000);
  } else {
    setStatus('center', `Save failed: ${result.error}`);
  }
}

dom.btnSave.addEventListener('click', saveCurrentFile);

// ---- Tabs ----
function createTab(filePath) {
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.path = filePath;

  const isPreview = filePath.startsWith('preview:');
  const displayPath = isPreview ? filePath.replace('preview:', '') : filePath;
  const name = isPreview ? `👁 ${displayPath.split('/').pop()}` : displayPath.split('/').pop();
  tab.innerHTML = `
    <span class="tab-name">${name}</span>
    <span class="tab-modified hidden">●</span>
    <span class="tab-close">×</span>
  `;

  tab.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      closeTab(filePath);
    } else {
      switchToTab(filePath);
    }
  });

  dom.tabBar.appendChild(tab);
}

function switchToTab(filePath) {
  const fileInfo = state.openFiles.get(filePath);
  if (!fileInfo) return;

  dom.tabBar.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));

  const tab = dom.tabBar.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (tab) tab.classList.add('active');

  state.currentFile = filePath;

  // Check if this is a markdown preview tab
  if (fileInfo.isPreview) {
    dom.editorContainer.style.display = 'none';
    dom.markdownPreview.classList.remove('hidden');
    dom.currentFilePath.textContent = filePath.replace('preview:', '');
    dom.fileModified.classList.add('hidden');
    setStatus('right', 'Markdown Preview');
  } else {
    dom.markdownPreview.classList.add('hidden');
    dom.editorContainer.style.display = '';
    state.editor.setModel(fileInfo.model);
    dom.currentFilePath.textContent = filePath;
    dom.fileModified.classList.toggle('hidden', !fileInfo.modified);
    setStatus('right', getLanguageFromPath(filePath));
    state.editor.layout();
  }
}

function closeTab(filePath) {
  const fileInfo = state.openFiles.get(filePath);
  if (!fileInfo) return;

  if (fileInfo.isPreview) {
    stopMarkdownPreviewPolling();
    state.markdownPreviewFile = null;
    dom.markdownPreview.classList.add('hidden');
  } else {
    fileInfo.model.dispose();
  }
  state.openFiles.delete(filePath);

  const tab = dom.tabBar.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (tab) tab.remove();

  if (state.currentFile === filePath) {
    const remaining = Array.from(state.openFiles.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      state.currentFile = null;
      dom.currentFilePath.textContent = 'No file open';
      dom.fileModified.classList.add('hidden');
      dom.markdownPreview.classList.add('hidden');
      dom.editorContainer.style.display = '';
      state.editor.setModel(monaco.editor.createModel('// No file open\n', 'plaintext'));
    }
  }
}

function updateTabModified(filePath, modified) {
  const tab = dom.tabBar.querySelector(`.tab[data-path="${CSS.escape(filePath)}"]`);
  if (tab) {
    const indicator = tab.querySelector('.tab-modified');
    indicator.classList.toggle('hidden', !modified);
  }
}

// ---- File Explorer ----
async function loadFileTree(dirPath) {
  state.currentBrowseDir = dirPath;
  dom.fileTree.innerHTML = '<div style="padding:8px;color:var(--text-secondary)">Loading...</div>';
  const result = await window.api.fs.list(dirPath);
  if (!result.success) {
    dom.fileTree.innerHTML = `<div style="padding:8px;color:var(--danger)">${result.error}</div>`;
    return;
  }

  dom.fileTree.innerHTML = '';

  // Current directory label
  const dirLabel = document.createElement('div');
  dirLabel.style.cssText = 'padding:4px 8px;font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  dirLabel.textContent = dirPath;
  dirLabel.title = dirPath;
  dom.fileTree.appendChild(dirLabel);

  if (dirPath !== '/') {
    const parentPath = dirPath.split('/').slice(0, -1).join('/') || '/';
    const parentEl = createTreeItem('..', parentPath, true, 0);
    dom.fileTree.appendChild(parentEl);
  }

  for (const item of result.items) {
    const el = createTreeItem(item.name, item.path, item.isDirectory, 0);
    dom.fileTree.appendChild(el);
  }
}

async function refreshFileTree() {
  if (!state.currentBrowseDir) return;
  const result = await window.api.fs.list(state.currentBrowseDir);
  if (!result.success) return;

  // Only update if items changed (simple length check to avoid flicker)
  const currentItems = dom.fileTree.querySelectorAll('.tree-item');
  const expectedCount = result.items.length + (state.currentBrowseDir !== '/' ? 1 : 0);
  if (currentItems.length !== expectedCount) {
    await loadFileTree(state.currentBrowseDir);
  }
}

function createTreeItem(name, itemPath, isDirectory, depth) {
  const div = document.createElement('div');
  div.className = 'tree-item';
  div.style.paddingLeft = `${8 + depth * 16}px`;

  const icon = isDirectory ? '📁' : getFileIcon(name);
  div.innerHTML = `<span class="icon">${icon}</span><span class="name">${name}</span>`;

  div.addEventListener('click', async () => {
    if (isDirectory) {
      await loadFileTree(itemPath);
    } else {
      dom.fileTree.querySelectorAll('.tree-item').forEach((t) => t.classList.remove('active'));
      div.classList.add('active');
      await openFile(itemPath);
    }
  });

  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, itemPath, isDirectory, name);
  });

  return div;
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    js: '🟨', ts: '🔷', py: '🐍', rb: '💎', rs: '🦀', go: '🔵',
    html: '🌐', css: '🎨', json: '📋', md: '📝', yaml: '⚙️', yml: '⚙️',
    sh: '🖥️', bash: '🖥️', sql: '🗃️', svg: '🖼️', png: '🖼️', jpg: '🖼️',
    txt: '📄', log: '📄', env: '🔒', lock: '🔒',
  };
  return icons[ext] || '📄';
}

dom.btnRefresh.addEventListener('click', () => {
  loadFileTree(state.currentBrowseDir || state.workingDir);
});

// ---- Context Menu ----
let contextMenuTarget = null;

function showContextMenu(x, y, itemPath, isDirectory, name) {
  contextMenuTarget = { path: itemPath, isDirectory, name };
  const isMd = !isDirectory && name.toLowerCase().endsWith('.md');
  dom.ctxPreviewMd.classList.toggle('disabled', !isMd);
  dom.ctxPreviewMd.style.display = isMd ? '' : 'none';
  dom.ctxOpenFile.style.display = isDirectory ? 'none' : '';

  dom.contextMenu.style.left = `${x}px`;
  dom.contextMenu.style.top = `${y}px`;
  dom.contextMenu.classList.remove('hidden');

  // Clamp to viewport
  const rect = dom.contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) dom.contextMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) dom.contextMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

function hideContextMenu() {
  dom.contextMenu.classList.add('hidden');
  contextMenuTarget = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('#file-tree')) hideContextMenu();
});

dom.ctxOpenFile.addEventListener('click', () => {
  if (contextMenuTarget && !contextMenuTarget.isDirectory) {
    openFile(contextMenuTarget.path);
  }
  hideContextMenu();
});

dom.ctxDelete.addEventListener('click', async () => {
  if (!contextMenuTarget) return;
  const confirmDelete = confirm(`Delete "${contextMenuTarget.name}"?`);
  if (confirmDelete) {
    const result = await window.api.fs.delete(contextMenuTarget.path);
    if (result.success) {
      state.fileIndexDirty = true;
      await loadFileTree(state.currentBrowseDir || state.workingDir);
    } else {
      alert('Error deleting: ' + result.error);
    }
  }
  hideContextMenu();
});

dom.ctxPreviewMd.addEventListener('click', () => {
  if (contextMenuTarget && contextMenuTarget.name.toLowerCase().endsWith('.md')) {
    openMarkdownPreview(contextMenuTarget.path);
  }
  hideContextMenu();
});

// ---- Markdown Preview ----
async function openMarkdownPreview(filePath) {
  const previewKey = `preview:${filePath}`;

  // If already open, just switch to it
  if (state.openFiles.has(previewKey)) {
    switchToTab(previewKey);
    return;
  }

  const result = await window.api.fs.read(filePath);
  if (!result.success) {
    addSystemMessage(`Error reading ${filePath}: ${result.error}`);
    return;
  }

  const html = marked.parse(result.content);
  dom.markdownPreviewContent.innerHTML = html;

  // Register as a special tab entry
  state.openFiles.set(previewKey, {
    isPreview: true,
    sourcePath: filePath,
    modified: false,
  });

  createTab(previewKey);
  switchToTab(previewKey);
  state.markdownPreviewFile = filePath;

  // Start auto-refresh polling (every 2 seconds)
  stopMarkdownPreviewPolling();
  state.markdownPreviewTimer = setInterval(async () => {
    if (!state.markdownPreviewFile) return;
    // Only update if the preview tab is active
    if (state.currentFile !== `preview:${state.markdownPreviewFile}`) return;
    const updated = await window.api.fs.read(state.markdownPreviewFile);
    if (updated.success) {
      const newHtml = marked.parse(updated.content);
      if (dom.markdownPreviewContent.innerHTML !== newHtml) {
        const scrollTop = dom.markdownPreviewContent.scrollTop;
        dom.markdownPreviewContent.innerHTML = newHtml;
        dom.markdownPreviewContent.scrollTop = scrollTop;
      }
    }
  }, 2000);
}

function stopMarkdownPreviewPolling() {
  if (state.markdownPreviewTimer) {
    clearInterval(state.markdownPreviewTimer);
    state.markdownPreviewTimer = null;
  }
}

// ---- Open Folder ----
async function openFolder() {
  const result = await window.api.system.openFolderDialog();
  if (!result.success || result.canceled) return;
  state.workingDir = result.path;
  state.currentBrowseDir = result.path;
  state.fileIndexDirty = true;
  dom.statusLeft.textContent = `Local: ${result.path}`;
  await loadFileTree(result.path);
  addSystemMessage(`Opened folder: ${result.path}`);
}

dom.btnOpenFolder.addEventListener('click', openFolder);

// ---- Quick File Picker (Ctrl+P) ----
async function buildFileIndex() {
  if (!state.fileIndexDirty) return;
  setStatus('center', 'Indexing files...');
  const result = await window.api.fs.listRecursive(state.workingDir, 5000);
  if (result.success) {
    state.fileIndex = result.files;
    state.fileIndexDirty = false;
  }
  setStatus('center', '');
}

function fuzzyMatch(query, filePath) {
  const lowerQuery = query.toLowerCase();
  const fileName = filePath.split('/').pop().toLowerCase();
  const relativePath = filePath.toLowerCase();

  // Exact filename substring match gets highest score
  if (fileName.includes(lowerQuery)) {
    return { match: true, score: 100 + (fileName === lowerQuery ? 50 : 0) - fileName.length };
  }

  // Path substring match
  if (relativePath.includes(lowerQuery)) {
    return { match: true, score: 50 - relativePath.length };
  }

  // Fuzzy: all query chars appear in order in the path
  let qi = 0;
  for (let i = 0; i < relativePath.length && qi < lowerQuery.length; i++) {
    if (relativePath[i] === lowerQuery[qi]) qi++;
  }
  if (qi === lowerQuery.length) {
    return { match: true, score: 10 - relativePath.length };
  }

  return { match: false, score: 0 };
}

function showQuickPicker() {
  dom.quickPicker.classList.remove('hidden');
  dom.quickPickerInput.value = '';
  dom.quickPickerInput.focus();
  state.quickPickerSelectedIndex = 0;
  renderQuickPickerResults('');
}

function hideQuickPicker() {
  dom.quickPicker.classList.add('hidden');
  dom.quickPickerInput.value = '';
  dom.quickPickerResults.innerHTML = '';
}

function renderQuickPickerResults(query) {
  const container = dom.quickPickerResults;
  container.innerHTML = '';

  let results;
  if (!query) {
    // Show recently-ish files (first 30)
    results = state.fileIndex.slice(0, 30).map((f) => ({ path: f, score: 0 }));
  } else {
    results = state.fileIndex
      .map((f) => {
        const { match, score } = fuzzyMatch(query, f);
        return match ? { path: f, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="quick-picker-empty">No files found</div>';
    return;
  }

  state.quickPickerSelectedIndex = Math.min(state.quickPickerSelectedIndex, results.length - 1);

  results.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'quick-picker-item' + (i === state.quickPickerSelectedIndex ? ' selected' : '');
    div.dataset.path = item.path;

    const fileName = item.path.split('/').pop();
    const relPath = item.path.startsWith(state.workingDir)
      ? item.path.slice(state.workingDir.length + 1)
      : item.path;
    const dirPart = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const icon = getFileIcon(fileName);

    div.innerHTML = `<span class="qp-icon">${icon}</span><span class="qp-filename">${escapeHtml(fileName)}</span><span class="qp-path">${escapeHtml(dirPart)}</span>`;

    div.addEventListener('click', () => {
      hideQuickPicker();
      openFile(item.path);
    });

    div.addEventListener('mouseenter', () => {
      container.querySelectorAll('.quick-picker-item').forEach((el) => el.classList.remove('selected'));
      div.classList.add('selected');
      state.quickPickerSelectedIndex = i;
    });

    container.appendChild(div);
  });
}

dom.quickPickerInput.addEventListener('input', () => {
  state.quickPickerSelectedIndex = 0;
  renderQuickPickerResults(dom.quickPickerInput.value.trim());
});

dom.quickPickerInput.addEventListener('keydown', (e) => {
  const items = dom.quickPickerResults.querySelectorAll('.quick-picker-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.quickPickerSelectedIndex = Math.min(state.quickPickerSelectedIndex + 1, items.length - 1);
    updateQuickPickerSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.quickPickerSelectedIndex = Math.max(state.quickPickerSelectedIndex - 1, 0);
    updateQuickPickerSelection(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const selected = items[state.quickPickerSelectedIndex];
    if (selected) {
      hideQuickPicker();
      openFile(selected.dataset.path);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideQuickPicker();
  }
});

function updateQuickPickerSelection(items) {
  items.forEach((el, i) => {
    el.classList.toggle('selected', i === state.quickPickerSelectedIndex);
  });
  // Scroll selected into view
  const selected = items[state.quickPickerSelectedIndex];
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

dom.quickPickerBackdrop.addEventListener('click', hideQuickPicker);

dom.btnNewFile.addEventListener('click', async () => {
  const name = prompt('New file name:');
  if (!name) return;
  const dir = state.currentBrowseDir || state.workingDir;
  const filePath = dir + '/' + name;
  const result = await window.api.fs.write(filePath, '');
  if (result.success) {
    state.fileIndexDirty = true;
    await loadFileTree(dir);
    await openFile(filePath);
  } else {
    alert('Error creating file: ' + result.error);
  }
});

dom.btnNewFolder.addEventListener('click', async () => {
  const name = prompt('New folder name:');
  if (!name) return;
  const dir = state.currentBrowseDir || state.workingDir;
  const dirPath = dir + '/' + name;
  const result = await window.api.fs.mkdir(dirPath);
  if (result.success) {
    state.fileIndexDirty = true;
    await loadFileTree(dir);
  } else {
    alert('Error creating folder: ' + result.error);
  }
});

// ---- Terminal ----
async function initTerminal() {
  state.terminal = new Terminal({
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
    fontSize: 13,
    theme: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      selectionBackground: '#264f78',
    },
    cursorBlink: true,
    scrollback: 5000,
  });

  state.fitAddon = new FitAddon();
  state.terminal.loadAddon(state.fitAddon);
  state.terminal.open(dom.terminalContainer);
  state.fitAddon.fit();

  const result = await window.api.terminal.shell.start();
  if (!result.success) {
    state.terminal.writeln(`\r\nFailed to start shell: ${result.error}\r\n`);
    return;
  }

  state.terminal.onData((data) => {
    window.api.terminal.shell.write(data);
  });

  window.api.terminal.shell.onData((data) => {
    state.terminal.write(data);
  });

  window.api.terminal.shell.onClosed(() => {
    state.terminal.writeln('\r\n[Shell session closed]\r\n');
  });

  state.terminal.onResize(({ cols, rows }) => {
    window.api.terminal.shell.resize(cols, rows);
  });

  window.addEventListener('resize', () => {
    if (state.fitAddon) state.fitAddon.fit();
  });
}

dom.btnClearTerminal.addEventListener('click', () => {
  if (state.terminal) state.terminal.clear();
});

// ---- Ollama Models ----
async function loadOllamaModels() {
  const result = await window.api.ollama.list();
  dom.modelSelect.innerHTML = '';

  if (result.success && result.models && result.models.length > 0) {
    for (const m of result.models) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.name;
      if (m.name === state.modelRoles.coder.model) opt.selected = true;
      dom.modelSelect.appendChild(opt);
    }
    // If current coder model not in list (fuzzy match: ignore :latest suffix), keep user setting
    const coderBase = state.modelRoles.coder.model.replace(/:latest$/, '');
    const match = result.models.find((m) => m.name === state.modelRoles.coder.model || m.name.replace(/:latest$/, '') === coderBase);
    if (match) {
      dom.modelSelect.value = match.name;
    }
  } else {
    const opt = document.createElement('option');
    opt.value = state.modelRoles.coder.model;
    opt.textContent = state.modelRoles.coder.model + ' (not verified)';
    dom.modelSelect.appendChild(opt);
  }
}

dom.modelSelect.addEventListener('change', () => {
  state.modelRoles.coder.model = dom.modelSelect.value;
});

dom.btnOllamaModels.addEventListener('click', async () => {
  await checkOllamaConnection();
  await loadOllamaModels();
});

// ---- Chat ----
function addChatMessage(role, content, actions, screenshotBase64) {
  const div = document.createElement('div');
  div.className = 'chat-message';

  const roleClass = role === 'user' ? 'user-role' : role === 'assistant' ? 'assistant-role' : 'system-role';
  const roleLabel = role === 'user' ? 'You' : role === 'assistant' ? 'AI' : 'System';

  let html = `<div class="role ${roleClass}">${roleLabel}</div>`;
  if (screenshotBase64) {
    html += `<div class="chat-screenshot"><img src="data:image/png;base64,${screenshotBase64}" style="max-width:300px;max-height:200px;border-radius:4px;margin-bottom:6px;display:block;cursor:pointer;" onclick="window.open(this.src)"></div>`;
  }
  html += `<div class="content">${formatChatContent(content)}</div>`;

  if (actions && actions.length > 0) {
    for (const action of actions) {
      const typeLabel = action.type === 'edit' ? '✏️ Edit File' : action.type === 'read' ? '📖 Read File' : '▶️ Run Command';
      const desc = action.type === 'edit' ? `Write to ${action.filePath}` : action.type === 'read' ? action.filePath : action.command;
      html += `
        <div class="action-block">
          <div class="action-type">${typeLabel}</div>
          <pre>${escapeHtml(desc)}</pre>
          <button class="btn btn-sm action-apply" data-action='${escapeHtml(JSON.stringify(action))}'>Apply</button>
        </div>
      `;
      // Queue action for Apply All
      pendingActions.push(action);
    }
    updateApplyAllButton();
  }

  div.innerHTML = html;

  div.querySelectorAll('.action-apply').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = JSON.parse(btn.dataset.action);
      btn.disabled = true;
      btn.textContent = 'Applying...';
      await executeAction(action);
      btn.textContent = 'Applied ✓';
      // Remove from pending
      pendingActions = pendingActions.filter(a => JSON.stringify(a) !== JSON.stringify(action));
      updateApplyAllButton();
    });
  });

  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function addSystemMessage(text) {
  addChatMessage('system', text);
}

function formatChatContent(text) {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

let chatBusy = false;
let chatCancelled = false;
const MAX_ACTIONS_PER_RESPONSE = 50;
let pendingActions = [];

function updateApplyAllButton() {
  if (pendingActions.length > 0) {
    dom.btnApplyAll.classList.remove('hidden');
    dom.btnApplyAll.textContent = `Apply All (${pendingActions.length})`;
  } else {
    dom.btnApplyAll.classList.add('hidden');
  }
}

// ---- Screenshot ----
dom.btnScreenshot.addEventListener('click', async () => {
  dom.btnScreenshot.disabled = true;
  dom.btnScreenshot.textContent = '...';
  try {
    const result = await window.api.system.screenshot();
    if (result.success) {
      state.pendingScreenshot = result.base64;
      dom.screenshotImg.src = `data:image/png;base64,${result.base64}`;
      dom.screenshotPreview.classList.remove('hidden');
      dom.chatInput.focus();
    } else if (result.error !== 'Screenshot cancelled') {
      addSystemMessage(`Screenshot failed: ${result.error}`);
    }
  } catch (err) {
    addSystemMessage(`Screenshot error: ${err.message}`);
  }
  dom.btnScreenshot.disabled = false;
  dom.btnScreenshot.textContent = '\ud83d\udcf7';
});

dom.btnRemoveScreenshot.addEventListener('click', () => {
  state.pendingScreenshot = null;
  dom.screenshotImg.src = '';
  dom.screenshotPreview.classList.add('hidden');
});

dom.btnApplyAll.addEventListener('click', async () => {
  if (pendingActions.length === 0) return;
  dom.btnApplyAll.disabled = true;
  dom.btnApplyAll.textContent = 'Applying...';
  const toApply = [...pendingActions];
  pendingActions = [];
  for (const action of toApply) {
    await executeAction(action);
    addSystemMessage(`Applied: ${action.type} ${action.type === 'edit' ? action.filePath : action.type === 'read' ? action.filePath : action.command}`);
  }
  // Mark all Apply buttons as done
  document.querySelectorAll('.action-apply:not([disabled])').forEach(btn => {
    btn.disabled = true;
    btn.textContent = 'Applied ✓';
  });
  dom.btnApplyAll.disabled = false;
  updateApplyAllButton();
});

// ---- Router: classify request ----
async function classifyRequest(userMessage, hasImage) {
  if (!state.autoRoute) {
    // No auto-routing — default to code if agentic, general if not
    if (hasImage) return 'vision';
    return state.agenticMode ? 'code' : 'general';
  }

  // Quick shortcut: if image attached, always vision
  if (hasImage) return 'vision';

  const routerPrompt = `Classify this user request into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- architecture: request involves multi-file scaffolding, project structure, design decisions, refactoring across files, or creating a new project/module from a spec
- code: request involves reading, writing, editing, or debugging a single file or small change
- general: general question, explanation, or discussion

User request: "${userMessage.substring(0, 500)}"

Category:`;

  try {
    console.log('[router] Classifying with', state.modelRoles.router.model);
    const result = await window.api.ollama.chat({
      model: state.modelRoles.router.model,
      messages: [{ role: 'user', content: routerPrompt }],
      options: { num_ctx: state.modelRoles.router.num_ctx },
      timeout: 60000, // 1 minute — classification is fast
    });

    if (result.success && result.message) {
      const raw = (result.message.content || '').trim().toLowerCase();
      // Extract just the category word
      const category = raw.match(/\b(vision|architecture|code|general)\b/)?.[1] || 'code';
      console.log('[router] Classification:', category, '(raw:', raw.substring(0, 50), ')');
      return category;
    }
  } catch (err) {
    console.warn('[router] Classification failed, defaulting to code:', err.message);
  }
  return 'code';
}

// ---- Vision: describe screenshot ----
async function describeScreenshot(screenshotBase64, userText) {
  console.log('[vision] Sending to', state.modelRoles.vision.model);
  const visionPrompt = (userText ? `Respond in English. ${userText}` : 'Respond in English. Describe this screenshot in detail, focusing on any code, UI elements, errors, or relevant technical details.');
  const messages = [
    { role: 'system', content: 'You are a helpful assistant. Always respond in English only. Never respond in Chinese or any other language.' },
    { role: 'user', content: visionPrompt, images: [screenshotBase64] },
  ];

  const result = await window.api.ollama.chat({
    model: state.modelRoles.vision.model,
    messages,
    options: { num_ctx: state.modelRoles.vision.num_ctx },
    timeout: 120000, // 2 minutes — image description
  });

  if (result.success && result.message) {
    const description = result.message.content || '';
    console.log('[vision] Description length:', description.length);
    return description;
  }
  throw new Error(result.error || 'Vision model failed');
}

// ---- Planner: architecture/multi-file planning ----
async function createArchitecturePlan(userMessage, chatHistory) {
  console.log('[planner] Sending to', state.modelRoles.planner.model);

  const plannerSystemPrompt = `You are an expert software architect. Your job is to analyze the user's request and produce a detailed implementation plan.

Working directory: ${state.workingDir}

${state.currentFile ? `Currently open file: ${state.currentFile}` : ''}

Your plan MUST include:
1. A brief summary of the approach (2-3 sentences)
2. A numbered list of EVERY file that needs to be created or modified, with:
   - Full absolute file path
   - What the file does / what changes are needed
   - Key classes, functions, or endpoints it should contain
3. Dependencies or packages needed (if any)
4. The order files should be created in (considering dependencies between them)

Be specific and thorough. The coder model will use your plan to generate all the actual code.
Do NOT write any code yourself — just the plan and file list.`;

  const messages = [
    { role: 'system', content: plannerSystemPrompt },
    ...chatHistory.slice(-10),
    { role: 'user', content: userMessage },
  ];

  const result = await window.api.ollama.chat({
    model: state.modelRoles.planner.model,
    messages,
    options: { num_ctx: state.modelRoles.planner.num_ctx },
    timeout: 300000, // 5 minutes — planning can take a while with large context
  });

  if (result.success && result.message) {
    const plan = result.message.content || '';
    console.log('[planner] Plan length:', plan.length);
    return plan;
  }
  throw new Error(result.error || 'Planner model failed');
}

async function sendChat() {
  const input = dom.chatInput.value.trim();
  if (!input && !state.pendingScreenshot) return;
  if (chatBusy) {
    console.log('[sendChat] Already busy, ignoring');
    return;
  }
  chatBusy = true;
  chatCancelled = false;
  dom.btnCancelChat.classList.remove('hidden');
  dom.btnSendChat.classList.add('hidden');

  dom.chatInput.value = '';

  // Handle screenshot attachment
  const screenshotBase64 = state.pendingScreenshot;
  if (screenshotBase64) {
    state.pendingScreenshot = null;
    dom.screenshotImg.src = '';
    dom.screenshotPreview.classList.add('hidden');
  }

  // Show user message with optional screenshot thumbnail
  const displayText = screenshotBase64
    ? `${input || '(screenshot)'}\n📷 [Screenshot attached]`
    : input;
  addChatMessage('user', displayText, null, screenshotBase64);

  // Loading indicator
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-message';
  loadingDiv.innerHTML = '<div class="role assistant-role">AI</div><div class="content"><span class="spinner"></span> Routing...</div>';
  dom.chatMessages.appendChild(loadingDiv);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  dom.btnSendChat.disabled = true;

  try {
    // Step 1: Classify the request
    let route = await classifyRequest(input, !!screenshotBase64);
    if (state.showRouting) {
      const routeEmoji = { vision: '👁️', architecture: '🏗️', code: '💻', general: '💬' }[route] || '💻';
      const pipeline = route === 'vision' ? `${state.modelRoles.vision.model} → ${state.modelRoles.coder.model}`
        : route === 'architecture' ? `${state.modelRoles.planner.model} → ${state.modelRoles.coder.model}`
        : state.modelRoles.coder.model;
      addSystemMessage(`🔀 Route: ${routeEmoji} ${route} → ${pipeline}`);
    }
    const statusText = { vision: 'Analyzing screenshot...', architecture: 'Planning architecture...', code: 'Thinking...', general: 'Thinking...' };
    loadingDiv.querySelector('.content').innerHTML = `<span class="spinner"></span> ${statusText[route] || 'Thinking...'}`;

    // Step 2: If vision, get description from vision model first
    let visionDescription = '';
    if (route === 'vision' && screenshotBase64) {
      try {
        visionDescription = await describeScreenshot(screenshotBase64, input);
        if (state.showRouting) {
          addSystemMessage(`👁️ Vision: ${visionDescription.substring(0, 200)}${visionDescription.length > 200 ? '...' : ''}`);
        }
        loadingDiv.querySelector('.content').innerHTML = '<span class="spinner"></span> Processing with coder...';
      } catch (vErr) {
        addSystemMessage(`Vision error: ${vErr.message}. Falling back to coder only.`);
      }
    }

    // Step 2b: If vision produced a description, re-classify to see if it needs architecture planning
    if (route === 'vision' && visionDescription) {
      const reRoute = await classifyRequest(`${input}\n\nContext from screenshot: ${visionDescription}`, false);
      if (reRoute === 'architecture') {
        if (state.showRouting) {
          addSystemMessage(`🔀 Re-routed: vision → architecture (screenshot shows structural task)`);
        }
        route = 'architecture';
        loadingDiv.querySelector('.content').innerHTML = '<span class="spinner"></span> Planning architecture...';
      }
    }

    // Step 2c: If architecture, get plan from planner model first
    let architecturePlan = '';
    if (route === 'architecture') {
      try {
        architecturePlan = await createArchitecturePlan(input, state.chatHistory);
        if (state.showRouting) {
          addSystemMessage(`🏗️ Plan from ${state.modelRoles.planner.model}:\n${architecturePlan.substring(0, 500)}${architecturePlan.length > 500 ? '...' : ''}`);
        }
        // Show the full plan as an assistant message from the planner
        addChatMessage('assistant', `**Architecture Plan** (${state.modelRoles.planner.model}):\n\n${architecturePlan}`);
        loadingDiv.querySelector('.content').innerHTML = '<span class="spinner"></span> Executing plan with coder...';
      } catch (pErr) {
        addSystemMessage(`Planner error: ${pErr.message}. Falling back to coder only.`);
      }
    }

    // Step 3: Build the user content for the coder
    let userContent = input;
    if (visionDescription && architecturePlan) {
      // Vision + architecture combined pipeline
      userContent = `USER REQUEST: ${input}\n\n[Screenshot analysis from vision model]:\n${visionDescription}\n\n---\nARCHITECTURE PLAN (from planner model — you MUST execute this NOW):\n${architecturePlan}\n---\n\nIMPORTANT INSTRUCTIONS:\n- You MUST produce action blocks (EDIT_FILE, RUN_CMD) in THIS response.\n- Do NOT just describe what you will do. Actually DO it with action blocks.\n- Use EDIT_FILE to create/write files, RUN_CMD for mkdir/mv/rm.\n- Start with a 1-2 sentence summary, then immediately output action blocks.`;
    } else if (visionDescription) {
      userContent = `${input}\n\n[Screenshot analysis from vision model]:\n${visionDescription}\n\nBased on the screenshot analysis above, take action. Use EDIT_FILE and RUN_CMD blocks to implement any changes needed.`;
    } else if (architecturePlan) {
      userContent = `USER REQUEST: ${input}\n\n---\nARCHITECTURE PLAN (from planner model — you MUST execute this NOW):\n${architecturePlan}\n---\n\nIMPORTANT INSTRUCTIONS:\n- You MUST produce action blocks (EDIT_FILE, RUN_CMD) in THIS response to implement the plan above.\n- Do NOT just describe what you will do. Actually DO it with action blocks.\n- Use EDIT_FILE to create/write files with their full contents.\n- Use RUN_CMD for mkdir, mv, rm, pip install, npm install, etc.\n- Create ALL files listed in the plan in a SINGLE response.\n- Start with a 1-2 sentence summary, then immediately output action blocks.`;
    } else if (screenshotBase64) {
      userContent = `${input}\n\n[A screenshot image was attached but could not be analyzed by the vision model.]`;
    }
    state.chatHistory.push({ role: 'user', content: userContent });

    // Step 4: Build system prompt — suppress agentic blocks for "general" route
    const useAgentic = state.agenticMode && route !== 'general';
    const systemPrompt = buildSystemPrompt(useAgentic, route === 'architecture');

    // For architecture route, limit chat history to avoid context bloat that starves output tokens.
    // The plan + instructions are already in the latest user message, so we don't need old history.
    const historySlice = route === 'architecture' ? state.chatHistory.slice(-4) : state.chatHistory.slice(-20);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historySlice,
    ];

    // Step 5: Call the coder model (with auto-continuation for architecture)
    const coderOptions = { num_ctx: state.modelRoles.coder.num_ctx };
    if (route === 'architecture') {
      coderOptions.num_predict = 16384; // Allow large output for multi-file scaffolding
    }
    const totalChars = messages.reduce((s, m) => s + m.content.length, 0);
    console.log('[sendChat] Calling coder:', state.modelRoles.coder.model, 'messages:', messages.length, 'totalChars:', totalChars, 'agentic:', useAgentic, 'route:', route, 'num_predict:', coderOptions.num_predict || 'default');

    let fullAiContent = '';
    let continuationMessages = [...messages];
    const MAX_CONTINUATIONS = 10;
    let continuationCount = 0;
    let allActions = [];
    let emptyStreak = 0;

    // Loop: call coder, parse actions, auto-continue for architecture if new actions were produced
    while (true) {
      const result = await window.api.ollama.chat({
        model: state.modelRoles.coder.model,
        messages: continuationMessages,
        options: coderOptions,
        timeout: route === 'architecture' ? 900000 : 600000,
      });

      console.log('[sendChat] Got result:', JSON.stringify(result).substring(0, 300));
      console.log('[sendChat] done_reason:', result.done_reason, 'eval_count:', result.eval_count);

      if (!result.success || !result.message) {
        loadingDiv.remove();
        console.log('[sendChat] Error result:', result.error);
        addChatMessage('system', `Error: ${result.error || 'Unknown error'}`);
        dom.btnSendChat.disabled = false;
        dom.btnCancelChat.classList.add('hidden');
        dom.btnSendChat.classList.remove('hidden');
        chatBusy = false;
        chatCancelled = false;
        return;
      }

      const chunk = result.message.content || '';
      fullAiContent += chunk;

      // Parse actions from this chunk — only count edit/command as productive (not read)
      const { actions: chunkActions } = parseAgenticResponse(chunk);
      allActions.push(...chunkActions);
      const productiveChunkActions = chunkActions.filter(a => a.type === 'edit' || a.type === 'command');
      const totalProductive = allActions.filter(a => a.type === 'edit' || a.type === 'command').length;

      console.log('[sendChat] Chunk length:', chunk.length, 'chunk actions:', chunkActions.length, 'productive:', productiveChunkActions.length, 'total productive:', totalProductive, 'continuation:', continuationCount);

      // For architecture route: always continue until we've exhausted retries
      // Track consecutive non-productive responses to know when the coder is truly done
      if (route !== 'architecture' || continuationCount >= MAX_CONTINUATIONS || chatCancelled) {
        break;
      }

      if (productiveChunkActions.length === 0) {
        emptyStreak++;
        console.log('[sendChat] No productive actions in chunk, emptyStreak:', emptyStreak);
        if (emptyStreak >= 3) {
          console.log('[sendChat] 3 consecutive non-productive responses — stopping');
          break;
        }
      } else {
        emptyStreak = 0;
      }

      // Check for explicit completion signal
      if (chunk.includes('ALL_FILES_COMPLETE')) {
        console.log('[sendChat] Coder signalled ALL_FILES_COMPLETE — stopping');
        break;
      }

      continuationCount++;
      addSystemMessage(`⏳ Auto-continuing (${continuationCount}/${MAX_CONTINUATIONS}) — ${totalProductive} edits/commands so far...`);
      loadingDiv.querySelector('.content').innerHTML = `<span class="spinner"></span> Continuing... (part ${continuationCount + 1}, ${totalProductive} edits/cmds)`;

      // Build lean continuation — system + plan + summary of what's done + continue prompt
      const completedFiles = allActions.filter(a => a.type === 'edit').map(a => a.filePath).join('\n  ');
      const completedCmds = allActions.filter(a => a.type === 'command').map(a => a.command).join('\n  ');
      let continuePrompt = `You have produced ${totalProductive} actions so far.`;
      if (completedFiles) continuePrompt += `\nFiles created/edited:\n  ${completedFiles}`;
      if (completedCmds) continuePrompt += `\nCommands issued:\n  ${completedCmds}`;
      continuePrompt += `\n\nNow produce the NEXT EDIT_FILE or RUN_CMD block from the architecture plan. Do NOT repeat any of the above. Do NOT use READ_FILE. Do NOT explain — just output the next action block. When ALL files from the plan are done, write "ALL_FILES_COMPLETE".`;

      continuationMessages = [
        continuationMessages[0], // system prompt
        { role: 'user', content: historySlice[historySlice.length - 1].content }, // original user message with plan
        { role: 'assistant', content: chunk },
        { role: 'user', content: continuePrompt },
      ];
    }

    loadingDiv.remove();

    if (fullAiContent) {
      const aiContent = fullAiContent;
      console.log('[sendChat] Final AI content length:', aiContent.length, 'continuations:', continuationCount);
      state.chatHistory.push({ role: 'assistant', content: aiContent });

      if (useAgentic) {
        const { text, actions } = parseAgenticResponse(aiContent);
        console.log('[sendChat] Parsed agentic: text length:', text.length, 'actions:', actions.length);
        addChatMessage('assistant', text, actions);

        const cappedActions = actions.slice(0, MAX_ACTIONS_PER_RESPONSE);
        if (actions.length > MAX_ACTIONS_PER_RESPONSE) {
          addSystemMessage(`⚠ Capped at ${MAX_ACTIONS_PER_RESPONSE} actions (${actions.length} requested). Run remaining manually.`);
        }

        // Auto-execute READ_FILE actions immediately (they just display content)
        const readActions = cappedActions.filter(a => a.type === 'read');
        const otherActions = cappedActions.filter(a => a.type !== 'read');

        for (const action of readActions) {
          console.log('[sendChat] Auto-executing read:', action.filePath);
          await executeAction(action);
          addSystemMessage(`Read: ${action.filePath}`);
          pendingActions = pendingActions.filter(a => !(a.type === 'read' && a.filePath === action.filePath));
          updateApplyAllButton();
        }

        if (otherActions.length > 0) {
          addSystemMessage(`${otherActions.length} action(s) queued — click **Apply All** to execute.`);
        }

        // If only read actions, auto-follow-up so model can analyze
        if (readActions.length > 0 && otherActions.length === 0) {
          console.log('[sendChat] Auto-follow-up after READ_FILE actions');

          const followUpLoading = document.createElement('div');
          followUpLoading.className = 'chat-message';
          followUpLoading.innerHTML = '<div class="role assistant-role">AI</div><div class="content"><span class="spinner"></span> Analyzing...</div>';
          dom.chatMessages.appendChild(followUpLoading);
          dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

          const originalRequest = state.chatHistory.filter(m => m.role === 'user' && !m.content.startsWith('[File contents of')).slice(-1)[0]?.content || '';

          const followUpMessages = [
            { role: 'system', content: buildSystemPrompt(true) },
            ...state.chatHistory.slice(-30),
            { role: 'user', content: `I have read the files above. Original request: "${originalRequest}"

IMPORTANT INSTRUCTIONS FOR THIS RESPONSE:
- You MUST produce EDIT_FILE blocks NOW to create all needed files.
- Do NOT use READ_FILE — all file contents are already above.
- Do NOT use RUN_CMD to explore or check directories — just create the files directly.
- EDIT_FILE will create parent directories automatically.
- Create EVERY file needed in a SINGLE response: source code, configs, requirements, etc.
- Start with a brief plan (2-3 sentences max), then output all EDIT_FILE blocks.` },
          ];

          console.log('[sendChat] Follow-up messages count:', followUpMessages.length, 'total chars:', followUpMessages.reduce((s, m) => s + m.content.length, 0));

          try {
            const followUp = await window.api.ollama.chat({
              model: state.modelRoles.coder.model,
              messages: followUpMessages,
              options: { num_ctx: state.modelRoles.coder.num_ctx },
              timeout: 900000, // 15 minutes — follow-up scaffolding with large context
            });
            followUpLoading.remove();

            if (followUp.success && followUp.message) {
              const followContent = followUp.message.content || '';
              console.log('[sendChat] Follow-up content length:', followContent.length);
              console.log('[sendChat] Follow-up first 500 chars:', followContent.substring(0, 500));
              state.chatHistory.push({ role: 'assistant', content: followContent });

              const { text: fText, actions: fActions } = parseAgenticResponse(followContent);
              console.log('[sendChat] Follow-up parsed:', fActions.length, 'actions');
              addChatMessage('assistant', fText, fActions);
              if (fActions.length > 0) {
                addSystemMessage(`${fActions.length} action(s) queued — click **Apply All** to execute.`);
              }
            } else {
              followUpLoading.remove();
              console.log('[sendChat] Follow-up error:', followUp.error);
              addChatMessage('system', `Follow-up error: ${followUp.error || 'Unknown error'}`);
            }
          } catch (fuErr) {
            followUpLoading.remove();
            addChatMessage('system', `Follow-up error: ${fuErr.message}`);
          }
        }
      } else {
        addChatMessage('assistant', aiContent);
      }
    }
  } catch (err) {
    console.error('[sendChat] Exception:', err);
    loadingDiv.remove();
    addChatMessage('system', `Error: ${err.message}`);
  }

  dom.btnSendChat.disabled = false;
  dom.btnCancelChat.classList.add('hidden');
  dom.btnSendChat.classList.remove('hidden');
  chatBusy = false;
  chatCancelled = false;
}

// ---- Cancel handler ----
dom.btnCancelChat.addEventListener('click', async () => {
  console.log('[cancel] User cancelled request');
  chatCancelled = true;
  await window.api.ollama.cancel();
  addSystemMessage('Request cancelled.');
});

function buildSystemPrompt(agentic, isArchitecture) {
  // If agentic param not passed, use state default
  const useAgentic = agentic !== undefined ? agentic : state.agenticMode;

  let prompt = `You are an AI coding assistant embedded in Vibe IDE. You help the user with coding tasks on their local machine.

Working directory: ${state.workingDir}
Currently browsing: ${state.currentBrowseDir}
`;

  if (state.currentFile) {
    const fileInfo = state.openFiles.get(state.currentFile);
    if (fileInfo) {
      const content = fileInfo.model.getValue();
      const lines = content.split('\n').length;
      prompt += `\nCurrently open file: ${state.currentFile} (${lines} lines, language: ${getLanguageFromPath(state.currentFile)})`;
      if (lines <= 200) {
        prompt += `\nFile contents:\n\`\`\`\n${content}\n\`\`\`\n`;
      } else {
        prompt += `\nFile is large (${lines} lines). First 100 lines:\n\`\`\`\n${content.split('\n').slice(0, 100).join('\n')}\n\`\`\`\n`;
      }
    }
  }

  if (useAgentic) {
    prompt += `
AGENTIC MODE IS ON. You can perform actions by including special blocks in your response:

To read a file:
<READ_FILE path="/absolute/path/to/file">
</READ_FILE>

To edit/create a file:
<EDIT_FILE path="/absolute/path/to/file">
file contents here
</EDIT_FILE>

To run a shell command:
<RUN_CMD>
command here
</RUN_CMD>

You can include multiple actions. Explain what you're doing before each action.
Always use absolute paths. The working directory is ${state.workingDir}.
Be proactive: if the user asks you to build something, write the code and create the files.
If you need to read a file first, use READ_FILE. The file contents will be shown to you.
If you need to install packages, use the RUN_CMD block.
To move or rename files, use RUN_CMD with mv commands.
To delete files, use RUN_CMD with rm commands.
To create directories, use RUN_CMD with mkdir -p commands.
`;
  }

  if (isArchitecture && useAgentic) {
    prompt += `
ARCHITECTURE MODE: A planner model has already created a detailed plan for you.
Your ONLY job is to EXECUTE that plan by producing EDIT_FILE and RUN_CMD blocks.
DO NOT explain, summarize, or describe what you plan to do.
DO NOT use READ_FILE unless absolutely necessary — the plan already tells you what to create.
START your response with action blocks immediately.
Produce ALL files in ONE response. Do not stop early.
`;
  }

  return prompt;
}

function parseAgenticResponse(content) {
  const actions = [];
  let text = content;

  // Collect all action blocks with their positions so we can sort by order of appearance
  const allMatches = [];

  const readRegex = /<READ_FILE\s+path="([^"]+)">[\s\S]*?<\/READ_FILE>/g;
  let match;
  while ((match = readRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'read', filePath: match[1] });
  }

  const editRegex = /<EDIT_FILE\s+path="([^"]+)">\n?([\s\S]*?)<\/EDIT_FILE>/g;
  while ((match = editRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'edit', filePath: match[1], content: match[2].trimEnd() });
  }

  const cmdRegex = /<RUN_CMD>\n?([\s\S]*?)<\/RUN_CMD>/g;
  while ((match = cmdRegex.exec(content)) !== null) {
    allMatches.push({ index: match.index, raw: match[0], type: 'command', command: match[1].trim() });
  }

  // Sort by position in the original content
  allMatches.sort((a, b) => a.index - b.index);

  for (const m of allMatches) {
    if (m.type === 'read') {
      actions.push({ type: 'read', filePath: m.filePath, description: `Read ${m.filePath}` });
      text = text.replace(m.raw, `[📖 Read: ${m.filePath}]`);
    } else if (m.type === 'edit') {
      actions.push({ type: 'edit', filePath: m.filePath, content: m.content, description: `Write to ${m.filePath}` });
      text = text.replace(m.raw, `[📝 Edit: ${m.filePath}]`);
    } else if (m.type === 'command') {
      actions.push({ type: 'command', command: m.command, description: m.command });
      text = text.replace(m.raw, `[▶️ Command: ${m.command}]`);
    }
  }

  return { text: text.trim(), actions };
}

async function executeAction(action) {
  try {
    if (action.type === 'edit') {
      const result = await window.api.fs.write(action.filePath, action.content);
      if (result.success) {
        state.fileIndexDirty = true;
        if (state.openFiles.has(action.filePath)) {
          const fileInfo = state.openFiles.get(action.filePath);
          fileInfo.model.setValue(action.content);
          fileInfo.modified = false;
          fileInfo.originalContent = action.content;
          updateTabModified(action.filePath, false);
        }
        await loadFileTree(state.currentBrowseDir);
      } else {
        addSystemMessage(`Failed to write ${action.filePath}: ${result.error}`);
      }
    } else if (action.type === 'read') {
      addSystemMessage(`Reading: ${action.filePath}`);
      const result = await window.api.fs.read(action.filePath);
      if (result.success) {
        const content = result.content;
        const lines = content.split('\n').length;
        const preview = lines > 300 ? content.split('\n').slice(0, 300).join('\n') + `\n... (${lines} total lines)` : content;
        addSystemMessage(`📖 ${action.filePath} (${lines} lines):\n\`\`\`\n${preview}\n\`\`\``);
        state.chatHistory.push({ role: 'user', content: `[File contents of ${action.filePath}]:\n${preview}` });
        await openFile(action.filePath);
      } else if (result.error && result.error.includes('EISDIR')) {
        // Path is a directory — fall back to listing its contents
        addSystemMessage(`${action.filePath} is a directory — listing contents instead.`);
        const listResult = await window.api.fs.list(action.filePath);
        if (listResult.success) {
          const listing = listResult.items.map(i => `${i.isDirectory ? '📁' : '📄'} ${i.name}${i.isDirectory ? '/' : ''} (${i.size} bytes)`).join('\n');
          addSystemMessage(`📂 ${action.filePath}:\n\`\`\`\n${listing}\n\`\`\``);
          state.chatHistory.push({ role: 'user', content: `[Directory listing of ${action.filePath}]:\n${listing}` });
        } else {
          addSystemMessage(`Failed to list ${action.filePath}: ${listResult.error}`);
        }
      } else {
        addSystemMessage(`Failed to read ${action.filePath}: ${result.error}`);
      }
    } else if (action.type === 'command') {
      addSystemMessage(`Running: ${action.command}`);
      const result = await window.api.terminal.exec(action.command);
      if (result.stdout) {
        addSystemMessage(`Output:\n\`\`\`\n${result.stdout}\n\`\`\``);
      }
      if (result.stderr) {
        addSystemMessage(`Stderr:\n\`\`\`\n${result.stderr}\n\`\`\``);
      }
      state.fileIndexDirty = true;
      await loadFileTree(state.currentBrowseDir);
    }
  } catch (err) {
    addSystemMessage(`Action failed: ${err.message}`);
  }
}

dom.btnSendChat.addEventListener('click', sendChat);

dom.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

dom.agenticMode.addEventListener('change', () => {
  state.agenticMode = dom.agenticMode.checked;
});

// ---- Resizers ----
function setupResizers() {
  setupVerticalResizer(dom.sidebarResizer, $('#sidebar'), 'left');
  setupVerticalResizer(dom.chatResizer, $('#chat-panel'), 'right');
  setupHorizontalResizer(dom.terminalResizer, $('#terminal-panel'));
}

function setupVerticalResizer(handle, panel, side) {
  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e) => {
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
      const newWidth = Math.max(150, Math.min(600, startWidth + delta));
      panel.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (state.fitAddon) state.fitAddon.fit();
      if (state.editor) state.editor.layout();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function setupHorizontalResizer(handle, panel) {
  let startY, startHeight;

  handle.addEventListener('mousedown', (e) => {
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    handle.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeight + delta));
      panel.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (state.fitAddon) state.fitAddon.fit();
      if (state.editor) state.editor.layout();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ---- Status Bar ----
function setStatus(position, text) {
  if (position === 'left') dom.statusLeft.textContent = text;
  else if (position === 'center') dom.statusCenter.textContent = text;
  else if (position === 'right') dom.statusRight.textContent = text;
}

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentFile();
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    buildFileIndex().then(() => showQuickPicker());
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    openFolder();
  }

  if ((e.ctrlKey || e.metaKey) && e.key === '`') {
    e.preventDefault();
    if (state.terminal) state.terminal.focus();
  }
});

// ---- Start the app ----
initApp();
