import { useState, useRef, useEffect } from 'react'
import { Play, Pause, StepBack, StepForward, RotateCcw, GripHorizontal } from 'lucide-react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { useTransportDockStore } from '@/lib/store/transport-dock'
import { cn } from '@/lib/utils'
import { useIsNarrow } from '@/hooks/use-mobile'
import { toast } from 'sonner'

export function HoldableMergedTransport({ pageId }: { pageId: string }) {
  const [holding, setHolding] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setFloating = useTransportDockStore((s) => s.setFloating)
  const setPosition = useTransportDockStore((s) => s.setPosition)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    setHolding(true)
    timerRef.current = setTimeout(() => {
      setHolding(false)
      const posX = Math.max(16, rect.left)
      const posY = Math.max(60, rect.bottom + 12)
      setPosition({ x: posX, y: posY })
      setFloating(true)
      toast.success('Simulation controls detached into a floating pill! Drag to move, or drag to top bar to re-merge.')
    }, 1000)
  }

  const cancelHold = () => {
    setHolding(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return (
    <div
      className="relative flex items-center group cursor-grab active:cursor-grabbing select-none rounded-xl px-1 py-0.5"
      onPointerDown={handlePointerDown}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      title="Hold for 1 second to pop out simulation controls"
    >
      {holding && (
        <div className="absolute inset-0 overflow-hidden rounded-xl border border-[var(--accent-mint)] bg-[var(--accent-mint)]/10">
          <div className="h-full bg-[var(--accent-mint)]/40 transition-all duration-[1000ms] ease-linear w-full origin-left scale-x-100" />
        </div>
      )}
      <Transport pageId={pageId} flat />
    </div>
  )
}

export function FloatingTransport({ pageId }: { pageId: string }) {
  const floating = useTransportDockStore((s) => s.floating)
  const position = useTransportDockStore((s) => s.position)
  const setFloating = useTransportDockStore((s) => s.setFloating)
  const setPosition = useTransportDockStore((s) => s.setPosition)

  const [isNearTop, setIsNearTop] = useState(false)
  const [mounted, setMounted] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !floating || !pageId) return null

  const defaultX = typeof window !== 'undefined' ? Math.max(20, window.innerWidth / 2 - 120) : 200
  const defaultY = 70

  const posX = position?.x ?? defaultX
  const posY = position?.y ?? defaultY

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX,
      posY,
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const newX = Math.max(16, Math.min(window.innerWidth - 240, dragRef.current.posX + dx))
    const newY = Math.max(16, Math.min(window.innerHeight - 80, dragRef.current.posY + dy))

    setIsNearTop(e.clientY < 60)
    setPosition({ x: newX, y: newY })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (e.clientY < 60) {
      setFloating(false)
      setIsNearTop(false)
      toast.info('Simulation controls merged into top bar')
    } else {
      setIsNearTop(false)
    }
  }

  return (
    <AnimatePresence>
      <fm.div
        style={{ left: `${posX}px`, top: `${posY}px` }}
        initial={{ opacity: 0, scale: 0.8, y: -20 }}
        animate={{
          opacity: 1,
          scale: isNearTop ? 0.95 : 1,
          y: 0,
        }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className={cn(
          'fixed z-[60] flex items-center gap-1 rounded-2xl glass-strong p-1.5 shadow-2xl border transition-colors select-none touch-none',
          isNearTop
            ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)]/20 ring-2 ring-[var(--accent-mint)] shadow-[0_0_24px_rgba(16,185,129,0.3)]'
            : 'border-border/60'
        )}
        aria-label="Floating simulation transport"
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex shrink-0 items-center justify-center pl-1 pr-0.5 text-muted-foreground/60 cursor-grab active:cursor-grabbing hover:text-foreground"
          title="Drag handle"
        >
          <GripHorizontal className="h-4 w-4" />
        </div>
        <Transport pageId={pageId} />
      </fm.div>
    </AnimatePresence>
  )
}

export function Transport({ pageId, flat = false }: { pageId: string; flat?: boolean }) {
  const motion = useSpring()
  const mode = useRuntimeStore((s) => s.mode)
  const time = useRuntimeStore((s) => s.time)
  const isPhone = useIsNarrow(767)

  const btnSize = flat ? 'h-7 w-7' : 'h-9 w-9'
  const iconSize = flat ? 'h-3.5 w-3.5' : 'h-4 w-4'

  if (isPhone && mode === 'edit') {
    const playBtn = (
      <button
        type="button"
        aria-label="Play"
        className={cn(
          'flex items-center justify-center rounded-xl text-[var(--accent-mint)] transition-colors hover:bg-accent',
          btnSize
        )}
        onClick={() => play(pageId)}
      >
        <Play className={iconSize} />
      </button>
    )
    if (flat) return playBtn
    return (
      <fm.div
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={motion}
        className="glass-strong rounded-2xl p-1"
        aria-label="Simulation transport"
      >
        {playBtn}
      </fm.div>
    )
  }

  const buttons = (
    <>
      <button
        type="button"
        aria-label={mode === 'running' ? 'Pause' : 'Play'}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className={cn(
          'flex items-center justify-center rounded-xl transition-colors',
          btnSize,
          mode === 'running'
            ? 'bg-[var(--accent-mint)] text-primary-foreground'
            : 'text-[var(--accent-mint)] hover:bg-accent'
        )}
        onClick={() => (mode === 'running' ? pause() : play(pageId))}
      >
        {mode === 'running' ? <Pause className={iconSize} /> : <Play className={iconSize} />}
      </button>
      <button
        type="button"
        aria-label="Step back one frame"
        disabled={mode === 'edit' || mode === 'running'}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={stepBack}
      >
        <StepBack className={iconSize} />
      </button>
      <button
        type="button"
        aria-label="Step one frame"
        disabled={mode === 'running'}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={() => {
          if (mode === 'edit') {
            play(pageId)
            pause()
          }
          stepFrame()
        }}
      >
        <StepForward className={iconSize} />
      </button>
      <button
        type="button"
        aria-label="Reset simulation"
        disabled={mode === 'edit'}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={stop}
      >
        <RotateCcw className={iconSize} />
      </button>
      <div className={cn('mx-1 w-px bg-border', flat ? 'h-4' : 'h-6')} />
      <span
        className={cn(
          'text-right font-mono tabular-nums',
          flat ? 'min-w-14 pr-1 text-[10.5px]' : 'min-w-16 pr-2 text-[11.5px]',
          mode === 'edit' ? 'text-muted-foreground' : 'text-[var(--accent-mint)]'
        )}
      >
        {mode === 'edit' ? 'EDIT' : `${time.toFixed(2)}s`}
      </span>
    </>
  )

  if (flat) return <div className="flex items-center gap-0.5">{buttons}</div>

  return (
    <fm.div
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={motion}
      className={cn(
        'glass-strong flex items-center gap-1 rounded-2xl p-1.5 transition-shadow',
        mode !== 'edit' && 'shadow-[0_0_0_1.5px_var(--accent-mint)]'
      )}
      aria-label="Simulation transport"
    >
      {buttons}
    </fm.div>
  )
}
