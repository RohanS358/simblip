// The steps between a drawing and a running circuit, and what to say when one fails.
//
//   1 Recognise   what is drawn (symbols, wires)            lib/sketch/read-sketch.ts
//   2 Describe    the circuit description (IR)              extractCircuit → SketchIR
//   3 Compile     IR → SimScript, lint-gated                lib/sketch/compile.ts
//   4 Build       SimScript → objects on the page           executeSimScript
//   5 Simulate    the circuit engine can solve it           lib/circuit/engine.ts
//
// A failure carries its STEP, so "couldn't recognise this sketch" is never used for a
// circuit that was recognised fine and then failed to compile, build or run.

import type { CompileError } from './compile'
import { buildCircuit, stepCircuit } from '@/lib/circuit/engine'
import type { SceneObject } from '@/lib/scene/types'

export type Step = 'recognise' | 'describe' | 'compile' | 'build' | 'simulate'

export const STEP_NUMBER: Record<Step, number> = { recognise: 1, describe: 2, compile: 3, build: 4, simulate: 5 }
export const STEP_LABEL: Record<Step, string> = {
  recognise: 'Recognise the sketch',
  describe: 'Describe the circuit',
  compile: 'Compile to SimScript',
  build: 'Build it on the page',
  simulate: 'Simulate',
}

export interface StepFailure {
  step: Step
  /** One line: what went wrong, in the person's terms. */
  title: string
  /** The specific reason (an engine or compiler message, or what was found). */
  detail: string
  /** The sketch is still there and nothing was replaced — or, for simulate, the circuit WAS built. */
  built: boolean
}

/** "Step 3 of 5 · Compile to SimScript" */
export const stepLine = (s: Step) => `Step ${STEP_NUMBER[s]} of 5 · ${STEP_LABEL[s]}`

const DESCRIBE_CODES = new Set(['schema', 'unsupported-domain', 'duplicate-node', 'unknown-node', 'bad-edge-kind', 'self-loop'])

/** A compile that did not produce a script: the description (IR) was malformed, or the script was. */
export function failureFromCompile(errors: CompileError[]): StepFailure {
  const first = errors[0]
  const step: Step = first && DESCRIBE_CODES.has(first.code) ? 'describe' : 'compile'
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : ''
  return {
    step,
    built: false,
    title: step === 'describe' ? "The circuit was recognised but its description isn't valid" : 'The circuit was recognised but could not be compiled',
    detail: first ? `${first.message}${first.ref ? ` [${first.ref}]` : ''}${more}` : 'Unknown compile error.',
  }
}

export function failureFromBuild(e: unknown): StepFailure {
  return {
    step: 'build',
    built: false,
    title: 'The circuit compiled but could not be placed on the page',
    detail: e instanceof Error ? e.message : String(e),
  }
}

/**
 * Could the engine run these freshly built objects? Reports the first thing that would
 * make a "Play" show nothing useful. The circuit is already built either way.
 */
export function checkSimulates(objects: SceneObject[]): StepFailure | null {
  const fail = (detail: string): StepFailure => ({ step: 'simulate', built: true, title: 'The circuit was built but cannot run yet', detail })
  let circuit
  try {
    circuit = buildCircuit(objects)
  } catch (e) {
    return fail(`The circuit engine rejected it: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!circuit) return fail('No electrical parts were found among the new objects.')
  const symbols = new Set(circuit.comps.map((c) => c.symbol))
  const hasSource = symbols.has('battery') || symbols.has('ac-source') || circuit.digitalNets.size > 0
  if (!hasSource) return fail('There is no battery or AC source, so nothing drives current. Add one.')

  const uses = new Map<number, number>()
  for (const c of circuit.comps) for (const n of c.nets) uses.set(n, (uses.get(n) ?? 0) + 1)
  for (const w of circuit.wires) uses.set(w.net, (uses.get(w.net) ?? 0) + 1)
  const dangling = circuit.comps.reduce((a, c) => a + c.nets.filter((n) => (uses.get(n) ?? 0) < 2).length, 0)
  if (dangling > 0) return fail(`${dangling} part terminal${dangling > 1 ? 's are' : ' is'} not connected to anything, so the loop is open.`)

  try {
    const byId = Object.fromEntries(objects.map((o) => [o.id, o]))
    for (let i = 0; i < 20; i++) stepCircuit(circuit, 0.001, i * 0.001, byId)
    for (const r of circuit.frame.readings.values()) {
      for (const v of Object.values(r.channels ?? {})) if (!Number.isFinite(v)) return fail('The solver produced values that are not numbers (a short circuit, or sources in a loop).')
    }
  } catch (e) {
    return fail(`The solver failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return null
}
