'use client'

// Live markdown text block, WYSIWYG-while-typing: every line renders
// formatted, INCLUDING the one holding the caret — bold looks bold the
// moment you apply it, not just after you click off the line. The active
// line keeps its delimiters in the DOM (dimmed via .md-marker) instead of
// hiding them, so **/[text]{...} markers are still visible/editable right
// where they are, and — critically — the DOM text length still matches the
// raw markdown length character-for-character, which is what every caret/
// selection offset function below assumes. Click away entirely and the
// whole block renders through the richer block-level renderer (real
// <ul>/<pre>, not per-line).
// The box width is the writing width — text wraps there — and the box
// grows vertically to fit the content (grow-only; the user's height acts
// as a minimum).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useDocStore } from '@/lib/store/document'
import { useActiveTextEditor, type TextEditorHandle } from '@/lib/store/text-editor'
import { getString, type ObjectRendererProps } from './types'
import { renderMarkdown, renderLineLive, renderLineActive, htmlToMarkdownSource, TEXT_COLORS, TEXT_SIZES } from '@/lib/text/markdown'
import { cn } from '@/lib/utils'

// Optional box-level background tint — shared with Note, which always shows
// one; Text defaults to no fill (fully transparent) unless chosen in the
// Properties panel's Text → Appearance section.
export const FILLS: Record<string, string> = {
  amber: 'bg-[color-mix(in_oklch,var(--accent-amber)_18%,var(--card))]',
  mint: 'bg-[color-mix(in_oklch,var(--accent-mint)_18%,var(--card))]',
  blue: 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,var(--card))]',
  violet: 'bg-[color-mix(in_oklch,var(--accent-violet)_14%,var(--card))]',
  rose: 'bg-[color-mix(in_oklch,var(--accent-rose)_14%,var(--card))]',
}

// Legacy whole-box fallback — no control in the current UI writes fmtSize/
// fmtColor anymore (color/size are selection-scoped now, see TEXT_COLORS/
// TEXT_SIZES spans below), but old saved docs may still carry them.
export function textFormatStyle(object: ObjectRendererProps['object']): CSSProperties {
  const size = getString(object, 'fmtSize')
  const color = getString(object, 'fmtColor')
  return {
    fontSize: size ? (TEXT_SIZES[size] ?? TEXT_SIZES.m) : undefined,
    color: color ? (TEXT_COLORS[color] ?? TEXT_COLORS.default) : undefined,
  }
}

// ── Live per-line editor: one <div data-i> per source line inside a single
// contentEditable root. The active (caret-holding) line stays plain raw
// text so typing is native with zero caret math; only line SWITCHES
// (click, arrow up/down, Enter, Backspace-at-column-0) need to move the
// caret themselves, and only that one line's DOM gets rebuilt. ───────────

function useLiveMarkdownEditor(
  editorRef: React.RefObject<HTMLDivElement | null>,
  value: string,
  onChange: (next: string) => void,
  handleRef: React.RefObject<TextEditorHandle | null>
) {
  const linesRef = useRef<string[]>(value.split('\n'))
  const activeRef = useRef<number>(-1)
  // See TextEditorHandle.snapshotSelection's doc comment — a selection
  // captured just before a panel control (the Size input) steals focus,
  // consumed by the next setSpan() call in place of live window.getSelection.
  const snapshotRef = useRef<{
    line: number
    s: number
    e: number
  } | null>(null)

  const lineEl = (i: number) => editorRef.current?.children[i] as HTMLElement | undefined

  const renderLineDom = (i: number) => {
    const el = lineEl(i)
    if (!el) return
    const raw = linesRef.current[i] ?? ''
    if (i === activeRef.current) {
      const { html, cls } = renderLineActive(raw)
      el.innerHTML = html
      el.className = cn('md-line md-line-active', cls)
    } else {
      const { html, cls } = renderLineLive(raw)
      el.innerHTML = html
      el.className = cn('md-line', cls)
    }
  }

  const markEmpty = () => {
    const container = editorRef.current
    if (!container) return
    const isEmpty = linesRef.current.length === 1 && linesRef.current[0] === ''
    container.dataset.empty = String(isEmpty)
  }

  const rebuildAll = () => {
    const container = editorRef.current
    if (!container) return
    container.innerHTML = ''
    for (let i = 0; i < linesRef.current.length; i++) {
      const div = document.createElement('div')
      div.dataset.i = String(i)
      container.appendChild(div)
    }
    for (let i = 0; i < linesRef.current.length; i++) renderLineDom(i)
    markEmpty()
  }

/** Maps any (node, offset) inside the editor to {line, rawOffset} — offset
   * is converted to RAW markdown space even for inactive (rendered) lines,
   * via a proportional estimate against that line's shown-vs-raw length. */
  const posAt = (node: Node, nodeOffset: number): { line: number; offset: number } | null => {
    let n: Node | null = node
    let lineDiv: HTMLElement | null = null
    while (n && n !== editorRef.current) {
      if (n instanceof HTMLElement && n.dataset.i !== undefined) {
        lineDiv = n
        break
      }
      n = n.parentNode
    }
    if (!lineDiv) return null
    const line = Number(lineDiv.dataset.i)
    const pre = document.createRange()
    pre.selectNodeContents(lineDiv)
    pre.setEnd(node, nodeOffset)
    const shownOffset = pre.toString().length
    if (line === activeRef.current) return { line, offset: shownOffset }
    const shownLen = lineDiv.textContent?.length ?? 0
    const rawLen = (linesRef.current[line] ?? '').length
    const offset = shownLen > 0 ? Math.round((shownOffset / shownLen) * rawLen) : rawLen
    return { line, offset }
  }

  /** Collapsed caret position (line + raw offset), or null if there's a
   * range selection or the caret isn't inside a line div. */
  const caretPosition = (): { line: number; offset: number } | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null
    return posAt(sel.anchorNode!, sel.anchorOffset)
  }

  /** Normalized (start ≤ end) selection span in raw-line/offset space, or
   * null if the selection is collapsed (a plain caret, no range). */
  const selectionSpan = (): { s: { line: number; offset: number }; e: { line: number; offset: number } } | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !editorRef.current) return null
    const range = sel.getRangeAt(0)
    const a = posAt(range.startContainer, range.startOffset)
    const b = posAt(range.endContainer, range.endOffset)
    if (!a || !b) return null
    return a.line < b.line || (a.line === b.line && a.offset <= b.offset) ? { s: a, e: b } : { s: b, e: a }
  }

  /** Replaces everything between two raw positions with `text` (used for
   * typing/pasting over a selection, Backspace/Delete on a range, and
   * Enter with a selection) — the one path that can touch multiple lines
   * at once, so it's also what keeps the line-array structurally sound
   * against browser-native multi-line edits we didn't otherwise intend. */
  const replaceRange = (
    s: { line: number; offset: number },
    e: { line: number; offset: number },
    text: string
  ) => {
    const before = (linesRef.current[s.line] ?? '').slice(0, s.offset)
    const after = (linesRef.current[e.line] ?? '').slice(e.offset)
    const inserted = (before + text + after).split('\n')
    linesRef.current.splice(s.line, e.line - s.line + 1, ...inserted)
    const newActive = s.line + inserted.length - 1
    const caretAt = inserted.length === 1 ? before.length + text.length : inserted[inserted.length - 1].length - after.length
    activeRef.current = -1 // render everything inactive first — avoids a stale index landing on the wrong (now-shifted) line
    rebuildAll()
    activeRef.current = newActive
    renderLineDom(newActive)
    placeCaretAt(newActive, caretAt)
    commit()
  }

  /** Finds the (textNode, offset) that sits `targetOffset` characters into
   * el's full text content, walking every descendant text node in order —
   * not just the first one. Plain-text lines are still just one text node
   * (fast path below), but the active line can now be a tree of marker/
   * strong/em spans (see renderLineActive), so the caret needs to be able
   * to land inside any of them, not just the first. */
  const textNodeAt = (el: HTMLElement, targetOffset: number): { node: Text; offset: number } => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let last: Text | null = null
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const len = node.textContent?.length ?? 0
      if (targetOffset <= consumed + len) return { node, offset: targetOffset - consumed }
      consumed += len
      last = node
    }
    // Ran past the end (or the line has no text nodes at all) — land at the
    // end of the last one, creating an empty node first if there were none.
    if (!last) {
      last = document.createTextNode('')
      el.appendChild(last)
    }
    return { node: last, offset: last.textContent?.length ?? 0 }
  }

  const placeCaretAt = (line: number, rawOffset: number) => {
    const el = lineEl(line)
    const sel = window.getSelection()
    if (!el || !sel) return
    const totalLen = el.textContent?.length ?? 0
    const clamped = Math.max(0, Math.min(rawOffset, totalLen))
    const { node, offset } = textNodeAt(el, clamped)
    const range = document.createRange()
    range.setStart(node, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** Same idea as placeCaretAt but selects a RANGE instead of collapsing —
   *  used to keep a just-applied span selected so a follow-up panel action
   *  (another size bump, a different color) still has something to act on. */
  const selectRawRange = (line: number, startOffset: number, endOffset: number) => {
    const el = lineEl(line)
    const sel = window.getSelection()
    if (!el || !sel) return
    const totalLen = el.textContent?.length ?? 0
    const a = Math.max(0, Math.min(startOffset, totalLen))
    const b = Math.max(0, Math.min(endOffset, totalLen))
    const start = textNodeAt(el, a)
    const end = textNodeAt(el, b)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** Swap the line the caret just left back to rendered, and the line it
   * entered to raw — mapping the click/arrow-key offset proportionally
   * since rendered text is shorter than its raw source. */
  const activateLine = (newIdx: number, shownOffset: number) => {
    const oldIdx = activeRef.current
    if (oldIdx === newIdx) return
    const el = lineEl(newIdx)
    const shownLen = el?.textContent?.length ?? 0
    const rawLen = (linesRef.current[newIdx] ?? '').length
    const rawOffset = shownLen > 0 ? Math.round((shownOffset / shownLen) * rawLen) : rawLen
    activeRef.current = newIdx
    if (oldIdx >= 0) renderLineDom(oldIdx)
    renderLineDom(newIdx)
    placeCaretAt(newIdx, rawOffset)
  }

  /** Same swap as activateLine, but the offset is already in RAW space (as
   * posAt/selectionSpan report it) — skips the shown→raw conversion so
   * callers who already resolved a real offset don't get it double-mapped. */
  const activateLineAtRaw = (newIdx: number, rawOffset: number) => {
    const oldIdx = activeRef.current
    if (oldIdx === newIdx) return
    activeRef.current = newIdx
    if (oldIdx >= 0) renderLineDom(oldIdx)
    renderLineDom(newIdx)
    placeCaretAt(newIdx, rawOffset)
  }

  const checkLineSwitch = () => {
    const pos = caretPosition()
    if (!pos || pos.line === activeRef.current) return
    activateLine(pos.line, pos.offset)
  }

  const commit = () => onChange(linesRef.current.join('\n'))

  /** Wraps the current selection (or inserts at the caret) with markdown
   *  delimiters — bold, italic, highlight, a `[text]{color=..}` span… Named
   *  (not just inlined into handleRef below) so both the Properties panel
   *  AND this hook's own Ctrl+B/Ctrl+I handling can call it. */
  const wrap = (before: string, after = before) => {
    // Resolve the selection/caret's real line BEFORE trusting activeRef —
    // a selection made by double-click or a drag on a still-rendered line
    // doesn't move the caret into that line on its own, so without this the
    // wrap below silently targets whatever line was last active (often
    // empty/unrelated) and drops in bare, unwrapped delimiters.
    const span = selectionSpan()
    const pos = caretPosition()
    const targetLine = span?.s.line ?? pos?.line ?? activeRef.current
    if (targetLine < 0) return
    if (targetLine !== activeRef.current) {
      const rawOffset = span ? span.s.offset : (pos?.offset ?? (linesRef.current[targetLine] ?? '').length)
      activateLineAtRaw(targetLine, rawOffset)
    }
    const i = activeRef.current
    const raw = linesRef.current[i] ?? ''
    const sameLineSpan = span && span.s.line === targetLine && span.e.line === targetLine ? span : null
    const s = sameLineSpan ? sameLineSpan.s.offset : pos && pos.line === targetLine ? pos.offset : raw.length
    const e = sameLineSpan ? sameLineSpan.e.offset : s
    const next = raw.slice(0, s) + before + raw.slice(s, e) + after + raw.slice(e)
    linesRef.current[i] = next
    renderLineDom(i)
    // Past the closing delimiter too, not just the wrapped selection — typing
    // right after applying a mark should continue as plain text, not land
    // inside the mark before its closing **/]{...} (see WYSIWYG comment atop
    // this file: the closing delimiter is now a real, typeable text run).
    placeCaretAt(i, s + before.length + (e - s) + after.length)
    commit()
  }

  /** Captures the live selection right now, before it's about to be lost —
   *  call this from a control's onFocus/onPointerDown, BEFORE the browser
   *  moves focus into that control. setSpan() below prefers this snapshot
   *  (and clears it once used) over live window.getSelection(), which by
   *  the time a text <input>'s onBlur/Enter fires no longer points at the
   *  contentEditable at all — focusing any real input collapses it there,
   *  unlike a plain <button> click, which needs no focus to register. */
  const snapshotSelection = () => {
    const span = selectionSpan()
    const pos = caretPosition()
    if (span) {
      snapshotRef.current = { line: span.s.line, s: span.s.offset, e: span.e.offset }
    } else if (pos) {
      snapshotRef.current = { line: pos.line, s: pos.offset, e: pos.offset }
    }
  }

  /** Applies a "pick one value" span (size/color/font) — unlike wrap(),
   *  which always inserts a fresh bracket pair and leaves the caret PAST
   *  it (fine for a toggle mark you then keep typing past), this replaces
   *  an existing span of the same bracket syntax already covering the
   *  selection, and reselects the result. Without that, a second stepper
   *  click/swatch pick after the first had nothing left selected — the
   *  caret was sitting right after the closing `}` — so it wrapped EMPTY
   *  text at that caret instead of adjusting the span just applied,
   *  producing junk like `[x]{size=16}[]{size=17}[]{size=18}`. */
  const setSpan = (kind: 'size' | 'color' | 'font' | 'weight', value: string) => {
    const snap = snapshotRef.current
    snapshotRef.current = null // one-shot — a stale snapshot from an earlier edit must never silently reapply
    const span = snap ? null : selectionSpan()
    const pos = snap ? null : caretPosition()
    const targetLine = snap?.line ?? span?.s.line ?? pos?.line ?? activeRef.current
    if (targetLine < 0) return
    if (targetLine !== activeRef.current) {
      const rawOffset = snap ? snap.s : span ? span.s.offset : (pos?.offset ?? (linesRef.current[targetLine] ?? '').length)
      activateLineAtRaw(targetLine, rawOffset)
    }
    const i = activeRef.current
    const raw = linesRef.current[i] ?? ''
    const sameLineSpan = span && span.s.line === targetLine && span.e.line === targetLine ? span : null
    const s = snap ? snap.s : sameLineSpan ? sameLineSpan.s.offset : pos && pos.line === targetLine ? pos.offset : raw.length
    const e = snap ? snap.e : sameLineSpan ? sameLineSpan.e.offset : s
    if (s === e) return // nothing selected — there's no text to size/color/font

    const selected = raw.slice(s, e)
    const already = selected.match(/^\[([\s\S]*)\]\{[a-z]+=[a-z0-9.]+\}$/)
    const inner = already ? already[1] : selected
    const spanText = `[${inner}]{${kind}=${value}}`
    linesRef.current[i] = raw.slice(0, s) + spanText + raw.slice(e)
    renderLineDom(i)
    selectRawRange(i, s, s + spanText.length)
    commit()
  }

  const prefixLine = (prefix: string) => {
    // Same fix as wrap(): land on the line the user actually clicked/
    // selected, not whatever line happened to be active already.
    const span = selectionSpan()
    const pos = caretPosition()
    const targetLine = span?.s.line ?? pos?.line ?? activeRef.current
    if (targetLine < 0) return
    if (targetLine !== activeRef.current) {
      const rawOffset = span ? span.s.offset : (pos?.offset ?? (linesRef.current[targetLine] ?? '').length)
      activateLineAtRaw(targetLine, rawOffset)
    }
    const i = activeRef.current
    linesRef.current[i] = prefix + (linesRef.current[i] ?? '')
    renderLineDom(i)
    placeCaretAt(i, (linesRef.current[i] ?? '').length)
    commit()
  }

  const start = (initialLine?: number) => {
    rebuildAll()
    const idx = initialLine ?? linesRef.current.length - 1
    activateLine(idx, (linesRef.current[idx] ?? '').length)
    editorRef.current?.focus()
  }

  const syncExternal = (next: string) => {
    linesRef.current = next.split('\n')
    activeRef.current = -1
    rebuildAll()
  }

  const onInput = () => {
    const idx = activeRef.current
    if (idx < 0) return
    linesRef.current[idx] = lineEl(idx)?.textContent ?? ''
    markEmpty()
    commit()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    const idx = activeRef.current
    if (idx < 0) return

    // Common formatting shortcuts — the floating dock is gone, so these (and
    // the panel buttons) are the only way to apply a mark without typing the
    // raw markdown delimiters yourself.
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      wrap('**')
      return
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      wrap('*')
      return
    }
    if (mod && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      wrap('++')
      return
    }

    // Any selection (single- or multi-line, active line or not) that's
    // about to be mutated goes through the one path that can safely touch
    // more than the active line — this is also what protects the line
    // structure from a native multi-line delete we didn't intend (e.g.
    // Ctrl+A then Backspace, or a drag-selection across lines).
    const span = selectionSpan()
    if (span) {
      const isPrintable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        replaceRange(span.s, span.e, '')
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        replaceRange(span.s, span.e, '\n')
        return
      }
      if (isPrintable) {
        e.preventDefault()
        replaceRange(span.s, span.e, e.key)
        return
      }
      return // other keys (arrows, modifiers, copy…) — let the browser handle selection as usual
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const pos = caretPosition()
      const raw = linesRef.current[idx] ?? ''
      const at = pos && pos.line === idx ? Math.min(pos.offset, raw.length) : raw.length
      linesRef.current.splice(idx, 1, raw.slice(0, at), raw.slice(at))
      rebuildAll()
      activeRef.current = idx + 1
      renderLineDom(idx)
      renderLineDom(idx + 1)
      placeCaretAt(idx + 1, 0)
      commit()
      return
    }
    if (e.key === 'Backspace') {
      const pos = caretPosition()
      if (idx > 0 && pos && pos.line === idx && pos.offset === 0) {
        e.preventDefault()
        const prev = linesRef.current[idx - 1]
        const cur = linesRef.current[idx]
        linesRef.current.splice(idx - 1, 2, prev + cur)
        rebuildAll()
        activeRef.current = idx - 1
        renderLineDom(idx - 1)
        placeCaretAt(idx - 1, prev.length)
        commit()
      }
      return
    }
    if (e.key === 'Delete') {
      const pos = caretPosition()
      const raw = linesRef.current[idx] ?? ''
      if (pos && pos.line === idx && pos.offset === raw.length && idx < linesRef.current.length - 1) {
        e.preventDefault()
        const next = linesRef.current[idx + 1]
        linesRef.current.splice(idx, 2, raw + next)
        rebuildAll()
        activeRef.current = idx
        renderLineDom(idx)
        placeCaretAt(idx, raw.length)
        commit()
      }
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const idx = activeRef.current
    if (idx < 0) return
    const text = e.clipboardData.getData('text/plain')
    const span = selectionSpan()
    const pos = caretPosition()
    const at = span?.s ?? pos ?? { line: idx, offset: (linesRef.current[idx] ?? '').length }
    const end = span?.e ?? at
    replaceRange(at, end, text)
  }

  const onClick = () => checkLineSwitch()
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      checkLineSwitch()
    }
  }

  ;(handleRef as React.MutableRefObject<TextEditorHandle | null>).current = { wrap, prefixLine, setSpan, snapshotSelection }

  return { start, syncExternal, onInput, onKeyDown, onKeyUp, onClick, onPaste }
}

// Whole-textbox alignment — the one box-level formatting knob left (see
// TextOptions in inspector.tsx). Everything else (bold, color, size…) is
// selection-scoped now, set via the panel or Ctrl+B/Ctrl+I and read straight
// out of the markdown source, so there's no floating dock anymore.
const ALIGNS = ['left', 'center', 'right', 'justify'] as const
type Align = (typeof ALIGNS)[number]

/** Shared markdown editor: live per-line preview while editing, full
 * block-level markdown otherwise. Wraps at box width, grows the box
 * vertically to fit. */
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
}) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const updateObject = useDocStore((s) => s.updateObject)
  const removeObjects = useDocStore((s) => s.removeObjects)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const setSelection = useDocStore((s) => s.setSelection)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TextEditorHandle | null>(null)
  const focusedRef = useRef(false)
  // Guards the empty-box cleanup: only a box the caret actually reached can
  // be discarded, so a not-yet-selected fresh box never deletes itself.
  const everFocusedRef = useRef(false)
  // Single click selects/drags the box like any object; only a double click
  // enters edit mode. Deselecting leaves edit mode.
  const [editing, setEditing] = useState(false)
  const value = htmlToMarkdownSource(getString(object, 'text'))

  const editor = useLiveMarkdownEditor(
    editorRef,
    value,
    (next) => setStringParam(pageId, object.id, 'text', next),
    handleRef
  )

  // Spawned boxes go straight into typing — no click, no double-click.
  useEffect(() => {
    if (!autoEdit) return
    setEditing(true)
    requestAnimationFrame(() => editor.start())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selected && editing) {
      setEditing(false)
      editorRef.current?.blur()
      // An empty box was never really wanted — clean it up instead of
      // leaving an invisible object on the canvas.
      if (deleteWhenEmpty && everFocusedRef.current && value.trim() === '')
        removeObjects(pageId, [object.id])
    }
  }, [selected, editing, deleteWhenEmpty, value, pageId, object.id, removeObjects])

  // External changes (undo, sync, AI) land only while unfocused — never
  // clobber the caret mid-typing.
  useEffect(() => {
    if (editing && !focusedRef.current) editor.syncExternal(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing])

  // Makes this box's format/prefixLine handle reachable from the Properties
  // panel (see lib/store/text-editor.ts) while it's the one being edited —
  // the panel lives in an entirely different part of the DOM, so this is the
  // only way its buttons can reach the live selection.
  useEffect(() => {
    if (!editing) return
    useActiveTextEditor.getState().set(object.id, handleRef)
    return () => useActiveTextEditor.getState().clear(object.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, object.id])

  // Grow-only autosize: the width is the writing width; overflowing lines
  // wrap, and the box gets taller so nothing is ever clipped vertically.
  //
  // Grow by the actual OVERFLOW, never by scrollHeight. The element is
  // h-full, so scrollHeight is always >= the box height — measuring
  // `scrollHeight + padY` therefore always exceeded the current height, grew
  // the box, re-rendered, and exceeded it again: an unbounded loop that React
  // kills with "Maximum update depth exceeded" (error #185). Overflow, by
  // contrast, goes to zero once the content fits, so this converges.
  const fit = () => {
    const el = editing ? editorRef.current : viewRef.current
    if (!el) return
    const overflow = el.scrollHeight - el.clientHeight
    if (overflow > 1) {
      updateObject(pageId, object.id, {
        size: { w: object.size.w, h: Math.ceil(object.size.h + overflow + padY) },
      })
    }
  }
  useLayoutEffect(fit) // content, editing mode, width and zoom changes all re-measure

  const rendered = renderMarkdown(value)
  // Properties → Text → Line spacing (box-level, like Alignment — the
  // markdown model has no per-paragraph tracking). 1.625 matches Tailwind's
  // leading-relaxed, the old fixed value, so unset boxes look unchanged.
  const lineHeight = (object.metadata.lineHeight as number | undefined) ?? 1.625
  // Properties → Typography → Letter spacing, box-level like line height —
  // a percentage of font-size, same convention Figma's field uses.
  const letterSpacingPct = (object.metadata.letterSpacing as number | undefined) ?? 0
  const letterSpacing = letterSpacingPct ? `${letterSpacingPct / 100}em` : undefined

  return (
    <>
      <div className={cn('h-full overflow-hidden', hug ? 'w-max' : 'w-full')} style={textFormatStyle(object)}>
        {editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={placeholder || 'Text'}
            data-placeholder={placeholder}
            // inputMode=text signals the OS that this field accepts text input,
            // which enables Google Handwriting Input and similar stylus IMEs.
            inputMode="text"
            className={cn(
              'md-editor h-full outline-none',
              hug ? 'w-max whitespace-pre' : 'w-full whitespace-pre-wrap break-words',
              'select-text cursor-text',
              className
            )}
            style={{ touchAction: 'auto', lineHeight, letterSpacing }}
            onFocus={() => {
              if (!focusedRef.current) {
                focusedRef.current = true
                pushHistory(pageId)
              }
              everFocusedRef.current = true
              setSelection([object.id])
            }}
            onBlur={() => {
              focusedRef.current = false
            }}
            onInput={editor.onInput}
            onKeyDown={(e) => {
              // The canvas's global Ctrl+Z/Ctrl+Y skip everything while
              // typing (so single-letter tool shortcuts don't fire mid-
              // sentence) — undo/redo need their own path here instead.
              // History is pushed once per edit session (on focus, above),
              // so this steps back to the pre-session snapshot, same
              // granularity Ctrl+Z already has everywhere else in the app.
              const mod = (e.ctrlKey || e.metaKey) && !e.altKey
              if (mod && e.key.toLowerCase() === 'z') {
                e.preventDefault()
                e.stopPropagation()
                if (e.shiftKey) redo(pageId)
                else undo(pageId)
                return
              }
              editor.onKeyDown(e)
            }}
            onKeyUp={editor.onKeyUp}
            onClick={editor.onClick}
            onPaste={editor.onPaste}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            ref={viewRef}
            role="textbox"
            aria-label={placeholder || 'Text'}
            className={cn(
              'markdown-view h-full cursor-inherit',
              hug ? 'w-max whitespace-pre' : 'w-full whitespace-pre-wrap break-words',
              !rendered && 'text-muted-foreground/50',
              className
            )}
            style={{ lineHeight, letterSpacing }}
            onDoubleClick={(e) => {
              // Double click = drop into the live per-line editor, caret at end.
              e.stopPropagation()
              setEditing(true)
              setSelection([object.id])
              requestAnimationFrame(() => editor.start())
            }}
            // Rendered markdown is generated by our own escaping renderer
            // (lib/text/markdown.ts) — never raw user HTML.
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        )}
      </div>
    </>
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
  const hasFill = Boolean(bg && FILLS[bg])
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
        hasFill && cn(FILLS[bg as string], 'p-3 hairline shadow-sm')
      )}
      style={{ textAlign: align, color: resolvedTextColor, borderRadius: cornerRadius }}
    >
      <RichTextArea
        {...props}
        placeholder=""
        padY={hasFill ? 24 : 0}
        autoEdit={fresh}
        deleteWhenEmpty={fresh}
        hug={hug}
      />
    </div>
  )
}
