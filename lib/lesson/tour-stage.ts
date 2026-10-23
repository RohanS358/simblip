'use client'

// The stage for a PAGE TOUR: the lesson walks the student's own page — frames each piece in turn, makes it glow, and
// explains it — without adding anything to the board. Everything a generated lesson draws (sections, notes,
// scenes, summary) is deliberately absent.

import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { play, stop as stopPhysics } from '@/lib/physics/world'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { sleep } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { prefetch } from '@/lib/tts/neural'
import { useTeacher } from '@/lib/teacher/store'
import { frameObjects } from './camera'
import { upcomingLines } from './lines'
import type { Stage } from './player'
import { useLesson } from './store'
import { useTutor } from './tutor-store'
import type { Storyboard } from './storyboard'

export function makeTourStage(sb: Storyboard, pageId: string, isCurrent: () => boolean): Stage {
  const L = () => useLesson.getState()
  const T = () => useTeacher.getState()
  const glow = (ids: string[]) => useTutor.getState().set({ spot: ids })
  const speak = async (text: string) => {
    L().set({ caption: text, spoken: 0 })
    if (T().pose === 'read') T().set({ pose: 'open' })
    await narrator.speak(text, (n) => L().set({ spoken: n }))
    L().set({ spoken: text.length })
    if (T().pose === 'open') T().set({ pose: 'read' })
  }
  return {
    async say(text, instant) { if (!instant) await speak(text) },
    async title(text, sub, instant) {
      if (instant) return
      L().set({ card: { text, sub }, caption: '', spoken: 0 })
      await Promise.all([narrator.speak(text), sleep(1500)])
      L().set({ card: null })
    },
    async scene() {},
    async equation() {},
    async run(seconds) { play(pageId); await sleep(seconds * 1000); stopPhysics() },
    async point(object, text) {
      const o = Object.values(useDocStore.getState().pages[pageId]?.objects ?? {}).find((x) => x.name === object)
      if (o) { glow([o.id]); await frameObjects(pageId, [o.id], () => !isCurrent()) }
      await speak(text)
    },
    async focus(ids, sheet) {
      const target = sheet ?? pageId
      // A slide or sheet other than the one on screen: turn to it first.
      if (target !== pageId || useWorkspaceStore.getState().activeSheetId !== target) {
        if (useWorkspaceStore.getState().nodes && sheet) useWorkspaceStore.getState().setActiveSheet(sheet)
      }
      glow(ids)
      await frameObjects(target, ids, () => !isCurrent())
    },
    async lab() {},
    async code() {},
    async animate() {},
    async ask() { return 0 },
    record() {},
    onBeat(index) {
      L().set({ index })
      prefetch(upcomingLines(sb, index + 1), 1)
    },
    alive: () => isCurrent() && L().active,
    async gate() { while (L().paused && L().active) await new Promise((r) => setTimeout(r, 150)) },
    async finish() { glow([]); stopPhysics() },
  }
}
