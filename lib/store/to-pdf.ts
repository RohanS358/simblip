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

const PPT_W = 960 // 16:9 slide, CSS px
const PPT_H = 540
const DOC_W = 794 // A4 @ 96dpi
const DOC_H = 1123

export type ConvertProgress = (done: number, total: number) => void

/** An off-screen host the renderers can lay out into. Must be attached to
 *  the document (not display:none) or html2canvas measures everything as 0. */
function stage(width: number): HTMLDivElement {
  const el = document.createElement('div')
  el.dataset.pdfStage = ''
  el.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${width}px;background:#fff;color:#111;` +
    `z-index:-1;color-scheme:light;`
  ensureStageReset()
  document.body.appendChild(el)
  return el
}

/** Inline styles can't reach ::before/::after, and Tailwind's preflight paints
 *  those too — so neutralize them for the stage subtree with a rule in <head>
 *  (the renderers wipe the stage's own children, so it can't live inside it).
 *  The renderers never use pseudo-elements for content, so nothing is lost. */
function ensureStageReset() {
  const ID = 'simblip-pdf-stage-reset'
  if (document.getElementById(ID)) return
  const reset = document.createElement('style')
  reset.id = ID
  reset.textContent =
    '[data-pdf-stage] *::before, [data-pdf-stage] *::after {' +
    'border-color: transparent !important;' +
    'background-image: none !important;' +
    'box-shadow: none !important;' +
    'color: #111 !important;' +
    'outline-color: transparent !important;' +
    '}'
  document.head.appendChild(reset)
}

// html2canvas 1.4 predates the modern CSS color functions — it throws
// "unsupported color function" the moment it meets lab()/lch()/oklch() or
// color-mix(). Our design tokens are oklch and Tailwind's preflight paints
// borders/colors onto EVERY element, so the app's own styles leak into the
// off-screen stage and poison it. Rewrite only the offending values to safe
// equivalents (colors from the document itself are plain rgb and untouched).
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
  fill: '#111111',
  stroke: 'none',
}

function sanitizeColors(root: HTMLElement) {
  const els: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  for (const el of els) {
    const cs = getComputedStyle(el)
    for (const prop of Object.keys(SAFE_FALLBACK)) {
      const value = cs.getPropertyValue(prop)
      if (value && UNSUPPORTED_COLOR.test(value)) {
        el.style.setProperty(prop, SAFE_FALLBACK[prop], 'important')
      }
    }
  }
}

async function pagesToPdf(
  pages: HTMLElement[],
  size: { w: number; h: number },
  onProgress?: ConvertProgress
): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
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
    sanitizeColors(pages[i])
    const canvas = await html2canvas(pages[i], {
      scale: 2, // 2× so the PDF stays sharp when the whiteboard zooms in
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      // html2canvas re-applies the page's stylesheets inside its own clone,
      // which resurrects the oklch values — sanitize the clone as well.
      onclone: (_doc, element) => sanitizeColors(element as HTMLElement),
    })
    if (i > 0) pdf.addPage([size.w, size.h], landscape ? 'landscape' : 'portrait')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, size.w, size.h)
    onProgress?.(i + 1, pages.length)
  }
  return pdf.output('blob')
}

async function pptxToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const { init } = await import('pptx-preview')
  const host = stage(PPT_W)
  try {
    // 'list' mode lays every slide out at once (the default paginates to a
    // single visible slide, which would give us a one-page PDF).
    const previewer = init(host, { width: PPT_W, height: PPT_H, mode: 'list' })
    await previewer.preview(await file.arrayBuffer())
    const slides = Array.from(host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper'))
    if (slides.length === 0) throw new Error('No slides found in this presentation.')
    return await pagesToPdf(slides, { w: PPT_W, h: PPT_H }, onProgress)
  } finally {
    host.remove()
  }
}

async function docxToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const docx = await import('docx-preview')
  const host = stage(DOC_W)
  try {
    await docx.renderAsync(await file.arrayBuffer(), host, undefined, {
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
    host.remove()
  }
}

/** Plain text / CSV / markdown: lay it out as monospaced A4 pages. */
async function textToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const text = await file.text()
  const LINES = 52
  const lines = text.split(/\r?\n/)
  const host = stage(DOC_W)
  try {
    const pages: HTMLElement[] = []
    for (let i = 0; i < lines.length; i += LINES) {
      const page = document.createElement('div')
      page.style.cssText = `width:${DOC_W}px;height:${DOC_H}px;padding:48px;box-sizing:border-box;background:#fff;color:#111;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;`
      page.textContent = lines.slice(i, i + LINES).join('\n')
      host.appendChild(page)
      pages.push(page)
    }
    if (pages.length === 0) throw new Error('The file is empty.')
    return await pagesToPdf(pages, { w: DOC_W, h: DOC_H }, onProgress)
  } finally {
    host.remove()
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
