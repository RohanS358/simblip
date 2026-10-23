// Starts ai-server/ (and its neural-voice sidecar) in the background unless already listening (used by `predev`).
// Only when .env.local points OLLAMA_HOST at it; a no-op for everyone else.
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : ''
const host = env.match(/^OLLAMA_HOST=(.+)$/m)?.[1]
const port = Number(host?.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)?.[1] ?? 0)
if (!port || !/^OLLAMA_API_KEY=./m.test(env)) process.exit(0)

const listening = (p) => new Promise((ok) => {
  const s = connect(p, '127.0.0.1')
  s.on('connect', () => (s.destroy(), ok(true))).on('error', () => ok(false))
})
mkdirSync('.cache', { recursive: true })

if (!(await listening(port))) {
  const log = openSync('.cache/ai-server.log', 'a')
  spawn(process.execPath, ['--env-file=.env.local', 'ai-server/server.mjs'], { detached: true, stdio: ['ignore', log, log] }).unref()
  console.log(`[ai-server] started on :${port} (log: .cache/ai-server.log)`)
}

// The teacher's voice (Kokoro). Without it lessons are silent on Linux, so it starts with everything else — but only
// if `bash ai-server/tts/setup.sh` has been run (venv + model files present).
const py = '.cache/tts-venv/bin/python'
if (existsSync(py) && existsSync('.cache/tts/kokoro-v1.0.onnx') && !(await listening(8788))) {
  const log = openSync('.cache/tts.log', 'a')
  spawn(py, ['ai-server/tts/tts_server.py'], { detached: true, stdio: ['ignore', log, log] }).unref()
  console.log('[tts] voice service started on :8788 (log: .cache/tts.log)')
}
