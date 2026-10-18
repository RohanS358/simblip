// Phase S0 exit, second half: every compiled gold IR EXECUTES in the real
// SimScript runtime and creates one object per node. Same bundling harness as
// lib/scene/circuit-layout.test.mjs (real executeSimScript, stubbed store).
// Run: node --test lib/sketch/compile-run.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'sketch-run-'))
const stub = join(dir, 'stub-store.mjs')
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'sim.mjs')
writeFileSync(stub, `
let pages = { p: { objects: {} } }
export const useDocStore = {
  getState: () => ({ pages,
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) { const c = pages[pageId]?.objects?.[id]; if (c) pages[pageId].objects[id] = { ...c, ...patch } },
    ensurePage() {}, upsertVariable() {} }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = { p: { objects: {} } } },
  __objects: () => Object.values(pages.p?.objects ?? {}),
}`)
writeFileSync(entry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { compileIR } from '@/lib/sketch/compile'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@/lib/store/document=${stub}`, `--alias:@=${root}`, '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })
const { executeSimScript, useDocStore, compileIR } = await import(bundle)

const goldDir = join(root, 'scripts/ai/sketch/gold')
for (const f of readdirSync(goldDir).filter((x) => x.endsWith('.json'))) {
  test(`gold ${f} runs in the engine`, () => {
    const ir = JSON.parse(readFileSync(join(goldDir, f), 'utf8'))
    const { script, ok, errors } = compileIR(ir)
    assert.ok(ok, errors.join('\n'))
    useDocStore.__reset()
    executeSimScript('p', script, { x: 200, y: 100 }, { bounds: { left: 0, top: 0, right: 1400, bottom: 900 }, fixedFrame: false })
    assert.ok(useDocStore.__objects().length >= ir.nodes.length, `${useDocStore.__objects().length} objects for ${ir.nodes.length} nodes`)
  })
}
