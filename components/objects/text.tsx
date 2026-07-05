'use client'

// Text block with a Canva-style mini formatting toolbar (shown while
// selected): bold/italic/underline, size, text color and highlighter.
// Formatting is stored as string params on the object, so it undoes,
// saves and AI-imports like everything else. NoteObject reuses both
// the toolbar and the style resolver.

import { useRef, type CSSProperties } from 'react'
import { Bold, Italic, Underline } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getString, type ObjectRendererProps } from './types'
import { cn } from '@/lib/utils'

const TEXT_COLORS: Record<string, string> = {
  default: 'var(--foreground)',
  blue: 'var(--accent-blue)',
  mint: 'var(--accent-mint)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
}

const HIGHLIGHTS: Record<string, string> = {
  none: 'transparent',
  yellow: 'color-mix(in oklch, var(--accent-amber) 32%, transparent)',
  mint: 'color-mix(in oklch, var(--accent-mint) 30%, transparent)',
  blue: 'color-mix(in oklch, var(--accent-blue) 26%, transparent)',
  rose: 'color-mix(in oklch, var(--accent-rose) 26%, transparent)',
}

const SIZES: Record<string, number> = { s: 12, m: 15, l: 20, xl: 28 }

/** Resolve the stored format params into inline styles for the textarea. */
export function textFormatStyle(object: ObjectRendererProps['object']): CSSProperties {
  const color = TEXT_COLORS[getString(object, 'fmtColor')] ?? TEXT_COLORS.default
  const highlight = HIGHLIGHTS[getString(object, 'fmtHighlight')] ?? 'transparent'
  return {
    fontWeight: getString(object, 'fmtBold') ? 700 : undefined,
    fontStyle: getString(object, 'fmtItalic') ? 'italic' : undefined,
    textDecoration: getString(object, 'fmtUnderline') ? 'underline' : undefined,
    fontSize: SIZES[getString(object, 'fmtSize')] ?? SIZES.m,
    color,
    // Highlighter: paint behind the glyph lines only, like a real marker.
    background:
      highlight === 'transparent'
        ? undefined
        : `linear-gradient(${highlight}, ${highlight})`,
    boxDecorationBreak: 'clone',
  }
}

/** Floating toolbar above the object while it's selected. */
export function TextFormatBar({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const get = (n: string) => getString(object, n)
  const set = (n: string, v: string) => setStringParam(pageId, object.id, n, v)
  const toggle = (n: string) => set(n, get(n) ? '' : '1')

  const toggleBtn = (name: string, label: string, Icon: typeof Bold) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={Boolean(get(name))}
      className={cn(
        'rounded-md p-1 transition-colors',
        get(name) ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={() => toggle(name)}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div
      className="glass-strong absolute -top-10 left-0 z-50 flex items-center gap-0.5 rounded-lg px-1.5 py-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {toggleBtn('fmtBold', 'Bold', Bold)}
      {toggleBtn('fmtItalic', 'Italic', Italic)}
      {toggleBtn('fmtUnderline', 'Underline', Underline)}
      <span className="mx-0.5 h-4 w-px bg-border" />
      <select
        aria-label="Text size"
        className="rounded-md bg-transparent px-0.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-foreground"
        value={get('fmtSize') || 'm'}
        onChange={(e) => set('fmtSize', e.target.value)}
      >
        <option value="s">S</option>
        <option value="m">M</option>
        <option value="l">L</option>
        <option value="xl">XL</option>
      </select>
      <span className="mx-0.5 h-4 w-px bg-border" />
      {Object.entries(TEXT_COLORS).map(([name, css]) => (
        <button
          key={name}
          type="button"
          aria-label={`Text color ${name}`}
          className={cn(
            'h-3.5 w-3.5 rounded-full border transition-transform hover:scale-125',
            (get('fmtColor') || 'default') === name ? 'border-[var(--ring)]' : 'border-border/60'
          )}
          style={{ background: css }}
          onClick={() => set('fmtColor', name === 'default' ? '' : name)}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" />
      {Object.entries(HIGHLIGHTS).map(([name, css]) => (
        <button
          key={name}
          type="button"
          aria-label={`Highlight ${name}`}
          className={cn(
            'h-3.5 w-3.5 rounded-[4px] border transition-transform hover:scale-125',
            (get('fmtHighlight') || 'none') === name ? 'border-[var(--ring)]' : 'border-border/60'
          )}
          style={{
            background: name === 'none' ? 'transparent' : css,
            backgroundImage:
              name === 'none'
                ? 'linear-gradient(to top right, transparent 45%, var(--accent-rose) 47%, var(--accent-rose) 53%, transparent 55%)'
                : undefined,
          }}
          onClick={() => set('fmtHighlight', name === 'none' ? '' : name)}
        />
      ))}
    </div>
  )
}

export function TextObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const focusedRef = useRef(false)

  return (
    <div className="relative h-full w-full">
      {selected && <TextFormatBar pageId={pageId} object={object} selected={selected} />}
      <textarea
        aria-label="Text block"
        className="h-full w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground/50"
        style={textFormatStyle(object)}
        placeholder="Type something…"
        value={getString(object, 'text')}
        onFocus={() => {
          if (!focusedRef.current) {
            focusedRef.current = true
            pushHistory(pageId)
          }
        }}
        onBlur={() => (focusedRef.current = false)}
        onChange={(e) => setStringParam(pageId, object.id, 'text', e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
