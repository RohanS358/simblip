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
// Node cannot run the browser paths as-is: pdfjs wants its legacy build with the worker preloaded, and tesseract
// wants a Buffer where the browser hands it a File. Both shims only adapt the INPUT — the extraction code is real.
const ocrShim = join(dir, 'ocr-shim.mjs')
writeFileSync(ocrShim, `
import { createRequire } from 'node:module'
const real = createRequire(${JSON.stringify(root + '/package.json')})('tesseract.js')
export const recognize = async (img, lang, opts) =>
  real.recognize(typeof img === 'string' ? img : Buffer.from(await img.arrayBuffer()), lang, opts)
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`,
  `--alias:@=${root}`, `--alias:tesseract.js=${ocrShim}`, `--alias:pdfjs-dist=${root}/node_modules/pdfjs-dist/legacy/build/pdf.mjs`,
  '--external:react', `--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);`],
  { cwd: root, stdio: 'pipe' })
globalThis.pdfjsWorker = await import(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'))
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
const { jsPDF } = require('jspdf')
const pdf = new jsPDF()
pdf.text('Ohm law: V = I R. A 12 V battery drives 3 A through a resistor. Find R.', 10, 20)
pdf.addPage(); pdf.text('Answer key: R = 4 ohm', 10, 20)
fs.writeFileSync(${JSON.stringify(join(fixtures, 't.pdf'))}, Buffer.from(pdf.output('arraybuffer')))
const D = require('docx')
D.Packer.toBuffer(new D.Document({ sections: [{ children: [
  new D.Paragraph({ text: 'Chapter 1 Kirchhoff', heading: D.HeadingLevel.HEADING_1 }),
  new D.Paragraph('Sum of currents at a node is zero.'),
  new D.Table({ rows: [new D.TableRow({ children: ['R1', '100'].map((t) => new D.TableCell({ children: [new D.Paragraph(t)] })) })] }),
] }] })).then((b) => fs.writeFileSync(${JSON.stringify(join(fixtures, 't.docx'))}, b))
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200"><rect width="100%" height="100%" fill="white"/><text x="20" y="80" font-size="40" font-family="DejaVu Sans">Q3. A 12 V battery drives 3 A.</text><text x="20" y="140" font-size="40" font-family="DejaVu Sans">Find the resistance R.</text></svg>'
require('sharp')(Buffer.from(svg)).png().toFile(${JSON.stringify(join(fixtures, 't.png'))})
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

test('a real docx keeps headings, paragraphs and table cells in order', async () => {
  const r = await extractFileText(asFile('t.docx'))
  assert.equal(r.warning, undefined)
  const lines = r.text.split('\n')
  assert.deepEqual(lines.slice(0, 2), ['Chapter 1 Kirchhoff', 'Sum of currents at a node is zero.'])
  assert.match(r.text, /R1\n100/, 'table cells must survive')
})

test('a real pdf is read page by page', async () => {
  const r = await extractFileText(asFile('t.pdf'))
  assert.equal(r.warning, undefined)
  assert.match(r.text, /\[page 1\] Ohm law: V = I R/)
  assert.match(r.text, /\[page 2\] Answer key: R = 4 ohm/)
})

test('a pdf with no text layer says so instead of sending nothing', async () => {
  const { jsPDF } = (await import('node:module')).createRequire(root + '/package.json')('jspdf')
  const empty = new File([new Uint8Array(new jsPDF().output('arraybuffer'))], 'scan.pdf')
  const r = await extractFileText(empty)
  assert.equal(r.text, '')
  assert.match(r.warning, /scan/i)
})

test('an image is OCR\'d into its question text', { timeout: 150_000 }, async (t) => {
  const phases = []
  const r = await extractFileText(asFile('t.png'), (p) => phases.push(p))
  if (r.warning && /fetch|network|ENOTFOUND|timed out/i.test(r.warning)) return t.skip('OCR model unavailable offline')
  assert.equal(r.warning, undefined)
  assert.match(r.text, /12 V battery/)
  assert.match(r.text, /Find the resistance R/)
  assert.ok(phases.length > 0, 'progress must be reported for the slow path')
})

// End to end: the extracted text, folded into the prompt, must actually be what the model answers from. The question
// is only answerable from page 2 of the PDF ("R = 4 ohm"), so a model that ignored the file would have to guess.
test('the model answers from the extracted PDF text', { timeout: 240_000 }, async (t) => {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
  const model = process.env.ATTACH_E2E_MODEL ?? 'qwen2.5:7b'
  const tags = await fetch(`${host}/api/tags`).then((x) => x.json()).catch(() => null)
  if (!tags?.models?.some((m) => m.name === model)) return t.skip(`${model} not available on ${host}`)
  const { text } = await extractFileText(asFile('t.pdf'))
  const prompt = withAttachments('What is the value of R according to the answer key? Reply with the number and unit only.', [{ name: 't.pdf', text }])
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, options: { temperature: 0 }, messages: [{ role: 'user', content: prompt }] }),
  }).then((x) => x.json())
  assert.match(res.message.content, /\b4\b/, `model said: ${res.message.content}`)
})
