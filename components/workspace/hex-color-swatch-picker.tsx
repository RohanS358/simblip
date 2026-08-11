'use client'

// The "+" custom-color control shared by every swatch picker in the app
// (Selection color, text/page Background, pen colour) — a saturation/hue
// picker plus a typeable hex field, and the document's own swatch library,
// all in one popover. Replaces the OS-native <input type="color"> dialog
// (inconsistent close/blur behavior across browsers made "commit on close"
// unreliable — see git history). The target color applies live as you drag
// the saturation/hue picker or type a valid hex (onChange), so the object
// updates in real time like every other color control in the app — only
// the document swatch palette (onCommit) waits for an explicit confirm
// (check button, Enter, closing the popover, or picking a document color),
// so dragging around the picker doesn't flood it with one entry per tick.

import { useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Check, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ImagePalette } from '@/lib/color/use-image-palette'

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const FALLBACK = '#3b82f6'

export function HexColorSwatchPicker({
  label,
  initial = FALLBACK,
  onChange,
  onCommit,
  size = 'sm',
  trigger,
  documentSwatches,
  imageSwatches,
}: {
  label: string
  /** Starting color when the popover opens — the current value if there is
   *  one. Anything that isn't a real hex string (a CSS var, empty, etc.)
   *  falls back to FALLBACK rather than feeding react-colorful garbage. */
  initial?: string
  /** Fires on every change — dragging the saturation/hue picker, typing a
   *  valid hex, or picking a document color — so the target object updates
   *  live, the same as every other color control in the app. */
  onChange: (hex: string) => void
  /** Fires once, when the user confirms a color (check button, Enter,
   *  closing the popover, or picking a document color) — this is what
   *  grows the document swatch palette. Picking an existing document color
   *  does NOT re-add it to the list, only genuinely new colors do. */
  onCommit: (hex: string) => void
  size?: 'sm' | 'md'
  /** Custom trigger element (e.g. a live-color swatch showing the current
   *  fill/stroke) — defaults to the usual dashed "+" button. */
  trigger?: React.ReactNode
  /** This document's saved custom colors (page-swatches.ts) — shown as a
   *  "Document colors" row so a color picked anywhere in the doc is one
   *  click away everywhere else, not just re-typed by hex. */
  documentSwatches?: string[]
  /** Dominant colors auto-extracted from picture objects on the current
   *  page (lib/color/use-image-palette.ts) — one row per picture, each
   *  led by a tiny thumbnail of the image its swatches came from, so a
   *  photo already on the canvas can be color-matched without an
   *  eyedropper and multiple images don't blur into one mixed palette. */
  imageSwatches?: ImagePalette[]
}) {
  const safeInitial = HEX_RE.test(initial) ? initial : FALLBACK
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState(safeInitial)
  const [hexInput, setHexInput] = useState(safeInitial)
  // Only commit-on-close if something actually changed since the popover
  // opened — reopening to look, then clicking away, shouldn't grow the
  // swatch palette with a color that was already the current one.
  const dirtyRef = useRef(false)

  const setColorFromHex = (hex: string) => {
    setColor(hex)
    setHexInput(hex)
    dirtyRef.current = true
    onChange(hex)
  }

  const confirm = (hex: string) => {
    onCommit(hex)
    dirtyRef.current = false
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && open && dirtyRef.current) onCommit(color)
        setOpen(next)
        if (next) {
          setColorFromHex(safeInitial)
          dirtyRef.current = false
        }
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={label}
            className={
              size === 'sm'
                ? 'relative flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground transition-transform hover:scale-110 hover:text-foreground'
                : 'relative flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-muted-foreground transition-transform hover:scale-110 hover:text-foreground'
            }
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('hex-swatch-picker space-y-2 p-2', imageSwatches && imageSwatches.length > 0 ? 'w-[208px]' : 'w-[168px]')}
      >
        <HexColorPicker color={color} onChange={setColorFromHex} />
        <div className="flex items-center gap-1">
          <span
            aria-hidden
            className="h-6 w-6 shrink-0 rounded-md border border-border"
            style={{ background: HEX_RE.test(hexInput) ? hexInput : color }}
          />
          <input
            aria-label="Hex color"
            value={hexInput}
            onChange={(e) => {
              const v = e.target.value
              setHexInput(v)
              if (HEX_RE.test(v)) setColorFromHex(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && HEX_RE.test(hexInput)) confirm(hexInput)
            }}
            placeholder="#000"
            className="h-6 w-0 min-w-0 flex-1 rounded-md border border-border bg-transparent px-1.5 font-mono text-[0.6875rem] outline-none focus:border-[var(--ring)]"
          />
          <button
            type="button"
            aria-label="Use this color"
            disabled={!HEX_RE.test(hexInput)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-blue)] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            onClick={() => confirm(hexInput)}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
        {documentSwatches && documentSwatches.length > 0 && (
          <div className="space-y-1 border-t border-border pt-2">
            <p className="text-[0.625rem] text-muted-foreground">Document colors</p>
            <div className="flex flex-wrap gap-1">
              {documentSwatches.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={`Document color ${hex}`}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
                    color === hex ? 'border-[var(--ring)]' : 'border-transparent'
                  )}
                  style={{ background: hex }}
                  onClick={() => {
                    setColorFromHex(hex)
                    onCommit(hex)
                    dirtyRef.current = false
                    setOpen(false)
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {imageSwatches && imageSwatches.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-2">
            <p className="text-[0.625rem] text-muted-foreground">Image colors</p>
            {imageSwatches.map((img, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl}
                  alt=""
                  aria-hidden
                  className="h-5 w-5 shrink-0 rounded border border-border object-cover"
                />
                <div className="flex flex-1 flex-wrap gap-1">
                  {img.colors.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Image color ${hex}`}
                      className={cn(
                        'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
                        color === hex ? 'border-[var(--ring)]' : 'border-transparent'
                      )}
                      style={{ background: hex }}
                      onClick={() => {
                        setColorFromHex(hex)
                        onCommit(hex)
                        dirtyRef.current = false
                        setOpen(false)
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
