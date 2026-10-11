'use client'

// The notebook's end of the MCP bridge (scripts/mcp/simblip-mcp.mjs).
//
// When the user has switched "AI agents" on, this tab dials the local MCP
// server, offers its tool registry, and executes the calls that come back —
// against the same stores a mouse click uses. Nothing is exposed to the
// internet: the socket is 127.0.0.1, and every connection needs the user's
// approval before its first tool runs.
//
// Modes:   off  — never connects
//          read — only tools that observe (effect: 'read')
//          full — everything, each write still one undo step

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { toast } from 'sonner'
import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { activeContext } from './context'
import { listTools, runTool, toolSpecs } from './registry'
import type { ToolResult } from './types'
import './scene'
import './pages'

export type AgentMode = 'off' | 'read' | 'full'
export type BridgeStatus = 'off' | 'searching' | 'waiting' | 'connected'

export const BRIDGE_PORT = 7437

interface BridgeStore {
  mode: AgentMode
  status: BridgeStatus
  /** Calls served this connection, for the settings page. */
  calls: number
  setMode: (m: AgentMode) => void
  set: (p: Partial<Pick<BridgeStore, 'status' | 'calls'>>) => void
}

export const useBridge = create<BridgeStore>()(
  persist(
    (set) => ({
      mode: 'off',
      status: 'off',
      calls: 0,
      setMode: (mode) => set({ mode }),
      set: (p) => set(p),
    }),
    { name: 'simblip-ai-agents', storage: createJSONStorage(() => localStorage), partialize: (s) => ({ mode: s.mode }) }
  )
)

/** Which tools a mode may use. Enforced when a call EXECUTES, not just when
 *  tools are listed — a client that ignores the list must still be stopped. */
export const allowedIn = (mode: AgentMode, effect: string) => mode === 'full' || (mode === 'read' && effect === 'read')

export function visibleSpecs(mode: AgentMode) {
  return toolSpecs().filter((t) => allowedIn(mode, t.effect))
}

/** Execute one bridge call under a mode. Exported for tests. */
export async function serveCall(name: string, args: unknown, mode: AgentMode): Promise<ToolResult> {
  const tool = listTools().find((t) => t.name === name)
  if (!tool) return { ok: false, summary: `Unknown tool "${name}".`, error: 'unknown tool' }
  if (!allowedIn(mode, tool.effect)) {
    return { ok: false, summary: `"${name}" changes the notebook, and AI agents are set to Read only. Ask the user to switch to Full control in Settings → AI assistant.`, error: 'forbidden' }
  }
  return runTool(name, args, activeContext())
}

let socket: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | undefined
let backoff = 2000
let approved = false
let stopped = true

const here = () => {
  const s = useWorkspaceStore.getState()
  return { app: 'simblip', page: findPageMeta(s.nodes, s.activePageId)?.name ?? null }
}

/** Ask once per connection. Resolves true/false; a toast with real buttons,
 *  not a blocking confirm(), so the notebook stays usable while it waits. */
function askApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    const mode = useBridge.getState().mode
    toast('An AI agent wants to use this notebook', {
      description: mode === 'full' ? 'It can read and change your pages. Every change is one Undo.' : 'It can read your pages but not change them.',
      duration: Infinity,
      action: { label: 'Allow', onClick: () => resolve(true) },
      cancel: { label: 'Deny', onClick: () => resolve(false) },
      onDismiss: () => resolve(false),
    })
  })
}

function connect() {
  if (stopped) return
  const { mode } = useBridge.getState()
  if (mode === 'off') return
  useBridge.getState().set({ status: 'searching' })
  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
  } catch {
    return schedule()
  }
  socket = ws
  approved = false
  ws.onopen = () => {
    backoff = 2000
    useBridge.getState().set({ status: 'waiting', calls: 0 })
    ws.send(JSON.stringify({ type: 'hello', info: here(), tools: visibleSpecs(useBridge.getState().mode) }))
  }
  ws.onmessage = async (ev) => {
    let m: { type: string; id: number; name: string; args: unknown }
    try {
      m = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (m.type !== 'call') return
    const reply = (result: ToolResult) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'result', id: m.id, result }))
    if (!approved) {
      approved = await askApproval()
      if (!approved) {
        reply({ ok: false, summary: 'The user denied this connection.', error: 'denied' })
        return ws.close(4001, 'denied')
      }
      useBridge.getState().set({ status: 'connected' })
    }
    const res = await serveCall(m.name, m.args, useBridge.getState().mode)
    useBridge.getState().set({ calls: useBridge.getState().calls + 1 })
    reply(res)
  }
  ws.onclose = () => {
    if (socket === ws) socket = null
    useBridge.getState().set({ status: useBridge.getState().mode === 'off' ? 'off' : 'searching' })
    schedule()
  }
  ws.onerror = () => ws.close()
}

function schedule() {
  clearTimeout(retry)
  if (stopped || useBridge.getState().mode === 'off') return
  // Back off to 30 s: a missing server is the normal state, and every failed
  // attempt is a line in the devtools console.
  retry = setTimeout(connect, backoff)
  backoff = Math.min(backoff * 2, 30_000)
}

export function startBridge() {
  stopped = false
  if (!socket) connect()
}

export function stopBridge() {
  stopped = true
  clearTimeout(retry)
  socket?.close(1000, 'off')
  socket = null
  useBridge.getState().set({ status: 'off' })
}

/** Tell the server the tool list changed (the mode was edited). */
export function refreshBridgeTools() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'tools', tools: visibleSpecs(useBridge.getState().mode) }))
}
