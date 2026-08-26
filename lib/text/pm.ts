// Converters between the legacy StoredText model ({text, marks} — a flat
// string plus offset ranges, see lib/text/marks.ts) and a ProseMirror
// document, which is what the Tiptap editor reads and writes.
//
// These exist so the migration to Tiptap never has to touch the ~13 files
// that consume {text, marks} (pptx-export, pptx-import, docx-*,
// page-templates, ai/slides, presentation-view, selection-actions…). Those
// keep calling parse()/runsForLine() exactly as they do today; anything
// holding a ProseMirror document converts back through pmDocToStoredText()
// first. One function preserving four exporters beats rewriting four
// exporters.
//
// Storage is lazy-migrating and non-destructive — there are three
// generations of stored `text` param in the wild and ONE reader handles all
// of them (see parseDoc below):
//
//   raw markdown-ish string  → migrateLegacyMarkdown() → StoredText → PM doc
//   {"text":…,"marks":[…]}   → (today's format)        → StoredText → PM doc
//   {"type":"doc",…}         → (the target)            → used directly
//
// Nothing is ever converted in bulk: an old page opens, converts in memory,
// and only persists as ProseMirror JSON when the user actually edits it.

import {
  parse,
  runsForLine,
  splitIndent,
  resolveSizePx,
  TEXT_FONTS,
  TEXT_WEIGHTS,
  INDENT_UNIT,
  type Mark,
  type MarkKind,
  type StoredText,
} from './marks'

// ── ProseMirror JSON shapes ──────────────────────────────────────────────
// Structural types only — deliberately NOT imported from @tiptap/pm, so
// this module (and the round-trip test) stay dependency-free and runnable
// under `node --experimental-strip-types`.

export interface PmMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  marks?: PmMark[]
  text?: string
}

export interface PmDoc extends PmNode {
  type: 'doc'
  content: PmNode[]
}

/** True when `raw` is a stored ProseMirror document rather than either
 *  legacy format. Cheap prefix check first — the vast majority of stored
 *  values are one of the other two generations, and JSON.parse on every
 *  text object on a page is not free. */
export function isPmDoc(raw: string): boolean {
  if (!raw || raw[0] !== '{') return false
  try {
    const obj = JSON.parse(raw)
    return obj?.type === 'doc' && Array.isArray(obj?.content)
  } catch {
    return false
  }
}

/** The single entry point for reading an object's stored `text` param,
 *  whichever of the FOUR generations it is. Never writes anything — the new
 *  format is persisted only by the normal edit/commit path.
 *
 *  The oldest generation predates even the markdown model: raw HTML written
 *  by an execCommand-era contentEditable. parse() does not strip tags, so
 *  such a document would migrate into literal tag soup as its TEXT. The old
 *  RichTextArea ran htmlToMarkdownSource() over the stored value before
 *  parse() for exactly this reason; doing it here instead means every reader
 *  gets it, not just the one that remembered to ask. */
export function parseDoc(raw: string): PmDoc {
  if (isPmDoc(raw)) return JSON.parse(raw) as PmDoc
  return storedTextToPmDoc(parse(htmlToMarkdownSource(raw)))
}

/** Best-effort recovery of plain text from legacy HTML-formatted notes.
 *  Formatting itself is lost — kept identical to the pre-rewrite version
 *  that lived in lib/text/render.ts. */
function htmlToMarkdownSource(value: string): string {
  if (!value.includes('<')) return value
  return value
    .replace(/<(div|p|br)[^>]*>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function serializeDoc(doc: PmDoc): string {
  return JSON.stringify(doc)
}

// ── StoredText → ProseMirror ─────────────────────────────────────────────

// Block structure in the legacy model is literal prefix characters left
// inside the text ("# ", "> ", "- ", "1. ", "- [ ] ") and indentation is
// literal runs of INDENT_UNIT spaces. Each becomes a real node here, which
// is the whole point of the migration: nesting stops being a space count.
//
// Deliberately NOT reusing BLOCK_PREFIX_RE from marks.ts even though it
// matches the same set: that one is a single alternation returning only the
// matched text, and every branch below needs its own capture groups (the
// heading level, the ordered-list start digit, the checkbox state) plus the
// prefix LENGTH, to offset into the mark ranges correctly.
const HEADING_RE = /^(#{1,6})(\s+)(.*)$/
const QUOTE_RE = /^(>\s?)(.*)$/
const CHECK_RE = /^([-*+]\s+)\[( |x|X)\](\s+)(.*)$/
const BULLET_RE = /^([-*+]\s+)(.*)$/
const ORDERED_RE = /^(\d+)(\.\s+)(.*)$/
const HR_RE = /^(-{3,}|\*{3,}|_{3,})\s*$/

type BlockKind = 'paragraph' | 'heading' | 'blockquote' | 'bullet' | 'ordered' | 'task' | 'hr'

interface ParsedLine {
  kind: BlockKind
  level: number
  /** Heading level 1-6, or the ordered list's own start digit. */
  attr: number
  checked: boolean
  /** Body text with the block prefix stripped. */
  body: string
  /** Offset of `body`'s first character in the FULL flat string, so
   *  runsForLine can find the marks covering it. */
  bodyStart: number
}

function parseLine(raw: string, lineStart: number): ParsedLine {
  const { level, indent, rest } = splitIndent(raw)
  const restStart = lineStart + indent.length
  const base = { level, attr: 0, checked: false }

  if (HR_RE.test(rest)) return { ...base, kind: 'hr', body: '', bodyStart: restStart }

  const heading = rest.match(HEADING_RE)
  if (heading) {
    return {
      ...base,
      kind: 'heading',
      attr: heading[1].length,
      body: heading[3],
      bodyStart: restStart + heading[1].length + heading[2].length,
    }
  }

  const quote = rest.match(QUOTE_RE)
  if (quote) {
    return { ...base, kind: 'blockquote', body: quote[2], bodyStart: restStart + quote[1].length }
  }

  // Checklist before plain bullet: "- " is a strict prefix of "- [ ] ", so
  // the looser pattern would match first and leave "[ ] " as stray text.
  const check = rest.match(CHECK_RE)
  if (check) {
    return {
      ...base,
      kind: 'task',
      checked: check[2].toLowerCase() === 'x',
      body: check[4],
      bodyStart: restStart + check[1].length + 3 /* [x] */ + check[3].length,
    }
  }

  const bullet = rest.match(BULLET_RE)
  if (bullet) {
    return { ...base, kind: 'bullet', body: bullet[2], bodyStart: restStart + bullet[1].length }
  }

  const ordered = rest.match(ORDERED_RE)
  if (ordered) {
    return {
      ...base,
      kind: 'ordered',
      attr: Number(ordered[1]),
      body: ordered[3],
      bodyStart: restStart + ordered[1].length + ordered[2].length,
    }
  }

  return { ...base, kind: 'paragraph', body: rest, bodyStart: restStart }
}

/** One legacy Mark → the ProseMirror mark(s) it becomes. The four exclusive
 *  kinds (color/size/font/weight) all collapse into a single `textStyle`
 *  mark carrying up to four attributes — which is exactly the legacy
 *  model's "a newer size replaces an older size on the same text" rule,
 *  except ProseMirror enforces it structurally: two marks of the same type
 *  with different attrs cannot both cover one character. */
function markToPm(m: Mark): PmMark | null {
  switch (m.kind) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'code':
      return { type: m.kind }
    case 'highlight':
      return { type: 'highlight' }
    case 'link':
      // Same https-only gate the legacy renderer applied before putting a
      // value into an href — a stored mark is not a trusted source.
      return m.value && /^https?:/.test(m.value) ? { type: 'link', attrs: { href: m.value } } : null
    case 'color':
      return { type: 'textStyle', attrs: { color: m.value ?? null } }
    case 'size':
      return { type: 'textStyle', attrs: { fontSize: `${resolveSizePx(m.value ?? '')}px` } }
    case 'font':
      return { type: 'textStyle', attrs: { fontFamily: TEXT_FONTS[m.value ?? ''] ?? null } }
    case 'weight':
      return { type: 'textStyle', attrs: { fontWeight: TEXT_WEIGHTS[m.value ?? ''] ?? null } }
    default:
      return null
  }
}

/** Merges the textStyle marks a run produced into one, since ProseMirror
 *  allows only a single mark of a given type per character. Order in the
 *  output is stable (textStyle last) so round-trip comparisons are simple. */
function mergeMarks(marks: PmMark[]): PmMark[] {
  const out: PmMark[] = []
  let style: Record<string, unknown> | null = null
  for (const m of marks) {
    if (m.type === 'textStyle') {
      style = { ...(style ?? {}), ...(m.attrs ?? {}) }
      continue
    }
    if (!out.some((o) => o.type === m.type)) out.push(m)
  }
  if (style) out.push({ type: 'textStyle', attrs: style })
  return out
}

/** A line's body → ProseMirror inline content. runsForLine already does the
 *  hard work of flattening overlapping mark ranges into non-overlapping
 *  runs, so this is a direct transcription rather than a second flattener. */
function inlineContent(body: string, marks: Mark[], bodyStart: number): PmNode[] {
  if (body === '') return []
  const out: PmNode[] = []
  for (const run of runsForLine(body, marks, bodyStart)) {
    if (!run.text) continue
    const pmMarks = mergeMarks(run.marks.map(markToPm).filter((m): m is PmMark => m !== null))
    out.push(pmMarks.length > 0 ? { type: 'text', text: run.text, marks: pmMarks } : { type: 'text', text: run.text })
  }
  return out
}

const LIST_NODE = { bullet: 'bulletList', ordered: 'orderedList', task: 'taskList' } as const
const ITEM_NODE = { bullet: 'listItem', ordered: 'listItem', task: 'taskItem' } as const

type ListKind = keyof typeof LIST_NODE

/** Builds the list tree for a maximal run of consecutive list lines of the
 *  same kind, honouring their indent levels as real nesting. `lines[i]`'s
 *  `level` is the legacy INDENT_UNIT count; a deeper line nests inside the
 *  previous item, a shallower one closes back out.
 *
 *  Returns the finished list node and the index of the first line it did
 *  NOT consume. */
function buildList(lines: ParsedLine[], from: number, marks: Mark[]): { node: PmNode; next: number } {
  const kind = lines[from].kind as ListKind
  const baseLevel = lines[from].level
  const items: PmNode[] = []
  let i = from

  while (i < lines.length && lines[i].kind === kind && lines[i].level >= baseLevel) {
    const line = lines[i]
    if (line.level > baseLevel) {
      // Deeper than this list — nest it inside the item just emitted. A
      // deeper line with no preceding sibling (a document that starts
      // indented) still needs a host, so synthesise an empty item.
      if (items.length === 0) items.push(emptyItem(kind))
      const nested = buildList(lines, i, marks)
      const host = items[items.length - 1]
      host.content = [...(host.content ?? []), nested.node]
      i = nested.next
      continue
    }
    items.push(lineToItem(line, marks))
    i++
  }

  const node: PmNode = { type: LIST_NODE[kind], content: items }
  // An ordered list that does not start at 1 must say so, or the renderer
  // silently renumbers it from 1 (the same bug renderMarkdown's `olStart`
  // exists to avoid).
  if (kind === 'ordered' && lines[from].attr > 1) node.attrs = { start: lines[from].attr }
  return { node, next: i }
}

function emptyItem(kind: ListKind): PmNode {
  const item: PmNode = { type: ITEM_NODE[kind], content: [{ type: 'paragraph' }] }
  if (kind === 'task') item.attrs = { checked: false }
  return item
}

function lineToItem(line: ParsedLine, marks: Mark[]): PmNode {
  const kind = line.kind as ListKind
  const para = paragraphOf(line, marks)
  const item: PmNode = { type: ITEM_NODE[kind], content: [para] }
  if (kind === 'task') item.attrs = { checked: line.checked }
  return item
}

function paragraphOf(line: ParsedLine, marks: Mark[]): PmNode {
  const content = inlineContent(line.body, marks, line.bodyStart)
  // ProseMirror omits `content` entirely on an empty textblock rather than
  // carrying an empty array — matching that here keeps round-trips exact.
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

export function storedTextToPmDoc(stored: StoredText): PmDoc {
  const rawLines = stored.text.split('\n')
  let offset = 0
  const lines: ParsedLine[] = rawLines.map((raw) => {
    const parsed = parseLine(raw, offset)
    offset += raw.length + 1
    return parsed
  })

  const content: PmNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.kind === 'bullet' || line.kind === 'ordered' || line.kind === 'task') {
      const { node, next } = buildList(lines, i, stored.marks)
      content.push(node)
      i = next
      continue
    }

    if (line.kind === 'hr') {
      content.push({ type: 'horizontalRule' })
      i++
      continue
    }

    if (line.kind === 'blockquote') {
      // Consecutive quote lines are ONE blockquote holding several
      // paragraphs, not one blockquote each — the legacy renderer already
      // grouped them this way.
      const paras: PmNode[] = []
      while (i < lines.length && lines[i].kind === 'blockquote') {
        paras.push(paragraphOf(lines[i], stored.marks))
        i++
      }
      content.push({ type: 'blockquote', content: paras })
      continue
    }

    if (line.kind === 'heading') {
      const node = paragraphOf(line, stored.marks)
      node.type = 'heading'
      node.attrs = { level: line.attr }
      content.push(node)
      i++
      continue
    }

    content.push(paragraphOf(line, stored.marks))
    i++
  }

  // A ProseMirror doc may never be empty — an empty text box is one empty
  // paragraph, which is also what `''.split('\n')` would have produced.
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

// ── ProseMirror → StoredText ─────────────────────────────────────────────
// The inverse, so every existing {text, marks} consumer (pptx-export,
// docx-export, presentation-view, selection-actions) keeps working with no
// change at all. Lossy for nodes the legacy model cannot express — tables
// and code blocks degrade to plain text lines, which is what those
// exporters would have done with them anyway.
//
// ── On mark fragmentation (expected, not a bug) ──────────────────────────
// A round-tripped mark comes back FRAGMENTED relative to the original: a
// legacy mark may span a '\n' and cover block-prefix characters ("- ", "# ")
// because it is just an offset range over a flat string. Neither of those
// exists in a ProseMirror document — a newline is a node boundary, not a
// character, and a list marker is structure, not text — so there is nowhere
// for those offsets to live. One mark over "line one\nline two" therefore
// returns as two marks, 0-8 and 9-17, skipping the newline.
//
// This is semantically identical: every VISIBLE character keeps exactly the
// formatting it had. Only the gaps between them differ, and no consumer
// reads those — runsForLine (which pptx-export and every renderer walk)
// resolves marks per character and never asks what covers a '\n'. The
// invariant that actually matters, and the one the test suite asserts, is
// per-visible-character equality rather than range-for-range equality.

/** Inverse of markToPm. A textStyle mark can carry up to four attributes
 *  and therefore expands back into up to four legacy marks. */
function pmMarkToLegacy(m: PmMark, start: number, end: number): Mark[] {
  switch (m.type) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'code':
      return [{ start, end, kind: m.type as MarkKind }]
    case 'highlight':
      return [{ start, end, kind: 'highlight' }]
    case 'link': {
      const href = m.attrs?.href
      return typeof href === 'string' ? [{ start, end, kind: 'link', value: href }] : []
    }
    case 'textStyle': {
      const out: Mark[] = []
      const attrs = m.attrs ?? {}
      if (typeof attrs.color === 'string') out.push({ start, end, kind: 'color', value: attrs.color })
      if (typeof attrs.fontSize === 'string') {
        // Stored as CSS ("22px"); the legacy `size` value is a bare number
        // or a TEXT_SIZES preset id, and resolveSizePx accepts both.
        const px = attrs.fontSize.replace(/px$/, '')
        out.push({ start, end, kind: 'size', value: px })
      }
      if (typeof attrs.fontFamily === 'string') {
        const id = Object.keys(TEXT_FONTS).find((k) => TEXT_FONTS[k] === attrs.fontFamily)
        if (id) out.push({ start, end, kind: 'font', value: id })
      }
      if (attrs.fontWeight != null) {
        const weight = Number(attrs.fontWeight)
        const id = Object.keys(TEXT_WEIGHTS).find((k) => TEXT_WEIGHTS[k] === weight)
        if (id) out.push({ start, end, kind: 'weight', value: id })
      }
      return out
    }
    default:
      return []
  }
}

/** Accumulates lines and marks as the document is walked. `text` is the
 *  flat string being built; marks carry absolute offsets into it, exactly
 *  as the legacy model requires. */
class Sink {
  text = ''
  marks: Mark[] = []

  /** Starts a new line unless the buffer is already at one (so a document
   *  never opens with a blank leading line). */
  newline() {
    if (this.text !== '') this.text += '\n'
  }

  write(raw: string) {
    this.text += raw
  }

  inline(nodes: PmNode[] | undefined) {
    for (const node of nodes ?? []) {
      if (node.type !== 'text' || !node.text) continue
      const start = this.text.length
      this.text += node.text
      const end = this.text.length
      for (const m of node.marks ?? []) {
        for (const legacy of pmMarkToLegacy(m, start, end)) this.marks.push(legacy)
      }
    }
  }
}

/** Emits one textblock as a line: indent, then the caller's block prefix,
 *  then the inline content. */
function emitBlock(sink: Sink, node: PmNode, level: number, prefix: string) {
  sink.newline()
  sink.write(INDENT_UNIT.repeat(level) + prefix)
  sink.inline(node.content)
}

function emitNode(sink: Sink, node: PmNode, level: number) {
  switch (node.type) {
    case 'paragraph':
      emitBlock(sink, node, level, '')
      return
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      emitBlock(sink, node, level, '#'.repeat(lvl) + ' ')
      return
    }
    case 'horizontalRule':
      sink.newline()
      sink.write(INDENT_UNIT.repeat(level) + '---')
      return
    case 'blockquote':
      for (const child of node.content ?? []) emitBlock(sink, child, level, '> ')
      return
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const ordered = node.type === 'orderedList'
      let n = ordered ? Number(node.attrs?.start ?? 1) : 0
      for (const item of node.content ?? []) {
        const checked = item.attrs?.checked === true
        const prefix = ordered ? `${n++}. ` : node.type === 'taskList' ? `- [${checked ? 'x' : ' '}] ` : '- '
        // An item's first paragraph carries the marker; any nested list
        // inside it recurses one level deeper.
        let first = true
        for (const child of item.content ?? []) {
          if (child.type === 'paragraph') {
            emitBlock(sink, child, level, first ? prefix : INDENT_UNIT)
            first = false
          } else {
            emitNode(sink, child, level + 1)
          }
        }
        // An item holding nothing but a nested list still needs its own
        // marker line, or the nesting loses its parent.
        if (first) {
          sink.newline()
          sink.write(INDENT_UNIT.repeat(level) + prefix)
        }
      }
      return
    }
    case 'codeBlock':
      // Lossy by design (see this section's header): the legacy model has no
      // code block, so its text lands as plain lines.
      emitBlock(sink, node, level, '')
      return
    default:
      // Unknown/unsupported node (table, image, …) — recurse so any text it
      // contains survives rather than being dropped.
      for (const child of node.content ?? []) emitNode(sink, child, level)
  }
}

export function pmDocToStoredText(doc: PmDoc): StoredText {
  const sink = new Sink()
  for (const node of doc.content ?? []) emitNode(sink, node, 0)
  return { text: sink.text, marks: sink.marks }
}
