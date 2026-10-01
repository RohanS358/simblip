'use client'

// Lab card — the one renderer behind every subject package's labs. A palette
// component (lib/scene/factory.ts labComponents) creates one pinned to a single
// engine; the card runs whichever engine its
// `engine` parameter names (lib/steplab/registry.ts), gets back a list of
// frames — plain drawing primitives plus a one-sentence caption — and lets the
// reader step, play or scrub through them. It knows nothing about schedulers,
// caches or automata; every topic lives in a pure engine function.
//
// Self-contained on purpose: the player is the card's OWN (▶ ◀ ⏮ and a
// scrubber). It does not use the canvas transport, so it works identically on
// a board, in a lesson figure, and in a slide, and never competes with a
// physics run for the one runtime clock.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, Pause, Play, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getEngine, runEngine } from '@/lib/steplab/registry'
import { QuickControls } from './steplab-fields'
import { applyAct } from '@/lib/steplab/act'
import { openProperties } from '@/lib/store/sidebar-sections'
import type { Act, Params, Prim, Tone } from '@/lib/steplab/types'
import type { ObjectRendererProps } from './types'

const COLOR: Record<Tone, string> = {
  idle: 'var(--foreground)',
  blue: 'var(--accent-blue)',
  mint: 'var(--accent-mint)',
  amber: 'var(--accent-amber)',
  rose: 'var(--accent-rose)',
  violet: 'var(--accent-violet)',
  dim: 'var(--muted-foreground)',
}
const STROKE = (t: Tone = 'idle') => (t === 'idle' ? 'var(--border)' : COLOR[t])
const FILL = (t: Tone = 'idle', solid?: boolean) =>
  solid && t !== 'idle' ? COLOR[t]
    : t === 'idle' ? 'var(--card)'
    : t === 'dim' ? 'color-mix(in oklch, var(--muted-foreground) 8%, var(--card))'
    : `color-mix(in oklch, ${COLOR[t]} 16%, var(--card))`

/** Arrowhead for the segment (x1,y1)→(x2,y2). */
function head(x1: number, y1: number, x2: number, y2: number, color: string) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const s = 7
  const p = [
    [x2, y2],
    [x2 - s * Math.cos(a - 0.42), y2 - s * Math.sin(a - 0.42)],
    [x2 - s * Math.cos(a + 0.42), y2 - s * Math.sin(a + 0.42)],
  ]
  return <polygon points={p.map((q) => q.join(',')).join(' ')} fill={color} />
}

function PrimView({ p }: { p: Prim }) {
  switch (p.k) {
    case 'rect': {
      const label = p.text
      const fs = Math.max(9, Math.min(13, p.h * 0.42, (p.w / Math.max(1, (label ?? '').length + 1)) * 1.5))
      return (
        <g>
          <rect x={p.x} y={p.y} width={Math.max(0, p.w)} height={Math.max(0, p.h)} rx={p.r ?? 5}
            fill={FILL(p.tone, p.solid)} stroke={STROKE(p.tone)} strokeWidth={p.tone && p.tone !== 'idle' ? 1.5 : 1} />
          {label !== undefined && label !== '' && (
            <text x={p.x + p.w / 2} y={p.y + p.h / 2 + (p.sub ? -1 : fs * 0.36)} textAnchor="middle" fontSize={fs}
              fill="var(--foreground)" style={{ fontFamily: 'var(--font-mono)' }}>{label}</text>
          )}
          {p.sub && (
            <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 11} textAnchor="middle" fontSize={9.5} fill="var(--muted-foreground)"
              style={{ fontFamily: 'var(--font-mono)' }}>{p.sub}</text>
          )}
        </g>
      )
    }
    case 'text':
      return (
        <text x={p.x} y={p.y} textAnchor={p.anchor ?? 'start'} fontSize={p.size ?? 12}
          fontWeight={p.bold ? 700 : 400} fill={COLOR[p.tone ?? 'idle']}
          letterSpacing={(p.size ?? 12) <= 10 && p.bold ? '0.08em' : undefined}
          style={{ fontFamily: p.mono ? 'var(--font-mono)' : 'var(--font-sans)', whiteSpace: 'pre' }}>{p.text}</text>
      )
    case 'line': {
      const c = STROKE(p.tone === 'idle' ? 'dim' : p.tone)
      return (
        <g>
          <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={c} strokeWidth={p.w ?? 1.5}
            strokeDasharray={p.dash ? '5 4' : undefined} strokeLinecap="round" />
          {p.arrow && head(p.x1, p.y1, p.x2, p.y2, c)}
        </g>
      )
    }
    case 'circle':
      return (
        <g>
          <circle cx={p.x} cy={p.y} r={p.r} fill={FILL(p.tone, p.solid)} stroke={STROKE(p.tone)} strokeWidth={p.tone && p.tone !== 'idle' ? 1.5 : 1} />
          {p.double && <circle cx={p.x} cy={p.y} r={Math.max(1, p.r - 4)} fill="none" stroke={STROKE(p.tone)} strokeWidth={1} />}
          {p.text !== undefined && p.text !== '' && (
            <text x={p.x} y={p.y + Math.min(13, p.r * 0.7) * 0.36} textAnchor="middle" fontSize={Math.min(13, p.r * 0.7)}
              fill="var(--foreground)" style={{ fontFamily: 'var(--font-mono)' }}>{p.text}</text>
          )}
        </g>
      )
    case 'poly': {
      const c = STROKE(p.tone === 'idle' ? 'dim' : p.tone)
      const d = p.pts.map((q, i) => `${i ? 'L' : 'M'} ${q[0]} ${q[1]}`).join(' ') + (p.closed ? ' Z' : '')
      const n = p.pts.length
      return (
        <g>
          <path d={d} fill={p.fill ? FILL(p.tone) : 'none'} stroke={c} strokeWidth={p.w ?? 1.5} strokeDasharray={p.dash ? '5 4' : undefined}
            strokeLinejoin="round" strokeLinecap="round" />
          {p.arrow && n >= 2 && head(p.pts[n - 2][0], p.pts[n - 2][1], p.pts[n - 1][0], p.pts[n - 1][1], c)}
        </g>
      )
    }
  }
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

const ACT_HINT: Record<Act['do'], string> = { edit: 'Click to type a value', cycle: 'Click to change', set: 'Click to place here', toggle: 'Click to change', step: 'Click to adjust', char: 'Click to change' }

/** A primitive the student can click. Pointer-down stops here so pressing it
 *  does not start dragging the whole card. */
function ActView({ p, onAct }: { p: Prim & { act: Act }; onAct: (a: Act, el: Element) => void }) {
  return (
    <g role="button" tabIndex={0} className="cursor-pointer outline-none hover:opacity-75 focus-visible:opacity-75" onPointerDown={stop}
      onClick={(e) => { e.stopPropagation(); onAct(p.act, e.currentTarget) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onAct(p.act, e.currentTarget) } }}>
      <title>{('hint' in p.act && p.act.hint) || ACT_HINT[p.act.do]}</title>
      <PrimView p={p} />
    </g>
  )
}

const IconBtn = ({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) => (
  <button
    type="button" aria-label={label} title={label} disabled={disabled}
    onPointerDown={stop} onClick={onClick}
    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
  >{children}</button>
)

export function StepLabObject({ pageId, object, selected }: ObjectRendererProps) {

  // Every string parameter is an engine argument; `engine` picks the engine.
  const params = useMemo(() => {
    const out: Params = {}
    for (const [k, v] of Object.entries(object.parameters)) if (v.kind === 'string') out[k] = v.value
    return out
  }, [object.parameters])
  const key = JSON.stringify(params)
  const result = useMemo(() => runEngine(params), [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const [k, setK] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ms, setMs] = useState(750)
  const [help, setHelp] = useState(false)
  const [editing, setEditing] = useState<{ param: string; value: string; multiline: boolean; box: { left: number; top: number; width: number; height: number } } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const setStringParam = useDocStore((s) => s.setStringParam)
  const total = result.ok ? result.trace.frames.length : 0

  // A new configuration starts from its first frame.
  useEffect(() => { setK(0); setPlaying(false) }, [key])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setK((v) => {
      if (v >= total - 1) { setPlaying(false); return v }
      return v + 1
    }), ms)
    return () => clearInterval(id)
  }, [playing, ms, total])

  const frame = result.ok ? result.trace.frames[Math.min(k, total - 1)] : null
  const engine = result.engine ?? getEngine(params.engine || 'sched')
  const lastRef = useRef(false)
  lastRef.current = k >= total - 1

  const edit = (name: string, value: string) => setStringParam(pageId, object.id, name, value)
  const current = (name: string) => params[name] ?? engine?.params.find((d) => d.name === name)?.def ?? ''
  /** Programs, tables and specs: a code box over the whole picture. */
  const write = (param: string) => {
    const st = stageRef.current
    if (!st) return
    setPlaying(false)
    setEditing({ param, value: current(param), multiline: true, box: { left: 8, top: 8, width: st.clientWidth - 16, height: st.clientHeight - 16 } })
  }
  /** Run what a click on a primitive means: write the parameters, or open an in-place text box. */
  const onAct = (a: Act, el: Element) => {
    if (a.do === 'edit') {
      if (engine?.params.find((d) => d.name === a.param)?.long) return write(a.param)
      const st = stageRef.current?.getBoundingClientRect(), r = el.getBoundingClientRect()
      if (!st) return
      setPlaying(false)
      setEditing({ param: a.param, value: current(a.param), multiline: false, box: { left: r.left - st.left, top: r.top - st.top, width: Math.max(96, r.width), height: Math.max(26, r.height) } })
      return
    }
    const changes = applyAct(a, current)
    if (!changes) return
    pushHistory(pageId)
    for (const c of changes) edit(c.param, c.value)
  }
  const commit = () => {
    if (!editing) return
    if (editing.value !== current(editing.param)) { pushHistory(pageId); edit(editing.param, editing.value) }
    setEditing(null)
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setPlaying(false); setK((v) => Math.min(total - 1, v + 1)) }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setPlaying(false); setK((v) => Math.max(0, v - 1)) }
        else if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (lastRef.current) setK(0); setPlaying((v) => !v) }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {object.name}{engine && !object.name.startsWith(engine.label) ? ` · ${engine.label}` : ''}
        </span>
        {result.ok && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{Math.min(k, total - 1) + 1}/{total}</span>
        )}
        <IconBtn label={help ? 'Hide help' : 'What am I looking at?'} onClick={() => setHelp((v) => !v)}>
          <CircleHelp className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Properties — topic and numbers" onClick={() => { useDocStore.getState().setSelection([object.id]); openProperties() }}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </IconBtn>
      </div>

      {help && engine && (
        <div className="space-y-1 border-b border-border/60 bg-[color-mix(in_oklch,var(--accent-blue)_7%,var(--card))] px-3 py-2 text-[11.5px] leading-relaxed" onPointerDown={stop}>
          <p className="font-semibold">{engine.label}</p>
          <p className="text-muted-foreground">{engine.blurb}</p>
          <p className="text-muted-foreground">Press <b>▶</b> to play, <b>←</b> <b>→</b> (or the arrows) to step one move at a time, drag the slider to jump. The sentence under the picture says what just happened and <em>why</em>. Open <b>Properties</b> (the sliders button) to change the numbers and watch the picture redraw.</p>
        </div>
      )}

      {engine && <QuickControls engine={engine} params={params} onEdit={edit} onFocus={() => pushHistory(pageId)} onWrite={write} />}

      <div ref={stageRef} className="relative min-h-0 flex-1 p-2">
        {result.ok && frame ? (
          <svg viewBox={`0 0 ${result.trace.w} ${result.trace.h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
            role="img" aria-label={`${engine?.label}: ${frame.note}`}>
            {frame.draw.map((p, i) => (p.act ? <ActView key={i} p={p as Prim & { act: Act }} onAct={onAct} /> : <PrimView key={i} p={p} />))}
          </svg>
        ) : (
          <p className="m-auto flex h-full items-center justify-center px-6 text-center text-[12px] leading-relaxed text-[var(--accent-rose)]">
            {result.ok ? '' : result.error}
          </p>
        )}
        {editing && (editing.multiline ? (
          <div className="absolute z-10 flex flex-col overflow-hidden rounded-lg border border-[var(--accent-blue)] bg-background shadow-lg" style={editing.box} onPointerDown={stop}>
            <textarea autoFocus spellCheck={false} value={editing.value} aria-label={`Edit ${editing.param}`}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setEditing(null); else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit() }}
              className="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[12px] leading-relaxed outline-none" />
            <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1 text-[10.5px] text-muted-foreground">
              <span>Ctrl+Enter to run · Esc to cancel</span>
              <span className="flex gap-1">
                <button type="button" onClick={() => setEditing(null)} className="rounded px-2 py-0.5 hover:bg-accent">Cancel</button>
                <button type="button" onClick={commit} className="rounded bg-[var(--accent-blue)] px-2 py-0.5 text-white">Run</button>
              </span>
            </div>
          </div>
        ) : (
          <input autoFocus value={editing.value} aria-label={`Edit ${editing.param}`}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={commit} onPointerDown={stop}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(null) }}
            style={{ left: editing.box.left, top: editing.box.top, width: editing.box.width, height: editing.box.height }}
            className="absolute z-10 rounded-md border border-[var(--accent-blue)] bg-background px-2 font-mono text-[12px] shadow-md outline-none" />
        ))}
      </div>

      <div className="min-h-[34px] border-t border-border/60 px-3 py-1.5 text-[11.5px] leading-snug text-foreground/90">
        {frame?.note}
        {selected && !frame?.note && <span className="text-muted-foreground">Use the controls below.</span>}
        {result.ok && k >= total - 1 && total > 1 && Object.keys(result.trace.summary).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-[var(--accent-amber)]" aria-label="Results">
            {Object.entries(result.trace.summary).filter(([, v]) => v !== '' && String(v).length < 28).slice(0, 5).map(([kk, v]) => <span key={kk}><span className="text-muted-foreground">{kk}</span> {v}</span>)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1" onPointerDown={stop}>
        <IconBtn label="Restart" onClick={() => { setK(0); setPlaying(false) }} disabled={!result.ok || k === 0}><RotateCcw className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn label="Previous step" onClick={() => { setPlaying(false); setK((v) => Math.max(0, v - 1)) }} disabled={!result.ok || k === 0}><ChevronLeft className="h-4 w-4" /></IconBtn>
        <IconBtn label={playing ? 'Pause' : 'Play'} onClick={() => { if (lastRef.current) setK(0); setPlaying((v) => !v) }} disabled={!result.ok}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </IconBtn>
        <IconBtn label="Next step" onClick={() => { setPlaying(false); setK((v) => Math.min(total - 1, v + 1)) }} disabled={!result.ok || k >= total - 1}><ChevronRight className="h-4 w-4" /></IconBtn>
        <input type="range" min={0} max={Math.max(0, total - 1)} value={Math.min(k, Math.max(0, total - 1))}
          onChange={(e) => { setPlaying(false); setK(Number(e.target.value)) }} aria-label="Step"
          className="mx-1 h-1 min-w-0 flex-1 accent-[var(--accent-blue)]" disabled={!result.ok} />
        <select value={ms} onChange={(e) => setMs(Number(e.target.value))} aria-label="Playback speed"
          className="rounded-md border border-border bg-background px-1 py-0.5 text-[10.5px] text-muted-foreground">
          <option value={1400}>0.5×</option><option value={750}>1×</option><option value={350}>2×</option><option value={150}>5×</option>
        </select>
      </div>
    </div>
  )
}
