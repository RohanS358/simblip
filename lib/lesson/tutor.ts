'use client'

// The teacher listening and answering. Two ways in:
//
//   askAbout(region)   the student circles / selects something, or types a question, at any
//                      moment. The lesson stops where it is, she explains THAT, and the lesson
//                      carries on from the line that was interrupted.
//   checkIn(...)       between chapters (and after two wrong answers in a row) she asks how it is
//                      going and changes pace and depth from the answer.
//
// With the AI server or an on-device model she explains in her own words; with neither she still
// says what the thing is and what it is set to (tutor-core), so asking never gets a blank.

import { useDocStore } from '@/lib/store/document'
import { buildDigest } from '@/lib/ai/page-context'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { canvasToScreen, sleep } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { useTeacher } from '@/lib/teacher/store'
import { bumpRun } from './stage'
import { makeLlm } from './llm'
import { useLesson } from './store'
import { answerChip, cancelChoice, chooseChip, submitQuestion, useTutor, waitForQuestion, type Ring } from './tutor-store'
import { adapt, explainPrompts, fallbackExplain, pickObjects, simplerFromNarration, speakable, type Feel, type Placed, type Rect } from './tutor-core'

export { answerChip, submitQuestion }

const L = () => useLesson.getState()
const TU = () => useTutor.getState()
const T = () => useTeacher.getState()

/** Say a line as the teacher: caption writes itself out to the voice, the mouth follows it. */
export async function tutorSay(text: string, opts: { pose?: 'open' | 'read' } = {}): Promise<void> {
  L().set({ caption: text, spoken: 0, pending: null })
  T().set({ pose: opts.pose ?? 'open' })
  await narrator.speak(text, (n) => L().set({ spoken: n }))
  L().set({ spoken: text.length })
  if (T().pose === 'open') T().set({ pose: 'read' })
}

// ── from the board to objects ───────────────────────────────────────────────

const plain = (v: unknown): number | string | undefined => {
  if (v && typeof v === 'object' && 'value' in v) { const x = (v as { value: unknown }).value; return typeof x === 'boolean' ? (x ? 1 : 0) : (x as number | string) }
  return undefined
}

function placedOnPage(pageId: string): Placed[] {
  return Object.values(useDocStore.getState().pages[pageId]?.objects ?? {}).map((o) => {
    const g = o.geometry as { kind: string; symbol?: string }
    const params: Record<string, number | string> = {}
    for (const [k, v] of Object.entries(o.parameters)) { const x = plain(v); if (x !== undefined) params[k] = x }
    for (const b of o.behaviors) for (const [k, v] of Object.entries(b.params ?? {})) { const x = plain(v); if (x !== undefined && !(k in params)) params[k] = x }
    return { id: o.id, name: o.name, position: o.position, size: o.size, kind: g.kind === 'symbol' && g.symbol ? g.symbol : g.kind, params }
  })
}

/** A screen rectangle → canvas coordinates, through the page's pan and zoom. */
function toCanvas(pageId: string, r: Ring): Rect {
  const root = document.querySelector(`[data-canvas-root="${pageId}"]`) as HTMLElement | null
  const rr = root?.getBoundingClientRect() ?? { left: 0, top: 0 }
  const vp = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  const cx = (sx: number) => (sx - rr.left - vp.x) / vp.zoom, cy = (sy: number) => (sy - rr.top - vp.y) / vp.zoom
  return { left: cx(r.left), top: cy(r.top), right: cx(r.left + r.width), bottom: cy(r.top + r.height) }
}

/** The screen box of a set of objects — the ring drawn round what she is explaining. */
function ringOf(pageId: string, objs: Placed[]): Ring | null {
  if (!objs.length) return null
  const a = canvasToScreen(pageId, { x: Math.min(...objs.map((o) => o.position.x)), y: Math.min(...objs.map((o) => o.position.y)) })
  const b = canvasToScreen(pageId, { x: Math.max(...objs.map((o) => o.position.x + o.size.w)), y: Math.max(...objs.map((o) => o.position.y + o.size.h)) })
  return a && b ? { left: a.x - 8, top: a.y - 8, width: b.x - a.x + 16, height: b.y - a.y + 16 } : null
}

// ── explaining ──────────────────────────────────────────────────────────────

/** Ask the model (server or on-device); on any failure, return null so the caller falls back. */
async function viaModel(system: string, user: string): Promise<string | null> {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 22_000)
    const text = await makeLlm().complete(system, user, { signal: ac.signal })
    clearTimeout(t)
    const s = speakable(text)
    return s.length > 8 ? s : null
  } catch {
    return null
  }
}

const sectionOf = () => { const s = L().sections; return s[s.length - 1]?.title ?? L().storyboard?.title ?? '' }

async function explain(mode: 'what' | 'simpler' | 'more' | 'answer', objs: Placed[], question?: string): Promise<string> {
  const pageId = L().pageId
  const page = pageId ? useDocStore.getState().pages[pageId] : undefined
  const ids = objs.map((o) => o.id)
  const thing = page && ids.length ? buildDigest({ ...page, objects: Object.fromEntries(ids.filter((i) => page.objects[i]).map((i) => [i, page.objects[i]])) }, ids).text : ''
  const { system, user } = explainPrompts({ depth: TU().pace.depth, lesson: L().storyboard?.title ?? '', section: sectionOf(), saying: L().caption, thing, question, mode })
  return (await viaModel(system, user)) ?? (mode === 'answer' && question ? `Good question. ${fallbackExplain(objs)}` : fallbackExplain(objs))
}

// ── interrupting ────────────────────────────────────────────────────────────

/** Stop the film where it is — its sections stay on the board — and remember the beat. */
function interrupt() {
  if (TU().resumeAt === null) TU().set({ resumeAt: L().index })
  bumpRun() // ends the running performance; the board is left exactly as it is
  narrator.stop()
  L().set({ paused: false, pending: null })
  T().set({ mood: 'thinking', pose: 'think', aim: null })
}

/** The student circled `region` (screen px) and/or typed a question. Explain it, then offer
 *  to carry on. `resume` replays the interrupted beat (injected: the controller owns playback). */
export async function askAbout(region: Ring | null, resume: (index: number) => void, question?: string): Promise<void> {
  const pageId = L().pageId
  if (!pageId || !L().active) return
  interrupt()
  TU().set({ mode: 'thinking', typing: false })
  let objs: Placed[] = []
  if (region) {
    objs = pickObjects(placedOnPage(pageId), toCanvas(pageId, region))
    TU().set({ ring: ringOf(pageId, objs) ?? region })
    const c = { x: region.left + region.width / 2, y: region.top + region.height / 2 }
    T().set({ pose: 'point', aim: c })
  } else {
    // No circle: if the student has something selected on the board, that is what they mean.
    const sel = useDocStore.getState().selection
    const all = placedOnPage(pageId)
    objs = sel.length ? all.filter((o) => sel.includes(o.id)) : []
    if (objs.length) TU().set({ ring: ringOf(pageId, objs) })
  }
  L().set({ caption: question ? 'Let me think about that…' : 'Let me look at that…', spoken: 99 })
  await sleep(250)

  let mode: 'what' | 'answer' | 'simpler' | 'more' = question ? 'answer' : 'what'
  let q = question
  for (;;) {
    TU().set({ mode: 'thinking' })
    const said = await explain(mode, objs, q)
    TU().set({ mode: 'answering' })
    await tutorSay(said, { pose: T().pose === 'point' ? 'read' : 'open' })
    T().set({ aim: null, mood: 'happy' })
    const pick = await chooseChip(
      [{ id: 'go', label: 'Got it — carry on' }, { id: 'simpler', label: 'Simpler, please' }, { id: 'more', label: 'Tell me more' }, { id: 'ask', label: 'Ask something else' }],
      'go',
      60_000
    )
    if (pick === 'simpler') { mode = 'simpler'; q = undefined; useTutor.getState().set({ pace: adapt(TU().pace, 'tough').pace }); continue }
    if (pick === 'more') { mode = 'more'; q = undefined; continue }
    if (pick === 'ask') {
      await tutorSay('Of course. What would you like to know?', { pose: 'open' })
      const text = await waitForQuestion()
      if (!text) break
      q = text; mode = 'answer'
      continue
    }
    break
  }
  finishInterruption(resume)
}

/** Take the ring down and carry on from the line that was interrupted. */
export function finishInterruption(resume: (index: number) => void) {
  const at = TU().resumeAt
  TU().set({ ring: null, mode: 'idle', chips: [], typing: false, resumeAt: null })
  T().set({ pose: 'read', aim: null, mood: 'happy' })
  useWalkthroughStore.getState().setSpeed(TU().pace.speed)
  if (at !== null && L().active) resume(at)
}

/** The student closed the lesson mid-answer. */
export function abandonTutor() {
  cancelChoice()
  useTutor.getState().set({ ring: null, mode: 'idle', resumeAt: null })
}

// ── checking in ─────────────────────────────────────────────────────────────

/** Ask how it is going and adapt. `lines` is what was just taught (to say again, differently, if asked). */
export async function checkIn(lines: string[], alive: () => boolean, why: 'chapter' | 'misses' = 'chapter'): Promise<void> {
  TU().set({ mode: 'checkin' })
  T().set({ mood: why === 'misses' ? 'sympathetic' : 'curious', pose: 'palm' })
  await tutorSay(why === 'misses' ? "That one's a tricky one. How are you finding it so far?" : 'How is that going so far?', { pose: 'open' })
  const pick = (await chooseChip(
    [{ id: 'got-it', label: 'Clear' }, { id: 'tough', label: 'A bit tough' }, { id: 'easy', label: 'Too easy' }, { id: 'again', label: 'Say it again' }],
    'got-it'
  )) as Feel
  if (!alive()) return
  const r = adapt(TU().pace, pick)
  TU().set({ pace: r.pace, missesInRow: 0 })
  useWalkthroughStore.getState().setSpeed(r.pace.speed)
  T().set(pick === 'tough' ? { mood: 'sympathetic', pose: 'open' } : pick === 'easy' ? { mood: 'proud', pose: 'thumb' } : pick === 'again' ? { mood: 'happy', pose: 'open' } : { mood: 'happy', pose: 'thumb' })
  await tutorSay(r.line, { pose: 'open' })
  if (r.reexplain && alive()) {
    TU().set({ mode: 'thinking' })
    const { system, user } = explainPrompts({ depth: r.pace.depth, lesson: L().storyboard?.title ?? '', section: sectionOf(), saying: lines.join(' '), thing: '', mode: 'simpler' })
    const said = (await viaModel(system, user)) ?? simplerFromNarration(lines)
    await tutorSay(said, { pose: 'open' })
  }
  T().set({ mood: 'happy', pose: 'read' })
  TU().set({ mode: 'idle' })
}

/** The student wants to ask something without pointing at anything. */
export async function askQuestion(resume: (index: number) => void): Promise<void> {
  if (!L().pageId || !L().active) return
  interrupt()
  TU().set({ mode: 'thinking' })
  await tutorSay('Of course. What would you like to know?', { pose: 'open' })
  const text = await waitForQuestion()
  if (!text) return finishInterruption(resume)
  await askAbout(null, resume, text)
}
