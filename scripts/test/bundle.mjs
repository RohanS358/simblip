// Bundle a TypeScript entry for Node tests that need the REAL browser stores
// (zustand + the simulation runtime). The stores only need a handful of DOM
// globals to load, so shim those instead of stubbing the stores — a stub
// cannot catch the bug where a tool and the real store disagree.
//
//   const m = await bundle(`export * from '@/lib/tools/registry'`, 'tools')
//
// Output goes under node_modules/.cache so bare imports (zustand, matter-js)
// resolve from the repo. Tests using this must run with --test-force-exit: the
// stores keep timers alive.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

export function shimBrowser() {
  const mem = new Map()
  const g = globalThis
  g.localStorage ??= {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  }
  g.window = g
  g.innerWidth ??= 1200
  g.innerHeight ??= 800
  g.addEventListener ??= () => {}
  g.removeEventListener ??= () => {}
  g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  g.document ??= { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [{ appendChild() {} }], head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }), createTextNode: () => ({}), body: {} }
  g.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)
  g.cancelAnimationFrame = (id) => clearTimeout(id)
}

export async function bundle(entry, name) {
  shimBrowser()
  const dir = join(root, 'node_modules/.cache/simblip-tests')
  mkdirSync(dir, { recursive: true })
  const src = join(dir, `${name}.entry.ts`)
  const out = join(dir, `${name}.mjs`)
  writeFileSync(src, entry)
  execFileSync(
    'npx',
    ['esbuild', src, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, `--alias:@=${root}`, '--external:react', '--external:react-dom', '--log-level=error'],
    { cwd: root, stdio: 'pipe' }
  )
  return import(`${out}?t=${Date.now()}`)
}
