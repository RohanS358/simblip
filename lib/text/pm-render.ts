'use client'

// The read-only render path for ProseMirror documents — Phase C's "one
// renderer, not two".
//
// The previous engine had renderEditorLine() (live, per-line) and
// renderMarkdown() (read-only, block-level) which were REQUIRED to produce
// pixel-identical output and already disagreed about indentation. Here the
// editable path is Tiptap's own view and this path is generateHTML() over
// the SAME extension list (lib/text/extensions.ts), so the two cannot drift:
// there is one schema and one set of renderHTML() implementations.
//
// Inline maths is the one thing generateHTML cannot do, because `$E=mc^2$`
// is ordinary text content in the document, not a node or mark. It is
// applied as a post-pass over the generated HTML, matching the old
// renderInlineMath() semantics exactly (see lib/text/render.ts).

import { generateHTML } from '@tiptap/core'
import { textExtensions } from './extensions'
import { renderMath } from './katex-lazy'
import type { PmDoc } from './pm'

/** Same expression syntax the legacy renderer used: no space just inside
 *  either `$`, so "it costs $5 and $10" is not misread as maths. Kept
 *  byte-identical to render.ts's MATH_RE so existing documents render the
 *  same before and after the migration. */
const MATH_RE = /\$(\S(?:[^$\n]*\S)?)\$/g

/** Splits generated HTML into tags and text, so `$…$` inside an attribute
 *  value (a link href, a style) can never be mistaken for an expression. */
const TAG_OR_TEXT_RE = /(<[^>]*>)|([^<]+)/g

/** Replaces every `$expr$` in the TEXT portions of `html` with typeset
 *  KaTeX. Text here is already HTML-escaped by generateHTML, and KaTeX
 *  output is trusted markup, so nothing is re-escaped — an expression that
 *  fails or arrives before the KaTeX chunk keeps its escaped literal source,
 *  the same fallback the old renderer took. */
function applyInlineMath(html: string): string {
  if (!html.includes('$')) return html
  return html.replace(TAG_OR_TEXT_RE, (whole, tag: string | undefined, text: string | undefined) => {
    if (tag !== undefined || text === undefined) return whole
    MATH_RE.lastIndex = 0
    return text.replace(MATH_RE, (source, expr: string) => {
      // The expression arrives HTML-escaped (it passed through
      // generateHTML), but KaTeX needs the raw source — `\frac{a}{b}` must
      // not reach it as `\frac{a}{b}` with &amp; in place of &.
      const rendered = renderMath(unescapeHtml(expr))
      return rendered ?? source
    })
  })
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

function unescapeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
}

/** PM document → display HTML. The only renderer for non-editing text
 *  boxes, notes and geometry labels.
 *
 *  Returns '' on the server: generateHTML serializes through
 *  prosemirror-model's DOMSerializer, which reads `window.document` and
 *  throws outright under Node. Every caller is inside a `'use client'`
 *  component, but that still prerenders on the server, so the guard is what
 *  keeps a text box from crashing the render. The client's first effect
 *  paints the real HTML — the same one-frame delay the KaTeX fallback
 *  already has. */
export function renderPmDoc(doc: PmDoc): string {
  if (typeof window === 'undefined') return ''
  const html = generateHTML(doc as unknown as Record<string, unknown>, textExtensions())
  return applyInlineMath(html)
}

/** True when the document has no text content at all — drives the
 *  placeholder styling on the read-only view, which previously keyed off an
 *  empty rendered string. An empty Tiptap doc still renders `<p></p>`, so
 *  the HTML itself is never falsy. */
export function isPmDocEmpty(doc: PmDoc): boolean {
  const walk = (node: { text?: string; content?: unknown[] }): boolean => {
    if (node.text && node.text.length > 0) return false
    for (const child of (node.content ?? []) as { text?: string; content?: unknown[] }[]) {
      if (!walk(child)) return false
    }
    return true
  }
  return walk(doc)
}
