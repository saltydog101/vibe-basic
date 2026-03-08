# Vibe IDE

An Electron-based IDE for agentic/vibe coding with multi-model AI routing. Uses Ollama for AI assistance with a dedicated router, coder, and vision model pipeline.

## Features

- **Monaco Editor** — Full VS Code editor with syntax highlighting, bracket matching, minimap
- **Local File Explorer** — Browse, create, and delete files/folders on the local machine
- **Integrated Terminal** — Full interactive local shell (xterm.js)
- **Multi-Model AI Routing** — Automatic request classification using a fast router model
  - **Router** (qwen3:4b) — classifies requests as vision/code/general in ~1 second
  - **Coder** (qwen3-coder-next) — 79.7B parameter model for code generation, analysis, planning
  - **Vision** (qwen2.5vl:7b) — screenshot/image analysis, forwards descriptions to coder
- **Agentic Mode** — AI can read/create/edit files and run commands automatically
- **Screenshot Capture** — Select a screen region, AI analyzes it via the vision model
- **Cancel Button** — Abort in-flight AI requests at any time
- **Configurable Context Limits** — Set `num_ctx` per model role to manage VRAM
- **Multi-tab Editing** — Open multiple files in tabs with modification tracking
- **Resizable Panels** — Drag to resize sidebar, terminal, and chat panels
- **Quick File Picker** — `Ctrl+P` to fuzzy-search and open files

## Prerequisites

1. **Node.js** (v18+)
2. **Ollama** running on a reachable host (default: `http://192.168.10.160:11434`)
3. Required models pulled on the Ollama server:
   - `qwen3:4b` (router)
   - `qwen3-coder-next:latest` (coder)
   - `qwen2.5vl:7b` (vision)
   - `nomic-embed-text` (embedder, optional)

## Setup

```bash
# Clone and install
git clone https://github.com/saltydog101/vibe-basic.git
cd vibe-basic
npm install

# Run
npm start

# Run with DevTools open
npm run dev
```

## Usage

1. Launch the app — it auto-connects to the Ollama server
2. Click **Settings** to configure the Ollama host, model roles, and working directory
3. Start coding — the AI assistant is in the right panel

### Editor
- Open files from the sidebar file explorer
- `Ctrl+S` to save
- `Ctrl+P` to quick-open files by name
- Multi-tab support with unsaved change indicators

### Terminal
- Full interactive local shell
- `Ctrl+`` ` to focus terminal

### AI Assistant
- Type your request in the chat panel
- **Agentic Mode ON**: AI can create/edit files and run commands automatically
- **Agentic Mode OFF**: AI gives suggestions without auto-executing
- The AI sees your currently open file as context
- Use the model dropdown to switch the active coder model
- **Cancel** button appears during requests — click to abort

### Multi-Model Routing

When auto-route is enabled, every request goes through a classification step:

1. **Router** (qwen3:4b) classifies the request as `vision`, `code`, or `general`
2. **Vision** route: screenshot → qwen2.5vl:7b describes → coder acts on description
3. **Code** route: coder responds with full agentic capabilities (read/edit/run)
4. **General** route: coder responds without agentic action blocks

See [docs/multi-model-routing.md](docs/multi-model-routing.md) for the full architecture.

### Screenshot Analysis

1. Click the 📷 button to capture a screen region
2. Type your question about the screenshot (or leave blank)
3. The vision model describes the image, then the coder acts on the description

### Agentic Capabilities

When agentic mode is enabled, the AI can:
- Create and edit files on the local machine
- Run shell commands (install packages, build projects, etc.)
- Read files for context, then act on them in a follow-up
- Chain multiple actions together (up to 5 per response)

## Architecture

```
src/
├── main/
│   ├── main.js            # Electron main process, IPC handlers, Ollama HTTP client
│   ├── local-manager.js   # Local filesystem operations
│   ├── ssh-manager.js     # SSH/SFTP connection management (optional)
│   └── preload.js         # Context bridge for renderer
└── renderer/
    ├── index.html         # Main UI layout, settings modal
    ├── styles.css         # Dark theme styling
    └── app.js             # Editor, terminal, file explorer, chat, multi-model routing
docs/
└── multi-model-routing.md # Design doc: model lineup, VRAM budget, routing architecture
```

## Settings

Configurable via the Settings modal (gear icon):

| Setting | Default | Description |
|---------|---------|-------------|
| Ollama Host | `http://192.168.10.160:11434` | Ollama API endpoint |
| Router Model | `qwen3:4b` | Fast classification model |
| Router Context | `2048` | num_ctx for router |
| Coder Model | `qwen3-coder-next:latest` | Main code generation model |
| Coder Context | `32768` | num_ctx for coder |
| Vision Model | `qwen2.5vl:7b` | Image analysis model |
| Vision Context | `4096` | num_ctx for vision |
| Auto-route | ON | Use router to classify requests |
| Show routing | ON | Display routing decisions in chat |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save current file |
| `Ctrl+P` | Quick file picker |
| `Ctrl+`` ` | Focus terminal |
| `Enter` | Send chat message |
| `Shift+Enter` | New line in chat |

## License

MIT
