// Table data model (lib/scene/table-data.ts).
// Run: node --test lib/scene/table-data.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-table-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'table.mjs')
writeFileSync(entry, `export * from '@/lib/scene/table-data'\n`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { parseHeaders, parseData, evalTable } = await import(bundle)

test('formula columns see their own row, left to right', () => {
  const cols = parseHeaders('x;y;z=x+y;k=z^2')
  const cells = evalTable(cols, parseData('1;2\n3;', 2 + 2), { })
  assert.deepEqual(cells[0].map((c) => c.value), [1, 2, 3, 9])
  assert.ok(Number.isNaN(cells[1][1].value)) // blank cell is NaN, not 0
})
