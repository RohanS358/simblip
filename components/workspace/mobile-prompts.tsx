'use client'

// In-app replacements for window.prompt / window.confirm on the touch shell.
//
// A native prompt is OS chrome: it can't be themed, can't be animated, drops
// the app illusion the moment it appears, and on an installed PWA it renders
// inconsistently across iOS versions. It's also the one surface in the app
// that ignores the design system entirely.
//
// Both of these are driven by a single piece of state on the caller (the item
// being renamed / deleted, or null), so replacing a prompt is a one-line swap
// at the call site rather than a bespoke dialog per action.

import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { haptic } from '@/lib/haptics'

/** What's being renamed: its current name, and where to send the new one. */
export interface RenameTarget {
  /** Shown in the title — "Rename page", "Rename notebook". */
  kind: string
  name: string
  onRename: (next: string) => void
}

export function RenameDialog({
  target,
  onClose,
}: {
  target: RenameTarget | null
  onClose: () => void
}) {
  const [value, setValue] = useState('')

  // Re-seed whenever a new target opens, not on every render — otherwise
  // typing would be overwritten by the original name on each keystroke.
  useEffect(() => {
    if (target) setValue(target.name)
  }, [target])

  const submit = () => {
    const next = value.trim()
    // An unchanged or emptied name is a no-op, not an error worth a message.
    if (next && next !== target?.name) {
      target?.onRename(next)
      haptic('tick')
    }
    onClose()
  }

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-ui-xl">Rename {target?.kind}</AlertDialogTitle>
        </AlertDialogHeader>
        <Input
          autoFocus
          value={value}
          aria-label={`New name for this ${target?.kind}`}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          // Select-all on focus so the common case (replace the whole name) is
          // one gesture, matching what window.prompt did.
          onFocus={(e) => e.currentTarget.select()}
        />
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
          <AlertDialogAction className="rounded-xl" onClick={submit}>
            Rename
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** What's being deleted, and what to call it in the warning. */
export interface ConfirmTarget {
  /** "page", "folder", "notebook" — used in the title and the body. */
  kind: string
  name: string
  /** Extra consequence worth stating, e.g. "Its pages go too." */
  detail?: string
  onConfirm: () => void
}

export function ConfirmDeleteDialog({
  target,
  onClose,
}: {
  target: ConfirmTarget | null
  onClose: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[min(24rem,calc(100vw-2rem))] rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-ui-xl">
            Delete {target?.kind}?
          </AlertDialogTitle>
          {/* Names the thing and the consequence. The old confirm() said only
              'Delete page "X"?' and left "can this be undone?" unanswered. */}
          <AlertDialogDescription className="text-ui-md leading-relaxed">
            <span className="font-semibold text-foreground">{target?.name}</span> will be
            deleted. {target?.detail ? `${target.detail} ` : ''}This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="rounded-xl bg-destructive text-white hover:bg-destructive/90"
            onClick={() => {
              target?.onConfirm()
              haptic('bump')
              onClose()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
