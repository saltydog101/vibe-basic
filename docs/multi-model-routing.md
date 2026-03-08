# Multi-Model Routing Architecture

## AI Box Hardware

- **GPU**: AMD Radeon Instinct (device 0x1586) via ROCm
- **VRAM**: 96 GB total (~99% used when 79.7B model loaded)
- **System RAM**: 32 GB (25 GB available)
- **Disk**: 1.4 TB free on NVMe

## Final Model Lineup

> **qwen3:32b dropped** — the 79.7B coder handles coding + reasoning. Dropping 32b frees ~29GB VRAM
> for larger context or future model upgrades. Can be brought back later if dense reasoning
> is needed (e.g., for architecture planning tasks where 32B active params > 3B MoE active).
> To restore: `ollama pull qwen3:32b` and increase `OLLAMA_MAX_LOADED_MODELS` to 5.

| Role | Model | Params | Size | Loaded Where | Purpose |
|------|-------|--------|------|-------------|----------|
| **Router** | qwen3:4b | 4.0B | 5.4 GB | VRAM (always) | Fast request classification, autocomplete |
| **Coder + Planner** | qwen3-coder-next | 79.7B | 54 GB | VRAM (always, 32K ctx baked) | Code, analysis, planning, general reasoning |
| **Vision** | qwen2.5vl:7b | 7.6B | 5 GB | VRAM (on demand) | Screenshot/image analysis |
| **Embedder** | nomic-embed-text | 137M | 604 MB | VRAM (always) | Codebase indexing, RAG semantic search |

### VRAM Budget

| Model | VRAM | num_ctx | Keep-alive |
|-------|------|---------|------------|
| qwen3-coder-next | ~54 GB | 32768 | Forever |
| qwen3:4b | ~2.5 GB | 2048 | Forever |
| qwen2.5vl:7b | ~5 GB | 4096 | On demand |
| nomic-embed-text | ~0.6 GB | N/A | Forever |
| **Total (always)** | **~57 GB** | | |
| **Total (w/ vision)** | **~62 GB** | | |

**Rule**: Every `ollama:chat` API call MUST include `options.num_ctx` to cap context size per model role:

```js
// Router — small context, just classification
{ model: 'qwen3:4b', messages, options: { num_ctx: 2048 } }

// Coder — full context for code work
{ model: 'qwen3-coder-next', messages, options: { num_ctx: 32768 } }

// Vision — moderate context for image description
{ model: 'qwen2.5vl:7b', messages, options: { num_ctx: 4096 } }
```

## Architecture: Router → Model Pipeline

### Request Flow

```
User sends message (possibly with screenshot)
       │
       ▼
  ┌─────────────┐
  │   Router     │  qwen3:4b (~1 second, num_ctx: 2048)
  │   Classify   │  → "vision" | "code" | "general"
  └──────┬───────┘
         │
         ├── vision ───► qwen2.5vl:7b (num_ctx: 4096) ──► describe image
         │                      │
         │                      ▼
         │               Coder (79.7B, num_ctx: 32768) ──► act on description
         │
         ├── code ─────► Coder (79.7B, num_ctx: 32768) ──► respond with actions
         │
         └── general ──► Coder (79.7B, num_ctx: 32768) ──► respond (NO actions)
```

### Key Design Decisions

1. **The 79.7B coder stays loaded in VRAM permanently** — it's the workhorse
2. **qwen3:4b runs in system RAM** — always available, near-zero overhead
3. **qwen2.5vl:7b loads on demand** — only when screenshots are present
4. **No model swapping** — all small models coexist with the big one
5. **num_ctx is mandatory** — prevents Ollama from evicting models
6. **All Qwen family** — consistent behavior and compatibility

### Router Prompt (qwen3:4b)

```
Classify this user request into exactly one category.
Reply with ONLY the category name, nothing else.

Categories:
- vision: request includes an image/screenshot to analyze
- code: request involves reading, writing, or editing code/files
- general: general question, explanation, or discussion

User request: "{user_message}"
Has image: {yes/no}

Category:
```

### Vision Pipeline

```
1. Router classifies as "vision"
2. Send screenshot + user text to qwen2.5vl:7b (num_ctx: 4096)
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

1. **`main.js`** — Pass `options.num_ctx` in all `ollama:chat` IPC handlers
2. **`app.js` state** — Add `modelRoles: { router, coder, vision }` with defaults
3. **`app.js` sendChat** — Add router step before main model call:
   - Call qwen3:4b to classify
   - If vision: call qwen2.5vl:7b, then forward to coder
   - If code: call coder with agentic system prompt
   - If general: call coder with non-agentic system prompt
4. **Settings UI** — Add model role dropdowns (router, coder, vision)
5. **Chat UI** — Show routing indicator: "🔀 router → vision → coder"

### Server Changes (done separately by user)
- Pull `qwen2.5vl:7b`
- Remove `qwen3:32b` and `qwen3-coder-next`
- Optionally bake num_ctx into Modelfiles as backup

## Settings UI

```
Model Roles:
  Router:  [qwen3:4b              ▼]
  Coder:   [qwen3-coder-next:latest ▼]
  Vision:  [qwen2.5vl:7b         ▼]

Context Limits:
  Router:  [2048  ]
  Coder:   [32768 ]
  Vision:  [4096  ]

[x] Auto-route (use router to classify requests)
[x] Show routing decisions in chat
```

## Future: Embeddings + RAG (Phase 3)
1. Index project files with nomic-embed-text on folder open
2. Retrieve top-N relevant files for each request
3. Include retrieved context in prompt automatically
