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

import { renderMath } from './katex-lazy'
import { runsForLine, splitIndent, TEXT_COLORS, TEXT_FONTS, TEXT_WEIGHTS, resolveSizePx, type Mark, type Run } from './marks'

// How far one indent level pushes a line in, in em (padding-left, a real
// tab-stop regardless of font metrics). 2.2em approximates INDENT_UNIT's 8
// literal spaces at a normal 15px sans-serif size.
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
function renderRun(run: Run): string {
  const inner = renderInlineMath(run.text)
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
 *  isn't misread as an expression.
 *
 *  Matched ANYWHERE in a run, not just when the run is nothing but the
 *  expression. It used to be anchored (/^\$...\$$/), which meant a sentence
 *  like "permittivities $\\epsilon_1$ and $\\epsilon_2$" rendered as literal
 *  source: runs are split at MARK boundaries only (runsForLine), so an
 *  unformatted sentence is ONE run whose full text is not an expression, and
 *  the anchors never matched. Inline maths therefore only ever worked when an
 *  expression happened to occupy a whole run by itself. */
const MATH_RE = /\$(\S(?:[^$\n]*\S)?)\$/g

/** Escaped text with every $expr$ span replaced by rendered KaTeX. Splitting
 *  here rather than in runsForLine keeps maths out of the marks model
 *  entirely — a mark still wraps the whole run, expression included. */
function renderInlineMath(text: string): string {
  MATH_RE.lastIndex = 0
  let out = ''
  let last = 0
  for (const m of text.matchAll(MATH_RE)) {
    const at = m.index ?? 0
    out += escapeHtml(text.slice(last, at))
    // null means either a KaTeX failure or that the library is still
    // loading (see katex-lazy.ts) — both fall back to the literal source
    // rather than dropping the student's expression on the floor. Callers
    // re-render via useKatexReady once the chunk lands.
    const html = renderMath(m[1])
    out += html ?? escapeHtml(m[0])
    last = at + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

/** Renders one line's inline content (marks + math), the single function
 *  every block-level case below calls. */
export function renderLine(text: string, marks: Mark[], lineStart: number): string {
  return runsForLine(text, marks, lineStart)
    .map((run) => renderRun(run))
    .join('')
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
  // The <ol start> value for whichever ordered list is currently open — the
  // first item's own source digit. A derivation's steps are routinely
  // interrupted by an unindented explanation paragraph between items (every
  // real model output tested wrote it this way), which flushList() treats as
  // the end of that list — a fresh <ol> always counts from 1 unless told
  // otherwise, so "1,2,3,4,5" rendered as "1,1,1,1,1". Recording the digit
  // the list OPENED with (not the next predicted one — that was the bug:
  // reading a value already advanced for the next item) fixes it without
  // requiring one unbroken list block.
  let olStart = 1

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
    if (listType && listItems.length) {
      const startAttr = listType === 'ol' && olStart !== 1 ? ` start="${olStart}"` : ''
      out.push(`<${listType}${startAttr}>${listItems.join('')}</${listType}>`)
    }
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
    const numbered = rest.match(/^(\d+)\.\s+(.*)$/)

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
        olStart = Number(numbered[1])
      }
      const bodyStart = bodyStart0 + rest.length - numbered[2].length
      listItems.push(`<li${padStyle(level)}>${renderLine(numbered[2], marks, bodyStart)}</li>`)
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
