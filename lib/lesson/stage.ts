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
import { useTeacher } from '@/lib/teacher/store'
import { checkIn } from './tutor'
import { useTutor } from './tutor-store'
import { shouldCheckIn } from './tutor-core'
import { FRAME_BOTTOM, frameObjects } from './camera'
import { boxOf, nextOrigin, sectionTitle, type Section } from './sections'
import type { Stage } from './player'
import type { Storyboard } from './storyboard'

/** One film at a time: starting another (or closing) invalidates the previous run. */
let run = 0
export const currentRun = () => run
export const bumpRun = () => ++run

export function makeStage(sb: Storyboard, pageId: string, myRun: number, from = 0): Stage {
  const L = () => useLesson.getState()
  const pageObjects = () => Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
  let eqCount = 0
  const alive = () => run === myRun && L().active
  /** Caption + voice together: the caption writes itself out as the line is spoken. */
  const T = () => useTeacher.getState()
  const speak = async (text: string) => {
    L().set({ caption: text, spoken: 0 })
    // She gestures while she talks, unless she is already pointing at something.
    if (T().pose === 'read') T().set({ pose: 'open' })
    await narrator.speak(text, (n) => L().set({ spoken: n }))
    L().set({ spoken: text.length }) // a voice that errors out (no TTS here) must not leave the caption unwritten
    if (T().pose === 'open') T().set({ pose: 'read' })
  }
  /** Screen position of the middle of an object — where the teacher points. */
  const screenOf = (id: string) => {
    const o = pageObjects().find((x) => x.id === id)
    return o ? canvasToScreen(pageId, { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 }) : null
  }
  /** Point at something for as long as it takes to say `text`, then lower the arm. */
  const pointAndSay = async (id: string | null, text: string) => {
    const at = id ? screenOf(id) : null
    if (at) T().set({ pose: 'point', aim: at })
    await speak(text)
    if (T().pose === 'point') T().set({ pose: 'read', aim: null })
  }

  // Resuming mid-lesson: the chapter we are in is the last chapter card before `from`.
  let lastTitle = ([...sb.beats.slice(0, from)].reverse().find((b) => b.t === 'title') as { text?: string } | undefined)?.text ?? ''
  const sections = () => L().sections
  const current = (): Section | undefined => sections()[sections().length - 1]
  const objectsOf = (ids: string[]) => pageObjects().filter((o) => ids.includes(o.id))
  /** Lowest edge of the newest section — where the next formula goes. */
  const belowScene = () => {
    const box = boxOf(objectsOf(current()?.ids ?? []))
    return box ? box.y + box.h + 24 : safeBounds(pageId).top + 40
  }
  /** The camera: glide to the newest section so it sits inside the visible board. */
  const frame = () => frameObjects(pageId, current()?.ids ?? null, () => !alive())
  const addToSection = (ids: string[]) => {
    const cur = current()
    if (cur) L().set({ sections: sections().map((s) => (s === cur ? { ...s, ids: [...s.ids, ...ids] } : s)) })
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
    async title(text, sub, instant) {
      lastTitle = text
      if (instant) return
      if (!sections().length) { T().set({ mood: 'happy', pose: 'wave' }); setTimeout(() => { if (T().pose === 'wave') T().set({ pose: 'read' }) }, 1900) }
      L().set({ card: { text, sub }, caption: '', spoken: 0 })
      await Promise.all([narrator.speak(text), sleep(1600)])
      L().set({ card: null })
    },
    async scene(script, clear, caption, opts) {
      stopPhysics() // one simulation runs at a time; the older sections stay, at rest
      await canvasReady()
      const before = new Set(pageObjects().map((o) => o.id))
      const opens = clear || !sections().length
      if (opens) {
        const n = sections().length + 1
        const title = opts?.section ? `${lastTitle || sb.title}: ${opts.section.toLowerCase()}` : lastTitle || sectionTitle(sb.beats, L().index, n)
        const at = nextOrigin(pageObjects(), { x: safeBounds(pageId).left + 40, y: safeBounds(pageId).top + 40 })
        // A heading names the section on the board itself, so a student scrolling back knows what each block is.
        await sceneAdd.run({ component: 'text', text: `## ${n} · ${title.length > 56 ? title.slice(0, 55) + '…' : title}`, x: at.x, y: at.y }, { pageId })
        // place() puts a scene inside the VISIBLE board. Aim the view at the empty space below the
        // heading for the instant it takes to place it, then put the view back exactly as it was —
        // synchronously, so nothing paints in between and the camera move below does the travelling.
        const vp = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
        useDocStore.getState().setViewport(pageId, { zoom: vp.zoom, x: -at.x * vp.zoom, y: -(at.y + 72) * vp.zoom })
        place(pageId, script, { reserveBottom: FRAME_BOTTOM })
        useDocStore.getState().setViewport(pageId, vp)
        const made = pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id)
        L().set({ sections: [...sections(), { id: `s${n}`, title, ids: made, beat: L().index }] })
        eqCount = 0
      } else {
        place(pageId, script, { reserveBottom: FRAME_BOTTOM })
        addToSection(pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id))
      }
      if (caption && !opts?.instant) L().set({ caption, spoken: caption.length })
      if (opts?.instant) return
      void frame()
      await drawIn(pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id))
    },
    async equation(latex, text, instant) {
      const box = boxOf(objectsOf(current()?.ids ?? []))
      const before = new Set(pageObjects().map((o) => o.id))
      await sceneAdd.run({ component: 'formula', text: latex, x: box ? box.x + box.w / 2 - 160 : (safeBounds(pageId).left + safeBounds(pageId).right) / 2 - 160, y: belowScene() + eqCount * 8 }, { pageId })
      eqCount++
      const made = pageObjects().find((o) => !before.has(o.id))
      if (made) addToSection([made.id])
      if (instant) return
      void frame()
      // Written out left to right while it is explained: the formula takes about as long to
      // write as the explanation takes to say, so the two arrive together.
      const spokenMs = text ? ((text.split(' ').length / 150) * 60 * 1000) / Math.max(0.5, useWalkthroughStore.getState().speed) : 0
      const writeMs = Math.round(Math.min(4500, Math.max(1400, spokenMs * 0.8, latex.length * 70)) / Math.max(0.5, useWalkthroughStore.getState().speed))
      if (made) useDocStore.getState().updateObject(pageId, made.id, { parameters: { ...made.parameters, writeMs: num(writeMs) } }, { history: false })
      if (text) await Promise.all([pointAndSay(made?.id ?? null, text), sleep(writeMs)])
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
      await Promise.all([at ? glideTo(at, 900) : Promise.resolve(), pointAndSay(o?.id ?? null, text)])
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
        T().set({ mood: 'curious', pose: 'open' })
        L().set({ pending: beat, chosen: null, caption: beat.prompt, spoken: beat.prompt.length })
        void narrator.speak(beat.prompt)
        const iv = setInterval(() => {
          const c = L().chosen
          if (c !== null || !alive()) {
            clearInterval(iv)
            L().set({ pending: null })
            T().set({ pose: 'read' })
            resolve(c ?? 0)
          }
        }, 120)
      })
    },
    record(beat, chosen) {
      const learner = useLearner.getState()
      const right = chosen === beat.correct
      learner.record(sb.title, right)
      // Her face answers before her words do: delight for a right answer, gentle concern for a miss.
      T().set({ mood: right ? 'excited' : 'concerned' })
      useTutor.getState().set({ missesInRow: right ? 0 : useTutor.getState().missesInRow + 1 })
      setTimeout(() => T().set({ mood: 'happy' }), 4200)
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
    async checkpoint(index) {
      // Her questions are answered by tapping buttons on the board: with no board on screen (a headless
      // run, a test) there is nobody to ask, so she simply carries on.
      if (typeof document === 'undefined' || !document.querySelector('[aria-label="Infinite canvas"]')) return
      const tu = useTutor.getState()
      if (!shouldCheckIn({ beatIsChapter: true, sinceLast: index - tu.lastCheck, missesInRow: tu.missesInRow })) return
      useTutor.getState().set({ lastCheck: index })
      // What was just taught: the narration since the previous chapter card.
      let start = index - 1
      while (start > 0 && sb.beats[start].t !== 'title') start--
      const lines = sb.beats.slice(start, index).flatMap((b) => (b.t === 'say' ? [b.text] : b.t === 'equation' && b.text ? [b.text] : []))
      await checkIn(lines, alive, 'chapter')
    },
    alive,
    async settle() {
      await frame()
    },
    async gate() {
      while (L().paused && alive()) await new Promise((r) => setTimeout(r, 150))
    },
  }
}

export const lessonSpeed = () => useWalkthroughStore.getState().speed
