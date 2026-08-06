// Minimal Obsidian-flavored markdown renderer for Note/Text objects — no
// external dependency. Covers the syntax notebook users actually reach for
// (headings, bold/italic/strike, inline+fenced code, links, lists,
// checkboxes, blockquotes, hr). Not spec-complete CommonMark; escapes HTML
// first so typed/pasted content can never inject markup.
//
// Inline math ($...$) is the one exception that reaches outside this file's
// "no external dependency" rule — it pipes through the same KaTeX call
// formula.tsx already uses (UX masterplan §9), not a second math renderer.

import katex from 'katex'

// Selection-scoped color/size tokens — the one thing per-line markdown can't
// express with a bare delimiter (there's no bounded palette for "*"). Written
// by the Properties panel as `[text]{color=blue}` / `[text]{size=l}` (Pandoc's
// bracketed-span convention), read back here into an inline style built ONLY
// from these fixed lookups — never from the captured token directly — so
// arbitrary text can never inject a style attribute.
export const TEXT_COLORS: Record<string, string> = {
  default: 'var(--foreground)',
  blue: 'var(--accent-blue)',
  mint: 'var(--accent-mint)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
}
export const TEXT_SIZES: Record<string, number> = { s: 12, m: 15, l: 20, xl: 28 }
// Web-safe stacks only — sans/mono are this app's own loaded fonts (see
// globals.css --font-sans/--font-mono), serif/comic need no @font-face at
// all, every OS ships them.
export const TEXT_FONTS: Record<string, string> = {
  sans: 'var(--font-sans)',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'var(--font-mono)',
  comic: '"Comic Sans MS", "Comic Sans", cursive',
}
// Figma-style named weight steps — a distinct span from **bold** (which is
// always 700); this lets the panel's Weight dropdown pick any CSS weight.
export const TEXT_WEIGHTS: Record<string, number> = {
  thin: 100,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Plain text with every markdown delimiter removed — what copy/paste should
 * actually put on the clipboard (Google Docs never lets you copy the
 * underlying markup, just the rendered text). Strips block prefixes
 * (#, >, -, 1., [ ]) and inline emphasis/span syntax line by line; link text
 * is kept, the URL is dropped. Not used for rendering — only for building the
 * copy/cut payload in components/objects/text.tsx. */
export function stripMarkdown(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      let s = line
        .replace(/^(#{1,6})\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^(\s*[-*+]\s+)\[( |x|X)\]\s+/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
      s = s
        .replace(/```(\w*)\s*/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\$(\S(?:[^$\n]*\S)?)\$/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/==([^=]+)==/g, '$1')
        .replace(/\+\+([^+]+)\+\+/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1$2')
      // Style spans nest (color wrapping size wrapping weight — see setSpan
      // in text.tsx and renderStyleSpans above) so one pass only strips the
      // outermost layer; repeat until nothing's left to strip.
      let prev: string
      do {
        prev = s
        s = s.replace(/\[([^\]]+)\]\{(?:color|size|font|weight)=[a-z0-9.]+\}/g, '$1')
      } while (s !== prev)
      s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1')
      return s
    })
    .join('\n')
}

const SPAN_TAG: Record<string, (id: string, txt: string) => string> = {
  color: (id, txt) => `<span style="color:${TEXT_COLORS[id] ?? 'inherit'}">${txt}</span>`,
  size: (id, txt) => {
    const preset = TEXT_SIZES[id]
    const custom = preset === undefined ? Number(id) : NaN
    const px = preset ?? (Number.isFinite(custom) ? Math.min(200, Math.max(6, custom)) : TEXT_SIZES.m)
    return `<span style="font-size:${px}px">${txt}</span>`
  },
  font: (id, txt) => `<span style="font-family:${TEXT_FONTS[id] ?? 'inherit'}">${txt}</span>`,
  weight: (id, txt) => `<span style="font-weight:${TEXT_WEIGHTS[id] ?? TEXT_WEIGHTS.regular}">${txt}</span>`,
}
const SPAN_SUFFIX = /^\{(color|size|font|weight)=([a-z0-9.]+)\}/

/** Replaces every `[inner]{kind=value}` span with its styled tag, INCLUDING
 * spans nested inside each other (color wrapping size wrapping weight, any
 * order, any depth) — e.g. `[[text]{color=blue}]{size=l}` from stacking
 * color then size on the same selection (see setSpan in text.tsx). A plain
 * `[^\]]+` regex per kind (the previous approach) can't do this: it always
 * stops at the FIRST `]`, so whichever kind's regex happens to run first
 * against a nested pair either fails to match (if that first `]` isn't
 * immediately followed by ITS OWN `{kind=...}`) or — worse — matches the
 * WRONG span, consuming the outer bracket with the inner content and
 * leaving the other span's syntax as literal leftover text (exactly the bug
 * this replaced: `[[text]{size=24}]{color=blue}` rendered with `{color=...}`
 * leaking through as plain text because the size regex ran second and
 * misparsed across the outer boundary). Scanning with an explicit bracket-
 * depth counter to find each `[`'s TRUE matching `]` — then recursing on
 * the inner text before wrapping — makes this correct regardless of which
 * kind is outermost or what order the styles were applied in. */
function renderStyleSpans(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] !== '[') {
      out += s[i]
      i++
      continue
    }
    let depth = 1
    let j = i + 1
    while (j < s.length && depth > 0) {
      if (s[j] === '[') depth++
      else if (s[j] === ']') depth--
      if (depth > 0) j++
    }
    // No matching close, or nothing after it — not a span, emit '[' as-is.
    if (depth !== 0) {
      out += s[i]
      i++
      continue
    }
    const suffixMatch = s.slice(j + 1).match(SPAN_SUFFIX)
    if (!suffixMatch) {
      out += s[i]
      i++
      continue
    }
    const inner = s.slice(i + 1, j)
    const [full, kind, value] = suffixMatch
    out += SPAN_TAG[kind](value, renderStyleSpans(inner))
    i = j + 1 + full.length
  }
  return out
}

/** Inline spans within one block: code protected first, then emphasis/links. */
function inline(raw: string): string {
  const codes: string[] = []
  let withPlaceholders = raw.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return ` ${codes.length - 1} `
  })
  // Inline math: $expr$, not $$expr$$ block math (that's the Formula
  // object). Requires no space right after the opening $ or before the
  // closing $ — the same disambiguation Obsidian uses so "it costs $5 and
  // $10" isn't misread as an expression. Rendered (and protected via the
  // same placeholder swap as inline code) BEFORE escaping, since KaTeX
  // needs the raw LaTeX source.
  withPlaceholders = withPlaceholders.replace(/\$(\S(?:[^$\n]*\S)?)\$/g, (_, tex: string) => {
    let html: string
    try {
      html = katex.renderToString(tex, { throwOnError: false })
    } catch {
      html = escapeHtml(`$${tex}$`)
    }
    codes.push(html)
    return ` ${codes.length - 1} `
  })
  let s = escapeHtml(withPlaceholders)
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
  s = renderStyleSpans(s).replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  )
  return s.replace(/ (\d+) /g, (_, i: string) => codes[Number(i)])
}

/** Same emphasis/span rules as inline(), but for the line the caret is
 * currently on: delimiters stay in the DOM — as real, selectable/copyable
 * text nodes — but collapsed to zero visual width (.md-marker-hidden, see
 * globals.css) instead of being consumed. So **bold** doesn't just look
 * bold while you're editing it, it shows with NO visible ** at all — same
 * as the fully-rendered view — and [old color]{color=purple} shows only
 * "old color" in purple, no brackets/braces leaking through. This is what
 * makes WYSIWYG-while-typing possible at all: every offset function in
 * components/objects/text.tsx (posAt, selectionSpan, wrap, activateLine…)
 * walks DOM TEXT LENGTH (not visual width) and assumes it equals the raw
 * markdown length character-for-character. Actually removing the delimiters
 * from the DOM (or display:none, which drops them from .textContent too)
 * would shrink that length and break every one of those functions the
 * instant a mark is applied — collapsing width/height while keeping the
 * characters as real text preserves the 1:1 mapping AND keeps them
 * selectable (a drag-select or copy that spans a mark still copies its
 * delimiters as plain text, exactly as if you'd copied the raw source).
 * Code and math spans are deliberately left out of this treatment: KaTeX/
 * code output has different text length than its source, which is exactly
 * the length-parity trap above — so those keep rendering as raw source,
 * same as before, until you leave the line. */
function inlineActive(raw: string): string {
  let s = escapeHtml(raw)
  // Every replace below emits a hidden marker span containing literal
  // */_/~/[/]/{/} characters (the delimiter itself, kept as real text so
  // it's still selectable/copyable — see doc comment above). Emitting that
  // HTML directly, the way inline() does for its plain semantic tags, is
  // exactly what corrupted nested marks before this fix: a later pass in
  // this same chain (e.g. the single-`*` italic regex) can't tell an
  // already-emitted marker's `*` from the ORIGINAL text, so it happily
  // matches "**" from one bold span's opening marker together with "**"
  // from a totally unrelated bold span's closing marker, treating
  // everything in between — tags included — as italic. Protecting each
  // marker behind a numbered placeholder (the same technique already used
  // for code/math above) removes those characters from the string entirely
  // until the very end, so subsequent passes have nothing left to
  // (mis)match.
  const codes: string[] = []
  const hidden = (delim: string) => {
    codes.push(`<span class="md-marker md-marker-hidden">${escapeHtml(delim)}</span>`)
    return ` ${codes.length - 1} `
  }
  // Same bracket-depth scan as renderStyleSpans (see its doc comment for
  // why a flat [^\]]+ regex can't handle nested spans), but emitting hidden
  // marker placeholders around the `[` / `]{kind=value}` delimiters instead
  // of dropping them, exactly like every other mark below.
  const styleSpansActive = (str: string): string => {
    let out = ''
    let i = 0
    while (i < str.length) {
      if (str[i] !== '[') {
        out += str[i]
        i++
        continue
      }
      let depth = 1
      let j = i + 1
      while (j < str.length && depth > 0) {
        if (str[j] === '[') depth++
        else if (str[j] === ']') depth--
        if (depth > 0) j++
      }
      if (depth !== 0) {
        out += str[i]
        i++
        continue
      }
      const suffixMatch = str.slice(j + 1).match(SPAN_SUFFIX)
      if (!suffixMatch) {
        out += str[i]
        i++
        continue
      }
      const inner = str.slice(i + 1, j)
      const [full, kind, value] = suffixMatch
      out += `${hidden('[')}${SPAN_TAG[kind](value, styleSpansActive(inner))}${hidden(`]${full.slice(1)}`)}`
      i = j + 1 + full.length
    }
    return out
  }
  s = s
    .replace(
      /\*\*([^*]+)\*\*/g,
      (_, txt: string) => `${hidden('**')}<strong>${txt}</strong>${hidden('**')}`
    )
    .replace(
      /__([^_]+)__/g,
      (_, txt: string) => `${hidden('__')}<strong>${txt}</strong>${hidden('__')}`
    )
    .replace(
      /~~([^~]+)~~/g,
      (_, txt: string) => `${hidden('~~')}<del>${txt}</del>${hidden('~~')}`
    )
    .replace(
      /==([^=]+)==/g,
      (_, txt: string) => `${hidden('==')}<mark>${txt}</mark>${hidden('==')}`
    )
    .replace(
      /\+\+([^+]+)\+\+/g,
      (_, txt: string) => `${hidden('++')}<u>${txt}</u>${hidden('++')}`
    )
    .replace(
      /\*([^*]+)\*/g,
      (_, txt: string) => `${hidden('*')}<em>${txt}</em>${hidden('*')}`
    )
    .replace(
      /(^|[^\w])_([^_]+)_(?!\w)/g,
      (_, pre: string, txt: string) => `${pre}${hidden('_')}<em>${txt}</em>${hidden('_')}`
    )
  s = styleSpansActive(s)
  return s.replace(/ (\d+) /g, (_, i: string) => codes[Number(i)])
}

/** One line, live-preview style (Obsidian's "active line stays raw, every
 * other line renders" model — see components/objects/text.tsx). Unlike
 * renderMarkdown this never groups lines into real <ul>/<li> or <pre> blocks
 * — each line is independent so it can be swapped in/out as the caret moves
 * without touching its neighbors. */
export function renderLineLive(raw: string): { html: string; cls: string } {
  if (raw.trim() === '') return { html: '<br>', cls: '' }

  const heading = raw.match(/^(#{1,6})(\s+)(.*)$/)
  if (heading) {
    return { html: inline(raw), cls: `md-h md-h${heading[1].length}` }
  }
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
    return { html: '<span class="md-marker">' + escapeHtml(raw) + '</span>', cls: 'md-hr' }
  }
  const quote = raw.match(/^(>\s?)(.*)$/)
  if (quote) {
    return {
      html: `<span class="md-marker">${escapeHtml(quote[1])}</span>${inline(quote[2])}`,
      cls: 'md-quote',
    }
  }
  const checkbox = raw.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/)
  if (checkbox) {
    const checked = checkbox[2].toLowerCase() === 'x'
    return {
      html:
        `<span class="md-marker">${escapeHtml(checkbox[1])}[${checkbox[2]}]${escapeHtml(checkbox[3])}</span>` +
        `<span class="${checked ? 'md-done' : ''}">${inline(checkbox[4])}</span>`,
      cls: 'md-li',
    }
  }
  const bullet = raw.match(/^(\s*[-*+]\s+)(.*)$/)
  if (bullet) {
    return { html: `<span class="md-marker">${escapeHtml(bullet[1])}</span>${inline(bullet[2])}`, cls: 'md-li' }
  }
  const numbered = raw.match(/^(\s*\d+\.\s+)(.*)$/)
  if (numbered) {
    return { html: `<span class="md-marker">${escapeHtml(numbered[1])}</span>${inline(numbered[2])}`, cls: 'md-li' }
  }
  return { html: inline(raw), cls: '' }
}

/** Same block-level shape as renderLineLive, but for the ACTIVE (caret-
 * holding) line — marks render styled with their delimiters kept dim rather
 * than falling back to plain raw text. See inlineActive() for why this is
 * still exactly length-preserving and doesn't disturb caret math. Block-
 * level prefixes (>, -, 1.) already show as raw .md-marker text in both
 * modes, so only the inline call changes here. */
export function renderLineActive(raw: string): { html: string; cls: string } {
  if (raw.trim() === '') return { html: '<br>', cls: '' }

  const heading = raw.match(/^(#{1,6})(\s+)(.*)$/)
  if (heading) {
    return {
      html: `<span class="md-marker">${escapeHtml(heading[1] + heading[2])}</span>${inlineActive(heading[3])}`,
      cls: `md-h md-h${heading[1].length}`,
    }
  }
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
    return { html: '<span class="md-marker">' + escapeHtml(raw) + '</span>', cls: 'md-hr' }
  }
  const quote = raw.match(/^(>\s?)(.*)$/)
  if (quote) {
    return {
      html: `<span class="md-marker">${escapeHtml(quote[1])}</span>${inlineActive(quote[2])}`,
      cls: 'md-quote',
    }
  }
  const checkbox = raw.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/)
  if (checkbox) {
    const checked = checkbox[2].toLowerCase() === 'x'
    return {
      html:
        `<span class="md-marker">${escapeHtml(checkbox[1])}[${checkbox[2]}]${escapeHtml(checkbox[3])}</span>` +
        `<span class="${checked ? 'md-done' : ''}">${inlineActive(checkbox[4])}</span>`,
      cls: 'md-li',
    }
  }
  const bullet = raw.match(/^(\s*[-*+]\s+)(.*)$/)
  if (bullet) {
    return { html: `<span class="md-marker">${escapeHtml(bullet[1])}</span>${inlineActive(bullet[2])}`, cls: 'md-li' }
  }
  const numbered = raw.match(/^(\s*\d+\.\s+)(.*)$/)
  if (numbered) {
    return { html: `<span class="md-marker">${escapeHtml(numbered[1])}</span>${inlineActive(numbered[2])}`, cls: 'md-li' }
  }
  return { html: inlineActive(raw), cls: '' }
}

export function renderMarkdown(src: string): string {
  if (!src.trim()) return ''
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  let paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (listType && listItems.length) out.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listType = null
    listItems = []
  }

  while (i < lines.length) {
    const line = lines[i]

    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      flushParagraph()
      flushList()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++
      out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      flushList()
      i++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph()
      flushList()
      out.push('<hr>')
      i++
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      const qlines = [quote[1]]
      i++
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        qlines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${qlines.map(inline).join('<br>')}</blockquote>`)
      continue
    }

    const checkbox = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/)
    const bullet = !checkbox && line.match(/^\s*[-*+]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)

    if (checkbox) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      const checked = checkbox[1].toLowerCase() === 'x'
      listItems.push(
        `<li class="task-item"><input type="checkbox" disabled${checked ? ' checked' : ''}/> ${inline(checkbox[2])}</li>`
      )
      i++
      continue
    }
    if (bullet) {
      flushParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(`<li>${inline(bullet[1])}</li>`)
      i++
      continue
    }
    if (numbered) {
      flushParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(`<li>${inline(numbered[1])}</li>`)
      i++
      continue
    }

    flushList()
    paragraph.push(line)
    i++
  }
  flushParagraph()
  flushList()
  return out.join('')
}

/** Best-effort recovery of plain text from legacy HTML-formatted notes
 * (the old contentEditable/execCommand editor), so upgrading doesn't turn
 * old rich-text notes into literal tag soup. Formatting itself is lost. */
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
