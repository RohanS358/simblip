'use client'

// Where the assistant runs, and the model that lets it run on THIS device.
//
//   AiEngineStrip       — the one-line status above the composer, and the
//                         invitation to download a model.
//   AiAssistantSettings — Settings → AI assistant: backend, models, agents.
//
// The download is always an explicit button with its size on it. A model is
// 0.4–1.1 GB; nothing here (or in the engine) starts one as a side effect.

import { useEffect, useState } from 'react'
import { Check, Cpu, Download, Loader2, Server, Trash2, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { MODELS, estimateRamMB, type Tier } from '@/lib/ai/engine/catalog'
import { localEngine } from '@/lib/ai/engine/local'
import { useEngine, useEnginePrefs, type Backend } from '@/lib/ai/engine/store'
import { resolveRoute } from '@/lib/ai/transport'
import { useBridge, refreshBridgeTools, BRIDGE_PORT, type AgentMode } from '@/lib/tools/bridge'
import { Choice, ObsidianPrefRow, SettingCard } from './settings-fields'

const size = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`)

// ── Download control (module-level: survives the panel unmounting) ──────────

let downloading: AbortController | null = null

export async function downloadModel(tier: Tier) {
  downloading?.abort()
  const ctl = (downloading = new AbortController())
  useEnginePrefs.getState().setTier(tier)
  try {
    await localEngine.ensure(tier, ctl.signal, true)
    toast.success(`${MODELS[tier].label} model ready — the assistant now runs on this device.`)
  } catch (e) {
    if (!ctl.signal.aborted) toast.error(e instanceof Error ? e.message : 'Download failed.')
  } finally {
    if (downloading === ctl) downloading = null
  }
}

export const cancelDownload = () => downloading?.abort()

// Dev only: lets scripts/ai-e2e.mjs pick a tier without clicking through menus.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  ;(window as unknown as { __ai: unknown }).__ai = { downloadModel, useEngine, useEnginePrefs, localEngine }
}

/** Probe once per page load. Cheap — see LocalEngine.probe. */
function useProbe() {
  const caps = useEngine((s) => s.caps)
  useEffect(() => {
    if (!useEngine.getState().caps) void localEngine.probe()
  }, [])
  return caps
}

/** Where the next request will go — re-renders when the choice or the
 *  downloaded models change. */
export function useRoute() {
  useEnginePrefs((s) => s.backend + s.tier)
  useEngine((s) => s.cached.join())
  return resolveRoute()
}

// ── One model ───────────────────────────────────────────────────────────────

function ModelRow({ tier, recommended }: { tier: Tier; recommended: boolean }) {
  const m = MODELS[tier]
  const { state, tier: current, progress, cached, accel, tps } = useEngine()
  const isCached = cached.includes(tier)
  const busy = current === tier && (state === 'downloading' || state === 'loading')
  const live = current === tier && (state === 'ready' || state === 'generating')
  const preferred = useEnginePrefs((s) => s.tier)

  return (
    <div className="flex flex-col gap-2 pt-3.5 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-ui-md font-medium">
            {m.label}
            {recommended && <span className="rounded-full bg-[color-mix(in_oklch,var(--accent-violet)_16%,transparent)] px-1.5 py-px text-ui-2xs font-semibold text-[var(--accent-violet)]">Recommended</span>}
            {isCached && preferred === tier && <span className="rounded-full bg-[color-mix(in_oklch,var(--accent-mint)_16%,transparent)] px-1.5 py-px text-ui-2xs font-semibold text-[var(--accent-mint)]">In use</span>}
          </p>
          <p className="mt-0.5 text-ui-sm leading-relaxed text-muted-foreground">
            {m.blurb} Download {size(m.sizeMB)}; uses about {(estimateRamMB(m) / 1000).toFixed(1)} GB of memory while loaded.
            {live && accel && ` Running on ${accel === 'webgpu' ? 'your GPU' : 'the CPU'}${tps ? ` at ${tps.toFixed(0)} tokens/s` : ''}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {busy ? (
            <Button size="sm" variant="outline" onClick={cancelDownload}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : isCached ? (
            <>
              {preferred !== tier && (
                <Button size="sm" variant="outline" onClick={() => useEnginePrefs.getState().setTier(tier)}>
                  Use this
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete the ${m.label} model`}
                title="Delete from this device"
                onClick={() => void localEngine.remove(tier)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void downloadModel(tier)}>
              <Download className="h-3.5 w-3.5" /> {size(m.sizeMB)}
            </Button>
          )}
        </div>
      </div>
      {busy && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[var(--accent-violet)] transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="w-24 text-right text-ui-2xs tabular-nums text-muted-foreground">
            {state === 'downloading' ? `${Math.round(progress * m.sizeMB)} / ${m.sizeMB} MB` : 'Loading…'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── The strip above the composer ────────────────────────────────────────────

const INVITE_KEY = 'simblip-ai-device-invite-dismissed'

export function AiEngineStrip() {
  const caps = useProbe()
  const { state, tier, progress, tps, accel, error, prefill } = useEngine()
  const backend = useEnginePrefs((s) => s.backend)
  const cached = useEngine((s) => s.cached)
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(INVITE_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  if (!caps) return null
  const route = resolveRoute()
  const rec = caps.recommended
  const busy = state === 'downloading' || state === 'loading'

  if (busy && tier) {
    const m = MODELS[tier]
    return (
      <div className="mb-1.5 rounded-lg border border-border/60 bg-card/50 p-2">
        <div className="flex items-center justify-between gap-2 text-ui-xs">
          <span className="flex items-center gap-1.5 font-medium">
            <Loader2 className="h-3 w-3 animate-spin" />
            {state === 'downloading' ? `Downloading ${m.label} model` : `Loading ${m.label} model`}
          </span>
          {state === 'downloading' && (
            <button type="button" onClick={cancelDownload} className="text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          )}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[var(--accent-violet)] transition-[width] duration-200" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
        </div>
        <p className="mt-1 text-ui-2xs text-muted-foreground">
          {state === 'downloading' ? `${Math.round(progress * m.sizeMB)} of ${m.sizeMB} MB — one time, then it works offline.` : 'Reading the model into memory…'}
        </p>
      </div>
    )
  }

  if (state === 'error' && error) {
    return (
      <div className="mb-1.5 rounded-lg border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/5 p-2 text-ui-xs">
        <p className="text-[var(--accent-rose)]">{error}</p>
        <button type="button" className="mt-1 font-medium underline-offset-2 hover:underline" onClick={() => tier && void downloadModel(tier)}>
          Try again
        </button>
      </div>
    )
  }

  // No model on this device yet, and this device can run one: offer it.
  if (route.where !== 'device' && rec && backend !== 'server' && !dismissed && cached.length === 0) {
    const m = MODELS[rec]
    return (
      <div className="relative mb-1.5 rounded-lg border border-border/60 bg-[color-mix(in_oklch,var(--accent-violet)_6%,var(--card))] p-2.5">
        <button
          type="button"
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setDismissed(true)
            try { localStorage.setItem(INVITE_KEY, '1') } catch {}
          }}
        >
          <X className="h-3 w-3" />
        </button>
        <p className="flex items-center gap-1.5 pr-4 text-ui-xs font-semibold">
          <Cpu className="h-3.5 w-3.5 text-[var(--accent-violet)]" /> Run the assistant on this device
        </p>
        <p className="mt-0.5 text-ui-xs leading-relaxed text-muted-foreground">
          Private — nothing you type leaves your computer. Works offline. {caps.reason}{!caps.webgpu && ' Answers and quick commands are fast; building a simulation is slow without a GPU, and you can send those to the server one at a time.'}
        </p>
        <Button size="sm" className="mt-2 h-7 gap-1.5 px-2.5 text-ui-xs" onClick={() => void downloadModel(rec)}>
          <Download className="h-3 w-3" /> Download {m.label} · {size(m.sizeMB)}
        </Button>
      </div>
    )
  }

  // Standard on a plain CPU reads a prompt at a crawl. Say so, and offer the fix,
  // instead of leaving the user to wonder whether it hung.
  if (tier === 'standard' && accel === 'cpu' && (state === 'ready' || state === 'generating') && cached.includes('standard')) {
    return (
      <div className="mb-1.5 rounded-lg border border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/5 p-2 text-ui-xs">
        <p className="font-medium">Standard is running on the CPU here</p>
        <p className="mt-0.5 leading-relaxed text-muted-foreground">
          {useEngine.getState().caps?.gpuNote ?? 'No GPU acceleration was found.'} Until then answers will be slow — Lite is much faster on this device.
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <Button size="sm" className="h-6 px-2 text-ui-xs" onClick={() => void downloadModel('lite')}>
            <Download className="h-3 w-3" /> {cached.includes('lite') ? 'Use Lite' : `Get Lite · ${size(MODELS.lite.sizeMB)}`}
          </Button>
          <span className="text-ui-2xs text-muted-foreground">
            {prefill !== null ? `Reading your request… ${Math.round(prefill * 100)}%` : tps ? `${tps.toFixed(1)} tok/s` : ''}
          </span>
        </div>
      </div>
    )
  }

  // Steady state: a quiet status pill that opens the model manager.
  const device = route.where === 'device'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mb-1.5 flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-ui-2xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          title="Where the assistant runs"
        >
          {device ? <Zap className="h-3 w-3 shrink-0 text-[var(--accent-mint)]" /> : <Server className="h-3 w-3 shrink-0" />}
          <span className="truncate">
            {device
              ? `On this device · ${MODELS[route.tier].label}${accel ? ` · ${accel === 'webgpu' ? 'GPU' : 'CPU'}` : ''}${prefill !== null ? ` · reading ${Math.round(prefill * 100)}%` : state === 'generating' && tps ? ` · ${tps.toFixed(0)} tok/s` : state === 'unloaded' ? ' · asleep' : ''}`
              : route.where === 'blocked'
                ? 'On-device model not downloaded'
                : 'Server'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <AiAssistantSettings compact />
      </PopoverContent>
    </Popover>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

const BACKENDS: { id: Backend; label: string }[] = [
  { id: 'auto', label: 'Automatic' },
  { id: 'device', label: 'This device' },
  { id: 'server', label: 'Server' },
]

const AGENT_MODES: { id: AgentMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'read', label: 'Read only' },
  { id: 'full', label: 'Full control' },
]

export function AiAssistantSettings({ compact = false }: { compact?: boolean }) {
  const caps = useProbe()
  const backend = useEnginePrefs((s) => s.backend)
  const setBackend = useEnginePrefs((s) => s.setBackend)
  const { mode, status, calls, setMode } = useBridge()

  const where = (
    <ObsidianPrefRow
      label="Where it runs"
      detail={
        backend === 'server'
          ? 'Requests go to the server. Nothing runs on this device.'
          : backend === 'device'
            ? 'Only on this device. Nothing you type or draw is sent anywhere.'
            : 'On this device once a model is downloaded; otherwise the server.'
      }
    >
      <Choice options={BACKENDS} value={backend} onChange={setBackend} />
    </ObsidianPrefRow>
  )

  const models = (
    <div className="space-y-3.5 divide-y divide-border/30">
      {caps && !caps.recommended && <p className="text-ui-sm text-muted-foreground">{caps.reason} The assistant will use the server.</p>}
      {(Object.keys(MODELS) as Tier[]).map((t) => (
        <ModelRow key={t} tier={t} recommended={caps?.recommended === t} />
      ))}
      {caps && (
        <p className="pt-3 text-ui-2xs leading-relaxed text-muted-foreground">
          This device: {caps.cores} cores, {caps.memGB ? `${caps.memGB} GB memory` : 'memory unknown'}. {caps.gpuNote} Models are kept in this browser and can be deleted any time.
        </p>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="space-y-3">
        {where}
        {models}
      </div>
    )
  }

  const statusText =
    mode === 'off'
      ? 'Off. No agent can reach your notebook.'
      : status === 'connected'
        ? `Connected — ${calls} call${calls === 1 ? '' : 's'} so far.`
        : status === 'waiting'
          ? 'An agent connected and is waiting for your approval (see the notification).'
          : 'Waiting for an agent. Start the SIMBLIP MCP server (below) from your AI tool.'

  return (
    <div className="space-y-4">
      <SettingCard title="Where the assistant runs">{where}</SettingCard>
      <SettingCard title="On-device models">{models}</SettingCard>
      <SettingCard title="AI agents (MCP)">
        <ObsidianPrefRow
          label="Let an AI tool use my notebook"
          detail="Claude Code, Claude Desktop and other MCP clients can look at the open page, build simulations, run and measure them. Only on this computer — the connection never leaves localhost."
        >
          <Choice
            options={AGENT_MODES}
            value={mode}
            onChange={(m) => {
              setMode(m)
              queueMicrotask(refreshBridgeTools)
            }}
          />
        </ObsidianPrefRow>
        <div className="pt-3.5">
          <p className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            {status === 'connected' && <Check className="h-3.5 w-3.5 text-[var(--accent-mint)]" />}
            {statusText}
          </p>
          <p className="mt-2 text-ui-xs font-medium">Add it to Claude Code</p>
          <pre className="mt-1 overflow-x-auto rounded-lg border border-border/60 bg-[var(--card)] p-2 font-mono text-ui-xs">claude mcp add simblip -- node scripts/mcp/simblip-mcp.mjs</pre>
          <p className="mt-1.5 text-ui-2xs leading-relaxed text-muted-foreground">
            Run it from the SIMBLIP project folder. Read only lets an agent look but not touch; Full control lets it change pages — every change is one Undo. Each new connection asks you first. Port {BRIDGE_PORT}.
          </p>
        </div>
      </SettingCard>
    </div>
  )
}

