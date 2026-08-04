'use client'

import type { ObjectRendererProps } from './types'
import { FileObject } from './file-view'
import { RichTextArea, FILLS } from './text'
import { cn } from '@/lib/utils'

export function NoteObject(props: ObjectRendererProps) {
  // Session document elements ride the note kind (HTML surface on canvas).
  if (props.object.metadata.render === 'file') return <FileObject {...props} />
  const color = (props.object.metadata.color as string) ?? 'amber'
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-xl p-3 hairline shadow-sm',
        FILLS[color] ?? FILLS.amber
      )}
    >
      <RichTextArea
        {...props}
        placeholder="Write a note…"
        padY={24 /* p-3 top + bottom, so the box grows before clipping */}
        className="text-[13.5px]"
      />
    </div>
  )
}
