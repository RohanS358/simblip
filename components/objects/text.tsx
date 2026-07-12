'use client'

// Live markdown text block, Obsidian-style: while editing, every line
// renders formatted EXCEPT the one holding the caret, which shows raw
// source — so bold/headings/lists appear as you write instead of only
// after you click away. Click away entirely and the whole block renders
// through the richer block-level renderer (real <ul>/<pre>, not per-line).
// The box width is the writing width — text wraps there — and the box
// grows vertically to fit the content (grow-only; the user's height acts
// as a minimum).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading2,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Link,
} from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'
import { renderMarkdown, renderLineLive, htmlToMarkdownSource } from '@/lib/text/markdown'
import { cn } from '@/lib/utils'

// ── Legacy base styles (old docs formatted the whole box via params) ────────
const BASE_COLORS: Record<string, string> = {
  default: 'var(--foreground)',
  blue: 'var(--accent-blue)',
  mint: 'var(--accent-mint)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
}
const BASE_SIZES: Record<string, number> = { s: 12, m: 15, l: 20, xl: 28 }
const BASE_HIGHLIGHTS: Record<string, string> = {
  yellow: 'color-mix(in oklch, var(--accent-amber) 32%, transparent)',
  mint: 'color-mix(in oklch, var(--accent-mint) 30%, transparent)',
  blue: 'color-mix(in oklch, var(--accent-blue) 26%, transparent)',
  rose: 'color-mix(in oklch, var(--accent-rose) 26%, transparent)',
}

export function textFormatStyle(object: ObjectRendererProps['object']): CSSProperties {
  return {
    fontWeight: getString(object, 'fmtBold') ? 700 : undefined,
    fontStyle: getString(object, 'fmtItalic') ? 'italic' : undefined,
    textDecoration: getString(object, 'fmtUnderline') ? 'underline' : undefined,
    fontSize: BASE_SIZES[getString(object, 'fmtSize')] ?? BASE_SIZES.m,
    color: BASE_COLORS[getString(object, 'fmtColor')] ?? BASE_COLORS.default,
    background: BASE_HIGHLIGHTS[getString(object, 'fmtHighlight')],
  }
}

// ── Live per-line editor: one <div data-i> per source line inside a single
// contentEditable root. The active (caret-holding) line stays plain raw
// text so typing is native with zero caret math; only line SWITCHES
// (click, arrow up/down, Enter, Backspace-at-column-0) need to move the
// caret themselves, and only that one line's DOM gets rebuilt. ───────────

interface EditorHandle {
  wrap: (before: string, after?: string) => void
  prefixLine: (prefix: string) => void
}

function useLiveMarkdownEditor(
  editorRef: React.RefObject<HTMLDivElement | null>,
  value: string,
  onChange: (next: string) => void,
  handleRef: React.RefObject<EditorHandle | null>
) {
  const linesRef = useRef<string[]>(value.split('\n'))
  const activeRef = useRef<number>(-1)

  const lineEl = (i: number) => editorRef.current?.children[i] as HTMLElement | undefined

  const renderLineDom = (i: number) => {
    const el = lineEl(i)
    if (!el) return
    const raw = linesRef.current[i] ?? ''
    if (i === activeRef.current) {
      el.textContent = raw
      el.className = 'md-line md-line-active'
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

  const placeCaretAt = (line: number, rawOffset: number) => {
    const el = lineEl(line)
    const sel = window.getSelection()
    if (!el || !sel) return
    if (!el.firstChild) el.appendChild(document.createTextNode(''))
    const tn = el.firstChild!
    const len = tn.textContent?.length ?? 0
    const clamped = Math.max(0, Math.min(rawOffset, len))
    const range = document.createRange()
    range.setStart(tn, clamped)
    range.collapse(true)
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

  const checkLineSwitch = () => {
    const pos = caretPosition()
    if (!pos || pos.line === activeRef.current) return
    activateLine(pos.line, pos.offset)
  }

  const commit = () => onChange(linesRef.current.join('\n'))

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

  if (handleRef) {
    ;(handleRef as React.MutableRefObject<EditorHandle | null>).current = {
      wrap: (before, after = before) => {
        const i = activeRef.current
        if (i < 0) return
        const raw = linesRef.current[i] ?? ''
        const span = selectionSpan()
        const sameLineSpan = span && span.s.line === i && span.e.line === i ? span : null
        const pos = caretPosition()
        const s = sameLineSpan ? sameLineSpan.s.offset : pos && pos.line === i ? pos.offset : raw.length
        const e = sameLineSpan ? sameLineSpan.e.offset : s
        const next = raw.slice(0, s) + before + raw.slice(s, e) + after + raw.slice(e)
        linesRef.current[i] = next
        renderLineDom(i)
        placeCaretAt(i, s + before.length + (e - s))
        commit()
      },
      prefixLine: (prefix) => {
        const i = activeRef.current
        if (i < 0) return
        linesRef.current[i] = prefix + (linesRef.current[i] ?? '')
        renderLineDom(i)
        placeCaretAt(i, (linesRef.current[i] ?? '').length)
        commit()
      },
    }
  }

  return { start, syncExternal, onInput, onKeyDown, onKeyUp, onClick, onPaste }
}

/** Floating toolbar — inserts markdown syntax at the caret in the active line. */
function MarkdownToolBar({ handleRef }: { handleRef: React.RefObject<EditorHandle | null> }) {
  // preventDefault on pointerdown keeps the editor's selection alive while
  // clicking toolbar buttons — otherwise the click would collapse it.
  const guard = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const btn = (label: string, Icon: typeof Bold, action: (h: EditorHandle) => void) => (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onPointerDown={guard}
      onClick={() => {
        if (handleRef.current) action(handleRef.current)
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div
      className="glass-strong absolute -top-10 left-0 z-50 flex items-center gap-0.5 rounded-lg px-1.5 py-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {btn('Bold', Bold, (h) => h.wrap('**'))}
      {btn('Italic', Italic, (h) => h.wrap('*'))}
      {btn('Strikethrough', Strikethrough, (h) => h.wrap('~~'))}
      {btn('Inline code', Code, (h) => h.wrap('`'))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      {btn('Heading', Heading2, (h) => h.prefixLine('## '))}
      {btn('Bullet list', List, (h) => h.prefixLine('- '))}
      {btn('Numbered list', ListOrdered, (h) => h.prefixLine('1. '))}
      {btn('Checkbox', CheckSquare, (h) => h.prefixLine('- [ ] '))}
      {btn('Quote', Quote, (h) => h.prefixLine('> '))}
      {btn('Link', Link, (h) => h.wrap('[', '](url)'))}
    </div>
  )
}

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
}: ObjectRendererProps & {
  placeholder: string
  padY?: number
  className?: string
  /** Spawn straight into typing — no click needed. */
  autoEdit?: boolean
  /** A box that never received any text removes itself when you leave it. */
  deleteWhenEmpty?: boolean
}) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const updateObject = useDocStore((s) => s.updateObject)
  const removeObjects = useDocStore((s) => s.removeObjects)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const setSelection = useDocStore((s) => s.setSelection)
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<EditorHandle | null>(null)
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

  // Grow-only autosize: the width is the writing width; overflowing lines
  // wrap, and the box gets taller so nothing is ever clipped vertically.
  const fit = () => {
    const el = editing ? editorRef.current : viewRef.current
    if (!el) return
    const needed = Math.ceil(el.scrollHeight + padY)
    if (needed > object.size.h + 1) {
      updateObject(pageId, object.id, { size: { w: object.size.w, h: needed } })
    }
  }
  useLayoutEffect(fit) // content, editing mode, width and zoom changes all re-measure

  const rendered = renderMarkdown(value)

  return (
    <>
      {/* Toolbar lives OUTSIDE the clipping wrapper below — it floats above
          the box and overflow-hidden would swallow it. */}
      {selected && editing && <MarkdownToolBar handleRef={handleRef} />}
      <div className="h-full w-full overflow-hidden" style={textFormatStyle(object)}>
        {editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={placeholder || 'Text'}
            data-placeholder={placeholder}
            className={cn(
              'md-editor h-full w-full whitespace-pre-wrap break-words leading-relaxed outline-none',
              'select-text cursor-text',
              className
            )}
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
            onKeyDown={editor.onKeyDown}
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
              'markdown-view h-full w-full cursor-inherit whitespace-pre-wrap break-words leading-relaxed',
              !rendered && 'text-muted-foreground/50',
              className
            )}
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

export function TextObject(props: ObjectRendererProps) {
  // A brand-new text box (no text yet) opens focused and ready to type, and
  // deletes itself if you click away without writing anything.
  const empty = getString(props.object, 'text').trim() === ''
  const fresh = useRef(empty).current
  return (
    <div className="relative h-full w-full">
      <RichTextArea
        {...props}
        placeholder=""
        autoEdit={fresh}
        deleteWhenEmpty={fresh}
      />
    </div>
  )
}
