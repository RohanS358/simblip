'use client'

// AI panel. The assistant answers in text and may attach a Simulation JSON
// payload; nothing reaches the canvas until the user clicks "Add to canvas" —
// the AI proposes, the editor imports (docs/architecture.md).

import { useRef, useState } from 'react'
import { Sparkles, Send, X, PlusCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { importSimulation } from '@/lib/ai/import'
import { aiResponseSchema, type SimulationPayload } from '@/lib/ai/schema'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
  simulation?: SimulationPayload
}

export function AiPanel({ pageId }: { pageId: string }) {
  const aiOpen = useWorkspaceStore((s) => s.aiOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = async () => {
    const prompt = input.trim()
    if (!prompt || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: prompt }])
    setBusy(true)
    try {
      const page = useDocStore.getState().pages[pageId]
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          pageContext: {
            variables: (page?.variables ?? []).map((v) => ({ name: v.name, expr: v.expr })),
            objectCount: Object.keys(page?.objects ?? {}).length,
          },
        }),
      })
      if (!res.ok) throw new Error(`AI request failed (${res.status})`)
      const data = aiResponseSchema.parse(await res.json())
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.message, simulation: data.simulation },
      ])
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Something went wrong reaching the AI service. Please try again.' },
      ])
    } finally {
      setBusy(false)
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      )
    }
  }

  const addToCanvas = (payload: SimulationPayload) => {
    // Drop at the center of the current viewport so it lands in view.
    const vp = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
    const drop = {
      x: (window.innerWidth / 2 - vp.x) / vp.zoom - 300,
      y: (window.innerHeight / 2 - vp.y) / vp.zoom - 150,
    }
    importSimulation(pageId, payload, drop)
    togglePanel('ai')
  }

  return (
    <AnimatePresence>
      {aiOpen && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="glass-strong absolute bottom-3 right-3 top-3 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col rounded-2xl"
          aria-label="AI assistant"
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Sparkles className="h-4 w-4 text-[var(--accent-violet)]" />
            <span className="flex-1 text-[13px] font-semibold">Ask SIMBLIP</span>
            <button
              type="button"
              aria-label="Close AI panel"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => togglePanel('ai')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="no-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-2 py-6 text-center">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Ask for explanations or live experiments.
                </p>
                {['Create a pendulum simulation', 'Show resonance in a driven oscillator', 'Simulate projectile motion'].map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      className="block w-full rounded-xl border border-border/70 px-3 py-2 text-left text-[12.5px] text-muted-foreground transition-colors hover:border-[var(--accent-violet)] hover:text-foreground"
                      onClick={() => setInput(s)}
                    >
                      {s}
                    </button>
                  )
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed',
                    m.role === 'user'
                      ? 'bg-[var(--accent-blue)] text-primary-foreground'
                      : 'bg-accent/70 text-foreground'
                  )}
                >
                  {m.content}
                  {m.simulation && (
                    <div className="mt-2 rounded-xl border border-[color-mix(in_oklch,var(--accent-violet)_40%,transparent)] bg-background/50 p-2.5">
                      <p className="text-[12px] font-semibold">{m.simulation.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{m.simulation.explanation}</p>
                      <button
                        type="button"
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-violet)] py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        onClick={() => addToCanvas(m.simulation!)}
                      >
                        <PlusCircle className="h-3.5 w-3.5" /> Add to canvas
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-[12px] text-muted-foreground">Thinking…</p>}
          </div>

          <div className="border-t border-border/60 p-3">
            <div className="flex items-center gap-2 rounded-xl border border-input bg-background/60 px-3 py-2 focus-within:border-[var(--ring)]">
              <input
                aria-label="Ask the AI"
                className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
                placeholder="Explain, solve, or generate a simulation…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                  e.stopPropagation()
                }}
              />
              <button
                type="button"
                aria-label="Send"
                disabled={busy || !input.trim()}
                className="text-[var(--accent-violet)] transition-opacity disabled:opacity-30"
                onClick={send}
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
