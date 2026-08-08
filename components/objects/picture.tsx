'use client'

// Static raster image placed as a canvas object — drag/resize/select like
// any other SceneObject. Distinct from the whole-page 'image' PageKind
// (image-view.tsx, for viewing/annotating an uploaded image as its own
// tab): this is one picture among other objects on a board/doc/pptx page,
// the canvas equivalent of a <p:pic> on a PowerPoint slide.

import { useEffect, useState } from 'react'
import { getFile } from '@/lib/storage/manager'
import type { ObjectRendererProps } from './types'

export function PictureObject({ object }: ObjectRendererProps) {
  const src = object.geometry.src
  const [url, setUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState<boolean>(Boolean(object.metadata?.isVideo))

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
