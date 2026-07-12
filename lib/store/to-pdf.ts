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
  el.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;background:#fff;z-index:-1;`
  document.body.appendChild(el)
  return el
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
    const canvas = await html2canvas(pages[i], {
      scale: 2, // 2× so the PDF stays sharp when the whiteboard zooms in
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
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
