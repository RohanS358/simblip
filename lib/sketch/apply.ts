// Put a reading on the page: the one place "Make it live" is done. The canvas preview button and the tutor's
// sketch.to_scene tool both call these, so a circuit built by either is built the same way, in one undo step,
// and a failure leaves the page exactly as it was.

import { useDocStore } from '@/lib/store/document'
import { executeSimScript } from '@/lib/scene/simscript'
import { verifyScene } from '@/lib/scene/verify-scene'
import { traceRays } from '@/lib/optics/engine'
import { compileGhost, inkOrigin, inkToReplace, type CircuitGhost } from './circuit-ghost'
import { compileMechGhost, mechInkToReplace, mechOrigin, type MechGhost } from './mech-ghost'
import { checkSimulates, failureFromBuild, failureFromCompile, type StepFailure } from './pipeline'

export type ApplyOutcome =
  | {
      ok: true
      /** ids of the objects built */
      built: string[]
      parts: number
      /** What stops it running as drawn, in plain words; null when nothing is wrong. */
      problem: string | null
      /** One line for the person. */
      message: string
    }
  | { ok: false; failure: StepFailure }

/** The sketch (if any is on the page) goes first, so the new circuit sits where it was drawn; if building fails the ink comes back. */
function swapIn(pageId: string, replaceIds: string[], origin: { x: number; y: number }, script: string): { built: string[] } | { failure: StepFailure } {
  const store = useDocStore.getState()
  const live = store.pages[pageId]?.objects ?? {}
  const ids = replaceIds.filter((id) => live[id])
  const removed = ids.map((id) => live[id])
  store.pushHistory(pageId, true)
  if (ids.length) store.removeObjects(pageId, ids)
  const before = new Set(Object.keys(useDocStore.getState().pages[pageId]?.objects ?? {}))
  try {
    executeSimScript(pageId, script, origin)
  } catch (e) {
    for (const o of removed) store.addObject(pageId, o)
    return { failure: failureFromBuild(e) }
  }
  const built = Object.keys(useDocStore.getState().pages[pageId]?.objects ?? {}).filter((id) => !before.has(id))
  if (built.length) useDocStore.getState().setSelection(built)
  return { built }
}

export function applyCircuit(g: CircuitGhost): ApplyOutcome {
  const res = compileGhost(g)
  if (!res.ok) return { ok: false, failure: failureFromCompile(res.errors) }
  // No layout pass: it would dodge unrelated content and drift away from the sketch.
  const o = inkOrigin(g)
  const r = swapIn(g.pageId, inkToReplace(g), { x: o.x - 10, y: o.y - 10 }, res.script)
  if ('failure' in r) return { ok: false, failure: r.failure }
  const live = useDocStore.getState().pages[g.pageId]?.objects ?? {}
  const cant = checkSimulates(r.built.map((id) => live[id]).filter(Boolean))
  const n = g.result.parts.length
  return {
    ok: true,
    built: r.built,
    parts: n,
    problem: cant ? cant.detail : null,
    message: cant ? `Built ${n} parts, but it can't run yet: ${cant.detail}` : `Built a circuit from ${n} parts.`,
  }
}

export function applyMech(g: MechGhost): ApplyOutcome {
  const res = compileMechGhost(g)
  if (!res.ok) return { ok: false, failure: failureFromCompile(res.errors) }
  const r = swapIn(g.pageId, mechInkToReplace(g), mechOrigin(g), res.script)
  if ('failure' in r) return { ok: false, failure: r.failure }
  const now = useDocStore.getState().pages[g.pageId]?.objects ?? {}
  const n = g.ir.nodes.length
  if (g.domain === 'optics') {
    const rays = traceRays(r.built.map((id) => now[id]).filter(Boolean))
    if (!rays.length) {
      const why = r.built.some((id) => now[id]?.behaviors.some((b) => b.type === 'lightSource')) ? 'nothing reaches an optical part' : 'there is no light source'
      return { ok: true, built: r.built, parts: n, problem: `no ray is traced: ${why}`, message: `Built ${n} parts, but no ray is traced: ${why}.` }
    }
    return { ok: true, built: r.built, parts: n, problem: null, message: `Built an optical bench from ${n} parts — the rays are traced live.` }
  }
  const bad = verifyScene(Object.values(now), r.built).issues.find((i) => i.level === 'error')
  return bad
    ? { ok: true, built: r.built, parts: n, problem: bad.message, message: `Built ${n} parts, but it may not run as drawn: ${bad.message}` }
    : { ok: true, built: r.built, parts: n, problem: null, message: `Built a mechanics scene from ${n} parts. Press Play.` }
}
