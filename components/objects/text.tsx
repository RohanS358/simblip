'use client'

// Live text block with real formatting — WYSIWYG always: bold/italic/
// underline/color/size are marks on a ProseMirror document, never markdown
// delimiter characters typed into the text itself. There is no "active line
// shows raw source" mode, because there is nothing to hide — the DOM never
// contains a literal `**`/`++`/`[x]{k=v}` to begin with.
//
// The editing surface is Tiptap (components/objects/text-editor.tsx) and the
// read-only surface is generateHTML() over the SAME extension list
// (lib/text/pm-render.ts), so the two cannot look different from each other.
// The old engine's ~900-line useLiveTextEditor — which reconstructed each
// edit by diffing the previous string against the contentEditable's new
// textContent, and hand-shifted every mark offset afterwards — is gone; see
// docs/tiptap-text-engine-plan.md.
//
// The box width is the writing width — text wraps there — and the box
// grows vertically to fit the content (grow-only; the user's height acts
// as a minimum).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/react'
import { useDocStore } from '@/lib/store/document'
import { useActiveTextEditor } from '@/lib/store/text-editor'
import { getString, type ObjectRendererProps } from './types'
import { TiptapArea } from './text-editor'
import { parseDoc } from '@/lib/text/pm'
import { renderPmDoc, isPmDocEmpty } from '@/lib/text/pm-render'
import { useKatexReady } from '@/lib/text/use-katex-ready'
import { cn } from '@/lib/utils'
import { TEXT_COLORS, TEXT_SIZES } from '@/lib/text/marks'

export const FILLS: Record<string, string> = {
  amber: 'bg-[color-mix(in_oklch,var(--accent-amber)_18%,var(--card))]',
  mint: 'bg-[color-mix(in_oklch,var(--accent-mint)_18%,var(--card))]',
  blue: 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,var(--card))]',
  violet: 'bg-[color-mix(in_oklch,var(--accent-violet)_14%,var(--card))]',
  rose: 'bg-[color-mix(in_oklch,var(--accent-rose)_14%,var(--card))]',
}

// Legacy whole-box fallback — no control in the current UI writes fmtSize/
// fmtColor anymore (color/size are selection-scoped now, see the marks
// model), but old saved docs may still carry them.
export function textFormatStyle(object: ObjectRendererProps['object']): CSSProperties {
  const size = getString(object, 'fmtSize')
  const color = getString(object, 'fmtColor')
  return {
    fontSize: size ? (TEXT_SIZES[size] ?? TEXT_SIZES.m) : undefined,
    color: color ? (TEXT_COLORS[color] ?? TEXT_COLORS.default) : undefined,
  }
}

// Whole-textbox alignment — the one box-level formatting knob left (see
// TextOptions in inspector.tsx). Everything else (bold, color, size…) is
// selection-scoped now, set via the panel or Ctrl+B/Ctrl+I and stored as
// document marks, so there's no floating dock anymore.
const ALIGNS = ['left', 'center', 'right', 'justify'] as const
type Align = (typeof ALIGNS)[number]

/** Shared text surface: a Tiptap editor while editing, generated HTML
 * otherwise — both driven by the same ProseMirror document and the same
 * extension list, so "editing" and "just clicked away" cannot look
 * different. Wraps at box width, grows the box vertically to fit. */
export function RichTextArea({
  pageId,
  object,
  selected,
  placeholder,
  padY = 0,
  className,
  autoEdit = false,
  deleteWhenEmpty = false,
  hug = false,
  fillHeight = true,
}: ObjectRendererProps & {
  placeholder: string
  padY?: number
  className?: string
  /** Spawn straight into typing — no click needed. */
  autoEdit?: boolean
  /** A box that never received any text removes itself when you leave it. */
  deleteWhenEmpty?: boolean
  /** Properties → Layout → Resizing: "Hug contents" — box width shrinks to
   *  the widest line instead of wrapping at a fixed width (canvas.tsx renders
   *  the outer box at `width: fit-content` to match). */
  hug?: boolean
  /** Note (the only other caller) always fills its card top-to-bottom, no
   *  vertical-alignment concept. TextObject needs this OFF whenever
   *  vertical align isn't 'top': a 100%-height flex child leaves the
   *  parent's justify-content nothing to distribute, so middle/bottom
   *  alignment silently did nothing. */
  fillHeight?: boolean
}) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const updateObject = useDocStore((s) => s.updateObject)
  const removeObjects = useDocStore((s) => s.removeObjects)
  const setSelection = useDocStore((s) => s.setSelection)
  const viewRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  // Guards the empty-box cleanup: only a box the caret actually reached can
  // be discarded, so a not-yet-selected fresh box never deletes itself.
  const everFocusedRef = useRef(false)
  // Set further down, where the debounce lives — the leave-edit-mode effect
  // needs to commit pending text but runs above its definition.
  const flushRef = useRef<(() => void) | null>(null)
  // Single click selects/drags the box like any object; only a double click
  // (or a click on an already-selected box) enters edit mode.
  const [editing, setEditing] = useState(false)
  const value = getString(object, 'text')
  const doc = parseDoc(value)

  // Spawned boxes go straight into typing — no click, no double-click.
  useEffect(() => {
    if (autoEdit) setEditing(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selected && editing) {
      setEditing(false)
      // Persistence is debounced (see queueChange below), so `doc` — parsed
      // from the STORE — can be up to one debounce window behind what was
      // actually typed. Leaving edit mode is exactly the moment that gap
      // matters, so commit the pending text first, then judge emptiness from
      // the editor's own document rather than the store's stale copy.
      flushRef.current?.()
      const live = editorRef.current
      const empty = live ? live.isEmpty : isPmDocEmpty(doc)
      // An empty box was never really wanted — clean it up instead of
      // leaving an invisible object on the canvas.
      if (deleteWhenEmpty && everFocusedRef.current && empty) removeObjects(pageId, [object.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editing, deleteWhenEmpty, value, pageId, object.id, removeObjects])

  // Grow-only autosize: the width is the writing width; overflowing lines
  // wrap, and the box gets taller so nothing is ever clipped vertically.
  //
  // Grow by the actual OVERFLOW, never by scrollHeight. The measured element
  // is h-full, so scrollHeight is always >= the box height — measuring
  // `scrollHeight + padY` therefore always exceeded the current height, grew
  // the box, re-rendered, and exceeded it again: an unbounded loop that React
  // kills with "Maximum update depth exceeded" (error #185). Overflow, by
  // contrast, goes to zero once the content fits, so this converges.
  //
  // Driven by a ResizeObserver on whichever surface is live (see TiptapArea's
  // onLayoutChange and the read-only observer below) rather than by a
  // JSON.stringify'd render signature. The old signature could not see a
  // font finishing loading, KaTeX's chunk landing and growing an expression,
  // or the parent column changing width — all of which change the height
  // needed without changing the document at all.
  const fit = useCallback(() => {
    const el = editing ? (editorRef.current?.view.dom as HTMLElement | undefined) : viewRef.current
    if (!el) return
    const overflow = el.scrollHeight - el.clientHeight
    if (overflow > 1) {
      updateObject(pageId, object.id, {
        size: { w: object.size.w, h: Math.ceil(object.size.h + overflow + padY) },
      })
    }
  }, [editing, pageId, object.id, object.size.w, object.size.h, padY, updateObject])

  // The read-only surface needs its own observer; the editing one comes from
  // TiptapArea's onLayoutChange.
  useEffect(() => {
    const el = viewRef.current
    if (editing || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [editing, fit])

  // Typing is not a document mutation per keystroke. Tiptap already holds the
  // authoritative document while the caret is in it, so the only thing the
  // store gains from a per-transaction write is work: setStringParam replaces
  // pages[id], which trips the doc store's dirty-set subscriber and schedules
  // a page save — on every character. The editor stays the source of truth
  // between beats; the store catches up 250ms after you stop.
  //
  // MUST flush on the way out (blur, unmount, leaving edit mode) or the last
  // keystrokes of a burst are simply lost.
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const next = pendingRef.current
    pendingRef.current = null
    if (next !== null) setStringParam(pageId, object.id, 'text', next)
  }, [pageId, object.id, setStringParam])

  const queueChange = useCallback(
    (next: string) => {
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, 250)
    },
    [flush]
  )

  // Unmount is the last chance: a box removed mid-burst (page switch, sheet
  // unmounting as it scrolls out of view) must not take the pending text with
  // it. flush() is stable across renders, so this is not a per-keystroke
  // re-subscribe.
  useEffect(() => flush, [flush])

  // The leave-edit-mode effect above runs before flush is defined, so it
  // reaches it through this ref rather than through the closure.
  flushRef.current = flush

  // Makes this box's editor reachable from the Properties panel (see
  // lib/store/text-editor.ts) while it's the one being edited — the panel
  // lives in an entirely different part of the DOM, so this is the only way
  // its buttons can reach the live selection.
  const handleEditor = useCallback(
    (ed: Editor | null) => {
      editorRef.current = ed
      if (ed) useActiveTextEditor.getState().set(object.id, ed)
      else useActiveTextEditor.getState().clear(object.id)
    },
    [object.id]
  )

  // KaTeX loads on demand (lib/text/katex-lazy.ts), so any `$…$` in this box
  // renders as its literal source until the chunk lands. This re-renders the
  // read-only view once it does.
  useKatexReady()

  const rendered = editing ? '' : renderPmDoc(doc)
  const empty = isPmDocEmpty(doc)
  // Properties → Text → Line spacing (box-level, like Alignment). 1.625
  // matches Tailwind's leading-relaxed, the old fixed value, so unset boxes
  // look unchanged.
  const lineHeight = (object.metadata.lineHeight as number | undefined) ?? 1.625
  // Properties → Typography → Letter spacing, box-level like line height —
  // a percentage of font-size, same convention Figma's field uses.
  const letterSpacingPct = (object.metadata.letterSpacing as number | undefined) ?? 0
  const letterSpacing = letterSpacingPct ? `${letterSpacingPct / 100}em` : undefined
  const widthClass = hug ? 'w-max' : 'w-full break-words'

  return (
    <div
      className={cn(fillHeight ? 'h-full' : 'shrink-0', 'overflow-hidden', hug ? 'w-max' : 'w-full')}
      style={textFormatStyle(object)}
    >
      {editing ? (
        <TiptapArea
          value={value}
          onChange={queueChange}
          editable
          placeholder={placeholder}
          autoFocus
          onEditor={handleEditor}
          onFocus={() => {
            everFocusedRef.current = true
            setSelection([object.id])
          }}
          onBlur={flush}
          onLayoutChange={fit}
          className={cn('h-full outline-none select-text cursor-text', widthClass, className)}
          style={{ touchAction: 'auto', lineHeight, letterSpacing }}
        />
      ) : (
        <div
          ref={viewRef}
          role="textbox"
          aria-label={placeholder || 'Text'}
          className={cn(
            'markdown-view h-full cursor-inherit',
            widthClass,
            empty && 'text-muted-foreground/50',
            className
          )}
          style={{ lineHeight, letterSpacing }}
          onClick={(e) => {
            // A click on an ALREADY-selected box starts editing directly —
            // select, then click again, same total clicks as a double-click
            // but not timing-dependent (a double-click that lands a beat too
            // slow just reselects instead of entering edit mode, which is
            // what made this feel like it took "a lot of clicks"). The
            // object's first click (not yet selected) still only selects, via
            // the canvas wrapper's own pointerdown — this handler no-ops
            // until selected is already true.
            if (!selected) return
            e.stopPropagation()
            setEditing(true)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
            setSelection([object.id])
          }}
          // Generated by generateHTML() over our own extension schema
          // (lib/text/pm-render.ts) — never raw user HTML.
          dangerouslySetInnerHTML={{ __html: empty ? '' : rendered }}
        />
      )}
    </div>
  )
}


const VERTICAL_ALIGN_CLASS: Record<string, string> = {
  top: 'justify-start',
  middle: 'justify-center',
  bottom: 'justify-end',
}

export function TextObject(props: ObjectRendererProps) {
  // A brand-new text box (no text yet) opens focused and ready to type, and
  // deletes itself if you click away without writing anything.
  const empty = getString(props.object, 'text').trim() === ''
  const fresh = useRef(empty).current
  const { metadata } = props.object
  // Background tint is opt-in (Properties → Text → Appearance in the
  // generic panel) — a plain box stays fully transparent unless chosen. Not
  // exposed in the Figma-style panel below: bare text has no parent frame to
  // paint one on in real Figma either, so there's nothing there to mirror.
  const bg = metadata.color as string | undefined
  // A named palette id (FILLS key) applies as a Tailwind class; a custom
  // hex color (from the Background "+" swatch) has no class and applies
  // via inline style instead — both count as "has a fill" for the padding/
  // corner-radius/shadow treatment below.
  const bgIsHex = Boolean(bg && bg.startsWith('#'))
  const hasFill = Boolean(bg && (FILLS[bg] || bgIsHex))
  // Corner radius defaults to the fill box's old fixed rounded-xl (12px) so
  // existing documents with a background don't jump to square the moment
  // this became a user-editable value.
  const cornerRadius = (metadata.cornerRadius as number | undefined) ?? 12
  // Properties → Fill: the text's own glyph color, same as real Figma (a
  // text layer's "Fill" IS its font color, not a background) — independent
  // of the box tint above. Opacity < 100 blends toward the page background,
  // same color-mix trick FILLS already uses above.
  const textColor = metadata.textColor as string | undefined
  const fillOpacity = (metadata.fillOpacity as number | undefined) ?? 100
  const resolvedTextColor = textColor
    ? fillOpacity < 100
      ? `color-mix(in oklch, ${textColor} ${fillOpacity}%, var(--background))`
      : textColor
    : undefined
  const align = (metadata.align as Align | undefined) ?? 'left'
  const vAlign = (metadata.verticalAlign as string | undefined) ?? 'top'
  // Properties → Layout → Resizing: "Hug contents" shrinks the box to the
  // widest line instead of wrapping at the stored width.
  const hug = metadata.resizing === 'hug'
  return (
    <div
      className={cn(
        'relative flex h-full flex-col',
        hug ? 'w-max' : 'w-full',
        VERTICAL_ALIGN_CLASS[vAlign] ?? 'justify-start',
        // A plain text box has NO padding: its bounding box should be the
        // text, so the glyphs sit exactly where the box edge says they will
        // — the old p-2 offset every box 8px in from its own handles, which
        // is visible the moment you align two boxes or butt one against a
        // shape. A FILLED box keeps its inset: text touching the edge of a
        // tinted panel reads as broken, and that padding is part of the fill
        // treatment rather than part of the text.
        hasFill ? cn(!bgIsHex && FILLS[bg as string], 'p-3 hairline shadow-sm') : ''
      )}
      style={{
        textAlign: align,
        color: resolvedTextColor,
        borderRadius: cornerRadius,
        backgroundColor: bgIsHex ? bg : undefined,
      }}
    >
      <RichTextArea
        {...props}
        placeholder=""
        padY={hasFill ? 24 : 0}
        autoEdit={fresh}
        deleteWhenEmpty={fresh}
        hug={hug}
        fillHeight={vAlign === 'top'}
      />
    </div>
  )
}
