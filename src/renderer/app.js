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
  ollamaModel: 'qwen3:32b',
  ollamaHost: 'http://192.168.10.160:11434',
  agenticMode: true,
  ollamaConnected: false,
  editor: null,
  terminal: null,
  fitAddon: null,
  refreshTimer: null,
  fileIndex: [],
  fileIndexDirty: true,
  quickPickerSelectedIndex: 0,
};

// ---- DOM Refs ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  settingsModal: $('#settings-modal'),
  settingsOllamaHost: $('#setting-ollama-host'),
  settingsOllamaModel: $('#setting-ollama-model'),
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
  quickPicker: $('#quick-picker'),
  quickPickerInput: $('#quick-picker-input'),
  quickPickerResults: $('#quick-picker-results'),
  quickPickerBackdrop: $('.quick-picker-backdrop'),
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

  addSystemMessage(`Vibe IDE ready. Local files at ${homedir}. Ollama server: ${state.ollamaHost}. Model: ${state.ollamaModel}. Agentic mode enabled.`);
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
  dom.settingsOllamaModel.value = state.ollamaModel;
  dom.settingsWorkDir.value = state.workingDir;
  dom.settingsError.textContent = '';
  dom.settingsModal.classList.remove('hidden');
});

dom.btnSettingsCancel.addEventListener('click', () => {
  dom.settingsModal.classList.add('hidden');
});

dom.btnSettingsSave.addEventListener('click', async () => {
  const newHost = dom.settingsOllamaHost.value.trim();
  const newModel = dom.settingsOllamaModel.value.trim();
  const newWorkDir = dom.settingsWorkDir.value.trim();

  if (newHost && newHost !== state.ollamaHost) {
    state.ollamaHost = newHost;
    await window.api.config.setOllamaHost(newHost);
  }

  if (newModel) {
    state.ollamaModel = newModel;
  }

  if (newWorkDir && newWorkDir !== state.workingDir) {
    state.workingDir = newWorkDir;
    state.currentBrowseDir = newWorkDir;
    dom.statusLeft.textContent = `Local: ${newWorkDir}`;
    await loadFileTree(newWorkDir);
  }

  await checkOllamaConnection();
  await loadOllamaModels();

  dom.settingsModal.classList.add('hidden');
  addSystemMessage(`Settings updated. Ollama: ${state.ollamaHost}, Model: ${state.ollamaModel}, Dir: ${state.workingDir}`);
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

  const name = filePath.split('/').pop();
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
  state.editor.setModel(fileInfo.model);
  dom.currentFilePath.textContent = filePath;
  dom.fileModified.classList.toggle('hidden', !fileInfo.modified);
  setStatus('right', getLanguageFromPath(filePath));
}

function closeTab(filePath) {
  const fileInfo = state.openFiles.get(filePath);
  if (!fileInfo) return;

  fileInfo.model.dispose();
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
      if (m.name === state.ollamaModel) opt.selected = true;
      dom.modelSelect.appendChild(opt);
    }
    // If current model not in list, select first
    if (!result.models.find((m) => m.name === state.ollamaModel) && result.models.length > 0) {
      state.ollamaModel = result.models[0].name;
      dom.modelSelect.value = state.ollamaModel;
    }
  } else {
    const opt = document.createElement('option');
    opt.value = state.ollamaModel;
    opt.textContent = state.ollamaModel + ' (not verified)';
    dom.modelSelect.appendChild(opt);
  }
}

dom.modelSelect.addEventListener('change', () => {
  state.ollamaModel = dom.modelSelect.value;
});

dom.btnOllamaModels.addEventListener('click', async () => {
  await checkOllamaConnection();
  await loadOllamaModels();
});

// ---- Chat ----
function addChatMessage(role, content, actions) {
  const div = document.createElement('div');
  div.className = 'chat-message';

  const roleClass = role === 'user' ? 'user-role' : role === 'assistant' ? 'assistant-role' : 'system-role';
  const roleLabel = role === 'user' ? 'You' : role === 'assistant' ? 'AI' : 'System';

  let html = `<div class="role ${roleClass}">${roleLabel}</div>`;
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
const MAX_ACTIONS_PER_RESPONSE = 5;
let pendingActions = [];

function updateApplyAllButton() {
  if (pendingActions.length > 0) {
    dom.btnApplyAll.classList.remove('hidden');
    dom.btnApplyAll.textContent = `Apply All (${pendingActions.length})`;
  } else {
    dom.btnApplyAll.classList.add('hidden');
  }
}

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

async function sendChat() {
  const input = dom.chatInput.value.trim();
  if (!input) return;
  if (chatBusy) {
    console.log('[sendChat] Already busy, ignoring');
    return;
  }
  chatBusy = true;

  dom.chatInput.value = '';
  addChatMessage('user', input);

  const systemPrompt = buildSystemPrompt();
  state.chatHistory.push({ role: 'user', content: input });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...state.chatHistory.slice(-20),
  ];

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-message';
  loadingDiv.innerHTML = '<div class="role assistant-role">AI</div><div class="content"><span class="spinner"></span> Thinking...</div>';
  dom.chatMessages.appendChild(loadingDiv);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

  dom.btnSendChat.disabled = true;

  try {
    console.log('[sendChat] Calling ollama.chat, model:', state.ollamaModel, 'messages:', messages.length);
    const result = await window.api.ollama.chat({
      model: state.ollamaModel,
      messages,
    });

    console.log('[sendChat] Got result:', JSON.stringify(result).substring(0, 300));
    loadingDiv.remove();

    if (result.success && result.message) {
      const aiContent = result.message.content || '';
      console.log('[sendChat] AI content length:', aiContent.length, 'first 200:', aiContent.substring(0, 200));
      state.chatHistory.push({ role: 'assistant', content: aiContent });

      if (state.agenticMode) {
        const { text, actions } = parseAgenticResponse(aiContent);
        console.log('[sendChat] Parsed agentic: text length:', text.length, 'actions:', actions.length);
        addChatMessage('assistant', text, actions);

        const cappedActions = actions.slice(0, MAX_ACTIONS_PER_RESPONSE);
        if (actions.length > MAX_ACTIONS_PER_RESPONSE) {
          addSystemMessage(`⚠ Capped at ${MAX_ACTIONS_PER_RESPONSE} actions (${actions.length} requested). Run remaining manually.`);
        }

        // Auto-execute READ_FILE actions immediately (they just display content)
        // All other actions get queued for Apply All
        const readActions = cappedActions.filter(a => a.type === 'read');
        const otherActions = cappedActions.filter(a => a.type !== 'read');

        for (const action of readActions) {
          console.log('[sendChat] Auto-executing read:', action.filePath);
          await executeAction(action);
          addSystemMessage(`Read: ${action.filePath}`);
          // Remove from pending since we auto-executed it
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

          // Build follow-up with file contents clearly embedded
          const followUpMessages = [
            { role: 'system', content: buildSystemPrompt() },
            ...state.chatHistory.slice(-20),
            { role: 'user', content: 'The file contents have been provided above. Now continue with the original request: analyze the file and perform any requested actions. Do NOT use READ_FILE again for files already shown. Use EDIT_FILE to create any output files.' },
          ];

          try {
            const followUp = await window.api.ollama.chat({
              model: state.ollamaModel,
              messages: followUpMessages,
            });
            followUpLoading.remove();

            if (followUp.success && followUp.message) {
              const followContent = followUp.message.content || '';
              console.log('[sendChat] Follow-up content length:', followContent.length);
              state.chatHistory.push({ role: 'assistant', content: followContent });

              const { text: fText, actions: fActions } = parseAgenticResponse(followContent);
              addChatMessage('assistant', fText, fActions);
              // Follow-up actions also get queued, not auto-executed
              if (fActions.length > 0) {
                addSystemMessage(`${fActions.length} action(s) queued — click **Apply All** to execute.`);
              }
            } else {
              followUpLoading.remove();
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
    } else {
      console.log('[sendChat] Error result:', result.error);
      addChatMessage('system', `Error: ${result.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('[sendChat] Exception:', err);
    loadingDiv.remove();
    addChatMessage('system', `Error: ${err.message}`);
  }

  dom.btnSendChat.disabled = false;
  chatBusy = false;
}

function buildSystemPrompt() {
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

  if (state.agenticMode) {
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
        const preview = lines > 100 ? content.split('\n').slice(0, 100).join('\n') + `\n... (${lines} total lines)` : content;
        addSystemMessage(`📖 ${action.filePath} (${lines} lines):\n\`\`\`\n${preview}\n\`\`\``);
        // Add file content as a user message so the model reliably sees it
        state.chatHistory.push({ role: 'user', content: `[File contents of ${action.filePath}]:\n${preview}` });
        // Also open the file in the editor
        await openFile(action.filePath);
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
