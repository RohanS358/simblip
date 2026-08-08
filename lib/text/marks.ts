// Inline text formatting as real style ranges over a plain string — never as
// delimiter characters typed into the text itself. This replaces the old
// markdown-delimiter model (lib/text/markdown.ts, now retired): that model
// hid **/++ /`[x]{k=v}` markers with CSS while keeping them as real (if
// zero-size) text nodes so caret math stayed 1:1 with the raw string — which
// meant any interaction combining two marks in an order the CSS trick didn't
// anticipate could leak literal delimiter characters into what the user
// sees. Storing marks as {start,end,kind} offsets into a delimiter-free
// string makes that a structural impossibility: there is no character
// sequence that means "bold" for a nesting bug to misparse.
//
// Modeled on how canvas design tools (Fabric.js's Textbox/IText `styles`
// map, at open-design in this workspace) represent rich text: formatting is
// out-of-band per-character data, painted directly, never encoded as text.

/** Toggle kinds: reapplying the exact same kind+range flips it off (like a
 *  real Bold button). Multiple toggle kinds can freely overlap the same
 *  range — bold+italic+underline on one word is normal. */
export type ToggleMarkKind = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code'
/** Exclusive kinds: only one mark of a given exclusive kind may cover any
 *  character at a time — applying a new one clips/removes whatever of the
 *  same kind was already there (user rule: "if a sentence already has a
 *  size/color/etc applied to a portion, the newer one replaces it"). */
export type ExclusiveMarkKind = 'color' | 'size' | 'font' | 'weight' | 'link'
export type MarkKind = ToggleMarkKind | ExclusiveMarkKind

export interface Mark {
  start: number // inclusive, offset into the object's full text (spans '\n')
  end: number // exclusive
  kind: MarkKind
  /** Only present for exclusive kinds — the color id, size in px, font id,
   *  weight id, or (for 'link') the URL. */
  value?: string
}

export interface StoredText {
  text: string
  marks: Mark[]
}

// Indentation is stored as literal leading spaces on a line (same "plain
// text, no new data structure" approach block prefixes already use) — the
// LIVE editor renders them as real space characters, not a padding-left (see
// renderEditorLine's doc comment in lib/text/render.ts for why padding broke
// the DOM/model invariant the whole caret system depends on). 8 spaces per
// level, not 2 — thin runs of space glyphs at a normal 15px font size are
// barely perceptible as an indent (2 spaces ≈ 4px, invisible next to a full
// line-height), so the unit has to be wide enough to actually read as a
// tab-stop using nothing but real character width.
export const INDENT_UNIT = '        '

/** Splits a line into its leading-indent spaces and the rest — indent is
 *  always a whole number of INDENT_UNITs; a stray odd space at the end of
 *  the run is left as part of the body rather than silently swallowed. */
export function splitIndent(raw: string): { level: number; indent: string; rest: string } {
  const m = raw.match(/^ */)
  const spaces = m ? m[0].length : 0
  const level = Math.floor(spaces / INDENT_UNIT.length)
  const indent = INDENT_UNIT.repeat(level)
  return { level, indent, rest: raw.slice(indent.length) }
}

const TOGGLE_KINDS = new Set<MarkKind>(['bold', 'italic', 'underline', 'strike', 'highlight', 'code'])
export const isExclusiveKind = (kind: MarkKind): kind is ExclusiveMarkKind => !TOGGLE_KINDS.has(kind)

// Selection-scoped color/size/font/weight tokens — the panel writes one of
// these ids as a mark's `value`; the renderer looks the id up here, never
// trusting a raw value straight through, so arbitrary text can never inject
// a style attribute.
export const TEXT_COLORS: Record<string, string> = {
  default: 'var(--foreground)',
  blue: 'var(--accent-blue)',
  mint: 'var(--accent-mint)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
}
export const TEXT_SIZES: Record<string, number> = { s: 12, m: 15, l: 20, xl: 28 }
// Font stacks: web-safe OS fonts first (zero latency), then Google Fonts
// loaded via CSS variables injected by next/font/google in app/layout.tsx
// with preload:false — they cost nothing until actually applied to text.
export const TEXT_FONTS: Record<string, string> = {
  // ── App defaults ──────────────────────────────────────────────────────
  sans:         'var(--font-sans)',
  mono:         'var(--font-mono)',

  // ── Google Fonts (popular modern picks) ──────────────────────────────
  roboto:       'var(--font-roboto), Roboto, sans-serif',
  openSans:     'var(--font-open-sans), "Open Sans", sans-serif',
  lato:         'var(--font-lato), Lato, sans-serif',
  montserrat:   'var(--font-montserrat), Montserrat, sans-serif',
  nunito:       'var(--font-nunito), Nunito, sans-serif',
  raleway:      'var(--font-raleway), Raleway, sans-serif',
  merriweather: 'var(--font-merriweather), Merriweather, serif',
  playfair:     'var(--font-playfair), "Playfair Display", serif',

  // ── Web-safe Sans-serif ───────────────────────────────────────────────
  arial:        'Arial, Helvetica, sans-serif',
  helvetica:    'Helvetica, Arial, sans-serif',
  verdana:      'Verdana, Geneva, sans-serif',
  tahoma:       'Tahoma, Geneva, sans-serif',
  trebuchet:    '"Trebuchet MS", sans-serif',
  impact:       'Impact, Haettenschweiler, sans-serif',

  // ── Web-safe Serif ────────────────────────────────────────────────────
  timesNewRoman: '"Times New Roman", Times, serif',
  georgia:      'Georgia, "Times New Roman", serif',
  garamond:     'Garamond, "Apple Garamond", serif',
  palatino:     '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  bookman:      '"Bookman Old Style", serif',
  copperplate:  'Copperplate, "Copperplate Gothic Light", serif',

  // ── Web-safe Monospace ────────────────────────────────────────────────
  courier:      '"Courier New", Courier, monospace',
  consolas:     'Consolas, "Lucida Console", monospace',

  // ── Decorative / Fun ─────────────────────────────────────────────────
  comic:        '"Comic Sans MS", "Comic Sans", cursive',
  brushScript:  '"Brush Script MT", cursive',
  papyrus:      'Papyrus, fantasy',
}

// Display labels shown in the font picker dropdown
export const TEXT_FONT_LABELS: Record<keyof typeof TEXT_FONTS, string> = {
  sans:          'Sans (App)',
  mono:          'Mono (App)',
  roboto:        'Roboto',
  openSans:      'Open Sans',
  lato:          'Lato',
  montserrat:    'Montserrat',
  nunito:        'Nunito',
  raleway:       'Raleway',
  merriweather:  'Merriweather',
  playfair:      'Playfair Display',
  arial:         'Arial',
  helvetica:     'Helvetica',
  verdana:       'Verdana',
  tahoma:        'Tahoma',
  trebuchet:     'Trebuchet MS',
  impact:        'Impact',
  timesNewRoman: 'Times New Roman',
  georgia:       'Georgia',
  garamond:      'Garamond',
  palatino:      'Palatino',
  bookman:       'Bookman',
  copperplate:   'Copperplate',
  courier:       'Courier New',
  consolas:      'Consolas',
  comic:         'Comic Sans',
  brushScript:   'Brush Script',
  papyrus:       'Papyrus',
}

/** Groups for the font picker UI — each group has a label and an ordered list
 *  of TEXT_FONTS keys. The inspector renders a non-selectable divider between
 *  groups so users can find fonts by category at a glance. */
export const FONT_GROUPS: { label: string; keys: (keyof typeof TEXT_FONTS)[] }[] = [
  { label: 'App', keys: ['sans', 'mono'] },
  { label: 'Google Fonts', keys: ['roboto', 'openSans', 'lato', 'montserrat', 'nunito', 'raleway', 'merriweather', 'playfair'] },
  { label: 'Sans-serif', keys: ['arial', 'helvetica', 'verdana', 'tahoma', 'trebuchet', 'impact'] },
  { label: 'Serif', keys: ['timesNewRoman', 'georgia', 'garamond', 'palatino', 'bookman', 'copperplate'] },
  { label: 'Monospace', keys: ['courier', 'consolas'] },
  { label: 'Decorative', keys: ['comic', 'brushScript', 'papyrus'] },
]
// Figma-style named weight steps — distinct from the toggle 'bold' mark
// (always 700); this lets the panel's Weight dropdown pick any CSS weight.
export const TEXT_WEIGHTS: Record<string, number> = {
  thin: 100,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
}

/** Resolves a size mark's value (a TEXT_SIZES preset id OR a bare custom
 *  number, e.g. panel-typed "22") to a clamped px number — same lookup the
 *  old markdown renderer used for `{size=...}`. */
export function resolveSizePx(value: string): number {
  const preset = TEXT_SIZES[value]
  if (preset !== undefined) return preset
  const custom = Number(value)
  return Number.isFinite(custom) ? Math.min(200, Math.max(6, custom)) : TEXT_SIZES.m
}

/** Splits a mark at `at` into up to two marks (the piece before `at` and the
 *  piece from `at` onward), dropping either half if it would be empty.
 *  Used by applyMark (clip an overlapping exclusive mark at the new mark's
 *  boundary) and shiftMarks (clip a mark a delete partially consumed). */
function splitAt(m: Mark, at: number): Mark[] {
  const out: Mark[] = []
  if (m.start < at) out.push({ ...m, end: Math.min(m.end, at) })
  if (m.end > at) out.push({ ...m, start: Math.max(m.start, at) })
  return out
}

/** Applies `kind` (with `value` for exclusive kinds) over [start, end) —
 *  the single entry point every formatting control in the app calls.
 *
 *  Exclusive kinds (color/size/font/weight/link): any existing mark of the
 *  SAME kind that overlaps [start, end) is clipped to whatever portion falls
 *  outside the new range (or dropped entirely if the new range fully covers
 *  it) BEFORE the new mark is inserted — so at most one value of a given
 *  exclusive kind ever governs a character. Marks of OTHER kinds are left
 *  alone entirely, so color+size+weight can all cover the same text at once.
 *
 *  Toggle kinds (bold/italic/...): if a mark of the exact same kind already
 *  spans EXACTLY [start, end), it's removed (toggle off) and no mark is
 *  added — the standard "click Bold on already-bold text" behavior. Partial
 *  overlaps aren't merged/split; the new mark is simply added alongside
 *  (matches how bold/italic never needed "replace" semantics — only
 *  size/color/font/weight do, per the exclusive-kind rule above). */
export function applyMark(marks: Mark[], start: number, end: number, kind: MarkKind, value?: string): Mark[] {
  if (start >= end) return marks

  if (!isExclusiveKind(kind)) {
    const exact = marks.find((m) => m.kind === kind && m.start === start && m.end === end)
    if (exact) return marks.filter((m) => m !== exact)
    return [...marks, { start, end, kind }]
  }

  const kept: Mark[] = []
  for (const m of marks) {
    if (m.kind !== kind || m.end <= start || m.start >= end) {
      kept.push(m)
      continue
    }
    // Overlaps the new range — clip away the overlapping portion, keep
    // whatever's left outside [start, end).
    if (m.start < start) kept.push({ ...m, end: start })
    if (m.end > end) kept.push({ ...m, start: end })
  }
  kept.push({ start, end, kind, value })
  return kept
}

/** After inserting (delta > 0) or deleting (delta < 0) `|delta|` characters
 *  at `atOffset`, moves every mark's start/end past the edit and clips/drops
 *  marks a delete partially/fully consumed. Call this from onInput any time
 *  the plain text changes — marks don't ride along with the edit for free
 *  the way delimiter characters used to (that was the old model's one
 *  advantage; this is the offset model's equivalent bookkeeping). */
export function shiftMarks(marks: Mark[], atOffset: number, delta: number): Mark[] {
  if (delta === 0) return marks
  if (delta > 0) {
    // Insertion: text typed exactly at a mark's END boundary does NOT get
    // absorbed — typing right after a bold run continues as plain text
    // (matches the old wrap()'s "past the closing delimiter" caret
    // placement). Text typed exactly at a mark's START pushes the whole
    // mark forward instead of becoming part of it — both boundaries move
    // together, so the mark's length is unchanged. Only an insertion
    // strictly INSIDE a mark (start < atOffset < end) grows it.
    return marks.map((m) => {
      if (atOffset <= m.start) return { ...m, start: m.start + delta, end: m.end + delta }
      if (atOffset < m.end) return { ...m, end: m.end + delta }
      return m
    })
  }
  // Deletion of |delta| chars starting at atOffset, i.e. removing
  // [atOffset, atOffset - delta).
  const delEnd = atOffset - delta
  const out: Mark[] = []
  for (const m of marks) {
    for (const piece of clipDeletion(m, atOffset, delEnd)) out.push(piece)
  }
  return out
}

function clipDeletion(m: Mark, delStart: number, delEnd: number): Mark[] {
  if (m.end <= delStart) return [m] // entirely before the deletion
  if (m.start >= delEnd) return [{ ...m, start: m.start + (delStart - delEnd), end: m.end + (delStart - delEnd) }] // entirely after
  // Overlaps the deletion — keep the pre-deletion piece and the (shifted)
  // post-deletion piece, dropping the part that was deleted.
  const pieces: Mark[] = []
  if (m.start < delStart) pieces.push({ ...m, end: delStart })
  if (m.end > delEnd) pieces.push({ ...m, start: delStart, end: m.end - (delEnd - delStart) })
  return pieces
}

/** One non-overlapping run of text with the marks that cover it, in
 *  document order — the flatten-overlapping-ranges pass every renderer
 *  (editing view and read-only view alike, see lib/text/render.ts) walks to
 *  build DOM. Boundaries are every mark start/end that falls within
 *  [lineStart, lineStart + line.length). */
export interface Run {
  text: string
  marks: Mark[]
}

export function runsForLine(line: string, allMarks: Mark[], lineStart: number): Run[] {
  const lineEnd = lineStart + line.length
  const boundaries = new Set<number>([0, line.length])
  for (const m of allMarks) {
    if (m.end <= lineStart || m.start >= lineEnd) continue
    const s = Math.max(m.start, lineStart) - lineStart
    const e = Math.min(m.end, lineEnd) - lineStart
    boundaries.add(s)
    boundaries.add(e)
  }
  const points = [...boundaries].sort((a, b) => a - b)
  const runs: Run[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i]
    const e = points[i + 1]
    if (s === e) continue
    const abs = { s: s + lineStart, e: e + lineStart }
    const covering = allMarks.filter((m) => m.start <= abs.s && m.end >= abs.e)
    runs.push({ text: line.slice(s, e), marks: covering })
  }
  if (runs.length === 0) runs.push({ text: '', marks: [] })
  return runs
}

// ── Storage (parse/serialize) ──────────────────────────────────────────

export function serialize(stored: StoredText): string {
  return JSON.stringify(stored)
}

/** Reads the object's `text` param back into {text, marks}. Anything that
 *  isn't valid `{text, marks}` JSON is treated as legacy content and run
 *  through migration exactly once (the migrated form is what gets saved on
 *  the next edit, via the normal commit path — this function itself never
 *  writes anything). */
export function parse(raw: string): StoredText {
  if (raw === '') return { text: '', marks: [] }
  if (raw[0] === '{') {
    try {
      const obj = JSON.parse(raw)
      if (typeof obj?.text === 'string' && Array.isArray(obj?.marks)) return obj as StoredText
    } catch {
      // fall through to legacy migration
    }
  }
  return migrateLegacyMarkdown(raw)
}

// ── Legacy migration ────────────────────────────────────────────────────
// One-time best-effort parse of the old delimiter syntax into marks, so
// documents saved before this rewrite still open with their formatting
// intact instead of showing raw ** ++ [x]{k=v} as literal text. Block-level
// line prefixes (#, >, -, 1., - [ ]) aren't delimiters in the new model
// either (see marks.ts doc comment) — they're left in `text` untouched,
// exactly as the pre-rewrite renderer already treated them.

const LEGACY_PATTERNS: { re: RegExp; kind: ToggleMarkKind }[] = [
  { re: /\*\*([^*]+)\*\*/g, kind: 'bold' },
  { re: /__([^_]+)__/g, kind: 'bold' },
  { re: /~~([^~]+)~~/g, kind: 'strike' },
  { re: /==([^=]+)==/g, kind: 'highlight' },
  { re: /\+\+([^+]+)\+\+/g, kind: 'underline' },
  { re: /`([^`]+)`/g, kind: 'code' },
]
// *italic* / _italic_ handled separately below since both need to not
// collide with ** (already consumed above) and _ needs word-boundary care.

function migrateLegacyLine(line: string): { text: string; marks: Mark[] } {
  // Repeatedly find the leftmost remaining delimiter match across every
  // pattern, consume it, record a mark at the OUTPUT offset, and continue
  // scanning the remainder — this naturally handles marks appearing in any
  // order without needing bracket-depth tracking (legacy content never had
  // arbitrarily nested marks the way the old [[x]{a}]{b} span-stacking did,
  // since that nesting was itself a bug this rewrite exists to remove).
  let out = ''
  let marks: Mark[] = []
  let rest = line

  const tryMatch = (s: string) => {
    let best: { index: number; length: number; inner: string; kind: ToggleMarkKind } | null = null
    for (const { re, kind } of LEGACY_PATTERNS) {
      re.lastIndex = 0
      const m = re.exec(s)
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, inner: m[1], kind }
      }
    }
    // *bold-ish* / _italic_ — checked last so ** / __ above always win when
    // they overlap at the same position.
    const starMatch = /\*([^*]+)\*/.exec(s)
    if (starMatch && (best === null || starMatch.index < best.index)) {
      best = { index: starMatch.index, length: starMatch[0].length, inner: starMatch[1], kind: 'italic' }
    }
    const underMatch = /(^|[^\w])_([^_]+)_(?!\w)/.exec(s)
    if (underMatch) {
      const prefixLen = underMatch[1].length
      const idx = underMatch.index + prefixLen
      if (best === null || idx < best.index) {
        best = { index: idx, length: underMatch[0].length - prefixLen, inner: underMatch[2], kind: 'italic' }
      }
    }
    return best
  }

  // Style spans [text]{kind=value} and links [text](url) — matched at the
  // SAME priority as the toggle delimiters above via a unified scan.
  const spanMatch = (s: string) => {
    const m = /\[([^\]]+)\]\{(color|size|font|weight)=([a-z0-9.]+)\}/.exec(s)
    const link = /\[([^\]]+)\]\((https?:[^)\s]+)\)/.exec(s)
    return { m, link }
  }

  for (;;) {
    const toggle = tryMatch(rest)
    const { m: span, link } = spanMatch(rest)
    const candidates = [
      toggle && { index: toggle.index, length: toggle.length, apply: () => ({ inner: toggle.inner, kind: toggle.kind as MarkKind, value: undefined }) },
      span && { index: span.index, length: span[0].length, apply: () => ({ inner: span[1], kind: span[2] as MarkKind, value: span[3] }) },
      link && { index: link.index, length: link[0].length, apply: () => ({ inner: link[1], kind: 'link' as MarkKind, value: link[2] }) },
    ].filter((c): c is NonNullable<typeof c> => Boolean(c))

    if (candidates.length === 0) {
      out += rest
      break
    }
    candidates.sort((a, b) => a.index - b.index)
    const next = candidates[0]
    out += rest.slice(0, next.index)
    const { inner, kind, value } = next.apply()
    const start = out.length
    out += inner
    const end = out.length
    marks.push(value !== undefined ? { start, end, kind, value } : { start, end, kind })
    rest = rest.slice(next.index + next.length)
  }

  return { text: out, marks }
}

export function migrateLegacyMarkdown(raw: string): StoredText {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  let text = ''
  let marks: Mark[] = []
  lines.forEach((line, i) => {
    const { text: lineText, marks: lineMarks } = migrateLegacyLine(line)
    const offset = text.length
    for (const m of lineMarks) marks.push({ ...m, start: m.start + offset, end: m.end + offset })
    text += lineText
    if (i < lines.length - 1) text += '\n'
  })
  return { text, marks }
}

/** Parses pasted HTML or plain text into StoredText (text + style marks),
 *  preserving formatting (bold, italic, underline, strike, links, headings, etc). */
export function htmlToStoredText(html: string, fallbackPlain?: string): StoredText {
  if (typeof DOMParser === 'undefined' || !html || !html.includes('<')) {
    const raw = fallbackPlain ?? html ?? ''
    return parse(raw)
  }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    let text = ''
    const marks: Mark[] = []

    function walk(node: Node, activeMarks: { kind: MarkKind; value?: string }[]) {
      if (node.nodeType === 3) { // Text node
        const val = node.nodeValue ?? ''
        if (!val) return
        const start = text.length
        text += val
        const end = text.length
        for (const am of activeMarks) {
          marks.push(
            am.value !== undefined
              ? { start, end, kind: am.kind, value: am.value }
              : { start, end, kind: am.kind }
          )
        }
        return
      }

      if (node.nodeType === 1) { // Element node
        const el = node as HTMLElement
        const tag = el.tagName.toLowerCase()
        if (['script', 'style', 'meta', 'head'].includes(tag)) return

        const newActive = [...activeMarks]
        let isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote'].includes(tag)

        if (tag === 'b' || tag === 'strong') newActive.push({ kind: 'bold' })
        else if (tag === 'i' || tag === 'em') newActive.push({ kind: 'italic' })
        else if (tag === 'u') newActive.push({ kind: 'underline' })
        else if (tag === 's' || tag === 'del' || tag === 'strike') newActive.push({ kind: 'strike' })
        else if (tag === 'mark') newActive.push({ kind: 'highlight' })
        else if (tag === 'code') newActive.push({ kind: 'code' })
        else if (tag === 'a') {
          const href = el.getAttribute('href')
          if (href) newActive.push({ kind: 'link', value: href })
        }

        const color = el.style?.color
        if (color) newActive.push({ kind: 'color', value: color })
        const fontSize = el.style?.fontSize
        if (fontSize) {
          const pxMatch = fontSize.match(/^(\d+(?:\.\d+)?)px$/i)
          if (pxMatch) newActive.push({ kind: 'size', value: pxMatch[1] })
        }

        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag[1])
          const prefix = '#'.repeat(level) + ' '
          if (text.length > 0 && !text.endsWith('\n')) text += '\n'
          text += prefix
          isBlock = false
        } else if (tag === 'li') {
          if (text.length > 0 && !text.endsWith('\n')) text += '\n'
          text += '- '
          isBlock = false
        } else if (tag === 'br') {
          text += '\n'
        } else if (isBlock && text.length > 0 && !text.endsWith('\n')) {
          text += '\n'
        }

        for (const child of Array.from(el.childNodes)) {
          walk(child, newActive)
        }

        if (isBlock && text.length > 0 && !text.endsWith('\n')) {
          text += '\n'
        }
      }
    }

    walk(doc.body, [])
    if (!text.trim() && fallbackPlain) {
      return parse(fallbackPlain)
    }
    return { text, marks }
  } catch {
    return parse(fallbackPlain ?? html)
  }
}
