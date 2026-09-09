// Structural tests for the .docx → ProseMirror mapper (lib/store/docx-map.ts).
//
// The property that matters: a Word file's STRUCTURE survives. The importer
// this replaced read <w:t> and nothing else, so every assertion below is a
// thing that used to be silently thrown away — a heading's level, a run's
// bold, a nested list, a table's cells, an explicit page break, the file's
// own page size and margins.
//
// docx-map.ts takes its XML parser as a parameter precisely so this can run
// in bare Node, where there is no DOMParser; @xmldom/xmldom (a devDependency)
// supplies one. The module is bundled first because it imports with the
// project's extensionless '@/…' style, exactly as lib/text/pm.test.mjs does.
//
// Run: node lib/store/docx-map.test.mjs

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-docx-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'docx-map.mjs')
writeFileSync(entry, `export { mapDocxDocument } from '@/lib/store/docx-map'\n`)
execFileSync(
  'npx',
  ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`, `--alias:@=${root}`],
  { cwd: root, stdio: 'pipe' }
)
const { mapDocxDocument } = await import(bundle)

const parser = new DOMParser()
const parse = (xml) => parser.parseFromString(xml, 'text/xml')

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

const doc = (body, opts = {}) =>
  mapDocxDocument(
    { document: `<w:document ${NS}><w:body>${body}</w:body></w:document>`, numbering: opts.numbering },
    { parse, image: opts.image }
  )

const para = (runs, pPr = '') => `<w:p>${pPr}${runs}</w:p>`
const run = (text, rPr = '') => `<w:r>${rPr}<w:t>${text}</w:t></w:r>`

// ── plain paragraphs ─────────────────────────────────────────────────────
{
  const { doc: d } = doc(para(run('Hello')) + para(run('World')))
  assert.equal(d.type, 'doc')
  assert.equal(d.content.length, 2)
  assert.equal(d.content[0].type, 'paragraph')
  assert.equal(d.content[0].content[0].text, 'Hello')
  assert.equal(d.content[1].content[0].text, 'World')
}

// ── an empty paragraph keeps no `content` key ────────────────────────────
{
  const { doc: d } = doc(para(''))
  assert.equal(d.content[0].type, 'paragraph')
  assert.equal('content' in d.content[0], false)
}

// ── an empty body is still a legal ProseMirror document ──────────────────
{
  const { doc: d } = doc('')
  assert.deepEqual(d, { type: 'doc', content: [{ type: 'paragraph' }] })
}

// ── run properties become marks ──────────────────────────────────────────
{
  const rPr =
    '<w:rPr><w:b/><w:i/><w:u w:val="single"/><w:strike/>' +
    '<w:color w:val="FF0000"/><w:sz w:val="24"/><w:rFonts w:ascii="Georgia"/></w:rPr>'
  const { doc: d } = doc(para(run('styled', rPr)))
  const marks = d.content[0].content[0].marks
  const kinds = marks.map((m) => m.type).sort()
  assert.deepEqual(kinds, ['bold', 'italic', 'strike', 'textStyle', 'underline'])
  const style = marks.find((m) => m.type === 'textStyle').attrs
  assert.equal(style.color, '#FF0000')
  assert.equal(style.fontFamily, 'Georgia')
  // 24 half-points = 12pt = 16px at 96dpi.
  assert.equal(style.fontSize, '16px')
}

// ── the on/off trap: <w:b w:val="0"/> is NOT bold ────────────────────────
{
  const { doc: d } = doc(para(run('plain', '<w:rPr><w:b w:val="0"/></w:rPr>')))
  assert.equal(d.content[0].content[0].marks, undefined)
}

// ── ...and <w:u w:val="none"/> is not underlined, but "single" is ────────
{
  const off = doc(para(run('x', '<w:rPr><w:u w:val="none"/></w:rPr>'))).doc
  assert.equal(off.content[0].content[0].marks, undefined)
  const on = doc(para(run('x', '<w:rPr><w:u w:val="double"/></w:rPr>'))).doc
  assert.equal(on.content[0].content[0].marks[0].type, 'underline')
}

// ── colour "auto" must not freeze a literal black into the document ──────
{
  const { doc: d } = doc(para(run('x', '<w:rPr><w:color w:val="auto"/></w:rPr>')))
  assert.equal(d.content[0].content[0].marks, undefined)
}

// ── headings ─────────────────────────────────────────────────────────────
{
  const { doc: d } = doc(
    para(run('Chapter'), '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>') +
      para(run('Section'), '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>') +
      para(run('Deep'), '<w:pPr><w:pStyle w:val="Heading6"/></w:pPr>') +
      para(run('Name'), '<w:pPr><w:pStyle w:val="Title"/></w:pPr>')
  )
  assert.equal(d.content[0].type, 'heading')
  assert.equal(d.content[0].attrs.level, 1)
  assert.equal(d.content[1].attrs.level, 2)
  // Clamped: the schema has three heading levels with real styles.
  assert.equal(d.content[2].attrs.level, 3)
  assert.equal(d.content[3].attrs.level, 1)
}

// ── paragraph geometry ───────────────────────────────────────────────────
{
  const pPr =
    '<w:pPr><w:jc w:val="both"/>' +
    '<w:ind w:left="720" w:right="360" w:hanging="360"/>' +
    '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>' +
    '<w:keepNext/><w:keepLines/></w:pPr>'
  const { doc: d } = doc(para(run('x'), pPr))
  const a = d.content[0].attrs
  assert.equal(a.align, 'justify')
  assert.equal(a.indentLeft, 48) // 720 twips = 0.5in = 48px
  assert.equal(a.indentRight, 24)
  assert.equal(a.indentFirstLine, -24) // hanging is a negative first line
  assert.equal(a.spaceBefore, 16)
  assert.equal(a.spaceAfter, 8)
  assert.equal(a.lineHeight, 1.5) // 360/240
  assert.equal(a.keepWithNext, true)
  assert.equal(a.keepTogether, true)
}

// ── lists, nested, both kinds ────────────────────────────────────────────
{
  const numbering = `<w:numbering ${NS}>
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
      <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
    </w:abstractNum>
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  </w:numbering>`
  const item = (text, numId, ilvl) =>
    para(run(text), `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`)
  const { doc: d } = doc(
    item('one', 1, 0) + item('nested', 1, 1) + item('two', 1, 0) + item('first', 2, 0) + para(run('after')),
    { numbering }
  )
  assert.equal(d.content[0].type, 'bulletList')
  assert.equal(d.content[0].content.length, 2, 'two top-level bullets')
  const nested = d.content[0].content[0].content[1]
  assert.equal(nested.type, 'bulletList')
  assert.equal(nested.content[0].content[0].content[0].text, 'nested')
  assert.equal(d.content[1].type, 'orderedList', 'a decimal numFmt starts a new, ordered list')
  assert.equal(d.content[2].type, 'paragraph')
}

// ── a list with no numbering.xml still becomes a list ────────────────────
{
  const { doc: d } = doc(
    para(run('x'), '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>')
  )
  assert.equal(d.content[0].type, 'bulletList')
}

// ── numId 0 means "not in a list" ────────────────────────────────────────
{
  const { doc: d } = doc(
    para(run('x'), '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>')
  )
  assert.equal(d.content[0].type, 'paragraph')
}

// ── an unknown pStyle is dropped rather than carried as noise ────────────
{
  const known = doc(para(run('q'), '<w:pPr><w:pStyle w:val="Quote"/></w:pPr>')).doc
  assert.equal(known.content[0].attrs.style, 'Quote')
  const unknown = doc(para(run('l'), '<w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr>')).doc
  assert.equal(unknown.content[0].attrs, undefined)
}

// ── tables ───────────────────────────────────────────────────────────────
{
  const cell = (t, pr = '') => `<w:tc>${pr}${para(run(t))}</w:tc>`
  const tbl =
    '<w:tbl>' +
    `<w:tr>${cell('a')}${cell('b', '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>')}</w:tr>` +
    `<w:tr>${cell('c')}<w:tc></w:tc></w:tr>` +
    '</w:tbl>'
  const { doc: d } = doc(tbl)
  assert.equal(d.content[0].type, 'table')
  assert.equal(d.content[0].content.length, 2)
  const [a, b] = d.content[0].content[0].content
  assert.equal(a.type, 'tableCell')
  assert.equal(a.content[0].content[0].text, 'a')
  assert.equal(b.attrs.colspan, 2)
  // An empty cell may never have empty content in ProseMirror.
  assert.deepEqual(d.content[0].content[1].content[1].content, [{ type: 'paragraph' }])
}

// ── explicit page breaks, both spellings ─────────────────────────────────
{
  const withRunBreak = `<w:p>${run('before')}<w:r><w:br w:type="page"/></w:r>${run('after')}</w:p>`
  const { doc: d } = doc(withRunBreak)
  assert.deepEqual(
    d.content.map((n) => n.type),
    ['paragraph', 'pageBreak', 'paragraph']
  )
  assert.equal(d.content[0].content[0].text, 'before')
  assert.equal(d.content[2].content[0].text, 'after')

  // Word's own shape — the break alone in its paragraph — must not leave an
  // empty paragraph on each side of it.
  const alone = doc(para(run('x')) + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + para(run('y'))).doc
  assert.deepEqual(
    alone.content.map((n) => n.type),
    ['paragraph', 'pageBreak', 'paragraph']
  )
  // ...but a paragraph the author left empty on purpose survives.
  const blank = doc(para(run('x')) + para('') + para(run('y'))).doc
  assert.equal(blank.content.length, 3)
  assert.equal(blank.content[1].type, 'paragraph')

  const { doc: e } = doc(para(run('x')) + para(run('y'), '<w:pPr><w:pageBreakBefore/></w:pPr>'))
  assert.deepEqual(
    e.content.map((n) => n.type),
    ['paragraph', 'pageBreak', 'paragraph']
  )
}

// ── a plain <w:br/> is a line break, not a page break ────────────────────
{
  const { doc: d } = doc(`<w:p>${run("a")}<w:r><w:br/></w:r>${run("b")}</w:p>`)
  assert.equal(d.content.length, 1)
  assert.equal(d.content[0].content[1].type, 'hardBreak')
}

// ── runs inside a hyperlink are not lost ─────────────────────────────────
{
  const { doc: d } = doc(`<w:p><w:hyperlink r:id="rId9">${run('link text')}</w:hyperlink></w:p>`)
  assert.equal(d.content[0].content[0].text, 'link text')
}

// ── inline images ────────────────────────────────────────────────────────
{
  const drawing =
    '<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/>' +
    '<a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  const { doc: d } = doc(`<w:p>${drawing}</w:p>`, { image: (id) => ({ src: `opfs:${id}` }) })
  const img = d.content[0].content[0]
  assert.equal(img.type, 'docImage')
  assert.equal(img.attrs.src, 'opfs:rId5')
  assert.equal(img.attrs.width, 96) // 914400 EMU = 1 inch = 96px
  assert.equal(img.attrs.height, 48)
  // No image resolver → the drawing is dropped, not crashed on.
  assert.deepEqual(doc(`<w:p>${drawing}</w:p>`).doc.content, [{ type: 'paragraph' }])
}

// ── section properties ───────────────────────────────────────────────────
{
  const sectPr =
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr>'
  const { section } = doc(para(run('x')) + sectPr)
  assert.deepEqual(section.page, { w: 816, h: 1056 }) // US Letter at 96dpi
  assert.deepEqual(section.margins, { top: 96, right: 72, bottom: 96, left: 72 })

  const land = doc(`<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>`)
  assert.deepEqual(land.section.page, { w: 1056, h: 816 }, 'already-swapped landscape is not swapped twice')
}

// ── an unprefixed document (not every writer emits `w:`) ─────────────────
{
  const d = mapDocxDocument(
    {
      document:
        '<document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<body><p><r><t>bare</t></r></p></body></document>',
    },
    { parse }
  ).doc
  assert.equal(d.content[0].content[0].text, 'bare')
}

console.log('docx-map: all checks passed')
