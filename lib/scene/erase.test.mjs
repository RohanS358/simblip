// Run: node --test lib/scene/erase.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'erase-'))
const entry = join(dir, 'e.ts')
const out = join(dir, 'o.mjs')
writeFileSync(entry, `export { eraseTargets } from '@/lib/scene/erase'\nexport { componentById, fromRecognition, baseObject } from '@/lib/scene/factory'`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`, '--external:react', '--external:zustand'], { cwd: root, stdio: 'pipe' })
const m = await import(out)

test('erases a part, a shape and ink; ink wins over what is under it', () => {
  const part = m.componentById('resistor').create({ x: 100, y: 100 })
  part.z = 1
  const stroke = m.fromRecognition({ kind: 'stroke', points: [[0, 0], [100, 0]], x: 100, y: 124, w: 100, h: 1 })
  stroke.z = 2
  const objs = { [part.id]: part, [stroke.id]: stroke }
  assert.deepEqual(m.eraseTargets(objs, { x: 150, y: 124 }, 6), [stroke.id]) // ink first
  delete objs[stroke.id]
  assert.deepEqual(m.eraseTargets(objs, { x: 150, y: 124 }, 6), [part.id]) // then the part
  assert.deepEqual(m.eraseTargets(objs, { x: 600, y: 600 }, 6), [])
  part.metadata.locked = true
  assert.deepEqual(m.eraseTargets(objs, { x: 150, y: 124 }, 6), []) // locked is safe
})
