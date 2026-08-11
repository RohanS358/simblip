'use client'

// Per-image dominant-color palettes for every 'picture' object on a page —
// feeds the Appearance panel's "Image colors" rows (one row per picture, a
// tiny thumbnail beside its extracted swatches) so picking a fill that
// matches a photo already on the canvas doesn't need an eyedropper.
import { useEffect, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import { getFile } from '@/lib/storage/manager'
import { extractPalette } from './extract-palette'

export interface ImagePalette {
  /** Object URL for the tiny thumbnail — kept alive for the hook's
   *  lifetime, revoked on unmount/change (see the effect cleanup below). */
  thumbUrl: string
  colors: string[]
}

const EMPTY: ImagePalette[] = []
const MAX_IMAGES = 6

export function useImagePalette(pageId: string): ImagePalette[] {
  // Joined to a single string so the effect below depends on a primitive,
  // not a fresh array reference — Object.values/.filter/.map rebuild a new
  // array every render regardless of whether the underlying objects
  // changed, which would otherwise re-run the effect (and re-fetch every
  // image) on every unrelated store update, same class of bug as the
  // React #185 selector fix elsewhere in this file's siblings.
  const pictureSrcsKey = useDocStore((s) => {
    const objects = s.pages[pageId]?.objects
    if (!objects) return ''
    return Object.values(objects)
      .filter((o) => o.geometry.kind === 'picture' && !!o.geometry.src)
      .map((o) => o.geometry.src)
      .join('\n')
  })
  const pictureSrcs = pictureSrcsKey === '' ? [] : pictureSrcsKey.split('\n')

  const [palettes, setPalettes] = useState<ImagePalette[]>(EMPTY)

  useEffect(() => {
    if (pictureSrcs.length === 0) {
      setPalettes(EMPTY)
      return
    }
    let dead = false
    const urls: string[] = []
    void (async () => {
      const results = await Promise.all(
        pictureSrcs.slice(0, MAX_IMAGES).map(async (src): Promise<ImagePalette | null> => {
          const url = src.startsWith('opfs:') ? await resolveOpfsUrl(src, urls) : src
          if (!url) return null
          try {
            const colors = await extractPalette(url, 5)
            return colors.length > 0 ? { thumbUrl: url, colors } : null
          } catch {
            return null
          }
        })
      )
      if (dead) return
      setPalettes(results.filter((r): r is ImagePalette => r !== null))
    })()
    return () => {
      dead = true
      for (const u of urls) URL.revokeObjectURL(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pictureSrcsKey])

  return palettes
}

async function resolveOpfsUrl(src: string, urls: string[]): Promise<string | null> {
  const blob = await getFile(src.slice('opfs:'.length))
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.push(url)
  return url
}
