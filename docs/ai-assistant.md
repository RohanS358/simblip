# AI assistant — tools, on-device engine, MCP

How the assistant is built *now*. For the plan and the reasoning, see `docs/ai-plans/`.

```
 AI panel ──▶ lib/ai/transport.ts ──┬─▶ on this device: lib/ai/engine/local.ts (wllama v3, WebGPU or CPU)
                                    └─▶ server:         /api/ai  (Ollama / OpenRouter)
                          both run ─▶ lib/ai/run.ts   (lanes: simulate · explain · both · edit · act)
                                          │
              act lane ─▶ lib/ai/tutor/{router,act}.ts ─▶ lib/tools/*  ◀── MCP bridge ◀── Claude Code etc.
```

## The rule

**Nothing the AI does is a private way to change the canvas.** Every tool wraps a store action a
user can already trigger, so it syncs, persists and undoes for free. A tool that writes is **one
undo step** (`pushHistory(pageId, true)` — `force` skips the 400 ms gesture-coalescing window).

## Tools — `lib/tools/`

One registry (`registry.ts`) is the single list of what the AI can do. The on-device chat agent,
the MCP bridge and WebMCP are all adapters over it, so they cannot drift.

| Family | Tools |
|---|---|
| `scene.*` | `describe` `script` `build` `edit` `add` `components` `run` `pause` `reset` `measure` `undo` `redo` |
| `page.*` | `list` `open` `create` |
| `doc.*` / `slides.*` | `note` `formula` / `from_markdown` |

**Add a tool:** `registerTool(defineTool({ name, summary (≤12 words — a small model reads only this),
effect: 'read'|'write'|'run', input: zodSchema, keywords, run }))` in `scene.ts` or `pages.ts`
(or a new file imported from `index.ts` and `bridge.ts`). Return `ok(summary, data)` or
`fail(error)`; write errors in the model's vocabulary ("unknown id 'x'; use scene.describe") so
one repair round can fix them. Tests: `lib/tools/tools.test.mjs` runs tools against the **real**
stores and physics engine.

## The chat agent — `lib/ai/tutor/`

`router.ts` is pure regex (no model call). Two tiers:

* **quick** — `run`, `pause`, `reset`, `undo`, `redo`, `what's on this page?` → one tool, no model.
* **agent** — measurement questions and page navigation → a bounded loop (≤ 4 rounds) in which the
  model sees **≤ 4 tools** (a 103-tool agent once cost 17,981 prompt tokens).

Everything else falls through to the existing lanes in `lib/ai/run.ts`.

## On-device engine — `lib/ai/engine/`

wllama v3 (llama.cpp → WebAssembly; WebGPU when an adapter exists). **GGUF is the one model
format**, so the same file runs here, in Ollama, and in a future native shell.

* `catalog.ts` — the models (Qwen3-1.7B / 0.6B, Q4_K_M, Apache-2.0) and honest memory estimates.
* `local.ts` — download, cache (browser storage), load, stream, tool calls, idle unload (10 min).
* `probe.ts` — what this device can run; never blocks anyone (worst case: the server).
* A model **never downloads without the user pressing Download** (`ensure(tier, signal, allowDownload)`).
* The runtime `.wasm` is copied to `public/vendor/wllama/` by `scripts/copy-wllama.mjs`
  (`predev` / `prebuild`).
* `proxy.ts` CSP `connect-src` allows `huggingface.co` for the model and `ws://127.0.0.1` for MCP.
  When weights move to our own storage (R2), edit `modelUrl()` and drop the HF origins.

Memory (Standard ≈ 1.7 GB, Lite ≈ 0.95 GB incl. an 8-bit KV cache at 6,144 tokens) is **planning
arithmetic** — measure with `npm run e2e:ai`.

## MCP — `scripts/mcp/simblip-mcp.mjs`

```
MCP client ──stdio──▶ simblip-mcp.mjs ◀──WebSocket 127.0.0.1:7437── the open notebook tab
```

```bash
claude mcp add simblip -- node scripts/mcp/simblip-mcp.mjs
```

Then **Settings → AI assistant → AI agents** → *Read only* or *Full control*, and approve the
connection when the notebook asks. The tab owns the tool list (it sends its registry on connect),
so the server cannot drift from the app. Safety: localhost only; browser origins must be SIMBLIP's;
the mode is enforced when a call **executes**, not just in the listed tools; each connection needs
approval; every write is one undo step. Port: `SIMBLIP_MCP_PORT`.

## Tests

```bash
npm run test:ai   # ~260 unit/integration tests: tools, router, agent loop, lanes, engine (fake wllama), MCP e2e over stdio+ws
npm run e2e:ai    # real Chrome + real on-device model + real MCP server against `npm run dev`
```

`scripts/test/bundle.mjs` bundles an entry with esbuild and shims just enough DOM to load the real
zustand stores in Node.

Two pre-existing failures in `lib/ai` (`every corpus sample still lints`, `inline maths renders
mid-sentence`) predate this work.
