// Dev server in LOCAL mode (NEXT_PUBLIC_CLOUD=0): accounts and pages live in the browser, nothing touches
// the database. For trying the app without cloud credentials (see scripts/capture-docs.mjs).
//   node scripts/dev-local.mjs [port]
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

await import('./build-sketch-worker.mjs') // the reader worker is a built file: rebuild it so it matches the source
const port = process.argv[2] ?? '3114'
const root = resolve(import.meta.dirname, '..')
const nextBin = resolve(root, 'node_modules/next/dist/bin/next')
spawn(process.execPath, [nextBin, 'dev', '-p', port], { cwd: root, stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_CLOUD: '0', DATABASE_URL: '' } })
