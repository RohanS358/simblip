# SIMBLIP AI server

Runs on the GPU machine (today: the RTX 4060 laptop; later: a dedicated server). Separate from the web app — the app reaches it over HTTP.

```bash
ollama serve                                   # the model runtime
export AI_SERVER_KEY=$(openssl rand -hex 32)   # required; the server refuses to start without it
npm run ai-server                              # listens on 127.0.0.1:8787
```

App side (Vercel env or `.env.local`):

```
AI_BACKEND=ollama
OLLAMA_HOST=https://<tunnel-url>
OLLAMA_API_KEY=<AI_SERVER_KEY>
OLLAMA_SCRIPT_MODEL=simblip-script
OLLAMA_EXPLAIN_MODEL=simblip-explain
```

Reaching the laptop from Vercel: bind stays on loopback; put a tunnel in front (Cloudflare Tunnel or Tailscale Funnel). Never expose port 8787 raw.

Lanes are aliases in `models.json`: swap the model behind a lane without touching the app. Queue (`AI_SERVER_CONCURRENCY`, default 1), rate limit and logs: see the header of `server.mjs`.

## Models (measured 2026-10-18, RTX 4060 8 GB, 30 novel prompts, no few-shots for fine-tunes)

| Lane model | Scenes passing all checks | Notes |
|---|---|---|
| `qwen3:8b` base + full SimScript prompt | 0% (43% valid) | good for prose and tool calls, not SimScript |
| `simblip-lite` Q4_K_M (0.6B fine-tune, 397 MB) | 83% | 1.2 s/prompt |
| `simblip-lite-q8` Q8_0 (640 MB) | **93%** | same as bf16 — serving this |
| 1.7B fine-tune, bf16 | 93% | no gain on this set; not promoted (see docs/ai/decisions.md) |

Register the fine-tune: copy `simblip-lite-Q8_0.gguf` beside `Modelfile.simblip-lite`, then `ollama create simblip-lite-q8 -f Modelfile.simblip-lite`. Weights are not in git (build: `scripts/ai/train/`, GGUF via `.cache/llama.cpp`).
