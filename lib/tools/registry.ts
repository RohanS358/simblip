// The one list of tools. Adapters (the on-device chat agent, the MCP bridge,
// WebMCP) all read from here, so "what the AI can do" cannot drift between
// them — the failure that once left schema.ts supporting 9 of ~22 kinds.

import { zodToJsonSchema } from 'zod-to-json-schema'
import type { GenerateFn } from './engine-hook'
import { fail, type Tool, type ToolContext, type ToolResult } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools = new Map<string, Tool<any>>()

export function registerTool<I>(tool: Tool<I>): Tool<I> {
  tools.set(tool.name, tool)
  return tool
}

export const listTools = () => [...tools.values()]
export const getTool = (name: string) => tools.get(name)

/** JSON Schema for a tool's arguments. `input` mode: a field that a zod
 *  transform coerces (a model writes 5, the schema stores "5") is advertised
 *  as what the CALLER should send. */
export function toolSchema(tool: Tool): Record<string, unknown> {
  const s = zodToJsonSchema(tool.input, { $refStrategy: 'none', effectStrategy: 'input' }) as Record<string, unknown>
  delete s.$schema
  return s
}

/** What an outside agent sees: name, text, schema — nothing executable. */
export const toolSpecs = () =>
  listTools().map((t) => ({
    name: t.name,
    description: t.help ? `${t.summary}. ${t.help}` : t.summary,
    effect: t.effect,
    inputSchema: toolSchema(t),
  }))

const MAX_SUMMARY = 600

/**
 * Validate, run, never throw. A tool that throws or returns a bad shape must
 * become a normal failure the model can read, not a crashed agent loop.
 */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.get(name)
  if (!tool) return fail(`Unknown tool "${name}". Available: ${[...tools.keys()].join(', ')}`)
  const parsed = tool.input.safeParse(rawArgs ?? {})
  if (!parsed.success) {
    const why = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
      .join('; ')
    return fail(`Bad arguments for ${name} — ${why}`)
  }
  try {
    const res = await tool.run(parsed.data, ctx)
    return res.summary.length > MAX_SUMMARY ? { ...res, summary: res.summary.slice(0, MAX_SUMMARY) + '…' } : res
  } catch (e) {
    return fail(`${name} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// ── The generator tools may use (scene.build) ──────────────────────────────
// Late-bound so this module — and every test of it — never imports an engine.
let generate: GenerateFn | null = null
export const setToolGenerator = (fn: GenerateFn | null) => {
  generate = fn
}
export const toolGenerator = () => generate
