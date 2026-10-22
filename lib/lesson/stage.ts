'use client'

// The real Stage: performs beats on the live canvas with the voice, the
// simulation runtime and the learner store. Every canvas change goes through
// the same code a user-initiated action does (place() = the panel's Add button).

import { useDocStore } from '@/lib/store/document'
import { getElement } from '@/lib/physics/world'
import { num } from '@/lib/scene/types'
import { applyParam } from './apply'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { play, stop as stopPhysics } from '@/lib/physics/world'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { sleep, glideTo, canvasToScreen, hideCursor } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { place, safeBounds, sceneAdd } from '@/lib/tools/scene'
import { useLearner } from '@/lib/learning/store'
import { useLesson } from './store'
import type { Stage } from './player'
import type { Storyboard } from './storyboard'

/** One film at a time: starting another (or closing) invalidates the previous run. */
let run = 0
/** Space kept clear along the bottom of the board for the caption bar, controls and tool dock. */
const FRAME_BOTTOM = 340
export const currentRun = () => run
export const bumpRun = () => ++run

export function makeStage(sb: Storyboard, pageId: string, myRun: number): Stage {
  const L = () => useLesson.getState()
  const pageObjects = () => Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
  let eqCount = 0
  const alive = () => run === myRun && L().active
  /** Caption + voice together: the caption writes itself out as the line is spoken. */
  const speak = (text: string) => {
    L().set({ caption: text, spoken: 0 })
    return narrator.speak(text, (n) => L().set({ spoken: n }))
  }

  /** Lowest edge of what is on the page — where the next formula goes. */
  const belowScene = () => {
    const objs = pageObjects()
    const b = safeBounds(pageId)
    return objs.length ? Math.max(...objs.map((o) => o.position.y + o.size.h)) + 24 : b.top + 40
  }

  /** The camera: pan and zoom so everything on the page sits inside the visible board, clear of the
   *  caption bar and the tool dock. Tweened, so the picture glides into frame instead of cutting. */
  const frame = async () => {
    const root = document.querySelector(`[data-canvas-root="${pageId}"]`) as HTMLElement | null
    const objs = pageObjects()
    if (!root || !objs.length) return
    const r = root.getBoundingClientRect()
    // The root runs under the sidebar and panels; the part the student can actually SEE is the
    // inner canvas element, so frame into that, offset from the root's origin.
    const vis = (document.querySelector('[aria-label="Infinite canvas"]') as HTMLElement | null)?.getBoundingClientRect() ?? r
    const offX = vis.left - r.left, offY = vis.top - r.top
    const x1 = Math.min(...objs.map((o) => o.position.x)), y1 = Math.min(...objs.map((o) => o.position.y))
    const x2 = Math.max(...objs.map((o) => o.position.x + o.size.w)), y2 = Math.max(...objs.map((o) => o.position.y + o.size.h))
    const pad = 28, topReserve = 76 /* the page header floats over the board */, bottomReserve = FRAME_BOTTOM
    const availW = Math.max(200, vis.width - pad * 2), availH = Math.max(160, vis.height - bottomReserve - topReserve)
    const zoom = Math.max(0.3, Math.min(1.1, availW / Math.max(1, x2 - x1), availH / Math.max(1, y2 - y1)))
    const target = { zoom, x: offX + pad + (availW - (x2 - x1) * zoom) / 2 - x1 * zoom, y: offY + topReserve + (availH - (y2 - y1) * zoom) / 2 - y1 * zoom }
    const from = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
    const steps = 12
    for (let i = 1; i <= steps && alive(); i++) {
      const t = 1 - Math.pow(1 - i / steps, 3) // ease-out
      useDocStore.getState().setViewport(pageId, { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t, zoom: from.zoom + (target.zoom - from.zoom) * t })
      await sleep(30)
    }
  }
  /** The canvas for a brand-new page mounts a moment after the page opens; placing before it
   *  exists measures a stale viewport and puts the scene off to one side. */
  const canvasReady = async () => {
    if (!document.querySelector('[aria-label="Infinite canvas"]')) return // no board on screen at all (headless): nothing to wait for
    for (let i = 0; i < 40 && !document.querySelector(`[data-canvas-root="${pageId}"]`); i++) await new Promise((r) => setTimeout(r, 75))
  }

  /** Parts of a new scene fade in one after another, bodies before wires, instead of popping in
   *  together. Opacity only: object wrappers are positioned with transforms we must not touch. */
  const drawIn = async (ids: string[]) => {
    await sleep(60) // let React mount the new objects
    const objs = useDocStore.getState().pages[pageId]?.objects ?? {}
    const wire = (id: string) => (objs[id]?.metadata.render === 'connector' || objs[id]?.geometry.kind === 'line' ? 1 : 0)
    const ordered = [...ids].sort((a, b) => wire(a) - wire(b))
    const each = Math.min(160, 1400 / Math.max(1, ordered.length))
    ordered.forEach((id, i) => {
      getElement(id)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: i * each, easing: 'ease-out', fill: 'backwards' })
    })
    await sleep(ordered.length * each + 500)
  }

  return {
    async say(text) {
      await speak(text)
    },
    async title(text, sub) {
      L().set({ card: { text, sub }, caption: '', spoken: 0 })
      await Promise.all([narrator.speak(text), sleep(1600)])
      L().set({ card: null })
    },
    async scene(script, clear, caption) {
      if (clear) {
        stopPhysics()
        const ids = pageObjects().map((o) => o.id)
        if (ids.length) useDocStore.getState().removeObjects(pageId, ids)
        eqCount = 0
      }
      await canvasReady()
      const before = new Set(pageObjects().map((o) => o.id))
      place(pageId, script, { reserveBottom: FRAME_BOTTOM })
      if (caption) L().set({ caption, spoken: caption.length })
      void frame()
      await drawIn(pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id))
    },
    async equation(latex, text) {
      const b = safeBounds(pageId)
      const before = new Set(pageObjects().map((o) => o.id))
      await sceneAdd.run({ component: 'formula', text: latex, x: (b.left + b.right) / 2 - 160, y: belowScene() + eqCount * 8 }, { pageId })
      eqCount++
      void frame()
      const made = pageObjects().find((o) => !before.has(o.id))
      // Written out left to right while it is explained: the formula takes about as long to
      // write as the explanation takes to say, so the two arrive together.
      const spokenMs = text ? ((text.split(' ').length / 150) * 60 * 1000) / Math.max(0.5, useWalkthroughStore.getState().speed) : 0
      const writeMs = Math.round(Math.min(4500, Math.max(1400, spokenMs * 0.8, latex.length * 70)) / Math.max(0.5, useWalkthroughStore.getState().speed))
      if (made) useDocStore.getState().updateObject(pageId, made.id, { parameters: { ...made.parameters, writeMs: num(writeMs) } }, { history: false })
      if (text) await Promise.all([speak(text), sleep(writeMs)])
      else await sleep(writeMs + 400)
      if (made && useDocStore.getState().pages[pageId]?.objects[made.id]) {
        const cur = useDocStore.getState().pages[pageId].objects[made.id]
        const { writeMs: _done, ...rest } = cur.parameters // leave a clean formula behind
        void _done
        useDocStore.getState().updateObject(pageId, made.id, { parameters: rest }, { history: false })
      }
    },
    async run(seconds) {
      play(pageId)
      await sleep(seconds * 1000)
    },
    async point(object, text) {
      const o = pageObjects().find((x) => x.name === object)
      const at = o && canvasToScreen(pageId, { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 })
      await Promise.all([at ? glideTo(at, 900) : Promise.resolve(), speak(text)])
      hideCursor()
    },
    async animate(object, param, from, to, seconds, text) {
      const o = pageObjects().find((x) => x.name === object)
      if (!o) return
      play(pageId)
      if (text) void speak(text)
      const steps = Math.max(8, Math.round(seconds * 12))
      for (let i = 0; i <= steps && alive(); i++) {
        applyParam(pageId, object, param, from + ((to - from) * i) / steps) // the slider thumb really moves
        await sleep((seconds * 1000) / steps)
      }
    },
    ask(beat) {
      return new Promise<number>((resolve) => {
        L().set({ pending: beat, chosen: null, caption: beat.prompt, spoken: beat.prompt.length })
        void narrator.speak(beat.prompt)
        const iv = setInterval(() => {
          const c = L().chosen
          if (c !== null || !alive()) {
            clearInterval(iv)
            L().set({ pending: null })
            resolve(c ?? 0)
          }
        }, 120)
      })
    },
    record(beat, chosen) {
      const learner = useLearner.getState()
      const right = chosen === beat.correct
      learner.record(sb.title, right)
      // A miss becomes a flash card whose deep link reopens this very lesson page.
      if (!right) {
        learner.addCard({
          conceptId: sb.title,
          type: 'predict',
          front: beat.prompt.slice(0, 300),
          back: `${beat.choices[beat.correct]} — ${beat.responses[beat.correct]}`.slice(0, 600),
          link: { pageId },
        })
      }
    },
    onBeat: (index) => L().set({ index }),
    alive,
    async gate() {
      while (L().paused && alive()) await new Promise((r) => setTimeout(r, 150))
    },
  }
}

export const lessonSpeed = () => useWalkthroughStore.getState().speed
