'use client'

// The little preview at the left of every Layers row.
//
// Pictures show the ACTUAL image — recognising a photo by its thumbnail is
// the entire reason a layers list uses pictures instead of names, and a grey
// box labelled "picture" would defeat it. Everything else reuses the same
// SVG glyph vocabulary as the notebook page cards (ShapeForObj), so the two
// previews can't drift apart.

import { useEffect, useState } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { getFile } from '@/lib/storage/manager'
import { childrenOf, unionBox } from '@/lib/scene/group'
import { ShapeForObj } from './page-thumbnail'

const BOX = 40 // px; the row's preview is a fixed square

/** Resolve an `opfs:<fileId>` src to a blob URL, revoking it on unmount.
 *  Returns null while loading, or for an object with no image at all. */
function useImageUrl(src: string | undefined): string | null {
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
    let dead = false
    let created: string | null = null
    void (async () => {
      const blob = await getFile(src.slice('opfs:'.length))
      if (!blob || dead) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })()
    return () => {
      dead = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [src])
  return url
}

export function LayerThumb({
  obj,
  objects,
}: {
  obj: SceneObject
  /** The page, needed only to draw a group's members inside its preview. */
  objects: Record<string, SceneObject>
}) {
  const isPicture = obj.geometry.kind === 'picture'
  const url = useImageUrl(isPicture ? obj.geometry.src : undefined)

  const frame = 'flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background/70'

  if (isPicture) {
    return (
      <div className={frame}>
        {url ? (
          // A video's poster frame is not available without decoding it, so
          // videos fall through to the empty tile rather than showing a
          // misleading still from an unrelated frame.
          obj.metadata?.isVideo ? (
            <div className="h-full w-full bg-muted" />
          ) : (
            <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
          )
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
      </div>
    )
  }

  // A group previews its CONTENTS, so a collapsed group still says what is
  // inside it. Anything else previews just itself.
  const members = obj.geometry.kind === 'group' ? childrenOf(obj, objects) : [obj]
  const box = unionBox(members)
  if (!box) return <div className={frame} />

  // Fit the union box into the square, preserving aspect ratio: a wide
  // banner should read as a wide banner, not be stretched to a square.
  const scale = Math.min(BOX / box.w, BOX / box.h)
  const w = box.w * scale
  const h = box.h * scale

  return (
    <div className={frame}>
      <svg
        width={w}
        height={h}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className="overflow-visible"
        aria-hidden
      >
        {members.map((m) => (
          <g
            key={m.id}
            transform={`translate(${m.position.x},${m.position.y}) rotate(${m.rotation || 0},${m.size.w / 2},${m.size.h / 2})`}
          >
            <ShapeForObj obj={m} />
          </g>
        ))}
      </svg>
    </div>
  )
}
