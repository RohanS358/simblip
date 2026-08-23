'use client'

// Lazily-loaded KaTeX, shared by the notebook's text renderer
// (lib/text/render.ts) and the AI panel's answer renderer. Both used to
// `import katex from 'katex'` at module scope, which put the library — and
// its stylesheet — in /notebook's first-load bundle even for the many pages
// that contain no maths at all. That was one of the three largest
// contributors to the 5.4 s LCP render delay Lighthouse measured.
//
// The trade: an expression renders as its literal source (`$E=mc^2$`) for
// the frame or two before the chunk lands, then swaps to typeset maths. That
// is exactly the fallback a KaTeX parse error already took, so no caller
// needed a new failure path — only a reason to re-render, which
// `subscribeKatexReady` provides.

type Katex = typeof import('katex').default

let katex: Katex | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()

function load() {
  if (katex || loading) return
  loading = import('./katex-impl')
    .then((m) => {
      katex = m.default
      for (const cb of waiting) cb()
    })
    .catch(() => {
      // Leaving `katex` null keeps every caller on the literal-source
      // fallback forever rather than throwing mid-render. `loading` stays
      // set so a failed chunk isn't re-requested on every keystroke.
    })
}

/** Typeset one expression, or null if KaTeX has not arrived yet — in which
 *  case the load is kicked off and the caller should fall back to the source
 *  text. Never throws. */
export function renderMath(expr: string, displayMode = false): string | null {
  if (!katex) {
    load()
    return null
  }
  try {
    return katex.renderToString(expr, { displayMode, throwOnError: false })
  } catch {
    return null
  }
}

/** Fires once, when KaTeX finishes loading, so a component that rendered the
 *  fallback can re-render with real maths. No-ops if it is already loaded.
 *  Returns an unsubscribe. */
export function subscribeKatexReady(cb: () => void): () => void {
  if (katex) return () => {}
  waiting.add(cb)
  return () => waiting.delete(cb)
}

export const katexLoaded = () => katex !== null
