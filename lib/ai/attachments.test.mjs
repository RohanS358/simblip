// Reading an attached file into text the model can use.
//
// Every local model here is text-only, so an attachment is worth nothing
// until its content is words. Extraction runs in the browser against
// libraries the notebook already bundles (pdfjs-dist, jszip, xlsx) — the
// file is never uploaded.
//
// These run the REAL extractors over REAL generated documents. A test that
// mocks the parsers would pass while shipping an extractor that cannot read
// a single actual pptx.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-attach-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
writeFileSync(entry, `
export { extractFileText, withAttachments, isSupported, ACCEPTED_TYPES, MAX_EXTRACT_CHARS } from '@/lib/ai/attachments'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react', '--external:tesseract.js', '--external:pdfjs-dist'],
  { cwd: root, stdio: 'pipe' })
const { extractFileText, withAttachments, isSupported, ACCEPTED_TYPES, MAX_EXTRACT_CHARS } =
  await import(bundle)

/** Build the real Office files with the same libraries the app ships. */
const fixtures = join(dir, 'fixtures')
execFileSync('node', ['-e', `
const PptxGenJS = require('pptxgenjs')
const XLSX = require('xlsx')
const fs = require('fs')
fs.mkdirSync(${JSON.stringify(fixtures)}, { recursive: true })
const p = new PptxGenJS()
p.addSlide().addText('Gauss Law Intro', { x: 1, y: 1 })
p.addSlide().addText('Flux equals charge over epsilon', { x: 1, y: 1 })
p.writeFile({ fileName: ${JSON.stringify(join(fixtures, 't.pptx'))} }).then(() => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Year','Cash'],[0,-1000],[1,300]]), 'Flows')
  XLSX.writeFile(wb, ${JSON.stringify(join(fixtures, 't.xlsx'))})
})
`], { cwd: root, stdio: 'pipe' })

const asFile = (name) => new File([new Uint8Array(readFileSync(join(fixtures, name)))], name)

test('a real pptx is read in slide order', async () => {
  const r = await extractFileText(asFile('t.pptx'))
  assert.equal(r.warning, undefined)
  assert.match(r.text, /Gauss Law Intro/)
  assert.match(r.text, /Flux equals charge/)
  // Order matters: slide10 must not sort before slide2.
  assert.ok(r.text.indexOf('Gauss') < r.text.indexOf('Flux'), 'slides came back out of order')
  assert.match(r.text, /\[slide 1\]/, 'slide numbers help the model cite what it read')
})

test('a real xlsx becomes readable rows', async () => {
  const r = await extractFileText(asFile('t.xlsx'))
  assert.equal(r.warning, undefined)
  assert.match(r.text, /\[sheet Flows\]/)
  // CSV, not a JSON blob of cell addresses — a model reads a grid far better
  // from commas.
  assert.match(r.text, /Year,Cash/)
  assert.match(r.text, /0,-1000/)
})

test('plain text passes through', async () => {
  const r = await extractFileText(new File(['RLC circuit question'], 'q.txt'))
  assert.equal(r.text, 'RLC circuit question')
})

test('an empty file warns rather than sending nothing silently', async () => {
  const r = await extractFileText(new File([''], 'empty.txt'))
  assert.equal(r.text, '')
  assert.ok(r.warning, 'the user must be told the attachment was unusable')
})

test('an unsupported type is refused with a reason, never thrown', async () => {
  const r = await extractFileText(new File(['x'], 'thing.exe'))
  assert.equal(r.text, '')
  assert.match(r.warning, /not supported/i)
})

test('a corrupt Office file degrades to a warning', async () => {
  // Not a zip at all. Extraction must never throw into the UI.
  const r = await extractFileText(new File(['not a zip'], 'broken.pptx'))
  assert.equal(r.text, '')
  assert.ok(r.warning)
})

test('the accept list and the dispatcher agree', () => {
  for (const e of ACCEPTED_TYPES.split(',')) {
    assert.ok(isSupported(new File([''], `f${e}`)), `${e} is offered but not supported`)
  }
  assert.ok(!isSupported(new File([''], 'f.exe')))
})

test('extracted text is capped so it cannot push out the system prompt', async () => {
  const huge = 'word '.repeat(50_000)
  const r = await extractFileText(new File([huge], 'big.txt'))
  assert.ok(r.text.length <= MAX_EXTRACT_CHARS + 200, `got ${r.text.length}`)
  assert.match(r.text, /truncated/, 'truncation must be visible, not silent')
})

test('attachments are fenced as material, not as instructions', () => {
  const p = withAttachments('summarise this', [{ name: 'deck.pptx', text: '[slide 1] Gauss' }])
  assert.match(p, /ATTACHED FILES/)
  assert.match(p, /follow only the request/i, 'a file must not be able to redirect the model')
  assert.match(p, /REQUEST: summarise this/)
})

test('a prompt with no usable attachment is unchanged', () => {
  assert.equal(withAttachments('hello', []), 'hello')
  // An attachment that yielded nothing must not add an empty block.
  assert.equal(withAttachments('hello', [{ name: 'x.png', text: '', warning: 'no text' }]), 'hello')
})
