'use client'

// The real Runner: draws a candidate scene on a hidden scratch page, runs the REAL
// engine, and reports what it measured. This is what stops a lesson from teaching
// something the simulator disagrees with.
//
// The runtime is a singleton (one running page at a time), so preparing a lesson
// stops whatever was running; the film itself plays only after preparation.

import { useDocStore } from '@/lib/store/document'
import { play, stop } from '@/lib/physics/world'
import { readBuffer } from '@/lib/physics/bus'
import { executeSimScript } from '@/lib/scene/simscript'
import { verifyScene } from '@/lib/scene/verify-scene'
import { applyParam } from './apply'
import type { Change, Ground, Runner, SceneObject, Watch } from './director'

const PREFERRED = ['I', 'V', 'P', 'speed', 'x', 'y', 'omega', 'ke', 'angle']
const RUN_MS = 2500
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** Mean of the last quarter of the run: steady readings are steady, noisy ones are not trusted at one instant. */
function settled(objectId: string, channel: string): number | null {
  const buf = readBuffer(objectId)
  if (!buf || buf.samples.length < 4) return null
  const tail = buf.samples.slice(-Math.max(3, Math.floor(buf.samples.length / 4)))
  const vals = tail.map((s) => s.channels[channel]).filter((v) => Number.isFinite(v))
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/** A channel is worth quoting or predicting only if it has SETTLED: a speed read at an arbitrary
 *  instant of a falling ball is noise, and a lesson that quotes it teaches nothing. */
function isSteady(objectId: string, channel: string): boolean {
  const buf = readBuffer(objectId)
  if (!buf || buf.samples.length < 8) return false
  const tail = buf.samples.slice(-Math.max(4, Math.floor(buf.samples.length / 4))).map((x) => x.channels[channel]).filter((v) => Number.isFinite(v))
  if (tail.length < 4) return false
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length
  return Math.max(...tail) - Math.min(...tail) <= 0.04 * Math.max(Math.abs(mean), 1e-9) + 1e-9
}

/** What can be said about a channel: a steady one has a final value; a moving one only has what it
 *  PEAKED at over the run (position channels are skipped — "y.max" in screen coordinates is a trap). */
const PEAKABLE = new Set(['speed', 'ke', 'omega', 'vx', 'vy', 'I', 'V', 'P'])
function options(objectId: string): string[] {
  return (readBuffer(objectId)?.channelNames ?? []).flatMap((c) => (isSteady(objectId, c) ? [c] : PEAKABLE.has(c) ? [`${c}.max`] : []))
}
/** "I" → settled value; "speed.max" → the largest value over the run. */
function valueOf(objectId: string, spec: string): number | null {
  const [channel, stat] = spec.split('.')
  if (stat === 'max' || stat === 'min') {
    const vals = (readBuffer(objectId)?.samples ?? []).map((x) => x.channels[channel]).filter((v) => Number.isFinite(v))
    return vals.length ? (stat === 'max' ? Math.max(...vals) : Math.min(...vals)) : null
  }
  return settled(objectId, channel)
}

export function makeRunner(): Runner {
  const pageId = `lesson-scratch-${Math.random().toString(36).slice(2, 8)}`
  const doc = () => useDocStore.getState()
  const objects = () => Object.values(doc().pages[pageId]?.objects ?? {})

  function draw(script: string): string | null {
    stop()
    doc().loadPage(pageId)
    const old = objects().map((o) => o.id)
    if (old.length) doc().removeObjects(pageId, old)
    try {
      executeSimScript(pageId, script, { x: 120, y: 120 })
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    if (!objects().length) return 'the script drew nothing'
    return verifyScene(objects()).issues.find((i) => i.level === 'error')?.message ?? null
  }

  const catalog = (): SceneObject[] =>
    objects().map((o) => ({
      name: o.name,
      kind: o.geometry.symbol ?? o.geometry.kind,
      params: Object.fromEntries(Object.entries(o.parameters).flatMap(([k, p]) => (p.kind === 'number' && Number.isFinite(p.value) ? [[k, p.value]] : []))),
      channels: options(o.id),
    }))

  return {
    async ground(script): Promise<Ground> {
      const err = draw(script)
      if (err) return { ok: false, error: err, objects: [], readings: [] }
      play(pageId)
      await sleep(RUN_MS)
      const objs = catalog() // channels exist only once the run has produced samples
      const readings: Ground['readings'] = []
      for (const o of objects()) {
        const ch = options(o.id)
        const pick = PREFERRED.map((c) => ch.find((x) => x === c || x === `${c}.max`)).find(Boolean)
        const v = pick ? valueOf(o.id, pick) : null
        if (pick && v !== null) readings.push({ object: o.name, channel: pick, value: v })
      }
      // Instruments first: "the ammeter reads…" is what a student wants quoted.
      readings.sort((a, b) => Number(/meter|probe|scope|sensor/i.test(b.object)) - Number(/meter|probe|scope|sensor/i.test(a.object)))
      stop()
      return { ok: true, objects: objs, readings }
    },

    async experiment(script, change: Change, watch: Watch) {
      const measure = async (apply?: () => void) => {
        if (draw(script)) return null
        apply?.()
        const w = objects().find((o) => o.name === watch.object)
        if (!w) return null
        play(pageId)
        await sleep(RUN_MS)
        const v = valueOf(w.id, watch.channel)
        stop()
        return v
      }
      // Everything every object reports, so we can tell "the change had no effect" (an inert
      // parameter, which must never be taught as physics) from "the watched value stayed put".
      const snapshot = (): Record<string, number> => {
        const out: Record<string, number> = {}
        for (const o of objects()) for (const c of readBuffer(o.id)?.channelNames ?? []) { const v = valueOf(o.id, PEAKABLE.has(c) && !isSteady(o.id, c) ? `${c}.max` : c); if (v !== null) out[`${o.name}.${c}`] = v }
        return out
      }
      const before = await measure()
      const snapBefore = snapshot()
      const target = () => objects().find((o) => o.name === change.object)
      const base = Number((doc().pages[pageId] && target()?.parameters[change.param] as { value?: number } | undefined)?.value ?? NaN)
      const after = await measure(() => void applyParam(pageId, change.object, change.param, change.to))
      const snapAfter = snapshot()
      const moved = Object.keys(snapAfter).some((k) => k in snapBefore && Math.abs(snapAfter[k] - snapBefore[k]) > 0.03 * Math.max(Math.abs(snapBefore[k]), Math.abs(snapAfter[k]), 1e-9))
      return before === null || after === null ? null : { before, after, base: Number.isFinite(base) ? base : 0, moved }
    },
  }
}
