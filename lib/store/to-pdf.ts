'use client'

// Client-side document → PDF conversion. The file element is a PDF viewer,
// so anything that isn't already a PDF is converted here, IN THE BROWSER —
// no LibreOffice, no server binary, so it works on Vercel (and offline).
//
// The recipe is the same for every format: render the document into a
// detached, off-screen DOM node at real page dimensions, rasterize each page
// with html2canvas, and stack the images into a PDF with jsPDF. Fidelity is
// "good enough to teach from" — the browser is doing the layout, so fonts,
// images, tables and slide graphics come through; exotic effects (transitions,
// SmartArt animations, embedded video) do not.
//
// Every heavy dependency is imported lazily so the notebook bundle never
// carries them until someone actually attaches a document.

// The frames themselves live in lib/scene/frames; aliased here because the
// export path has always called them PPT_*/DOC_*.
import { SLIDE_W, SLIDE_H, SHEET_W, SHEET_H } from '@/lib/scene/frames'

export const PPT_W = SLIDE_W // 16:9 slide, CSS px
export const PPT_H = SLIDE_H
const DOC_W = SHEET_W // A4 @ 96dpi
const DOC_H = SHEET_H

export type ConvertProgress = (done: number, total: number) => void

interface Stage {
  /** where the renderer lays the document out */
  host: HTMLElement
  /** the iframe's own document — pass its <head> as a style container */
  doc: Document
  cleanup: () => void
}

/**
 * An off-screen stage inside a BLANK IFRAME.
 *
 * This has to be an iframe, not a hidden div. html2canvas 1.4 cannot parse
 * modern CSS color functions — it throws "unsupported color function lab" the
 * moment it meets lab()/lch()/oklch()/color-mix() — and it inspects the whole
 * document, `html` and `body` included. Our design tokens are oklch and
 * Tailwind's preflight paints `*`, so a div inside our page is poisoned by the
 * app's own stylesheet no matter what we override on the subtree. An iframe
 * with its own empty document simply has none of that CSS in it.
 */
function stage(width: number): Promise<Stage> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      `position:fixed;left:-10000px;top:0;border:0;visibility:hidden;` +
      `width:${width}px;height:3000px;`
    frame.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;padding:0;background:#fff;color:#111"></body></html>'
    frame.onload = () => {
      const doc = frame.contentDocument!
      resolve({ host: doc.body, doc, cleanup: () => frame.remove() })
    }
    document.body.appendChild(frame)
  })
}

// Belt and braces: a document could itself carry a modern color function.
// Rewrite only the offending values; anything the file specified as plain rgb
// is left exactly as it is, so fidelity is unaffected.
const UNSUPPORTED_COLOR = /\b(?:lab|lch|oklab|oklch|color-mix|color)\(/i

const SAFE_FALLBACK: Record<string, string> = {
  color: '#111111',
  'background-color': 'transparent',
  'background-image': 'none',
  'border-top-color': 'transparent',
  'border-right-color': 'transparent',
  'border-bottom-color': 'transparent',
  'border-left-color': 'transparent',
  'outline-color': 'transparent',
  'text-decoration-color': 'currentColor',
  'column-rule-color': 'transparent',
  'box-shadow': 'none',
  'text-shadow': 'none',
  fill: '#111111',
  stroke: 'none',
}

/** Exported so callers rasterizing LIVE app DOM (not a throwaway iframe) can
 *  run this against html2canvas's `onclone` document only — never the real
 *  element, since this mutates inline styles permanently. */
export function sanitizeColors(root: HTMLElement) {
  const view = root.ownerDocument.defaultView
  if (!view) return
  const els: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const el of els) {
    const cs = view.getComputedStyle(el)
    for (const prop of Object.keys(SAFE_FALLBACK)) {
      const value = cs.getPropertyValue(prop)
      if (value && UNSUPPORTED_COLOR.test(value)) {
        el.style.setProperty(prop, SAFE_FALLBACK[prop], 'important')
      }
    }
  }
}

// Widget types where the browser draws a real control, not text — swapping
// these would lose the control itself, and they don't hit the clipping bug
// below since there's no glyph box to mis-measure.
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'image'])

/** html2canvas-pro doesn't reproduce a browser's own text-box layout for
 *  form controls — it mis-measures the glyph box and renders <input>/
 *  <textarea> text with the top of each line clipped (worst on large/bold
 *  text, e.g. a page title). Run in `onclone` only, same rule as
 *  sanitizeColors: swap each text-bearing field for a plain div carrying its
 *  value/placeholder and classes, so the rasterized clone lays the text out
 *  like any other block instead of through the broken control path. */
export function sanitizeFormFields(root: HTMLElement) {
  const doc = root.ownerDocument
  const isTextField = (el: Element): el is HTMLInputElement | HTMLTextAreaElement =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type))
  const fields = Array.from(root.querySelectorAll('input, textarea')).filter(isTextField)
  if (root instanceof HTMLElement && isTextField(root)) fields.unshift(root)
  for (const field of fields) {
    const div = doc.createElement('div')
    div.textContent = field.value || field.placeholder
    div.className = field.className
    field.replaceWith(div)
  }
}

async function pagesToPdf(
  pages: HTMLElement[],
  size: { w: number; h: number },
  onProgress?: ConvertProgress
): Promise<Blob> {
  // html2canvas-pro: same API, but it actually parses the modern color
  // functions (oklch/lab/color-mix) our design tokens use — the classic
  // html2canvas throws "unsupported color function lab" on them, and the
  // sanitizer below can't reach pseudo-elements.
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas-pro'),
    import('jspdf'),
  ])
  const landscape = size.w > size.h
  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [size.w, size.h],
    compress: true,
  })

  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2, // 2× so the PDF stays sharp when the whiteboard zooms in
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      // Pin the capture to the page box — the iframe's viewport must never
      // clip a slide or a tall page.
      width: size.w,
      height: size.h,
      windowWidth: size.w,
      windowHeight: size.h,
      onclone: (_doc, element) => {
        sanitizeColors(element as HTMLElement)
        sanitizeFormFields(element as HTMLElement)
      },
    })
    if (i > 0) pdf.addPage([size.w, size.h], landscape ? 'landscape' : 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, size.w, size.h)
    onProgress?.(i + 1, pages.length)
  }
  return pdf.output('blob')
}

async function pptxToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const { init } = await import('pptx-preview')
  const { host, cleanup } = await stage(PPT_W)
  try {
    // 'list' mode lays every slide out at once (the default paginates to a
    // single visible slide, which would give us a one-page PDF).
    const previewer = init(host, { width: PPT_W, height: PPT_H, mode: 'list' })
    await previewer.preview(await file.arrayBuffer())
    const slides = Array.from(host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper'))
    if (slides.length === 0) throw new Error('No slides found in this presentation.')
    return await pagesToPdf(slides, { w: PPT_W, h: PPT_H }, onProgress)
  } finally {
    cleanup()
  }
}

async function docxToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const docx = await import('docx-preview')
  const { host, doc, cleanup } = await stage(DOC_W)
  try {
    // Its stylesheet goes into the IFRAME's head — keeping the whole render
    // inside the clean document.
    await docx.renderAsync(await file.arrayBuffer(), host, doc.head, {
      className: 'docx',
      inWrapper: false,
      breakPages: true, // gives us one <section> per printed page
      ignoreWidth: false,
      ignoreHeight: false,
      experimental: true,
    })
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section'))
    const pages = sections.length > 0 ? sections : [host]
    return await pagesToPdf(pages, { w: DOC_W, h: DOC_H }, onProgress)
  } finally {
    cleanup()
  }
}

/** Plain text / CSV / markdown: lay it out as monospaced A4 pages. */
async function textToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const text = await file.text()
  const LINES = 52
  const lines = text.split(/\r?\n/)
  const { host, doc, cleanup } = await stage(DOC_W)
  try {
    const pages: HTMLElement[] = []
    for (let i = 0; i < lines.length; i += LINES) {
      const page = doc.createElement('div')
      page.style.cssText = `width:${DOC_W}px;height:${DOC_H}px;padding:48px;box-sizing:border-box;background:#fff;color:#111;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;`
      page.textContent = lines.slice(i, i + LINES).join('\n')
      host.appendChild(page)
      pages.push(page)
    }
    if (pages.length === 0) throw new Error('The file is empty.')
    return await pagesToPdf(pages, { w: DOC_W, h: DOC_H }, onProgress)
  } finally {
    cleanup()
  }
}

export const CONVERTIBLE = ['.pptx', '.docx', '.txt', '.md', '.csv'] as const

/** Formats we can't do in the browser — say so plainly instead of guessing. */
const LEGACY: Record<string, string> = {
  '.ppt': 'PowerPoint 97–2003',
  '.doc': 'Word 97–2003',
  '.odp': 'OpenDocument presentation',
  '.odt': 'OpenDocument text',
  '.xls': 'Excel 97–2003',
  '.xlsx': 'Excel',
}

/**
 * Convert a document to a PDF File, ready for the pdf.js viewer.
 * Already-PDF input is returned untouched by the caller, never sent here.
 */
export async function convertToPdf(file: File, onProgress?: ConvertProgress): Promise<File> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  const legacy = LEGACY[ext]
  if (legacy) {
    throw new Error(
      `${legacy} files can't be converted in the browser. Save it as ${
        ext === '.ppt' ? '.pptx' : ext === '.doc' ? '.docx' : 'PDF'
      } and attach that.`
    )
  }

  let blob: Blob
  if (ext === '.pptx') blob = await pptxToPdf(file, onProgress)
  else if (ext === '.docx') blob = await docxToPdf(file, onProgress)
  else if (ext === '.txt' || ext === '.md' || ext === '.csv') blob = await textToPdf(file, onProgress)
  else throw new Error(`Can't convert “${ext || 'unknown'}” files to PDF.`)

  const base = file.name.slice(0, file.name.lastIndexOf('.')) || file.name
  return new File([blob], `${base}.pdf`, { type: 'application/pdf' })
}
