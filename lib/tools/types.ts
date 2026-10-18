// The tool contract: ONE list of what an AI (on-device chat model, MCP client,
// WebMCP agent) may do in SIMBLIP.
//
// Every tool wraps an action a user can already perform — the same store
// calls a drag or an inspector edit makes — so nothing here is a private way
// to change the canvas, and everything syncs, persists and undoes for free
// (docs/architecture.md: "the AI is only an assistant").

import type { z } from 'zod'

/** read = observes only; write = changes a page (one undo step); run = starts,
 *  stops or steps the simulation. */
export type Effect = 'read' | 'write' | 'run'

export interface ToolContext {
  /** The content page the tool acts on (a board, a doc sheet, a slide). */
  pageId: string | null
  /** Cancels long work (generation) when the user presses Stop. */
  signal?: AbortSignal
}

export interface ToolResult {
  ok: boolean
  /** Short plain-language outcome — what the chat shows and the model reads back. */
  summary: string
  data?: unknown
  /** Why it failed, worded for the MODEL ("unknown id 'x'; ids on this page: …")
   *  so one repair round can fix it. */
  error?: string
}

export interface Tool<I = unknown> {
  /** Dotted and stable — `scene.run`. Never renamed once shipped. */
  name: string
  /** ≤ 12 words. This is all a small model reads about the tool. */
  summary: string
  /** Longer text for MCP clients and humans. Never put in a small-model prompt. */
  help?: string
  effect: Effect
  /** Minimum permission (lib/auth/types.ts), e.g. 'create-assignments'. Enforced in runTool, never left to a prompt. */
  needs?: string
  input: z.ZodType<I>
  /** Words that route a chat request to this tool (see router.ts). */
  keywords?: string[]
  run(args: I, ctx: ToolContext): Promise<ToolResult> | ToolResult
}

export const ok = (summary: string, data?: unknown): ToolResult => ({ ok: true, summary, data })
export const fail = (error: string): ToolResult => ({ ok: false, summary: error, error })

/** Type-preserving constructor — keeps args typed inside run(). */
export const defineTool = <I>(t: Tool<I>): Tool<I> => t
