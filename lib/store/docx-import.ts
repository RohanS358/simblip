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

/** relId → target path, from word/_rels/document.xml.rels. */
function relTargets(xml: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!xml) return out
  // A flat regex rather than a DOM walk: the file is a single-level list of
  // <Relationship Id Target> and this avoids a second namespace-aware parse.
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1]
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1]
    if (id && target) out.set(id, target.replace(/^\.\.\//, '').replace(/^\/?word\//, ''))
  }
  return out
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
  const documentXml = await zip.files['word/document.xml']?.async('text')
  if (!documentXml) throw new Error('Not a valid .docx file.')
  const numbering = await zip.files['word/numbering.xml']?.async('text')
  const rels = relTargets((await zip.files['word/_rels/document.xml.rels']?.async('text')) ?? null)

  // Every referenced image, into OPFS, before the (synchronous) mapping runs.
  const images = new Map<string, DocxImage>()
  await Promise.all(
    [...rels].map(async ([relId, target]) => {
      const entry = zip.files[`word/${target}`]
      if (!entry) return
      const ext = target.split('.').pop()?.toLowerCase() ?? ''
      const mime = MIME[ext]
      if (!mime) return
      try {
        const bytes = await entry.async('blob')
        const fileId = await putFile(bytes, target.split('/').pop() ?? 'image', mime, ownerId)
        images.set(relId, { src: `opfs:${fileId}` })
      } catch {
        // A single unreadable image must not fail the whole import.
      }
    })
  )

  const parser = new DOMParser()
  const { doc, section } = mapDocxDocument(
    { document: documentXml, numbering },
    {
      parse: (xml) => parser.parseFromString(xml, 'application/xml'),
      image: (relId) => {
        const img = images.get(relId)
        return img ?? null
      },
    }
  )
  return { flow: serializeDoc(doc), section }
}
