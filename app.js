// cPanel/Passenger startup file. cPanel's "Setup Node.js App" (Phusion
// Passenger) does not run `npm start`/`next start` — it requires a plain
// Node.js entry point it boots directly and manages the lifecycle of, so
// this wraps Next's programmatic API in a standard http.Server the way
// Passenger expects. Passenger sets PORT itself; the "Setup Node.js App"
// UI's Application startup file field should point at this file.
//
// One-time setup on cPanel (Setup Node.js App):
//   1. Application root: this project's directory.
//   2. Application startup file: app.js
//   3. Run `npm install` then `npm run build` via the app's "Run NPM Install"
//      button / the provided shell (next build must happen before first
//      start — this file only serves an already-built app, it doesn't build
//      one).
//   4. Set the env vars below (same names lib/data/db.ts, lib/auth/*, etc.
//      already read) via the Node.js App UI's "Environment variables" panel
//      — DATABASE_URL, AUTH_SECRET, BLOB_READ_WRITE_TOKEN, NEXT_PUBLIC_CLOUD,
//      NEXT_PUBLIC_SITE_URL, and any of AI_DEBUG/OLLAMA_HOST/OLLAMA_MODEL/
//      DATABASE_SSL/DATABASE_URL_DIRECT this deployment needs.
//   5. Restart the app from the Node.js App UI after any env var or build
//      change — Passenger doesn't hot-reload either.

const { createServer } = require('http')
const next = require('next')

const port = parseInt(process.env.PORT || '3000', 10)
const dev = process.env.NODE_ENV !== 'production'

const app = next({ dev, dir: __dirname })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(() => {
    createServer((req, res) => handle(req, res)).listen(port, () => {
      console.log(`SIMBLIP listening on port ${port} (${dev ? 'development' : 'production'})`)
    })
  })
  .catch((err) => {
    console.error('Failed to start SIMBLIP:', err)
    process.exit(1)
  })
