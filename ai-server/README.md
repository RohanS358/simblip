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
