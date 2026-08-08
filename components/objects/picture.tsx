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

  useEffect(() => {
    if (!src) {
      setUrl(null)
      return
    }
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
      createdUrl = URL.createObjectURL(blob)
      setUrl(createdUrl)
    })()
    return () => {
      dead = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [src])

  if (!url) {
    return <div className="h-full w-full rounded-md bg-muted/40" />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={object.name}
      className="h-full w-full select-none rounded-md object-fill"
      draggable={false}
    />
  )
}
