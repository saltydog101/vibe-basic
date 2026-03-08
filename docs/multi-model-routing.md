# Multi-Model Routing Architecture

## AI Box Hardware

- **GPU**: AMD Radeon Instinct (device 0x1586) via ROCm
- **VRAM**: 96 GB total (~99% used when 79.7B model loaded)
- **System RAM**: 32 GB (25 GB available)
- **Disk**: 1.4 TB free on NVMe

## Final Model Lineup

| Role | Model | Params | Size | Loaded Where | Purpose |
|------|-------|--------|------|-------------|----------|
| **Router** | qwen3:4b | 4.0B | 5.4 GB | VRAM (always) | Fast request classification |
| **Planner** | qwen3:32b | 32B (dense) | 29 GB | VRAM (always) | Architecture, multi-file planning, design decisions |
| **Coder** | qwen3-coder-next | 79.7B (MoE) | 54 GB | VRAM (always, 32K ctx) | Code generation, single-file edits, implementation |
| **Vision** | minicpm-v:latest | 8B | 4.7 GB | VRAM (always) | Screenshot/image analysis |
| **Embedder** | nomic-embed-text | 137M | 604 MB | VRAM (always) | Codebase indexing, RAG semantic search |

> **Why both qwen3:32b and 79.7B coder?** The 32B model is dense — all 32B params active on every token,
> making it better at holistic reasoning across multiple files and design decisions. The 79.7B MoE model
> has ~3B active params per token but excels at code generation patterns. Planner thinks, coder writes.

### VRAM Budget (observed via `ollama ps`)

| Model | VRAM | num_ctx | Keep-alive |
|-------|------|---------|------------|
| qwen3-coder-next | 54 GB | 32768 | Forever |
| qwen3:32b | 29 GB | 16384 | Forever |
| qwen3:4b | 5.4 GB | 8192 | Forever |
| minicpm-v:latest | 4.7 GB | 2048 | Forever |
| nomic-embed-text | 604 MB | 2048 | Forever |
| **Total** | **~94 GB** | | |

**Rule**: Every `ollama:chat` API call MUST include `options.num_ctx` to cap context size per model role:

```js
// Router — small context, just classification
{ model: 'qwen3:4b', messages, options: { num_ctx: 2048 } }

// Planner — architecture and multi-file decisions
{ model: 'qwen3:32b', messages, options: { num_ctx: 16384 } }

// Coder — full context for code generation
{ model: 'qwen3-coder-next', messages, options: { num_ctx: 32768 } }

// Vision — image description
{ model: 'minicpm-v:latest', messages, options: { num_ctx: 2048 } }
```

## Architecture: Router → Model Pipeline

### Request Flow

```
User sends message (possibly with screenshot)
       │
       ▼
  ┌─────────────┐
  │   Router     │  qwen3:4b (~1 second, num_ctx: 2048)
  │   Classify   │  → "vision" | "architecture" | "code" | "general"
  └──────┬───────┘
         │
         ├── vision ──────► minicpm-v (num_ctx: 2048) ──► describe image
         │                        │
         │                        ▼
         │                 Coder (79.7B, num_ctx: 32768) ──► act on description
         │
         ├── architecture ► qwen3:32b (num_ctx: 16384) ──► produce plan
         │                        │
         │                        ▼
         │                 Coder (79.7B, num_ctx: 32768) ──► execute plan with EDIT_FILE
         │
         ├── code ────────► Coder (79.7B, num_ctx: 32768) ──► respond with actions
         │
         └── general ─────► Coder (79.7B, num_ctx: 32768) ──► respond (NO actions)
```

### Key Design Decisions

1. **The 79.7B coder stays loaded in VRAM permanently** — it's the code generation workhorse
2. **qwen3:32b (dense) handles architecture** — 32B active params for holistic reasoning
3. **qwen3:4b classifies requests** — near-zero overhead, ~1 second per classification
4. **minicpm-v stays loaded** — small footprint (4.7 GB), always ready for screenshots
5. **All 5 models coexist in VRAM** — ~94 GB total, no swapping needed
6. **num_ctx is mandatory** — prevents Ollama from auto-expanding and evicting models

### Router Prompt (qwen3:4b)

```
Classify this user request into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- vision: request includes an image/screenshot to analyze
- architecture: request involves multi-file scaffolding, project structure, design decisions, or creating a new project/module from a spec
- code: request involves reading, writing, editing, or debugging a single file or small change
- general: general question, explanation, or discussion

User request: "{user_message}"
Has image: {yes/no}

Category:
```

### Architecture Pipeline (NEW)

```
1. Router classifies as "architecture"
2. Send request to qwen3:32b planner (num_ctx: 16384)
3. Planner produces detailed plan: file list, structure, approach, dependencies
4. Plan shown to user in chat
5. Plan + original request sent to coder (num_ctx: 32768)
6. Coder executes the plan with EDIT_FILE blocks for every file
```

### Vision Pipeline

```
1. Router classifies as "vision"
2. Send screenshot + user text to minicpm-v (num_ctx: 2048)
3. Vision model describes what it sees
4. Send vision description + user text to coder (num_ctx: 32768)
5. Coder responds with analysis/actions as usual
```

### General Query Pipeline

```
1. Router classifies as "general"
2. Send to coder with MODIFIED system prompt (no agentic action blocks)
3. Coder responds with text only — no EDIT_FILE, RUN_CMD, READ_FILE
```

## Implementation

### IDE Changes Required

1. **`main.js`** — Pass `options.num_ctx` and `timeout` in all `ollama:chat` IPC handlers
2. **`app.js` state** — Add `modelRoles: { router, planner, coder, vision }` with defaults
3. **`app.js` sendChat** — Add router step before main model call:
   - Call qwen3:4b to classify (vision / architecture / code / general)
   - If architecture: call qwen3:32b planner, then forward plan to coder
   - If vision: call minicpm-v, then forward description to coder
   - If code: call coder with agentic system prompt
   - If general: call coder with non-agentic system prompt
4. **Settings UI** — Add model role inputs (router, planner, coder, vision) with context limits
5. **Chat UI** — Show routing indicator and planner output in chat

### Server Changes (done separately by user)
- Pull `minicpm-v:latest`, `qwen3:32b`
- Set `OLLAMA_MAX_LOADED_MODELS=5`
- Optionally bake num_ctx into Modelfiles as backup

## Settings UI

```
Model Roles:
  Router:   [qwen3:4b              ] [2048  ]
  Planner:  [qwen3:32b             ] [16384 ]
  Coder:    [qwen3-coder-next:latest] [32768 ]
  Vision:   [minicpm-v:latest      ] [2048  ]

[x] Auto-route (use router to classify requests)
[x] Show routing decisions in chat
```

## Future: Embeddings + RAG (Phase 3)
1. Index project files with nomic-embed-text on folder open
2. Retrieve top-N relevant files for each request
3. Include retrieved context in prompt automatically
