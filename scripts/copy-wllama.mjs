// The on-device model runtime ships as one WebAssembly file inside
// @wllama/wllama. The browser fetches it by URL, so it has to be served from
// public/ — copied rather than committed (8.7 MB of binary the lockfile
// already pins).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

const src = 'node_modules/@wllama/wllama/esm/wasm/wllama.wasm'
const dest = 'public/vendor/wllama/wllama.wasm'
if (!existsSync(src)) {
  console.warn('copy-wllama: @wllama/wllama is not installed — skipping')
  process.exit(0)
}
mkdirSync('public/vendor/wllama', { recursive: true })
copyFileSync(src, dest)
console.log('copy-wllama: ->', dest)
