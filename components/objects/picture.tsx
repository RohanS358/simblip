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
 *  fillRectOf): each side is an inset fraction of the shape's own box,
 *  negative meaning the source image extends PAST that edge (a "fill and
 *  crop" image bigger than its frame — the common Canva case). The image's
 *  natural box in shape-fraction space is [-l, -t, 1+l+r, 1+t+b]: width
 *  1/(1-l-r) times the shape width, positioned so the shape window sits at
 *  fraction l/t from the scaled image's own top-left. Implemented as an
 *  absolutely-positioned/scaled <img> inside an overflow:hidden frame,
 *  since CSS object-position can't express independent asymmetric
 *  left/top/right/bottom insets the way object-fit:cover's single focal
 *  point can. */
function fillRectStyle(fillRect: { l: number; t: number; r: number; b: number } | undefined): React.CSSProperties {
  if (!fillRect) return { objectFit: 'fill', width: '100%', height: '100%' }
  const { l, t, r, b } = fillRect
  const scaleX = 1 / (1 - l - r)
  const scaleY = 1 / (1 - t - b)
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return { objectFit: 'fill', width: '100%', height: '100%' }
  }
  return {
    position: 'absolute',
    left: `${-l * scaleX * 100}%`,
    top: `${-t * scaleY * 100}%`,
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
        style={{ objectFit: 'fill' }}
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
        style={{ objectFit: 'fill' }}
        draggable={false}
      />
    )
  }

  return (
    <div className="relative h-full w-full select-none overflow-hidden rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={object.name} style={fillRectStyle(fillRect)} draggable={false} />
    </div>
  )
}
