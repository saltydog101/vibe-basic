# Vibe IDE

An Electron-based IDE for agentic/vibe coding that connects to a remote server via SSH and uses Ollama for AI assistance.

## Features

- **Monaco Editor** — Full VS Code editor with syntax highlighting, bracket matching, minimap
- **SSH Remote Connection** — Connect to any server with SSH key or password auth
- **Remote File Explorer** — Browse, create, and delete files/folders on the remote server
- **Integrated Terminal** — Full interactive terminal via SSH (xterm.js)
- **Ollama AI Chat** — Chat with any Ollama model running on the remote server
- **Agentic Mode** — AI can automatically edit files and run commands on your behalf
- **Multi-tab Editing** — Open multiple files in tabs with modification tracking
- **Resizable Panels** — Drag to resize sidebar, terminal, and chat panels

## Prerequisites

1. **Node.js** (v18+)
2. **Ollama** running on the remote server (`http://localhost:11434`)
3. **SSH access** to the remote server (key or password)

## Setup

```bash
# Clone and install
cd vibe-ide
npm install

# Run
npm start

# Run with DevTools open
npm run dev
```

## Usage

1. Launch the app — a connection dialog appears
2. Enter your SSH connection details (host, port, username, auth method)
3. Set the remote working directory and preferred Ollama model
4. Click **Connect**

### Editor
- Open files from the sidebar file explorer
- `Ctrl+S` to save
- Multi-tab support with unsaved change indicators

### Terminal
- Full interactive SSH shell
- `Ctrl+`` to focus terminal

### AI Assistant
- Type your request in the chat panel
- **Agentic Mode ON**: AI can create/edit files and run commands automatically
- **Agentic Mode OFF**: AI gives suggestions without auto-executing
- The AI sees your currently open file as context
- Use the model dropdown to switch Ollama models

### Agentic Capabilities

When agentic mode is enabled, the AI can:
- Create and edit files on the remote server
- Run shell commands (install packages, build projects, etc.)
- Read your current file for context
- Chain multiple actions together

## Architecture

```
src/
├── main/
│   ├── main.js          # Electron main process, IPC handlers
│   ├── ssh-manager.js   # SSH/SFTP connection management
│   └── preload.js       # Context bridge for renderer
└── renderer/
    ├── index.html       # Main UI layout
    ├── styles.css       # Dark theme styling
    └── app.js           # Editor, terminal, file explorer, chat logic
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current file |
| `Ctrl+`` | Focus terminal |
| `Enter` | Send chat message |
| `Shift+Enter` | New line in chat |

## License

MIT
