import type { SimScriptGenerator } from '@/lib/ai/generate'

/** Resolves whichever generator is live right now (on-device, or the server
 *  fallback). Null result = no model is available to a tool that needs one. */
export type GenerateFn = () => Promise<SimScriptGenerator | null>
