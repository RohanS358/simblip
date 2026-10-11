'use client'

// WebMCP: the proposed browser API that lets a page publish tools to an agent
// built into the browser. It is a draft — Chrome ships it behind a flag — so
// this is feature-detected and does nothing anywhere else. The registry is the
// stable core; this is only one more adapter over it.

import { activeContext } from './context'
import { listTools, runTool, toolSchema } from './registry'
import { allowedIn, type AgentMode } from './bridge'

interface ModelContext {
  registerTool(t: { name: string; description: string; inputSchema: unknown; execute(args: unknown): Promise<unknown> }): void | { unregister(): void }
}

let handles: { unregister(): void }[] = []

export function registerWebMcp(mode: AgentMode) {
  unregisterWebMcp()
  const mc = (navigator as unknown as { modelContext?: ModelContext }).modelContext
  if (!mc || mode === 'off') return false
  for (const t of listTools().filter((x) => allowedIn(mode, x.effect))) {
    const h = mc.registerTool({
      name: t.name.replace('.', '_'),
      description: t.summary,
      inputSchema: toolSchema(t),
      execute: async (args) => {
        const r = await runTool(t.name, args, activeContext())
        return { content: [{ type: 'text', text: r.summary }], isError: !r.ok }
      },
    })
    if (h) handles.push(h)
  }
  return true
}

export function unregisterWebMcp() {
  for (const h of handles) h.unregister()
  handles = []
}
