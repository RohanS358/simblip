// Bundles the sketch reader worker (lib/sketch/read-worker.ts) into public/workers/sketch-read.js.
// Done here rather than by the app bundler: the worker must be one self-contained classic script, and
// Next's bundler served it as a raw .ts asset. Run by predev / prebuild; the output is not committed.
import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
await build({
  entryPoints: [resolve(root, 'lib/sketch/read-worker.ts')],
  outfile: resolve(root, 'public/workers/sketch-read.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  alias: { '@': root },
  logLevel: 'warning',
})
console.log('build-sketch-worker: -> public/workers/sketch-read.js')
