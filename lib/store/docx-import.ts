'use client'

// .docx → a doc page's flowing body.
//
// A Word file IS a structured stream of content laid out onto pages, and so
// is a doc page now, so import is a straight structural mapping rather than a
// transcription: paragraph → paragraph, run → marked text, list → list, table
// → table, and OUR layout engine decides where the pages fall.
//
// This file is only the container half — unzip, pull the parts out, put the
// images somewhere real. The mapping itself is lib/store/docx-map.ts, which
// is pure and runs outside a browser so it can be tested (docx-map.test.mjs).
//
// It replaces an importer that read <w:t> and dropped the paragraphs onto
// sheets twenty at a time as absolutely-positioned text boxes, losing every
// heading, list, table, image and page break in the file.

import JSZip from 'jszip'
import { putFile } from '@/lib/storage/manager'
import { serializeDoc } from '@/lib/text/pm'
import { mapDocxDocument, type DocxImage, type DocxSection } from './docx-map'

export interface DocxImportResult {
  /** The body, serialized — ready for PageDoc.flow. */
  flow: string
  /** Page size and margins from <w:sectPr>, for the PageNode. */
  section: DocxSection
}

interface Rel {
  target: string
  type: string
  external: boolean
}

/** relId → relationship, from a .rels part. A flat regex rather than a DOM
 *  walk: the file is a single-level list of <Relationship Id Type Target>. */
function rels(xml: string | null): Map<string, Rel> {
  const out = new Map<string, Rel>()
  if (!xml) return out
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (!id || !target) continue
    out.set(id, {
      target: target.replace(/&amp;/g, '&'),
      type: m[0].match(/\bType="([^"]+)"/)?.[1] ?? '',
      external: /\bTargetMode="External"/.test(m[0]),
    })
  }
  return out
}

/** Resolve a relationship target against the folder of the part that owns it. */
function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'))
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

/**
 * Reads a .docx into a flowing body. Images are copied into storage first
 * (async), then the mapping runs synchronously against that lookup — which is
 * why the two happen in this order rather than resolving images lazily inside
 * the mapper.
 */
export async function importDocx(blob: Blob, ownerId: string): Promise<DocxImportResult> {
  const zip = await JSZip.loadAsync(blob)
  const text = async (path: string) => (await zip.file(path)?.async('text')) ?? null

  // The main part is whatever _rels/.rels says it is — usually
  // word/document.xml, but not for every writer (document2.xml, …).
  const pkg = rels(await text('_rels/.rels'))
  const main =
    [...pkg.values()].find((r) => r.type.endsWith('/officeDocument'))?.target.replace(/^\//, '') ?? 'word/document.xml'
  const documentXml = await text(main)
  if (!documentXml) throw new Error('Not a valid .docx file.')
  const dir = main.includes('/') ? main.slice(0, main.lastIndexOf('/')) : ''
  const docRels = rels(await text(`${dir ? dir + '/' : ''}_rels/${main.split('/').pop()}.rels`))
  const partOf = (typeSuffix: string, fallback: string) => {
    const r = [...docRels.values()].find((x) => x.type.endsWith(typeSuffix))
    return r ? resolvePart(dir, r.target) : fallback
  }
  const numbering = await text(partOf('/numbering', `${dir}/numbering.xml`))
  const styles = await text(partOf('/styles', `${dir}/styles.xml`))

  // Every referenced image, into OPFS, before the (synchronous) mapping runs.
  const images = new Map<string, DocxImage>()
  await Promise.all(
    [...docRels].map(async ([relId, rel]) => {
      if (rel.external || !rel.type.endsWith('/image')) return
      const path = resolvePart(dir, rel.target)
      const entry = zip.file(path)
      if (!entry) return
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const mime = MIME[ext]
      if (!mime) return // EMF/WMF/TIFF: nothing a browser can draw
      try {
        const bytes = await entry.async('blob')
        const fileId = await putFile(bytes, path.split('/').pop() ?? 'image', mime, ownerId)
        images.set(relId, { src: `opfs:${fileId}` })
      } catch {
        // A single unreadable image must not fail the whole import.
      }
    })
  )

  const parser = new DOMParser()
  const { doc, section } = mapDocxDocument(
    { document: documentXml, numbering: numbering ?? undefined, styles: styles ?? undefined },
    {
      parse: (xml) => parser.parseFromString(xml, 'application/xml'),
      image: (relId) => images.get(relId) ?? null,
      link: (relId) => {
        const r = docRels.get(relId)
        return r?.external ? r.target : null
      },
    }
  )
  return { flow: serializeDoc(doc), section }
}
