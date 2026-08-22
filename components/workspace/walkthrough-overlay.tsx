'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipForward, X, Volume2, VolumeX, List, HelpCircle, Gauge } from 'lucide-react'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { walkthroughEngine } from '@/lib/walkthrough/walkthrough-engine'
import { WALKTHROUGH_ACTS } from '@/lib/walkthrough/walkthrough-acts'
import { WalkthroughCursor } from './walkthrough-cursor'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function StepHighlightRing() {
  const targetSelector = useWalkthroughStore((s) => s.targetSelector)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!targetSelector) {
      setRect(null)
      return
    }
    const update = () => {
      const el = document.querySelector(targetSelector)
      const r = el?.getBoundingClientRect()
      setRect(r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null)
    }
    update()
    const timer = setInterval(update, 250)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [targetSelector])

  if (!rect) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[90] animate-pulse rounded-xl border-2 border-[var(--accent-blue)] shadow-[0_0_0_8px_color-mix(in_oklch,var(--accent-blue)_30%,transparent)] transition-[left,top,width,height] duration-300 ease-out"
      style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
    />
  )
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5]

export function WalkthroughOverlay() {
  const active = useWalkthroughStore((s) => s.active)
  const paused = useWalkthroughStore((s) => s.paused)
  const muted = useWalkthroughStore((s) => s.muted)
  const speed = useWalkthroughStore((s) => s.speed)
  const setSpeed = useWalkthroughStore((s) => s.setSpeed)
  const subtitles = useWalkthroughStore((s) => s.subtitles)
  const currentActIndex = useWalkthroughStore((s) => s.currentActIndex)
  const toggleMute = useWalkthroughStore((s) => s.toggleMute)

  const currentAct = WALKTHROUGH_ACTS[currentActIndex]

  if (!active) return null

  return (
    <>
      <StepHighlightRing />
      <WalkthroughCursor />

      {/* Bottom Right Container: Subtitles + Control Bar */}
      <div className="fixed bottom-6 right-6 z-[105] flex flex-col items-end gap-3 max-w-md pointer-events-auto">
        {/* Subtitles Bar */}
        <AnimatePresence>
          {subtitles && (
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 10, opacity: 0 }}
              className="glass-strong rounded-2xl px-4 py-3 shadow-2xl border border-border/60 text-left"
            >
              <div className="flex items-center gap-2 mb-1">
                <HelpCircle className="h-3.5 w-3.5 text-[var(--accent-blue)] shrink-0" />
                <span className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {currentAct?.title ?? 'Walkthrough'}
                </span>
              </div>
              <p className="text-ui-lg font-medium leading-relaxed text-foreground">
                {subtitles}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Control Bar Overlay */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass-strong flex items-center gap-1.5 rounded-2xl p-2 shadow-2xl border border-border/60"
        >
          {/* Act Picker Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-ui-xs font-semibold">
                <List className="h-4 w-4 text-[var(--accent-blue)]" />
                <span className="max-w-[120px] truncate">{currentActIndex + 1}/{WALKTHROUGH_ACTS.length} {currentAct?.title.split('.')[1] ?? ''}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 max-h-72 overflow-y-auto">
              {WALKTHROUGH_ACTS.map((act, i) => (
                <DropdownMenuItem
                  key={act.id}
                  onClick={() => walkthroughEngine.jumpToAct(i)}
                  className={cn('text-ui-xs py-2', i === currentActIndex && 'font-bold text-[var(--accent-blue)]')}
                >
                  <span className="truncate">{act.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-px bg-border/60" />

          {/* Speed Selector Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-ui-xs font-semibold" title="Playback Speed">
                <Gauge className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
                <span>{speed}x</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-24 min-w-0">
              {SPEED_OPTIONS.map((spd) => (
                <DropdownMenuItem
                  key={spd}
                  onClick={() => setSpeed(spd)}
                  className={cn('text-ui-xs py-1.5 justify-center', spd === speed && 'font-bold text-[var(--accent-blue)]')}
                >
                  {spd}x {spd === 0.75 ? '(Default)' : ''}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="h-4 w-px bg-border/60" />

          {/* Pause / Play Button */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => (paused ? walkthroughEngine.resume() : walkthroughEngine.pause())}
            title={paused ? 'Resume Walkthrough' : 'Pause Walkthrough'}
          >
            {paused ? <Play className="h-4 w-4 text-[var(--accent-blue)] fill-current" /> : <Pause className="h-4 w-4" />}
          </Button>

          {/* Skip Act Button */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={() => walkthroughEngine.jumpToAct(Math.min(WALKTHROUGH_ACTS.length - 1, currentActIndex + 1))}
            title="Next Act"
          >
            <SkipForward className="h-4 w-4" />
          </Button>

          {/* Mute TTS Toggle */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            onClick={toggleMute}
            title={muted ? 'Unmute Narration' : 'Mute Narration'}
          >
            {muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-[var(--accent-blue)]" />}
          </Button>

          <div className="h-4 w-px bg-border/60" />

          {/* Exit Walkthrough */}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => walkthroughEngine.stop()}
            title="Exit Walkthrough"
          >
            <X className="h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    </>
  )
}
