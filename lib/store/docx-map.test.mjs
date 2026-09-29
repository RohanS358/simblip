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
    { parse, image: opts.image, link: opts.link }
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

// ── styles.xml: headings by NAME, and style run formatting ──────────────
{
  const styles =
    `<w:styles ${NS}>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="a1"><w:name w:val="heading 2"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Q"><w:name w:val="Question"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Em"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>' +
    '</w:styles>'
  const d = mapDocxDocument(
    {
      document:
        `<w:document ${NS}><w:body>` +
        para(run('Localized heading'), '<w:pPr><w:pStyle w:val="a1"/></w:pPr>') +
        para(run('Asked') + run('stressed', '<w:rPr><w:rStyle w:val="Em"/></w:rPr>'), '<w:pPr><w:pStyle w:val="Q"/></w:pPr>') +
        para(run('plain')) +
        '</w:body></w:document>',
      styles,
    },
    { parse }
  ).doc
  assert.equal(d.content[0].type, 'heading')
  assert.equal(d.content[0].attrs.level, 2)
  const [asked, stressed] = d.content[1].content
  assert.deepEqual(asked.marks.map((m) => m.type), ['bold'], 'paragraph style bold applies, Normal size does not')
  assert.deepEqual(stressed.marks.map((m) => m.type).sort(), ['bold', 'italic'])
  assert.equal(d.content[2].content[0].marks, undefined, 'the default style adds nothing')
}

// ── hyperlinks, super/subscript, Symbol-font Greek ──────────────────────
{
  const d = mapDocxDocument(
    {
      document:
        `<w:document ${NS}><w:body><w:p>` +
        '<w:hyperlink r:id="rId9"><w:r><w:t>site</w:t></w:r></w:hyperlink>' +
        run('x') + run('2', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>') +
        run('a', '<w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr>') +
        '<w:r><w:sym w:font="Symbol" w:char="F070"/></w:r>' +
        run('hl', '<w:rPr><w:highlight w:val="none"/></w:rPr>') +
        '</w:p></w:body></w:document>',
    },
    { parse, link: (id) => (id === 'rId9' ? 'https://example.com' : null) }
  ).doc
  const c = d.content[0].content
  assert.deepEqual(c[0].marks, [{ type: 'link', attrs: { href: 'https://example.com' } }])
  assert.equal(c[2].marks[0].type, 'superscript')
  assert.equal(c[3].text, 'α')
  assert.equal(c[4].text, 'π')
  assert.equal(c[5].marks, undefined, 'highlight "none" is no highlight')
}

// ── tracked insertions and block content controls are kept ─────────────
{
  const d = doc(
    '<w:sdt><w:sdtContent>' + para(run('Contents')) + '</w:sdtContent></w:sdt>' +
      '<w:p><w:ins><w:r><w:t>added</w:t></w:r></w:ins><w:del><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>'
  ).doc
  assert.equal(d.content[0].content[0].text, 'Contents')
  assert.equal(d.content[1].content.map((n) => n.text).join(''), 'added')
}

// ── list numbering continues across an interrupting paragraph ────────────
{
  const numbering =
    `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>` +
    '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
  const item = (t) => para(run(t), '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>')
  const d = doc(item('Q1') + item('Q2') + para(run('answer')) + item('Q3'), { numbering }).doc
  assert.equal(d.content[0].type, 'orderedList')
  assert.equal(d.content[0].attrs.type, 'a')
  assert.equal(d.content[1].type, 'paragraph')
  assert.equal(d.content[2].attrs.start, 3, 'Q3 is item c, not a restarted a')
}

// ── vertically merged cells become a rowspan, not blank duplicates ──────
{
  const cell = (t, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr>${para(run(t))}</w:tc>`
  const tbl =
    '<w:tbl><w:tblGrid><w:gridCol w:w="1440"/><w:gridCol w:w="2880"/></w:tblGrid>' +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('H1')}${cell('H2')}</w:tr>` +
    `<w:tr>${cell('merged', '<w:vMerge w:val="restart"/>')}${cell('b')}</w:tr>` +
    `<w:tr>${cell('', '<w:vMerge/>')}${cell('c')}</w:tr></w:tbl>`
  const t = doc(tbl).doc.content[0]
  assert.equal(t.content[0].content[0].type, 'tableHeader')
  assert.equal(t.content[1].content[0].attrs.rowspan, 2)
  assert.deepEqual(t.content[1].content[0].attrs.colwidth, [96])
  assert.equal(t.content[2].content.length, 1, 'the continuation cell is absorbed')
}

// ── equations: OMML becomes text with real superscripts ─────────────────
{
  const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
  const mr = (t) => `<m:r><m:t>${t}</m:t></m:r>`
  const eq =
    `<w:p><m:oMath ${M}><m:sSup><m:e>${mr('E')}</m:e><m:sup>${mr('2')}</m:sup></m:sSup>${mr('=')}` +
    `<m:f><m:num>${mr('a')}</m:num><m:den>${mr('b+c')}</m:den></m:f></m:oMath></w:p>`
  const c = doc(eq).doc.content[0].content
  const text = c.map((n) => n.text).join('')
  assert.equal(text, 'E2=a/(b+c)')
  assert.ok(c.find((n) => n.text === '2').marks.some((m) => m.type === 'superscript'))
  assert.ok(c.find((n) => n.text === 'E').marks.some((m) => m.type === 'italic'))
}

// ── an image wrapped in AlternateContent arrives once ───────────────────
{
  const blip = '<a:blip r:embed="rId3"/>'
  const alt =
    '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
    `<mc:Choice Requires="wps"><w:drawing>${blip}</w:drawing></mc:Choice>` +
    `<mc:Fallback><w:drawing>${blip}</w:drawing></mc:Fallback></mc:AlternateContent></w:r></w:p>`
  const c = doc(alt, { image: () => ({ src: 'opfs:1' }) }).doc.content[0].content
  assert.equal(c.length, 1)
  assert.equal(c[0].type, 'docImage')
}

// ── cell shading survives (white-on-dark header rows looked empty) ──────
{
  const t = doc(
    '<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="1f4e79"/></w:tcPr>' +
      para(run('Term')) +
      '</w:tc><w:tc><w:tcPr><w:shd w:val="clear" w:fill="auto"/></w:tcPr>' +
      para(run('x')) +
      '</w:tc></w:tr></w:tbl>'
  ).doc.content[0]
  const [a, b] = t.content[0].content
  assert.equal(a.attrs.background, '#1F4E79')
  assert.equal(b.attrs?.background, undefined)
}

console.log('docx-map: all checks passed')
