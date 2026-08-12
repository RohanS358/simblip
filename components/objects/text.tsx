'use client'

// Live text block with real formatting — WYSIWYG always, not just while
// typing: bold/italic/underline/color/size/etc. are style RANGES over a
// plain string (see lib/text/marks.ts), never markdown-delimiter characters
// typed into the text itself. There is no "active line shows raw source"
// mode anymore (the old model needed one to fake WYSIWYG-while-typing) —
// every line, including the one holding the caret, renders fully formatted
// at all times, because there is nothing to hide: the DOM never contains a
// literal `**`/`++`/`[x]{k=v}` character to begin with. This mirrors how
// canvas design tools (Fabric.js's Textbox/IText `styles` map, e.g. at
// /home/diablo/Documents/GitHub/open-design in this workspace) represent
// rich text — formatting as out-of-band per-character data, painted
// directly, structurally unable to leak into the visible text.
// The box width is the writing width — text wraps there — and the box
// grows vertically to fit the content (grow-only; the user's height acts
// as a minimum).

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useDocStore } from '@/lib/store/document'
import { useActiveTextEditor, type TextEditorHandle } from '@/lib/store/text-editor'
import { getString, type ObjectRendererProps } from './types'
import { renderMarkdown, renderEditorLine, htmlToMarkdownSource, stripCaretHost, CARET_HOST_CHAR } from '@/lib/text/render'
import {
  applyMark,
  shiftMarks,
  parse,
  serialize,
  htmlToStoredText,
  splitIndent,
  continuationPrefix,
  BLOCK_PREFIX_RE,
  INDENT_UNIT,
  TEXT_COLORS,
  TEXT_SIZES,
  type Mark,
  type MarkKind,
} from '@/lib/text/marks'
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

// ── Live per-line editor: one <div data-i> per source line inside a single
// contentEditable root, all lines sharing one flat text+marks model (marks
// are offsets into the FULL string, '\n'-joined lines included, so a mark
// can be looked up for any line via that line's cumulative start offset).
// Every line always renders fully formatted — there's no more "active line
// stays raw" split, since there's no delimiter text that needs unhiding. ──

function useLiveTextEditor(
  editorRef: React.RefObject<HTMLDivElement | null>,
  value: string,
  onChange: (next: string) => void,
  handleRef: React.RefObject<TextEditorHandle | null>
) {
  const parsed = parse(value)
  const linesRef = useRef<string[]>(parsed.text.split('\n'))
  const marksRef = useRef<Mark[]>(parsed.marks)
  const activeRef = useRef<number>(-1)
  // See TextEditorHandle.snapshotSelection's doc comment — a selection
  // captured just before a panel control (the Size input) steals focus,
  // consumed by the next setSpan() call in place of live window.getSelection.
  const snapshotRef = useRef<{ s: { line: number; offset: number }; e: { line: number; offset: number } } | null>(null)
  // True right after a snapshot-driven setSpan() commits, until the next
  // real click/selection inside the editor clears it — see snapshotSelection
  // and setSpan's doc comments for why this exists (prevents a second panel
  // edit on the same field from re-reading a stale DOM selection).
  const snapshotFreshRef = useRef(false)
  // Format chosen while the box was still empty (size/colour/font/weight
  // picked before any text exists). Applied by onInput to the first run of
  // characters that actually arrives — see applyWholeBox.
  const pendingFormatRef = useRef<{ kind: MarkKind; value: string }[]>([])

  const lineEl = (i: number) => editorRef.current?.children[i] as HTMLElement | undefined

  /** Cumulative offset of line `i`'s first character in the flat joined
   *  string (each '\n' between lines counts as one character). */
  const lineStart = (i: number) => {
    let start = 0
    for (let k = 0; k < i; k++) start += linesRef.current[k].length + 1
    return start
  }

  /** Inverse of lineStart: absolute offset in the flat joined string back to
   *  {line, offset}. Used after a multi-line edit to find where the caret
   *  should land without assuming the edit stayed on one line. */
  const locate = (absolute: number): { line: number; offset: number } => {
    let remaining = Math.max(0, absolute)
    for (let i = 0; i < linesRef.current.length; i++) {
      const len = linesRef.current[i].length
      if (remaining <= len) return { line: i, offset: remaining }
      remaining -= len + 1
    }
    const last = linesRef.current.length - 1
    return { line: last, offset: linesRef.current[last]?.length ?? 0 }
  }

  const renderLineDom = (i: number) => {
    const el = lineEl(i)
    if (!el) return
    const raw = linesRef.current[i] ?? ''
    const { html, cls } = renderEditorLine(raw, marksRef.current, lineStart(i))
    el.innerHTML = html
    el.className = cn('md-line', i === activeRef.current && 'md-line-active', cls)
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

  /** Maps any (node, offset) inside the editor to {line, offset} — DOM text
   *  length equals the raw line length once the caret host's zero-width
   *  space is stripped (the ONLY hidden character in the DOM; see
   *  CARET_HOST_CHAR in lib/text/render.ts), so this is a direct Range-walk
   *  with no shown-vs-raw proportional estimate needed for any line. */
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
    return { line, offset: stripCaretHost(pre.toString()).length }
  }

  /** Collapsed caret position (line + offset), or null if there's a range
   * selection or the caret isn't inside a line div. */
  const caretPosition = (): { line: number; offset: number } | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null
    return posAt(sel.anchorNode!, sel.anchorOffset)
  }

  /** Normalized (start ≤ end) selection span in line/offset space, or null
   * if the selection is collapsed (a plain caret, no range). */
  const selectionSpan = (): { s: { line: number; offset: number }; e: { line: number; offset: number } } | null => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !editorRef.current) return null
    const range = sel.getRangeAt(0)
    const a = posAt(range.startContainer, range.startOffset)
    const b = posAt(range.endContainer, range.endOffset)
    if (!a || !b) return null
    return a.line < b.line || (a.line === b.line && a.offset <= b.offset) ? { s: a, e: b } : { s: b, e: a }
  }

  /** Replaces everything between two line/offset positions with `text`
   * (used for typing/pasting over a selection, Backspace/Delete on a range,
   * and Enter with a selection) — the one path that can touch multiple
   * lines at once. Marks are shifted for the delete-then-insert as two
   * ordinary shiftMarks calls (a replace is just those two edits). */
  const replaceRange = (
    s: { line: number; offset: number },
    e: { line: number; offset: number },
    text: string,
    opts: { commit?: boolean } = {}
  ) => {
    const globalStart = lineStart(s.line) + s.offset
    const globalEnd = lineStart(e.line) + e.offset
    if (globalEnd > globalStart) marksRef.current = shiftMarks(marksRef.current, globalStart, -(globalEnd - globalStart))
    if (text.length > 0) marksRef.current = shiftMarks(marksRef.current, globalStart, text.length)

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
    // Callers that apply marks immediately after (paste) suppress this to
    // avoid committing the unstyled text and then the styled text as two
    // separate edits — one paste should be one commit.
    if (opts.commit !== false) commit()
  }

  /** Finds the (textNode, offset) that sits `targetOffset` characters into
   * el's full text content, walking every descendant text node in order —
   * not just the first one, since a formatted line is a tree of
   * strong/em/span elements, not one text node. */
  const textNodeAt = (el: HTMLElement, targetOffset: number): { node: Text; offset: number } => {
    // A prefixed line with no body yet (see CARET_HOST in lib/text/render.ts)
    // ends in an empty, normally-sized span. The caret must go THERE, not at
    // the end of the preceding marker's text node — the marker is
    // font-size:0, so a caret inside it is invisible and swallows typing at
    // zero size. The host holds no text, so this never affects the
    // DOM-length == raw-length invariant; it only redirects the landing spot
    // for the one offset that sits at the very end of the prefix.
    const host = el.querySelector<HTMLElement>(':scope > .md-caret-host')
    if (host && targetOffset >= stripCaretHost(el.textContent ?? '').length) {
      let node = host.firstChild as Text | null
      if (!node || node.nodeType !== 3) {
        node = document.createTextNode(CARET_HOST_CHAR)
        host.appendChild(node)
      }
      // AFTER the zero-width space, so typed text extends the host's own
      // text node rather than being merged back into the zeroed marker.
      return { node, offset: node.textContent?.length ?? 0 }
    }

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let last: Text | null = null
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      // The caret host's zero-width space is not part of the raw line, so it
      // must not advance the offset count.
      const len = stripCaretHost(node.textContent ?? '').length
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

  const placeCaretAt = (line: number, offset: number) => {
    const el = lineEl(line)
    const sel = window.getSelection()
    if (!el || !sel) return
    const totalLen = stripCaretHost(el.textContent ?? '').length
    const clamped = Math.max(0, Math.min(offset, totalLen))
    const { node, offset: nodeOffset } = textNodeAt(el, clamped)
    const range = document.createRange()
    range.setStart(node, nodeOffset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** Same idea as placeCaretAt but selects a RANGE instead of collapsing —
   *  used to keep a just-applied mark selected so a follow-up panel action
   *  (another size bump, a different color) still has something to act on. */
  const selectRange = (sLine: number, sOffset: number, eLine: number, eOffset: number) => {
    const startEl = lineEl(sLine)
    const endEl = lineEl(eLine)
    const sel = window.getSelection()
    if (!startEl || !endEl || !sel) return
    const startLen = stripCaretHost(startEl.textContent ?? '').length
    const endLen = stripCaretHost(endEl.textContent ?? '').length
    const a = Math.max(0, Math.min(sOffset, startLen))
    const b = Math.max(0, Math.min(eOffset, endLen))
    const start = textNodeAt(startEl, a)
    const end = textNodeAt(endEl, b)
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const activateLine = (newIdx: number, offset: number) => {
    const oldIdx = activeRef.current
    if (oldIdx === newIdx) return
    activeRef.current = newIdx
    if (oldIdx >= 0) renderLineDom(oldIdx)
    renderLineDom(newIdx)
    placeCaretAt(newIdx, offset)
  }

  const checkLineSwitch = () => {
    const pos = caretPosition()
    if (!pos || pos.line === activeRef.current) return
    activateLine(pos.line, pos.offset)
  }

  // Final backstop: the caret host's zero-width space is a rendering detail
  // and must never be persisted, no matter which path produced the text.
  const commit = () =>
    onChange(serialize({ text: stripCaretHost(linesRef.current.join('\n')), marks: marksRef.current }))

  /** Toggles `kind` over the current selection (or does nothing on a
   *  collapsed caret — there's no text to mark). Named (not just inlined
   *  into handleRef below) so both the Properties panel AND this hook's own
   *  Ctrl+B/Ctrl+I/Ctrl+U handling can call it. */
  const toggleMark = (kind: MarkKind) => {
    // Resolve the selection's real line BEFORE trusting activeRef — a
    // selection made by clicking a still-inactive line doesn't move the
    // caret into that line on its own.
    const span = selectionSpan()
    if (!span) return // collapsed caret — nothing selected to mark

    // A selection spanning several lines applies the mark to each line's
    // covered portion. Previously this returned early and did nothing at
    // all: select two paragraphs, press Ctrl+B, and the editor silently
    // ignored you. Marks are offsets into the flat string, so a cross-line
    // range is expressible — it just has to skip the '\n' boundaries so the
    // newline itself never gets marked.
    if (span.s.line !== span.e.line) {
      for (let i = span.s.line; i <= span.e.line; i++) {
        const len = (linesRef.current[i] ?? '').length
        const from = i === span.s.line ? span.s.offset : 0
        const to = i === span.e.line ? span.e.offset : len
        if (to <= from) continue
        marksRef.current = applyMark(marksRef.current, lineStart(i) + from, lineStart(i) + to, kind)
      }
      rebuildAll()
      activeRef.current = span.e.line
      renderLineDom(span.e.line)
      selectRange(span.s.line, span.s.offset, span.e.line, span.e.offset)
      commit()
      return
    }

    const { line, offset: s } = span.s
    const { offset: e } = span.e
    if (line !== activeRef.current) activateLine(line, s)
    const i = activeRef.current
    const start = lineStart(i) + s
    const end = lineStart(i) + e
    marksRef.current = applyMark(marksRef.current, start, end, kind)
    renderLineDom(i)
    // Keep the range selected rather than collapsing to its end — so a
    // follow-up Ctrl+I on the same words still has something to act on.
    selectRange(i, s, i, e)
    commit()
  }

  /** Captures the live selection right now, before it's about to be lost —
   *  call this from a control's onFocus/onPointerDown, BEFORE the browser
   *  moves focus into that control. setSpan() below prefers this snapshot
   *  (and clears it once used) over live window.getSelection(), which by
   *  the time a text <input>'s onBlur/Enter fires no longer points at the
   *  contentEditable at all — focusing any real input collapses it there,
   *  unlike a plain <button> click, which needs no focus to register.
   *
   *  No-ops if the snapshot is still "fresh" from the setSpan() call that
   *  just consumed it — re-clicking the SAME panel field (e.g. correcting a
   *  size from 23 to 29 without touching the canvas in between) fires this
   *  again, but by then window.getSelection() no longer reflects the range
   *  setSpan() just wrote (setSpan deliberately never re-selects into the
   *  contentEditable for a snapshot-driven call — doing so steals focus
   *  back from the panel field mid-edit, corrupting the next keystroke).
   *  Only a genuine new click/selection — which clears the fresh flag
   *  first, see activateLine/onClick/onKeyUp below — earns a re-snapshot. */
  const snapshotSelection = () => {
    if (snapshotFreshRef.current) return
    const span = selectionSpan()
    const pos = caretPosition()
    if (span) {
      snapshotRef.current = { s: span.s, e: span.e }
    } else if (pos) {
      snapshotRef.current = { s: pos, e: pos }
    }
  }

  /** Applies an exclusive mark across every character in the box. Used both
   *  by the explicit whole-box path and by a collapsed-caret panel edit.
   *
   *  An EMPTY box has no characters, so the range is [0, 0) and applyMark
   *  bails on start >= end — picking a size/colour before typing anything
   *  silently did nothing, and the first character came out at the default.
   *  A seeded [0,1) mark does NOT solve it: shiftMarks deliberately pushes a
   *  mark forward (rather than growing it) for an insertion at its start, so
   *  the seed would slide off the very character it was meant to style. The
   *  choice is therefore parked in pendingFormatRef and applied by onInput
   *  once real text exists — the same "pending format at the caret" model
   *  every word processor uses for "pick bold, then type". */
  const applyWholeBox = (kind: MarkKind, value: string) => {
    const fullEnd = linesRef.current.reduce((acc, l) => acc + l.length, 0) + linesRef.current.length - 1
    if (fullEnd <= 0) {
      pendingFormatRef.current = pendingFormatRef.current.filter((p) => p.kind !== kind)
      pendingFormatRef.current.push({ kind, value })
      return
    }
    marksRef.current = applyMark(marksRef.current, 0, fullEnd, kind, value)
  }

  /** Applies an exclusive "pick one value" mark (size/color/font/weight) —
   *  applyMark (lib/text/marks.ts) already clips/replaces any existing mark
   *  of the SAME kind that overlaps the range, so re-picking a value never
   *  stacks (user rule: a later size/color/etc always wins over an earlier
   *  one on the same text). Reselects the applied range afterward so a
   *  follow-up stepper click/swatch pick adjusts the SAME mark instead of
   *  targeting whatever the caret happens to be on. */
  const setSpan = (kind: 'size' | 'color' | 'font' | 'weight' | 'link', value: string, wholeBox = false) => {
    if (wholeBox) {
      applyWholeBox(kind, value)
      rebuildAll()
      commit()
      return
    }
    const snap = snapshotRef.current
    snapshotRef.current = null // one-shot — a stale snapshot from an earlier edit must never silently reapply
    const span = snap ? null : selectionSpan()
    const pos = snap ? null : caretPosition()

    const sLoc = snap ? snap.s : span ? span.s : pos
    const eLoc = snap ? snap.e : span ? span.e : pos

    if (!sLoc || !eLoc) return

    if (sLoc.line !== activeRef.current && sLoc.line >= 0) {
      activateLine(sLoc.line, sLoc.offset)
    }

    const start = lineStart(sLoc.line) + sLoc.offset
    const end = lineStart(eLoc.line) + eLoc.offset

    if (start === end) {
      // Collapsed caret (nothing dragged over) means "apply to the whole
      // box" — Word/Docs behavior for a size/color field with no selection.
      applyWholeBox(kind, value)
      rebuildAll()
      placeCaretAt(sLoc.line, sLoc.offset)
      commit()
      return
    }

    marksRef.current = applyMark(marksRef.current, start, end, kind, value)
    if (sLoc.line === eLoc.line) {
      renderLineDom(sLoc.line)
    } else {
      rebuildAll()
    }

    selectRange(sLoc.line, sLoc.offset, eLoc.line, eLoc.offset)
    if (snap) {
      snapshotRef.current = snap
      snapshotFreshRef.current = true
    }
    commit()
  }

  const prefixLine = (prefix: string) => {
    // Same fix as toggleMark: land on the line the user actually
    // clicked/selected, not whatever line happened to be active already.
    const span = selectionSpan()
    const pos = caretPosition()
    const targetLine = span?.s.line ?? pos?.line ?? activeRef.current
    if (targetLine < 0) return
    if (targetLine !== activeRef.current) {
      const offset = span ? span.s.offset : (pos?.offset ?? (linesRef.current[targetLine] ?? '').length)
      activateLine(targetLine, offset)
    }
    const i = activeRef.current
    const raw = linesRef.current[i] ?? ''
    const { indent, rest } = splitIndent(raw)
    const existing = rest.match(BLOCK_PREFIX_RE)?.[0] ?? ''
    const bare = rest.slice(existing.length)
    // Re-applying the exact same prefix (e.g. clicking Bullet on an already-
    // bulleted line) toggles it off, matching toggleMark's toggle behavior;
    // otherwise the old prefix is replaced, never stacked on top of. The
    // prefix itself is plain text (block type is a per-line attribute, not
    // an inline mark — see marks.ts doc comment), so marks anywhere on this
    // line need to shift by the prefix-length delta.
    const delta = (existing === prefix ? '' : prefix).length - existing.length
    if (delta !== 0) marksRef.current = shiftMarks(marksRef.current, lineStart(i) + indent.length, delta)
    const next = indent + (existing === prefix ? bare : prefix + bare)
    linesRef.current[i] = next
    renderLineDom(i)
    placeCaretAt(i, next.length)
    commit()
  }

  /** Tab/Shift+Tab — adds or removes one INDENT_UNIT of leading whitespace
   *  on every line the current selection touches (a single line for a
   *  collapsed caret, matching how Tab behaves in every code/text editor).
   *  Caret/selection offsets are shifted by each touched line's own applied
   *  delta (0 for a Shift+Tab on an already-unindented line) so indenting
   *  mid-word doesn't jump the caret to the line start. */
  const indentLine = (dir: 1 | -1) => {
    const span = selectionSpan()
    const pos = caretPosition()
    const startLine = span?.s.line ?? pos?.line ?? activeRef.current
    const endLine = span?.e.line ?? startLine
    if (startLine < 0) return

    const deltaForLine = new Map<number, number>()
    for (let i = startLine; i <= endLine; i++) {
      const raw = linesRef.current[i] ?? ''
      const { indent, rest } = splitIndent(raw)
      const nextIndent = dir > 0 ? indent + INDENT_UNIT : indent.slice(INDENT_UNIT.length)
      const delta = nextIndent.length - indent.length
      deltaForLine.set(i, delta)
      if (delta === 0) continue
      marksRef.current = shiftMarks(marksRef.current, lineStart(i), delta)
      linesRef.current[i] = nextIndent + rest
    }

    activeRef.current = -1
    rebuildAll()
    activeRef.current = startLine
    renderLineDom(startLine) // picks up the md-line-active class rebuildAll() just missed (it ran while activeRef was still -1)
    if (span) {
      const sDelta = deltaForLine.get(span.s.line) ?? 0
      const eDelta = deltaForLine.get(span.e.line) ?? 0
      selectRange(span.s.line, Math.max(0, span.s.offset + sDelta), span.e.line, Math.max(0, span.e.offset + eDelta))
    } else if (pos) {
      const delta = deltaForLine.get(pos.line) ?? 0
      placeCaretAt(startLine, Math.max(0, pos.offset + delta))
    }
    commit()
  }

  const start = (initialLine?: number) => {
    snapshotFreshRef.current = false
    rebuildAll()
    const idx = initialLine ?? linesRef.current.length - 1
    activateLine(idx, (linesRef.current[idx] ?? '').length)
    editorRef.current?.focus()
  }

  const syncExternal = (next: string) => {
    snapshotFreshRef.current = false
    const p = parse(next)
    linesRef.current = p.text.split('\n')
    marksRef.current = p.marks
    activeRef.current = -1
    rebuildAll()
  }

  const onInput = () => {
    const idx = activeRef.current
    if (idx < 0) return

    // The browser can restructure the line divs behind our back — an IME
    // commit, autocorrect, a drag-and-drop, or a native multi-line delete
    // that slipped past onKeyDown. When the DOM's line COUNT no longer
    // matches the model, per-line diffing below is meaningless (it would
    // read the wrong div for `idx` and overwrite a good line with a
    // neighbour's text). Rebuild the model from the DOM instead: marks can't
    // be preserved through an edit we never saw, but the user's TEXT is
    // never silently discarded, which is the part that actually matters.
    const container = editorRef.current
    if (container && container.children.length !== linesRef.current.length) {
      const domLines = Array.from(container.children).map((c) => stripCaretHost(c.textContent ?? ''))
      const caret = caretPosition()
      linesRef.current = domLines.length > 0 ? domLines : ['']
      activeRef.current = Math.min(caret?.line ?? idx, linesRef.current.length - 1)
      rebuildAll()
      renderLineDom(activeRef.current)
      if (caret) placeCaretAt(activeRef.current, caret.offset)
      snapshotFreshRef.current = false
      markEmpty()
      commit()
      return
    }

    const el = lineEl(idx)
    // Strip the caret host's zero-width space: it lives in the DOM only to
    // give the caret somewhere real to sit on an empty prefixed line, and
    // must never reach the stored text (typing into the host produces
    // "​Hello" in textContent — the model wants "Hello").
    const nextText = stripCaretHost(el?.textContent ?? '')
    const prevText = linesRef.current[idx] ?? ''
    if (nextText !== prevText) {
      // Diff the two strings at their common prefix/suffix to find the one
      // edit point browsers actually make per keystroke (insert or delete a
      // run of characters at the caret) — enough to keep marks aligned for
      // normal typing; IME composition / multi-point edits fall back to
      // "whole line changed, nothing preserved," same ceiling the old
      // model had for anything beyond a single caret-driven edit.
      let prefixLen = 0
      while (prefixLen < prevText.length && prefixLen < nextText.length && prevText[prefixLen] === nextText[prefixLen]) prefixLen++
      let suffixLen = 0
      while (
        suffixLen < prevText.length - prefixLen &&
        suffixLen < nextText.length - prefixLen &&
        prevText[prevText.length - 1 - suffixLen] === nextText[nextText.length - 1 - suffixLen]
      ) suffixLen++
      const removedLen = prevText.length - prefixLen - suffixLen
      const insertedLen = nextText.length - prefixLen - suffixLen
      const at = lineStart(idx) + prefixLen
      if (removedLen > 0) marksRef.current = shiftMarks(marksRef.current, at, -removedLen)
      if (insertedLen > 0) marksRef.current = shiftMarks(marksRef.current, at, insertedLen)
      linesRef.current[idx] = nextText

      // First real text in a box the user had already picked a size/colour
      // for — apply that choice now that there are characters to carry it.
      if (insertedLen > 0 && pendingFormatRef.current.length > 0) {
        for (const p of pendingFormatRef.current) {
          marksRef.current = applyMark(marksRef.current, at, at + insertedLen, p.kind, p.value)
        }
        pendingFormatRef.current = []
        renderLineDom(idx)
        placeCaretAt(idx, prefixLen + insertedLen)
      }
    }
    snapshotFreshRef.current = false // typing invalidates any pending panel snapshot
    markEmpty()
    commit()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    const idx = activeRef.current
    if (idx < 0) return

    // Common formatting shortcuts — the floating dock is gone, so these (and
    // the panel buttons) are the only way to apply a mark without a menu.
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      toggleMark('bold')
      return
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      toggleMark('italic')
      return
    }
    if (mod && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      toggleMark('underline')
      return
    }
    if (e.key === 'Tab') {
      // Without preventDefault, Tab's default action is to move focus out of
      // the contentEditable entirely (to the next focusable element on the
      // page) — every text/code editor instead uses Tab for indent, which is
      // what's implemented here.
      e.preventDefault()
      indentLine(e.shiftKey ? -1 : 1)
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
      // Carries the split line's indent level forward onto the new line
      // (Tab on one line, Enter, keep typing at the same depth — no need to
      // re-Tab every time) — unless the caret is still INSIDE the leading
      // whitespace itself, where duplicating it would just double-indent.
      const { indent, rest } = splitIndent(raw)
      const listPrefix = continuationPrefix(rest)

      // Enter on a list item that has no body yet ENDS the list instead of
      // adding another empty bullet — the universal editor convention, and
      // the only way to get out of a list without reaching for the mouse.
      if (listPrefix && rest === listPrefix.trigger && at >= indent.length) {
        const removed = raw.length - indent.length
        if (removed > 0) marksRef.current = shiftMarks(marksRef.current, lineStart(idx) + indent.length, -removed)
        linesRef.current[idx] = indent
        renderLineDom(idx)
        placeCaretAt(idx, indent.length)
        commit()
        return
      }

      // Continue the list: the new line opens with the same marker (numbered
      // lists advance). Only when the caret is past the prefix — splitting
      // inside the marker itself means the user is editing the marker, not
      // adding an item.
      const carryPrefix = listPrefix && at >= indent.length + listPrefix.trigger.length ? listPrefix.next : ''
      const carry = at >= indent.length ? indent + carryPrefix : ''
      marksRef.current = shiftMarks(marksRef.current, lineStart(idx) + at, 1) // the new '\n' itself
      if (carry) marksRef.current = shiftMarks(marksRef.current, lineStart(idx) + at + 1, carry.length)
      linesRef.current.splice(idx, 1, raw.slice(0, at), carry + raw.slice(at))
      rebuildAll()
      activeRef.current = idx + 1
      renderLineDom(idx)
      renderLineDom(idx + 1)
      placeCaretAt(idx + 1, carry.length)
      commit()
      return
    }
    if (e.key === 'Backspace') {
      const pos = caretPosition()
      const rawLine = linesRef.current[idx] ?? ''
      const { indent: curIndent, rest: curRest } = splitIndent(rawLine)
      const prefixHere = curRest.match(BLOCK_PREFIX_RE)?.[0] ?? ''

      // Backspace at the end of a block prefix removes the WHOLE prefix, not
      // one character of it. Deleting a single char turns "- " into "-",
      // which no longer matches the bullet pattern, so the line flips from a
      // rendered bullet to a literal dash mid-keystroke — the marker has to
      // behave as one atomic unit, the way it does in every editor.
      if (prefixHere && pos && pos.line === idx && pos.offset === curIndent.length + prefixHere.length) {
        e.preventDefault()
        marksRef.current = shiftMarks(marksRef.current, lineStart(idx) + curIndent.length, -prefixHere.length)
        linesRef.current[idx] = curIndent + curRest.slice(prefixHere.length)
        renderLineDom(idx)
        placeCaretAt(idx, curIndent.length)
        commit()
        return
      }

      // Backspace inside leading indentation removes one whole INDENT_UNIT
      // rather than one space — otherwise unindenting a line takes eight
      // presses and leaves the line in a half-indented state in between.
      if (pos && pos.line === idx && pos.offset > 0 && pos.offset <= curIndent.length) {
        e.preventDefault()
        indentLine(-1)
        return
      }

      if (idx > 0 && pos && pos.line === idx && pos.offset === 0) {
        e.preventDefault()
        const prev = linesRef.current[idx - 1]
        const cur = linesRef.current[idx]
        marksRef.current = shiftMarks(marksRef.current, lineStart(idx) - 1, -1) // the joined '\n'
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
        marksRef.current = shiftMarks(marksRef.current, lineStart(idx) + raw.length, -1) // the joined '\n'
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
    // The canvas also listens for 'paste' on window (components/workspace/
    // canvas.tsx) to turn clipboard text into a NEW text box. preventDefault
    // above does not stop that listener — only this does. canvas.tsx has its
    // own guard too; both exist because either one alone has failed before.
    e.stopPropagation()
    const plainText = e.clipboardData.getData('text/plain')
    const htmlText = e.clipboardData.getData('text/html')
    const span = selectionSpan()
    const pos = caretPosition()
    // Fall back to the last known line rather than bailing: activeRef is
    // transiently -1 during rebuildAll/syncExternal, and returning here after
    // preventDefault() would swallow the paste with no way to retry.
    const idx = activeRef.current >= 0 ? activeRef.current : Math.max(0, linesRef.current.length - 1)
    const at = span?.s ?? pos ?? { line: idx, offset: (linesRef.current[idx] ?? '').length }
    const end = span?.e ?? at
    if (htmlText && htmlText.includes('<')) {
      const stored = htmlToStoredText(htmlText, plainText)
      // Resolve the insert point's ABSOLUTE offset BEFORE replaceRange
      // mutates linesRef — lineStart() afterwards reflects the post-insert
      // line geometry, which lands every pasted mark on the wrong characters
      // for any paste that isn't on the last line.
      const offset = lineStart(at.line) + at.offset
      replaceRange(at, end, stored.text, { commit: stored.marks.length === 0 })
      if (stored.marks.length > 0) {
        for (const m of stored.marks) {
          marksRef.current = applyMark(marksRef.current, m.start + offset, m.end + offset, m.kind, m.value)
        }
        rebuildAll()
        // Restore the caret rebuildAll() just destroyed — it lands at the end
        // of the pasted content, where the user expects to keep typing.
        const endOffset = offset + stored.text.length
        const loc = locate(endOffset)
        activeRef.current = loc.line
        renderLineDom(loc.line)
        placeCaretAt(loc.line, loc.offset)
        commit()
      }
    } else {
      replaceRange(at, end, plainText)
    }
  }

  // Copy needs NO interception anymore: since the DOM never contains
  // delimiter characters (there is no delimiter syntax in this model),
  // native Selection.toString() is already exactly the plain text a copy
  // should produce — the browser's default copy handler is left to run as
  // usual (no onCopy prop wired in the JSX below). The old model needed to
  // intercept copy specifically because its hidden markers were still real
  // (if invisible) text nodes that toString() would include.
  //
  // Cut still needs interception (unlike copy): letting the browser's
  // default cut run would delete the DOM content on its own, bypassing
  // replaceRange entirely and leaving linesRef/marksRef silently out of
  // sync with what's actually on screen (onInput only reacts to the ACTIVE
  // line's own contentEditable input event, not to a cut the browser
  // already performed, and a cut can span multiple lines the way Backspace-
  // on-selection does too). preventDefault, write the selection's plain
  // text to the clipboard ourselves (same value native cut would have
  // used — the DOM has no delimiter characters to worry about, so
  // Selection.toString() is already exactly right), then route the delete
  // through the same replaceRange(..., '') a Backspace-on-selection uses.
  const onCut = (e: React.ClipboardEvent) => {
    const span = selectionSpan()
    if (!span) return
    e.preventDefault()
    e.stopPropagation() // same reason as onPaste — keep the canvas's window listener out of it
    const sel = window.getSelection()
    if (sel) e.clipboardData.setData('text/plain', sel.toString())
    replaceRange(span.s, span.e, '')
  }

  // Any direct click or selection-moving key inside the editor means the
  // user has moved on from whatever range the last snapshot-driven setSpan()
  // touched — the next panel edit needs a real re-snapshot, not the stale
  // one left over from before. See snapshotSelection's doc comment.
  const onClick = () => {
    snapshotFreshRef.current = false
    checkLineSwitch()
  }
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      snapshotFreshRef.current = false
      checkLineSwitch()
    }
  }

  ;(handleRef as React.MutableRefObject<TextEditorHandle | null>).current = { toggleMark, prefixLine, setSpan, snapshotSelection }

  return { start, syncExternal, onInput, onKeyDown, onKeyUp, onClick, onPaste, onCut }
}

// Whole-textbox alignment — the one box-level formatting knob left (see
// TextOptions in inspector.tsx). Everything else (bold, color, size…) is
// selection-scoped now, set via the panel or Ctrl+B/Ctrl+I and stored as
// marks, so there's no floating dock anymore.
const ALIGNS = ['left', 'center', 'right', 'justify'] as const
type Align = (typeof ALIGNS)[number]

/** Shared text editor: live per-line preview while editing, full block-level
 * render otherwise — both paths render through the same marks-aware
 * function (lib/text/render.ts), so there's nothing that can look different
 * between "editing" and "just clicked away." Wraps at box width, grows the
 * box vertically to fit. */
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
  const stored = parse(value)

  const editor = useLiveTextEditor(
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
      if (deleteWhenEmpty && everFocusedRef.current && stored.text.trim() === '')
        removeObjects(pageId, [object.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editing, deleteWhenEmpty, stored.text, pageId, object.id, removeObjects])

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

  const rendered = renderMarkdown(stored.text, stored.marks)
  // Properties → Text → Line spacing (box-level, like Alignment). 1.625
  // matches Tailwind's leading-relaxed, the old fixed value, so unset boxes
  // look unchanged.
  const lineHeight = (object.metadata.lineHeight as number | undefined) ?? 1.625
  // Properties → Typography → Letter spacing, box-level like line height —
  // a percentage of font-size, same convention Figma's field uses.
  const letterSpacingPct = (object.metadata.letterSpacing as number | undefined) ?? 0
  const letterSpacing = letterSpacingPct ? `${letterSpacingPct / 100}em` : undefined

  return (
    <>
      <div className={cn(fillHeight ? 'h-full' : 'shrink-0', 'overflow-hidden', hug ? 'w-max' : 'w-full')} style={textFormatStyle(object)}>
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
            onCut={editor.onCut}
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
            onClick={(e) => {
              // A click on an ALREADY-selected box starts editing directly —
              // select, then click again, same total clicks as a double-
              // click but not timing-dependent (a double-click that lands a
              // beat too slow just reselects instead of entering edit mode,
              // which is what made this feel like it took "a lot of
              // clicks"). The object's first click (not yet selected) still
              // only selects, via the canvas wrapper's own pointerdown —
              // this handler no-ops until selected is already true.
              if (!selected) return
              e.stopPropagation()
              setEditing(true)
              requestAnimationFrame(() => editor.start())
            }}
            onDoubleClick={(e) => {
              // Double click = drop into the live per-line editor, caret at end.
              e.stopPropagation()
              setEditing(true)
              setSelection([object.id])
              requestAnimationFrame(() => editor.start())
            }}
            // Rendered HTML is generated by our own escaping renderer
            // (lib/text/render.ts) — never raw user HTML.
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
        hasFill && cn(!bgIsHex && FILLS[bg as string], 'p-3 hairline shadow-sm')
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
