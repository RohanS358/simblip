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

## Voice (text-to-speech)

Linux browsers ship no speech voices, so lessons are narrated by a neural voice served from here
(Kokoro-82M; 54 voices, women's voices curated in `lib/tts/neural.ts`; default `af_heart`).

```bash
bash ai-server/tts/setup.sh     # once: venv + ~350 MB of model files
npm run ai-tts                  # the sidecar on 127.0.0.1:8788 (next to `npm run ai-server`)
```

The app reaches it through `/api/ai/tts` (which adds the server key); lines are synthesised once and cached on disk
(`.cache/tts/cache`). With no sidecar the app falls back to the browser's voices, then to timed captions.
Measured: ~4× real time on CPU (a 4.7 s sentence in 1.2 s); the player prefetches the next lines so beats never wait.
