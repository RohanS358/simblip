'use client'

// A group container draws NOTHING of its own.
//
// Its children are ordinary top-level objects on the page with their own
// absolute positions (see lib/scene/group.ts), so they are already rendered
// by the canvas at their own z. All the container contributes is a hit area
// covering its bounds, so clicking anywhere inside the group — including the
// gaps between its members — picks up the group rather than falling through
// to the canvas and starting a marquee.

import type { ObjectRendererProps } from './types'

export function GroupObject({ object }: ObjectRendererProps) {
  const empty = (object.geometry.children?.length ?? 0) === 0
  return (
    <div
      className="h-full w-full"
      // An empty group has no children painting over it, so it would be an
      // invisible click-trap on the canvas. Let those clicks through; the
      // container is still selectable from the Layers list.
      style={{ pointerEvents: empty ? 'none' : 'auto' }}
      aria-hidden
    />
  )
}
