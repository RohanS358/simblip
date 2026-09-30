'use client'

// Tap-to-pick replacements for <input type="date"|"time">: a month grid for
// dates and a clock dial (hour, then minute) for times. Values stay the plain
// 'YYYY-MM-DD' / 'HH:mm' strings the rest of the calendar already uses.

import { useRef, useState } from 'react'
import { format } from 'date-fns'
import { CalendarDays, Clock } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const TRIGGER = cn(
  'flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-1 text-ui-sm tabular-nums',
  'outline-none transition-colors hover:border-[var(--accent-blue)]/50 focus-visible:border-[var(--accent-blue)]/70'
)

const toDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function DatePicker({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const date = toDate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(TRIGGER, className)} aria-label="Pick date">
        <CalendarDays className="size-3.5 text-muted-foreground" />
        {format(date, 'EEE, d MMM yyyy')}
      </PopoverTrigger>
      <PopoverContent className="z-[200] w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={(d) => {
            if (!d) return
            onChange(format(d, 'yyyy-MM-dd'))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const SIZE = 208
const C = SIZE / 2
const R = 82 // label ring radius

function Dial({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h24, min] = value.split(':').map(Number)
  const [mode, setMode] = useState<'hour' | 'minute'>('hour')
  const pm = h24 >= 12
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const pad = (n: number) => String(n).padStart(2, '0')

  const emit = (h: number, m: number) => onChange(`${pad(h)}:${pad(m)}`)
  const setHour12 = (h12: number) => emit((h12 % 12) + (pm ? 12 : 0), min)
  const setPm = (next: boolean) => emit((h24 % 12) + (next ? 12 : 0), min)

  const pick = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const x = e.clientX - r.left - r.width / 2
    const y = e.clientY - r.top - r.height / 2
    const turn = ((Math.atan2(x, -y) / (2 * Math.PI)) + 1) % 1 // 0 at 12 o'clock, clockwise
    if (mode === 'hour') setHour12(Math.round(turn * 12) % 12)
    else emit(h24, Math.round(turn * 60) % 60)
  }

  const h12 = h24 % 12 || 12
  const handTurn = mode === 'hour' ? (h24 % 12) / 12 : min / 60
  const hx = C + R * Math.sin(handTurn * 2 * Math.PI)
  const hy = C - R * Math.cos(handTurn * 2 * Math.PI)
  const labels = mode === 'hour' ? Array.from({ length: 12 }, (_, i) => i || 12) : Array.from({ length: 12 }, (_, i) => i * 5)

  return (
    <div className="flex flex-col items-center gap-2 p-3">
      <div className="flex items-center gap-1 text-3xl font-semibold tabular-nums">
        <button type="button" onClick={() => setMode('hour')} className={cn('rounded-md px-1.5', mode === 'hour' ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' : 'text-foreground/60')}>
          {pad(h12)}
        </button>
        :
        <button type="button" onClick={() => setMode('minute')} className={cn('rounded-md px-1.5', mode === 'minute' ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' : 'text-foreground/60')}>
          {pad(min)}
        </button>
        <div className="ml-2 flex flex-col text-ui-xs font-medium">
          {([false, true] as const).map((isPm) => (
            <button key={String(isPm)} type="button" onClick={() => setPm(isPm)} className={cn('rounded px-1.5 py-0.5', pm === isPm ? 'bg-[var(--accent-blue)] text-white' : 'text-muted-foreground')}>
              {isPm ? 'PM' : 'AM'}
            </button>
          ))}
        </div>
      </div>
      <svg
        ref={svg}
        width={SIZE}
        height={SIZE}
        className="touch-none select-none rounded-full bg-muted/50"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e)
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => {
          dragging.current = false
          if (mode === 'hour') setMode('minute')
        }}
        role="slider"
        aria-label={mode === 'hour' ? 'Hour' : 'Minute'}
        aria-valuenow={mode === 'hour' ? h12 : min}
      >
        <line x1={C} y1={C} x2={hx} y2={hy} stroke="var(--accent-blue)" strokeWidth={2} />
        <circle cx={C} cy={C} r={3} fill="var(--accent-blue)" />
        <circle cx={hx} cy={hy} r={17} fill="var(--accent-blue)" />
        {labels.map((l, i) => {
          const a = (i / 12) * 2 * Math.PI
          const on = mode === 'hour' ? l === h12 : l === min
          return (
            <text key={l} x={C + R * Math.sin(a)} y={C - R * Math.cos(a)} textAnchor="middle" dominantBaseline="central" className={cn('pointer-events-none text-[13px]', on ? 'fill-white' : 'fill-foreground')}>
              {mode === 'minute' ? pad(l) : l}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

export function TimePicker({
  value,
  onChange,
  className,
  label = 'Pick time',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  label?: string
}) {
  const [h, m] = (value || '09:00').split(':').map(Number)
  return (
    <Popover>
      <PopoverTrigger className={cn(TRIGGER, className)} aria-label={label} title={label}>
        <Clock className="size-3.5 text-muted-foreground" />
        {value ? format(new Date(2000, 0, 1, h, m), 'h:mm a') : '--:--'}
      </PopoverTrigger>
      <PopoverContent className="z-[200] w-auto p-0" align="end">
        <Dial value={value || '09:00'} onChange={onChange} />
      </PopoverContent>
    </Popover>
  )
}
