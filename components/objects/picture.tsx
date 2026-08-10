'use client'

// Static raster image placed as a canvas object — drag/resize/select like
// any other SceneObject. Distinct from the whole-page 'image' PageKind
// (image-view.tsx, for viewing/annotating an uploaded image as its own
// tab): this is one picture among other objects on a board/doc/pptx page,
// the canvas equivalent of a <p:pic> on a PowerPoint slide.

import { useEffect, useState } from 'react'
import { getFile } from '@/lib/storage/manager'
import type { ObjectRendererProps } from './types'

/** pptx import's <a:fillRect l t r b> (lib/store/pptx-import.ts's
 *  fillRectOf): each side is a signed fraction of the shape's own box —
 *  POSITIVE means an inset (the fill rectangle is smaller/padded within the
 *  box), NEGATIVE means an outset (the fill rectangle is BIGGER than the
 *  box, so the image is zoomed in and clipped — the common Canva "fill and
 *  crop" case). Per ECMA-376 §20.1.8.55 and confirmed against LibreOffice's
 *  own oox filter (fillproperties.cxx): scaleX = 1-(l+r), scaleY = 1-(t+b)
 *  — a subtraction, NOT `1/(1-l-r)`. That reciprocal was this function's
 *  original (wrong) formula: for a real deck's t=b=-0.389 (a symmetric
 *  vertical zoom-in), the reciprocal computed scaleY=0.56 — a SHRUNK fill
 *  rectangle — when the correct answer is scaleY=1.78, a GROWN one. The
 *  reciprocal version still "looked like a crop" in casual testing (it also
 *  produces *some* non-1:1 box), which is exactly why it shipped once
 *  already and the images still looked stretched/wrong after that fix.
 *  Offset: the fill rectangle's own top-left sits at (l, t) fractions of
 *  the BOX (not derived from scale/2 — an earlier version of this fix
 *  wrongly assumed a centered anchor and collapsed every asymmetric l/t/r/b
 *  combination to the same centered result, losing exactly the "crop more
 *  off one edge than the other" asymmetry the deck actually specified).
 *
 *  Deliberately sizes the WRAPPER to that box, not the <img> itself, and
 *  leaves the <img> at object-fit:cover inside it — an <img> with an
 *  explicit width/height percentage but no object-fit stretches its pixel
 *  content to exactly fill that box regardless of the image's own aspect
 *  ratio (the browser's default object-fit:fill), which is what produced
 *  the "images stretch/distort" bug in the first place: scaleX/scaleY come
 *  from the fillRect's box math, not the image's real pixel dimensions, so
 *  they essentially never equal the image's true aspect ratio. object-fit:
 *  cover on the <img> hands aspect-correct scaling back to the browser
 *  (which actually knows the image's intrinsic size), while the wrapper's
 *  own size/position implements the fillRect crop window. */
function fillRectWrapperStyle(fillRect: { l: number; t: number; r: number; b: number } | undefined): React.CSSProperties {
  if (!fillRect) return { position: 'absolute', inset: 0 }
  const { l, t, r, b } = fillRect
  const scaleX = 1 - (l + r)
  const scaleY = 1 - (t + b)
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return { position: 'absolute', inset: 0 }
  }
  return {
    position: 'absolute',
    left: `${l * 100}%`,
    top: `${t * 100}%`,
    width: `${scaleX * 100}%`,
    height: `${scaleY * 100}%`,
  }
}

export function PictureObject({ object }: ObjectRendererProps) {
  const src = object.geometry.src
  const [url, setUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState<boolean>(Boolean(object.metadata?.isVideo))
  const fillRect = object.metadata?.fillRect as { l: number; t: number; r: number; b: number } | undefined

  useEffect(() => {
    if (!src) {
      setUrl(null)
      return
    }
    const isVidExt = /\.(mp4|webm|mov|m4v|avi)($|\?)/i.test(src)
    if (isVidExt) setIsVideo(true)

    if (!src.startsWith('opfs:')) {
      setUrl(src)
      return
    }
    const fileId = src.slice('opfs:'.length)
    let dead = false
    let createdUrl: string | null = null
    void (async () => {
      const blob = await getFile(fileId)
      if (!blob || dead) return
      if (blob.type.startsWith('video/')) setIsVideo(true)
      createdUrl = URL.createObjectURL(blob)
      setUrl(createdUrl)
    })()
    return () => {
      dead = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [src, object.metadata?.isVideo])

  if (!url) {
    return <div className="h-full w-full rounded-md bg-muted/40" />
  }

  if (isVideo) {
    return (
      <video
        src={url}
        controls
        autoPlay
        loop
        muted
        playsInline
        className="h-full w-full select-none rounded-md"
        style={{ objectFit: 'cover' }}
      />
    )
  }

  if (!fillRect) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={object.name}
        className="h-full w-full select-none rounded-md"
        style={{ objectFit: 'cover' }}
        draggable={false}
      />
    )
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden rounded-md">
      <div style={fillRectWrapperStyle(fillRect)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={object.name}
          className="h-full w-full"
          style={{ objectFit: 'cover' }}
          draggable={false}
        />
      </div>
    </div>
  )
}
