'use client'

// The AI corner bubble (UX masterplan §5/§19): a fixed, always-in-the-same-
// place surface, deliberately off the primary toolbar — AI is a distinct,
// non-deterministic interaction mode, not a placement tool. Drafts only:
// /api/ai returns VERIFIED SimScript and "Add to canvas" (executeSimScript)
// is the only path from draft to page. The response shows the model's
// plain-language rationale AND the script itself, so accepting a draft is a
// worked micro-example the user can read, learn from, and edit before
// committing — which an opaque JSON payload never allowed.

import { useState } from 'react'
import { Sparkles, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDocStore } from '@/lib/store/document'
import { executeSimScript } from '@/lib/scene/simscript'
import type { AiResponse } from '@/lib/ai/schema'
import { cn } from '@/lib/utils'

export function AiBubble({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiResponse | null>(null)

  const submit = async () => {
    const text = prompt.trim()
    if (!text || loading) return
    setLoading(true)
    setResult(null)
    try {
      const page = useDocStore.getState().pages[pageId]
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          pageContext: page
            ? {
                variables: page.variables.map((v) => ({ name: v.name, expr: v.expr })),
                objectCount: Object.keys(page.objects).length,
              }
            : undefined,
        }),
      })
      const data = (await res.json()) as AiResponse
      setResult(data)
    } catch (e) {
      setResult({ message: e instanceof Error ? e.message : 'Request failed.' })
    } finally {
      setLoading(false)
    }
  }

  const addToCanvas = () => {
    if (!result?.script) return
    const v = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
    const origin = { x: -v.x / v.zoom + 320, y: -v.y / v.zoom + 240 }
    try {
      executeSimScript(pageId, result.script, origin)
    } catch (e) {
      // The script passed the verifier, so this is a runtime surprise rather
      // than a known failure mode — surface it instead of failing silently.
      toast.error(e instanceof Error ? e.message : 'Could not run the script.')
      return
    }
    toast.success('Added to canvas')
    setResult(null)
    setPrompt('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Ask AI"
        onClick={() => setOpen(true)}
        className="glass-strong fixed bottom-20 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full text-[var(--accent-violet)] shadow-lg transition-transform hover:scale-105"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    )
  }

  return (
    <div className="glass-strong fixed bottom-20 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-2xl p-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent-violet)]" />
        <span className="flex-1 text-[0.78125rem] font-semibold">Ask AI</span>
        <button
          type="button"
          aria-label="Close"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Textarea
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="A spring-mass system hanging from a fixed point…"
        className="min-h-16 resize-none text-[0.78125rem]"
        disabled={loading}
      />

      {result && (
        <div className="rounded-lg bg-accent/40 p-2 text-[0.71875rem] leading-relaxed">{result.message}</div>
      )}

      {result?.script && (
        // Showing the script is the point, not decoration: SimScript is the
        // app's own language, so a draft doubles as a worked example the user
        // can read and reuse.
        <pre className="max-h-40 overflow-auto rounded-lg bg-card/70 p-2 font-mono text-[0.65625rem] leading-relaxed">
          {result.script}
        </pre>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 flex-1 text-[0.71875rem]"
          onClick={() => void submit()}
          disabled={loading || !prompt.trim()}
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {loading ? 'Building…' : 'Generate'}
        </Button>
        {result?.script && (
          <Button
            size="sm"
            variant="outline"
            className={cn('h-7 text-[0.71875rem]', 'border-[var(--accent-mint)] text-[var(--accent-mint)]')}
            onClick={addToCanvas}
          >
            Add to canvas
          </Button>
        )}
      </div>
    </div>
  )
}
