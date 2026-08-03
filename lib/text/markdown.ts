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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\{color=([a-z]+)\}/g,
      (_, txt: string, id: string) => `<span style="color:${TEXT_COLORS[id] ?? 'inherit'}">${txt}</span>`
    )
    .replace(
      /\[([^\]]+)\]\{size=([a-z]+)\}/g,
      (_, txt: string, id: string) => `<span style="font-size:${TEXT_SIZES[id] ?? TEXT_SIZES.m}px">${txt}</span>`
    )
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )
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
