'use client'

// The stage for a PAGE TOUR: the lesson walks the student's own page — frames each piece in turn, makes it glow, and
// explains it — without adding anything to the board. Everything a generated lesson draws (sections, notes,
// scenes, summary) is deliberately absent.

import { useDocStore } from '@/lib/store/document'
import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { shiftScene } from '@/lib/scene/simscript'
import { getElement } from '@/lib/physics/world'
import { place } from '@/lib/tools/scene'
import { play, stop as stopPhysics } from '@/lib/physics/world'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { sleep } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { prefetch } from '@/lib/tts/neural'
import { useTeacher } from '@/lib/teacher/store'
import { FRAME_BOTTOM, frameObjects } from './camera'
import { boxOf } from './sections'
import { upcomingLines } from './lines'
import type { Stage } from './player'
import { useLesson } from './store'
import { useTutor } from './tutor-store'
import type { Storyboard } from './storyboard'

/** What earlier tours drew onto each sheet. They stay on the page for the student to read after the tour, and are taken
 *  down when the page is toured again — so teaching the same page twice does not pile pictures on top of each other. */
const drawn = new Map<string, string[]>()
const seen = new Set<string>() // seeking back to a beat must not draw its picture a second time
export function clearTourPictures() {
  for (const [sheet, ids] of drawn) if (useDocStore.getState().pages[sheet]) useDocStore.getState().removeObjects(sheet, ids)
  drawn.clear()
  seen.clear()
}

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
  // Where the thing being explained is: pictures are drawn beside it, on the sheet it lives on.
  let sheet = pageId
  // Pictures stack in a column to the right of the page's own content, per sheet — never on top of it.
  const columns = new Map<string, { x: number; y: number }>()
  let pdfPage = 0
  const kind = () => findPageMeta(useWorkspaceStore.getState().nodes, pageId)?.pageKind
  return {
    async say(text, instant) { if (!instant) await speak(text) },
    async title(text, sub, instant) {
      if (instant) return
      L().set({ card: { text, sub }, caption: '', spoken: 0 })
      await Promise.all([narrator.speak(text), sleep(1500)])
      L().set({ card: null })
    },
    async turn(n) {
      pdfPage = n
      usePdfDockStore.getState().dock?.scrollToPage?.(n)
      await sleep(900)
    },
    // A picture for what is being explained, drawn ONTO the open page (its sheet; a PDF page's ink layer) and left
    // there: it is part of the teaching, undoable like anything the student draws.
    async scene(script, _clear, caption, opts) {
      if (opts?.instant || seen.has(script)) return
      seen.add(script)
      let target = sheet
      if (pdfPage && kind() === 'pdf') {
        target = useWorkspaceStore.getState().ensureAnnotPage(pageId, pdfPage)
        useWorkspaceStore.getState().setActiveSheet(target)
        await sleep(300) // the page's ink layer mounts a moment after it is made
      }
      const before = new Set(Object.keys(useDocStore.getState().pages[target]?.objects ?? {}))
      place(target, script, { reserveBottom: FRAME_BOTTOM })
      const objs = useDocStore.getState().pages[target]?.objects ?? {}
      const made = Object.keys(objs).filter((id) => !before.has(id))
      const picture = boxOf(made.map((id) => objs[id]))
      // A PDF page cannot grow sideways, so there the picture stays where place() put it.
      if (picture && kind() !== 'pdf') {
        const content = boxOf(Object.keys(objs).filter((id) => !made.includes(id)).map((id) => objs[id]))
        if (!columns.has(target) && content) columns.set(target, { x: content.x + content.w + 80, y: content.y })
        const col = columns.get(target)
        if (col) { shiftScene(target, made, col.x - picture.x, col.y - picture.y); col.y += picture.h + 40 }
      }
      drawn.set(target, [...(drawn.get(target) ?? []), ...made])
      if (caption) L().set({ caption, spoken: caption.length })
      glow(made)
      await frameObjects(target, made, () => !isCurrent())
      made.forEach((id, i) => getElement(id)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: Math.min(i * 120, 1200), easing: 'ease-out', fill: 'backwards' }))
      await sleep(Math.min(made.length * 120, 1200) + 500)
    },
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
      sheet = target
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
