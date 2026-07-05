'use client'

// Rich text block, Docs/Canva-style: formatting applies to the SELECTED
// range only (bold/italic/underline, size, color, highlighter), stored as
// HTML in the `text` param. The box width is the writing width — text wraps
// there — and the box grows vertically to fit the content (grow-only; the
// user's height acts as a minimum).
//
// Built on contentEditable + execCommand: deprecated on paper, universally
// supported in practice, and the only dependency-free way to get ranged
// formatting. Legacy whole-box fmt* params still render as base styles.

import { useEffect, useRef, type CSSProperties } from 'react'
import { Bold, Italic, Underline } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'
import { cn } from '@/lib/utils'

// Selection palettes: concrete colors because execCommand can't resolve CSS
// vars. Mid-tone values stay readable on light and dark canvases.
const TEXT_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  mint: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  violet: '#8b5cf6',
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: '#fde047',
  mint: '#6ee7b7',
  blue: '#93c5fd',
  rose: '#fda4af',
}

// Legacy S/M/L/XL sizes → execCommand's 1–7 scale.
const SIZES: Record<string, string> = { s: '2', m: '3', l: '5', xl: '7' }

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

/** Stored value → HTML. Old docs hold plain text; render it faithfully. */
function toHtml(value: string): string {
  if (value.includes('<')) return value
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function exec(command: string, arg?: string) {
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, arg)
}

/** Floating toolbar — acts on the current text selection inside the box. */
export function TextFormatBar({ onChanged }: { onChanged: () => void }) {
  // preventDefault on pointerdown keeps the editor's selection alive while
  // clicking toolbar buttons — otherwise the click would collapse it.
  const guard = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const run = (command: string, arg?: string) => {
    exec(command, arg)
    onChanged()
  }

  const btn = (label: string, Icon: typeof Bold, command: string) => (
    <button
      type="button"
      aria-label={label}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onPointerDown={guard}
      onClick={() => run(command)}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div
      className="glass-strong absolute -top-10 left-0 z-50 flex items-center gap-0.5 rounded-lg px-1.5 py-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {btn('Bold', Bold, 'bold')}
      {btn('Italic', Italic, 'italic')}
      {btn('Underline', Underline, 'underline')}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <select
        aria-label="Text size"
        defaultValue="3"
        className="rounded-md bg-transparent px-0.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-foreground"
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => run('fontSize', e.target.value)}
      >
        {Object.entries(SIZES).map(([k, v]) => (
          <option key={k} value={v}>
            {k.toUpperCase()}
          </option>
        ))}
      </select>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Default text color"
        className="h-3.5 w-3.5 rounded-full border border-border/60 bg-[var(--foreground)] transition-transform hover:scale-125"
        onPointerDown={guard}
        onClick={() => run('foreColor', getComputedStyle(document.body).color)}
      />
      {Object.entries(TEXT_COLORS).map(([name, css]) => (
        <button
          key={name}
          type="button"
          aria-label={`Text color ${name}`}
          className="h-3.5 w-3.5 rounded-full border border-border/60 transition-transform hover:scale-125"
          style={{ background: css }}
          onPointerDown={guard}
          onClick={() => run('foreColor', css)}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Remove highlight"
        className="h-3.5 w-3.5 rounded-[4px] border border-border/60 transition-transform hover:scale-125"
        style={{
          backgroundImage:
            'linear-gradient(to top right, transparent 45%, #f43f5e 47%, #f43f5e 53%, transparent 55%)',
        }}
        onPointerDown={guard}
        onClick={() => run('hiliteColor', 'transparent')}
      />
      {Object.entries(HIGHLIGHTS).map(([name, css]) => (
        <button
          key={name}
          type="button"
          aria-label={`Highlight ${name}`}
          className="h-3.5 w-3.5 rounded-[4px] border border-border/60 transition-transform hover:scale-125"
          style={{ background: css }}
          onPointerDown={guard}
          onClick={() => run('hiliteColor', css)}
        />
      ))}
    </div>
  )
}

/** Shared rich editor: wraps at box width, grows the box vertically. */
export function RichTextArea({
  pageId,
  object,
  selected,
  placeholder,
  padY = 0,
  className,
}: ObjectRendererProps & { placeholder: string; padY?: number; className?: string }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const updateObject = useDocStore((s) => s.updateObject)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const ref = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const value = getString(object, 'text')

  // External changes (undo, sync, AI) land in the DOM only while unfocused —
  // never clobber the caret mid-typing.
  useEffect(() => {
    const el = ref.current
    if (el && !focusedRef.current && el.innerHTML !== toHtml(value)) el.innerHTML = toHtml(value)
  }, [value])

  // Grow-only autosize: the width is the writing width; overflowing lines
  // wrap, and the box gets taller so nothing is ever clipped vertically.
  const fit = () => {
    const el = ref.current
    if (!el) return
    const needed = Math.ceil(el.scrollHeight + padY)
    if (needed > object.size.h + 1) {
      updateObject(pageId, object.id, { size: { w: object.size.w, h: needed } })
    }
  }
  useEffect(fit) // content, width and zoom changes all re-measure

  const commit = () => {
    const el = ref.current
    if (!el) return
    setStringParam(pageId, object.id, 'text', el.innerHTML)
    fit()
  }

  return (
    <>
      {selected && <TextFormatBar onChanged={commit} />}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        className={cn(
          'h-full w-full whitespace-pre-wrap break-words leading-relaxed outline-none',
          'empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]',
          className
        )}
        style={textFormatStyle(object)}
        onFocus={() => {
          if (!focusedRef.current) {
            focusedRef.current = true
            pushHistory(pageId)
          }
        }}
        onBlur={() => {
          focusedRef.current = false
          commit()
        }}
        onInput={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </>
  )
}

export function TextObject(props: ObjectRendererProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <RichTextArea {...props} placeholder="Type something…" />
    </div>
  )
}
