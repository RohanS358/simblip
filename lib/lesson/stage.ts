'use client'

// The real Stage: performs beats on the live canvas with the voice, the
// simulation runtime and the learner store. Every canvas change goes through
// the same code a user-initiated action does (place() = the panel's Add button).

import { useDocStore } from '@/lib/store/document'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { play, stop as stopPhysics } from '@/lib/physics/world'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { sleep } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { place, safeBounds, sceneAdd } from '@/lib/tools/scene'
import { useLearner } from '@/lib/learning/store'
import { useLesson } from './store'
import type { Stage } from './player'
import type { Storyboard } from './storyboard'

/** One film at a time: starting another (or closing) invalidates the previous run. */
let run = 0
export const currentRun = () => run
export const bumpRun = () => ++run

export function makeStage(sb: Storyboard, pageId: string, myRun: number): Stage {
  const L = () => useLesson.getState()
  const pageObjects = () => Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
  let eqCount = 0
  const alive = () => run === myRun && L().active

  /** Lowest edge of what is on the page — where the next formula goes. */
  const belowScene = () => {
    const objs = pageObjects()
    const b = safeBounds(pageId)
    return objs.length ? Math.max(...objs.map((o) => o.position.y + o.size.h)) + 24 : b.top + 40
  }

  return {
    async say(text) {
      L().set({ caption: text })
      await narrator.speak(text)
    },
    async title(text, sub) {
      L().set({ card: { text, sub }, caption: '' })
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
      place(pageId, script)
      if (caption) L().set({ caption })
      await sleep(900) // let the scene settle on screen before the narrator talks about it
    },
    async equation(latex, text) {
      const b = safeBounds(pageId)
      const r = sceneAdd.run({ component: 'formula', text: latex, x: (b.left + b.right) / 2 - 160, y: belowScene() + eqCount * 8 }, { pageId })
      await r
      eqCount++
      if (text) { L().set({ caption: text }); await narrator.speak(text) } else await sleep(1500)
    },
    async run(seconds) {
      play(pageId)
      await sleep(seconds * 1000)
    },
    ask(beat) {
      return new Promise<number>((resolve) => {
        L().set({ pending: beat, chosen: null, caption: beat.prompt })
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
