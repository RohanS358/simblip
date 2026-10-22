// Decode a picture object's image into RGBA pixels for the photo reader (browser only).

import { getFile } from '@/lib/storage/manager'

/** Longest side decoded; the reader works at 900 anyway, so more is wasted memory. */
const DECODE_MAX = 1800

export interface Decoded {
  data: Uint8ClampedArray
  width: number
  height: number
}

export async function decodePicture(src: string): Promise<Decoded | null> {
  let blob: Blob | null = null
  if (src.startsWith('opfs:')) blob = await getFile(src.slice('opfs:'.length))
  else {
    try {
      blob = await (await fetch(src)).blob()
    } catch {
      blob = null
    }
  }
  if (!blob) return null
  // the stored type can be empty; let the decoder decide whether it is a picture
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(blob)
  } catch {
    return null
  }
  const k = Math.min(1, DECODE_MAX / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k))
  const h = Math.max(1, Math.round(bmp.height * k))
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null
  ctx.fillStyle = '#fff' // transparent pixels are paper
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h)
  bmp.close?.()
  return { data: px.data, width: w, height: h }
}
