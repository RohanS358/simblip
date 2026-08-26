'use client'

// Tiptap-backed rich text surface — the replacement for the hand-rolled
// contentEditable engine that used to live in components/objects/text.tsx.
//
// What this deletes, conceptually, by existing:
//   - the DOM-length ≡ model-length invariant (posAt, placeCaretAt,
//     selectRange, replaceRange, the caret host and its zero-width space)
//   - manual shiftMarks() bookkeeping at ~15 call sites
//   - reconstructing the user's edit by diffing the old string against the
//     new DOM textContent, which was heuristic and lost marks outright on
//     IME composition, drag-drop and spellcheck replacement
//   - two renderers that had to stay pixel-identical
// The document is the model; the DOM is derived from it, not read back as
// ground truth.

import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { textExtensions } from '@/lib/text/extensions'
import { parseDoc, serializeDoc, type PmDoc } from '@/lib/text/pm'
import { cn } from '@/lib/utils'

export interface TiptapAreaProps {
  /** The object's stored `text` param, in any of the three storage
   *  generations — parseDoc handles all of them (see lib/text/pm.ts). */
  value: string
  /** Called with the serialized ProseMirror document. Fires per transaction. */
  onChange: (next: string) => void
  editable: boolean
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  /** Focus and place the caret at the end as soon as the editor mounts. */
  autoFocus?: boolean
  /** Receives the editor instance so the Properties panel can reach it.
   *  Replaces the whole toggleMark/prefixLine/setSpan/snapshotSelection
   *  handle — Tiptap commands act on the stored document selection, which
   *  (unlike window.getSelection) does not evaporate when a panel input
   *  takes focus. */
  onEditor?: (editor: Editor | null) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Fires on every document change AND on container resize, so the caller's
   *  autosize can re-measure without polling React renders. */
  onLayoutChange?: () => void
}

export function TiptapArea({
  value,
  onChange,
  editable,
  placeholder,
  className,
  style,
  autoFocus = false,
  onEditor,
  onFocus,
  onBlur,
  onLayoutChange,
}: TiptapAreaProps) {
  // Guards the external-value effect below: a change this editor itself just
  // emitted must not be fed back in as an "external" update, which would
  // reset the document and drop the caret mid-keystroke.
  const lastEmittedRef = useRef<string | null>(null)
  // Latest callbacks without re-creating the editor (useEditor's deps) or
  // re-subscribing the ResizeObserver on every parent render.
  const layoutRef = useRef(onLayoutChange)
  layoutRef.current = onLayoutChange
  // Lets editorProps callbacks (built before useEditor returns) reach the
  // live editor instance.
  const editorRef = useRef<Editor | null>(null)

  const editor = useEditor({
    extensions: textExtensions({ placeholder }),
    content: parseDoc(value) as unknown as Record<string, unknown>,
    editable,
    // Next renders this on the server too; without it React logs a
    // hydration mismatch for the editor's DOM.
    immediatelyRender: false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        // Tab indents a list item, but ONLY inside a list. Anywhere else it
        // must stay a focus move: this is a canvas app, not a document
        // editor, and swallowing Tab unconditionally (as the old engine did)
        // trapped keyboard users inside a text box with no way out to the
        // inspector or the next object.
        if (event.key !== 'Tab') return false
        const ed = editorRef.current
        // Read through a ref, not the `editor` const — this closure is built
        // as an argument TO useEditor, so `editor` is still undefined here on
        // the first evaluation.
        const itemType = ed?.isActive('taskItem')
          ? 'taskItem'
          : ed?.isActive('listItem')
            ? 'listItem'
            : null
        if (!ed || !itemType) return false
        event.preventDefault()
        return event.shiftKey
          ? ed.chain().liftListItem(itemType).run()
          : ed.chain().sinkListItem(itemType).run()
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = serializeDoc(ed.getJSON() as unknown as PmDoc)
      lastEmittedRef.current = next
      onChange(next)
      layoutRef.current?.()
    },
    onFocus: () => onFocus?.(),
    onBlur: () => onBlur?.(),
  })

  editorRef.current = editor

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  // Focus on mount. There is no caret at all — let alone a blinking one —
  // until the contenteditable element actually holds DOM focus, and a
  // command issued the instant `editor` first exists can land before the
  // ProseMirror view is attached and painted, where it silently no-ops:
  // observed live as contenteditable="true" with a valid caret-color but
  // document.activeElement still <body>.
  //
  // So drive the DOM element directly and confirm it took, retrying on the
  // next frame. focus() on an unattached/unpainted node is the case that
  // fails, and one frame is enough for the view to be in the document.
  useEffect(() => {
    if (!editor || !autoFocus) return
    let raf = 0
    let cancelled = false
    const tryFocus = (attempt: number) => {
      if (cancelled || editor.isDestroyed) return
      const dom = editor.view?.dom as HTMLElement | undefined
      // activeElement is the DOM truth — editor.isFocused can report true
      // while the element does not actually hold focus, and it is the DOM
      // state the browser draws a caret from.
      if (dom?.isConnected && document.activeElement === dom) return
      // Focus the element FIRST. editor.commands.focus() alone was observed
      // leaving document.activeElement as <body> on the click-to-edit path
      // (verified live), and a contenteditable with no DOM focus has no
      // caret to blink. The command then only has to place the caret.
      dom?.focus({ preventScroll: true })
      editor.commands.focus('end')
      // A few frames covers "view not yet attached/painted" without spinning
      // if focus is legitimately elsewhere (the user clicked away already).
      if (attempt < 4) raf = requestAnimationFrame(() => tryFocus(attempt + 1))
    }
    tryFocus(0)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [editor, autoFocus])

  // Layout can change without the document changing at all: a font finishes
  // loading, KaTeX's chunk lands and an expression's box grows, the parent
  // column is resized, the browser zooms. The old autosize keyed off a
  // JSON.stringify of the document and therefore saw none of those.
  useEffect(() => {
    // Observe the ProseMirror element itself, not a wrapper: a wrapper would
    // need a box of its own to be observable at all, and adding one here
    // changes the layout the caller carefully set up.
    const el = editor?.view.dom as HTMLElement | undefined
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => layoutRef.current?.())
    ro.observe(el)
    return () => ro.disconnect()
  }, [editor])

  // External changes (undo, sync, AI, a collaborator) — never while this
  // editor is the one being typed into, and never an echo of our own last
  // emission.
  useEffect(() => {
    if (!editor || editor.isFocused) return
    if (value === lastEmittedRef.current) return
    const incoming = parseDoc(value)
    // Comparing serialized forms avoids a pointless transaction (and the
    // selection reset that comes with it) when the document is unchanged.
    if (serializeDoc(editor.getJSON() as unknown as PmDoc) === serializeDoc(incoming)) return
    editor.commands.setContent(incoming as unknown as Record<string, unknown>, { emitUpdate: false })
  }, [editor, value])

  return <EditorContent editor={editor} className={cn('tiptap-editor', className)} style={style} />
}
