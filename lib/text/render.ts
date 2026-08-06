// Renders a StoredText (plain text + offset-based marks, see lib/text/marks.ts)
// to HTML. ONE function serves both the editing view and the read-only
// view — there is no more "active line stays raw, everything else renders"
// split, because there's no delimiter text to keep length-parity with
// anymore (see marks.ts's doc comment). What you see while typing is
// pixel-identical to what you see after clicking away.
//
// Block-level structure (headings, blockquote, lists, fenced code, hr) is
// still recognized from line-prefix syntax — that part of the old markdown
// model is unchanged, only inline formatting moved to marks.

import katex from 'katex'
import { runsForLine, splitIndent, TEXT_COLORS, TEXT_FONTS, TEXT_WEIGHTS, resolveSizePx, type Mark, type Run } from './marks'

// How far one indent level pushes a line in, in em — used only by the
// read-only render below (padding-left, a real tab-stop regardless of font
// metrics). The LIVE editor renders indent as literal space characters
// instead (see renderEditorLine's doc comment for why padding doesn't work
// there); 2.2em approximates INDENT_UNIT's 8 literal spaces at a normal
// 15px sans-serif size so the two views read as the same indent depth, even
// though they're not pixel-identical for this one property the way
// everything else in this file is.
const INDENT_EM = 2.2

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Rendering order is fixed regardless of which mark was applied first/last
// (unlike the old bracket-nesting model, where visual nesting depended on
// application order) — color always wraps size wraps weight wraps font,
// with the toggle marks innermost, closest to the text.
const MARK_ORDER: Mark['kind'][] = ['color', 'size', 'weight', 'font', 'link', 'highlight', 'strike', 'underline', 'bold', 'italic', 'code']

/** Renders one run's plain text wrapped in every mark that covers it, KaTeX
 *  inline math ($expr$) already resolved. Innermost-first per MARK_ORDER so
 *  wrapping order is deterministic. */
function renderRun(run: Run, mathHtml: string | null): string {
  const inner = mathHtml ?? escapeHtml(run.text)
  const byKind = new Map<Mark['kind'], Mark>()
  for (const m of run.marks) byKind.set(m.kind, m)

  let html = inner
  for (const kind of [...MARK_ORDER].reverse()) {
    const m = byKind.get(kind)
    if (!m) continue
    html = wrapMark(kind, m.value, html)
  }
  return html
}

function wrapMark(kind: Mark['kind'], value: string | undefined, html: string): string {
  switch (kind) {
    case 'bold':
      return `<strong>${html}</strong>`
    case 'italic':
      return `<em>${html}</em>`
    case 'underline':
      return `<u>${html}</u>`
    case 'strike':
      return `<del>${html}</del>`
    case 'highlight':
      return `<mark>${html}</mark>`
    case 'code':
      return `<code>${html}</code>`
    case 'color': {
      // Preset id (TEXT_COLORS) OR a custom #hex from the color-wheel picker
      // — validated against a strict hex pattern before going into the style
      // attribute, since (unlike link's https check) there's no other gate
      // between panel input and this string.
      const preset = TEXT_COLORS[value ?? '']
      const hex = value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined
      return `<span style="color:${preset ?? hex ?? 'inherit'}">${html}</span>`
    }
    case 'size':
      return `<span style="font-size:${resolveSizePx(value ?? '')}px">${html}</span>`
    case 'font':
      return `<span style="font-family:${TEXT_FONTS[value ?? ''] ?? 'inherit'}">${html}</span>`
    case 'weight':
      return `<span style="font-weight:${TEXT_WEIGHTS[value ?? ''] ?? TEXT_WEIGHTS.regular}">${html}</span>`
    case 'link': {
      // value is a URL written by the panel's Link control — never trusted
      // raw into an href without the same https-only check the old model
      // used, so arbitrary mark data can't turn into a javascript: URL.
      const href = value && /^https?:/.test(value) ? value : '#'
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
    }
  }
}

/** Inline math ($expr$, not $$expr$$ block math — that's the Formula
 *  object). Requires no space right after the opening $ or before the
 *  closing $, same disambiguation Obsidian uses so "it costs $5 and $10"
 *  isn't misread as an expression. Returns the KaTeX HTML for any run whose
 *  ENTIRE text is a math expression — math runs are just plain text that
 *  happens to render as an equation, not a mark, since no formatting can
 *  meaningfully apply to only part of an expression here. */
const MATH_RE = /^\$(\S(?:[^$\n]*\S)?)\$$/

function mathHtmlFor(text: string): string | null {
  const m = MATH_RE.exec(text)
  if (!m) return null
  try {
    return katex.renderToString(m[1], { throwOnError: false })
  } catch {
    return null
  }
}

/** Renders one line's inline content (marks + math), the single function
 *  every block-level case below calls. */
export function renderLine(text: string, marks: Mark[], lineStart: number): string {
  return runsForLine(text, marks, lineStart)
    .map((run) => renderRun(run, mathHtmlFor(run.text)))
    .join('')
}

interface RenderedLine {
  html: string
  cls: string
}

/** Same per-line shape as the old renderLineLive/renderLineActive — one
 *  line's block-type detection (heading/quote/checkbox/bullet/numbered) and
 *  its rendered inline HTML, used by the live per-line editor
 *  (components/objects/text.tsx renders each contentEditable line div with
 *  this). `lineStart` is this line's offset into the FULL text string (the
 *  editor keeps one flat string + marks spanning it, not per-line arrays),
 *  needed so runsForLine can find which marks apply to this line. There is
 *  only ONE version of this now (the old model needed a separate "active"
 *  variant that kept delimiters dimly visible for the caret's line) — every
 *  line, including the one being typed on, renders through this.
 *
 *  Indentation (Tab/Shift+Tab, see components/objects/text.tsx's indentLine)
 *  is leading spaces on `raw` — unlike block prefixes, these are NOT
 *  stripped out of the rendered text: they render as literal space
 *  characters (white-space:pre-wrap already renders every other space
 *  literally, so this costs nothing extra) rather than becoming a
 *  padding-left on the line. That's deliberate: the live editor's whole
 *  caret/selection model depends on DOM text length exactly matching
 *  `raw.length` for every line (see posAt's doc comment) — stripping the
 *  indent into a style property broke that invariant for every indented
 *  line, silently dropping the indent the instant you typed into a
 *  freshly-Tabbed empty line (the DOM's only child was a bare `<br>` with
 *  zero text nodes for the browser to insert after, so `el.textContent`
 *  came back with no leading spaces at all once real content landed, and
 *  onInput's diff — which trusts the DOM as ground truth — happily
 *  overwrote linesRef with that shorter, unindented string). Keeping the
 *  spaces as real text sidesteps the whole class of bug. */
export function renderEditorLine(raw: string, marks: Mark[], lineStart: number): RenderedLine {
  // Only a TRULY empty line (not just whitespace-only) takes the <br>
  // placeholder shortcut — a line that's pure indentation (just Tabbed,
  // nothing typed after it yet) has to render its spaces as real text
  // nodes, or the DOM's only child is a bare <br> with nothing for the
  // browser to insert after, and the next keystroke's onInput reads back
  // zero leading spaces, silently dropping the indent (see indentLine's
  // caller in components/objects/text.tsx for the full story).
  if (raw === '') return { html: '<br>', cls: '' }

  const heading = raw.match(/^(#{1,6})(\s+)(.*)$/)
  if (heading) {
    const bodyStart = lineStart + heading[1].length + heading[2].length
    return {
      html: `<span class="md-marker">${escapeHtml(heading[1] + heading[2])}</span>${renderLine(heading[3], marks, bodyStart)}`,
      cls: `md-h md-h${heading[1].length}`,
    }
  }
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
    return { html: '<span class="md-marker">' + escapeHtml(raw) + '</span>', cls: 'md-hr' }
  }
  const quote = raw.match(/^(\s*>\s?)(.*)$/)
  if (quote) {
    const bodyStart = lineStart + quote[1].length
    return {
      html: `<span class="md-marker">${escapeHtml(quote[1])}</span>${renderLine(quote[2], marks, bodyStart)}`,
      cls: 'md-quote',
    }
  }
  const checkbox = raw.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/)
  if (checkbox) {
    const checked = checkbox[2].toLowerCase() === 'x'
    const bodyStart = lineStart + checkbox[1].length + 1 + 1 + checkbox[3].length
    return {
      html:
        `<span class="md-marker md-marker-check">${escapeHtml(checkbox[1])}[${escapeHtml(checkbox[2])}]${escapeHtml(checkbox[3])}</span>` +
        `<span class="${checked ? 'md-done' : ''}">${renderLine(checkbox[4], marks, bodyStart)}</span>`,
      cls: `md-li${checked ? ' md-li-checked' : ''}`,
    }
  }
  const bullet = raw.match(/^(\s*[-*+]\s+)(.*)$/)
  if (bullet) {
    const bodyStart = lineStart + bullet[1].length
    return {
      html: `<span class="md-marker md-marker-bullet">${escapeHtml(bullet[1])}</span>${renderLine(bullet[2], marks, bodyStart)}`,
      cls: 'md-li',
    }
  }
  const numbered = raw.match(/^(\s*\d+\.\s+)(.*)$/)
  if (numbered) {
    const bodyStart = lineStart + numbered[1].length
    return {
      html: `<span class="md-marker md-marker-num">${escapeHtml(numbered[1])}</span>${renderLine(numbered[2], marks, bodyStart)}`,
      cls: 'md-li',
    }
  }
  return { html: renderLine(raw, marks, lineStart), cls: '' }
}

/** Full block-level render (headings→<h1-6>, consecutive bullets→<ul>,
 *  fenced code→<pre>, blockquote runs→<blockquote>, everything else→<p>) —
 *  the read-only / deselected view. Same line-scanning shape the old
 *  renderMarkdown used, calling renderLine (marks-aware) instead of the old
 *  delimiter-parsing inline(). `text`/`marks` are the object's full stored
 *  content — line offsets into the flat string are tracked as the scan
 *  walks lines, since marks are global offsets, not per-line. */
export function renderMarkdown(text: string, marks: Mark[]): string {
  if (!text.trim()) return ''
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let offset = 0
  let paragraph: { raw: string; start: number; level: number }[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  const padCss = (level: number) => (level > 0 ? `padding-left:${level * INDENT_EM}em` : '')
  const padStyle = (level: number) => {
    const css = padCss(level)
    return css ? ` style="${css}"` : ''
  }

  // A plain (non-block-type) line still needs its OWN indent level — lines
  // in one paragraph aren't all the same depth just because they're not
  // headings/lists/quotes (see the fallback case at the end of the loop
  // below). Each line becomes its own block-level span when indented so
  // padding-left applies per-line instead of once for the whole <p>; a
  // level-0 line renders exactly as before (no wrapper, joined by <br>).
  const flushParagraph = () => {
    if (paragraph.length)
      out.push(
        `<p>${paragraph
          .map((l) => {
            const html = renderLine(l.raw, marks, l.start)
            return l.level > 0 ? `<span style="display:block;${padCss(l.level)}">${html}</span>` : html
          })
          .join('<br>')}</p>`
      )
    paragraph = []
  }
  const flushList = () => {
    if (listType && listItems.length) out.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listType = null
    listItems = []
  }

  while (i < lines.length) {
    const line = lines[i]
    const lineStart = offset
    const { level, indent, rest } = splitIndent(line)
    const bodyStart0 = lineStart + indent.length

    const fence = rest.match(/^```(\w*)\s*$/)
    if (fence) {
      flushParagraph()
      flushList()
      const codeLines: string[] = []
      offset += line.length + 1
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        offset += lines[i].length + 1
        i++
      }
      offset += (lines[i]?.length ?? 0) + 1
      i++
      out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      offset += line.length + 1
      i++
      continue
    }

    const heading = rest.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const hLevel = heading[1].length
      const bodyStart = bodyStart0 + rest.length - heading[2].length
      out.push(`<h${hLevel}${padStyle(level)}>${renderLine(heading[2], marks, bodyStart)}</h${hLevel}>`)
      offset += line.length + 1
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(rest)) {
      flushParagraph()
      flushList()
      out.push('<hr>')
      offset += line.length + 1
      i++
      continue
    }

    const quote = rest.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      const qlines: { raw: string; start: number }[] = [{ raw: quote[1], start: bodyStart0 + rest.length - quote[1].length }]
      offset += line.length + 1
      i++
      while (i < lines.length && /^>\s?/.test(splitIndent(lines[i]).rest)) {
        const nextRest = splitIndent(lines[i]).rest
        const m = nextRest.match(/^>\s?(.*)$/)!
        qlines.push({ raw: m[1], start: offset + lines[i].length - m[1].length })
        offset += lines[i].length + 1
        i++
      }
      out.push(`<blockquote${padStyle(level)}>${qlines.map((l) => renderLine(l.raw, marks, l.start)).join('<br>')}</blockquote>`)
      continue
    }

    const checkbox = rest.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/)
    const bullet = !checkbox && rest.match(/^[-*+]\s+(.*)$/)
    const numbered = rest.match(/^\d+\.\s+(.*)$/)

    if (checkbox) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      const checked = checkbox[1].toLowerCase() === 'x'
      const bodyStart = bodyStart0 + rest.length - checkbox[2].length
      listItems.push(
        `<li class="task-item"${padStyle(level)}><input type="checkbox" disabled${checked ? ' checked' : ''}/> ${renderLine(checkbox[2], marks, bodyStart)}</li>`
      )
      offset += line.length + 1
      i++
      continue
    }
    if (bullet) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      const bodyStart = bodyStart0 + rest.length - bullet[1].length
      listItems.push(`<li${padStyle(level)}>${renderLine(bullet[1], marks, bodyStart)}</li>`)
      offset += line.length + 1
      i++
      continue
    }
    if (numbered) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      const bodyStart = bodyStart0 + rest.length - numbered[1].length
      listItems.push(`<li${padStyle(level)}>${renderLine(numbered[1], marks, bodyStart)}</li>`)
      offset += line.length + 1
      i++
      continue
    }

    flushList()
    paragraph.push({ raw: rest, start: bodyStart0, level })
    offset += line.length + 1
    i++
  }
  flushParagraph()
  flushList()
  return out.join('')
}

/** Best-effort recovery of plain text from legacy HTML-formatted notes (the
 *  old contentEditable/execCommand editor, pre-dating even the markdown
 *  model), so opening a very old document doesn't show literal tag soup.
 *  Formatting itself is lost — kept identical to the pre-rewrite version. */
export function htmlToMarkdownSource(value: string): string {
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
