// The engine registry. One list, three consumers: the widget's engine picker,
// the SimScript/AI catalogue (lib/ai/simscript-corpus.ts derives from it), and
// the lesson lint gate. Adding a topic = writing an EngineDef and appending it
// here; nothing else changes.

import type { EngineDef, Params, Trace } from './types'
import { LabError } from './types'
import { OS_ENGINES } from './engines/os'
import { COA_ENGINES } from './engines/coa'
import { CPU_ENGINES } from './engines/cpu'
import { NET_ENGINES } from './engines/net'
import { DSA_ENGINES } from './engines/dsa'
import { TOC_ENGINES } from './engines/toc'
import { NUM_ENGINES } from './engines/num'
import { SIM_ENGINES } from './engines/sim'
import { AI_ENGINES } from './engines/ai'
import { GFX_ENGINES } from './engines/gfx'
import { DB_ENGINES } from './engines/db'
import { BLOCK_ENGINES } from './engines/blocks'

export const ENGINES: EngineDef[] = [
  ...OS_ENGINES,
  ...COA_ENGINES,
  ...CPU_ENGINES,
  ...NET_ENGINES,
  ...DSA_ENGINES,
  ...TOC_ENGINES,
  ...NUM_ENGINES,
  ...SIM_ENGINES,
  ...AI_ENGINES,
  ...GFX_ENGINES,
  ...DB_ENGINES,
  ...BLOCK_ENGINES,
]

export const getEngine = (id: string): EngineDef | undefined => ENGINES.find((e) => e.id === id)

export const DEFAULT_ENGINE = 'sched'

export type RunResult = { ok: true; trace: Trace; engine: EngineDef } | { ok: false; error: string; engine?: EngineDef }

/** Params as stored on a SceneObject are every string parameter it carries;
 *  `engine` picks the function and the rest are its arguments. Never throws —
 *  a student editing a field mid-word must see a sentence, not a crash. */
export function runEngine(params: Params): RunResult {
  const id = params.engine || DEFAULT_ENGINE
  const engine = getEngine(id)
  if (!engine) return { ok: false, error: `unknown engine "${id}" — available: ${ENGINES.map((e) => e.id).join(', ')}` }
  // Defaults fill any field the caller left out, so `create("steplab", { engine: "sched" })` runs.
  const merged: Params = {}
  for (const d of engine.params) merged[d.name] = d.def
  const optional = new Set(engine.params.filter((d) => d.optional).map((d) => d.name))
  for (const [k, v] of Object.entries(params)) if (v !== '' || optional.has(k)) merged[k] = v
  try {
    const trace = engine.run(merged)
    return { ok: true, trace, engine }
  } catch (e) {
    if (e instanceof LabError) return { ok: false, error: e.message, engine }
    return { ok: false, error: `${engine.label} could not run: ${(e as Error).message}`, engine }
  }
}
