// Run a SimScript through the REAL app (stores, executeSimScript, physics and
// circuit solvers) in Node, and score what comes out (lib/ai/quality/score.ts).
//
//   import { makeEvaluator } from './evaluate.mjs'
//   const evaluate = await makeEvaluator()
//   const r = evaluate('var b = create("battery", {V: 9}); …')   // → Score
//
// Needs --test-force-exit-style teardown: the stores keep timers alive, so
// callers end with process.exit().

import { bundle } from '../../test/bundle.mjs'

export async function makeEvaluator() {
  const m = await bundle(
    `
export { useDocStore } from '@/lib/store/document'
export { executeSimScript } from '@/lib/scene/simscript'
export { verifyScene } from '@/lib/scene/verify-scene'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { autofixSimScript } from '@/lib/ai/simscript-fix'
export { play, stepFrame, stop } from '@/lib/physics/world'
export { readBuffer } from '@/lib/physics/bus'
export { scoreScene, boxOf } from '@/lib/ai/quality/score'
`,
    'quality'
  )
  const { useDocStore, executeSimScript, verifyScene, lintSimScript, autofixSimScript, play, stepFrame, stop, readBuffer, scoreScene } = m
  // The frame a board scene lands in: a typical visible canvas.
  const FRAME = { left: 0, top: 0, right: 1200, bottom: 800 }
  let n = 0

  const evaluate = (script, { frames = 90, rails = true } = {}) => {
    globalThis.__noRails = !rails
    const id = `q${++n}`
    const rt = { lintErrors: [], verifyErrors: [], unstable: false, graphs: [], frames: 0 }
    let lint = lintSimScript(script)
    if (!lint.ok) {
      const fixed = autofixSimScript(lint.cleaned)
      if (fixed.notes.length) lint = lintSimScript(fixed.code)
    }
    rt.lintErrors = lint.errors
    const st = useDocStore.getState()
    st.loadPage(id)
    let objs = []
    try {
      if (lint.ok) {
        executeSimScript(id, lint.cleaned, { x: 200, y: 100 }, { bounds: FRAME, fixedFrame: false })
        objs = Object.values(useDocStore.getState().pages[id].objects)
        rt.verifyErrors = verifyScene(objs).issues.filter((i) => i.level === 'error').map((i) => i.message)
      }
    } catch (e) {
      rt.threw = String(e?.message ?? e).slice(0, 160)
    }

    if (!rt.threw && lint.ok && objs.length) {
      try {
        play(id)
        for (let i = 0; i < frames; i++) stepFrame()
        rt.frames = frames
        let anyCurrent = false
        let sawCircuit = false
        for (const o of objs) {
          const buf = readBuffer(o.id)
          if (!buf || !buf.samples.length) continue
          for (const s of buf.samples) for (const v of Object.values(s.channels)) if (!Number.isFinite(v) || Math.abs(v) > 1e9) rt.unstable = true
          // Only ANALOG parts have a current to speak of; logic gates carry bits.
          if (o.behaviors.some((b) => b.type === 'electricalNode') && buf.samples[0].channels.I !== undefined) {
            sawCircuit = true
            if (buf.samples.some((s) => Math.abs(s.channels.I ?? 0) > 1e-9)) anyCurrent = true
          }
        }
        if (sawCircuit && !anyCurrent) rt.deadCircuit = true
        for (const g of objs.filter((o) => o.geometry.kind === 'graph')) {
          // graph.plot() writes `series` as "objectId:channel; objectId:channel" (and
          // `formulas` for expressions); a graph bound by hand uses sourceId/yChannels.
          const pairs = String(g.parameters.series?.value ?? '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => x.split(':'))
          const src = String(g.parameters.sourceId?.value ?? '')
          for (const c of String(g.parameters.yChannels?.value ?? '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) pairs.push([src, c])
          const live = pairs.some(([oid, ch]) => {
            const buf = readBuffer(oid)
            if (!buf) return false
            const vs = buf.samples.map((s2) => s2.channels[ch]).filter(Number.isFinite)
            return vs.length > 3 && Math.max(...vs) - Math.min(...vs) > 1e-9
          })
          rt.graphs.push({ channel: pairs.map((p) => p.join(':')).join(','), live: live || (pairs.length === 0 && !!g.parameters.formulas) })
        }
      } catch (e) {
        rt.unstable = true
        rt.threw = rt.threw ?? `sim: ${String(e?.message ?? e).slice(0, 120)}`
      } finally {
        try { stop() } catch {}
      }
    }
    const score = scoreScene(objs, rt, FRAME)
    // Free the page: thousands of scenes would otherwise pile up in the store.
    try { st.removeObjects(id, objs.map((o) => o.id)) } catch {}
    return { score, objects: objs.length }
  }
  return evaluate
}
