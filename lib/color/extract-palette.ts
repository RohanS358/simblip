// Dominant-color extraction from an image, for the "image colors" swatch
// row in HexColorSwatchPicker. Downsamples onto an offscreen canvas (cheap
// even for a large photo) then buckets pixels into a coarse RGB grid —
// good enough for "colors that look like they came from this picture", not
// a real k-means/median-cut palette extractor.
const SAMPLE_SIZE = 64
const BUCKET = 24 // quantization step per channel — coarser = fewer, punchier swatches

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

/** Loads an image URL and returns its N most common colors, largest first. */
export async function extractPalette(url: string, count = 5): Promise<string[]> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('image failed to load'))
  })
  img.src = url
  await loaded

  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } catch {
    return [] // tainted canvas (cross-origin image without CORS) — no readable pixels
  }

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue // skip transparent pixels
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // Near-white/near-black pixels are usually page background or shadow,
    // not a color anyone picking from "this image" actually wants.
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max > 245 && min > 245) continue
    if (max < 12) continue
    const key = `${Math.round(r / BUCKET)},${Math.round(g / BUCKET)},${Math.round(b / BUCKET)}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.n++
    } else {
      buckets.set(key, { r, g, b, n: 1 })
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(({ r, g, b, n }) => `#${toHex(Math.round(r / n))}${toHex(Math.round(g / n))}${toHex(Math.round(b / n))}`)
}
