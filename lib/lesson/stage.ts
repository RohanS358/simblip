'use client'

// The real Stage: performs beats on the live canvas with the voice, the
// simulation runtime and the learner store. Every canvas change goes through
// the same code a user-initiated action does (place() = the panel's Add button).

import { useDocStore } from '@/lib/store/document'
import { shiftScene } from '@/lib/scene/simscript'
import { getElement } from '@/lib/physics/world'
import { num } from '@/lib/scene/types'
import { applyParam } from './apply'
import { prefetch } from '@/lib/tts/neural'
import { upcomingLines } from './lines'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { play, stop as stopPhysics } from '@/lib/physics/world'
import { narrator } from '@/lib/walkthrough/walkthrough-narrator'
import { sleep, glideTo, canvasToScreen, hideCursor } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { place, safeBounds, sceneAdd } from '@/lib/tools/scene'
import { useLearner } from '@/lib/learning/store'
import { useLesson } from './store'
import { useTeacher } from '@/lib/teacher/store'
import { gestureFor } from '@/lib/teacher/rig'
import { checkIn } from './tutor'
import { useTutor } from './tutor-store'
import { shouldCheckIn } from './tutor-core'
import { FRAME_BOTTOM, frameObjects } from './camera'
import { boxOf, COLUMN_GAP, CONTENT_W, contentOrigin, SLIDE_W, TITLE_H, diagramOrigin, layoutOf, buildSummary, glossaryMarkdown, summaryMarkdown, bulletFor, definitionFrom, nextOrigin, notesHeight, notesMarkdown, sectionTitle, type Section } from './sections'
import type { Stage } from './player'
import type { Storyboard } from './storyboard'

/** One film at a time: starting another (or closing) invalidates the previous run. */
let run = 0
export const currentRun = () => run
export const bumpRun = () => ++run

export function makeStage(sb: Storyboard, pageId: string, myRun: number, from = 0): Stage {
  const L = () => useLesson.getState()
  const pageObjects = () => Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
  const alive = () => run === myRun && L().active
  /** Caption + voice together: the caption writes itself out as the line is spoken. */
  const T = () => useTeacher.getState()
  let speakN = 0
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
  /** Which storyboard beat a scene came from (rebuilding after a seek replays scenes without moving the
   *  playhead, so the playhead cannot be used to find out what follows them). */
  let lastScene = -1
  const beatOfScene = (script: string): number => {
    for (let i = lastScene + 1; i < sb.beats.length; i++) {
      const b = sb.beats[i]
      if ((b.t === 'scene' && b.script === script) || (b.t === 'predict' && b.demo === script)) return (lastScene = i)
    }
    return L().index
  }
  /** A film with no picture anywhere (a topic the simulator cannot draw) has nothing to open a section: each chapter
   *  that has something to say becomes a text-only section of its own, so the board is never left blank. */
  const textOnly = !sb.beats.some((b) => b.t === 'scene' || (b.t === 'predict' && !!b.demo))
  let lastTitleBeat = -1
  const beatOfTitle = (text: string): number => {
    for (let i = lastTitleBeat + 1; i < sb.beats.length; i++) if (sb.beats[i].t === 'title' && (sb.beats[i] as { text: string }).text === text) return (lastTitleBeat = i)
    return L().index
  }
  const hasWords = (from: number): boolean => {
    for (let i = from + 1; i < sb.beats.length && sb.beats[i].t !== 'title'; i++) if (sb.beats[i].t === 'say' || sb.beats[i].t === 'equation') return true
    return false
  }
  let lastTitle = ([...sb.beats.slice(0, from)].reverse().find((b) => b.t === 'title') as { text?: string } | undefined)?.text ?? ''
  const sections = () => L().sections
  const current = (): Section | undefined => sections()[sections().length - 1]
  const objectsOf = (ids: string[]) => pageObjects().filter((o) => ids.includes(o.id))
  /** The newest section's picture and formulas — everything but its "Key points" column. */
  const bodyIds = () => (current()?.ids ?? []).slice(1).filter((id) => id !== current()?.notes)
  /** Lowest edge of the newest section's picture — where the next formula goes. */
  const belowScene = () => {
    const box = boxOf(objectsOf(bodyIds()))
    return box ? box.y + box.h + 24 : safeBounds(pageId).top + 40
  }
  /** The camera: glide to the newest section so it sits inside the visible board. */
  const frame = () => frameObjects(pageId, current()?.ids ?? null, () => !alive())
  // Rigid shift: moving bodies re-projects the connectors bound to them and flattens their routes, so scenes
  // (flowcharts above all) are only ever moved through shiftScene, which restores each connector's shape.
  const moveBy = (ids: string[], dx: number, dy: number) => shiftScene(pageId, ids, dx, dy)
  /** Open a section that has no picture of its own yet (a formula arriving before any scene): just its heading. */
  const openSection = async (o: { layout: 'split' | 'full' }) => {
    const n = sections().length + 1
    const title = lastTitle || sectionTitle(sb.beats, L().index, n)
    const at = nextOrigin(pageObjects(), { x: safeBounds(pageId).left + 40, y: safeBounds(pageId).top + 40 })
    const before = new Set(pageObjects().map((x) => x.id))
    await sceneAdd.run({ component: 'text', text: `## ${n} · ${title.length > 56 ? title.slice(0, 55) + '…' : title}`, x: at.x, y: at.y }, { pageId })
    const ids = pageObjects().filter((x) => !before.has(x.id)).map((x) => x.id)
    L().set({ sections: [...sections(), { id: `s${n}`, title, ids, beat: L().index, layout: o.layout }] })
  }
  /** Lay out the content column of the newest section: the key points on top, the formula card
   *  beneath them. In a full-width section there is no column, so the formulas sit under the diagram. */
  const layoutContent = () => {
    const cur = current()
    if (!cur) return
    const heading = objectsOf(cur.ids.slice(0, 1))[0]
    const notes = cur.notes ? objectsOf([cur.notes])[0] : undefined
    const card = cur.formulaBox ? objectsOf([cur.formulaBox])[0] : undefined
    if (!heading || !card) return
    const lines = Math.max(1, (cur.formulas ?? []).length)
    const h = 36 + lines * 64
    let x: number, y: number
    if (cur.layout === 'full') {
      const pic = boxOf(objectsOf(cur.ids.slice(1).filter((id) => id !== cur.notes && id !== cur.formulaBox)))
      x = (pic ? pic.x + pic.w / 2 : heading.position.x + SLIDE_W / 2) - CONTENT_W / 2
      y = (pic ? pic.y + pic.h : heading.position.y + TITLE_H) + 28
    } else {
      const at = contentOrigin(heading.position)
      x = at.x
      y = notes ? notes.position.y + notes.size.h + 28 : at.y
    }
    useDocStore.getState().updateObject(pageId, card.id, { position: { x, y }, size: { w: CONTENT_W, h } }, { history: false })
  }
  /** Record study notes for the current section — a key point, a word defined, a formula, a question and
   *  its answer — and keep its "Key points" block on the board (created beside the picture the first
   *  time) in step, so the board reads like slides when the lesson is over. */
  const doNote = async (n: { say?: string | null; bullet?: string | null; formula?: { latex: string; text?: string }; check?: { q: string; a: string } }) => {
    const cur = current()
    if (!cur) return
    const bullet = n.bullet ?? (n.say ? bulletFor(n.say) : null)
    const def = n.say ? n.say.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).map(definitionFrom).find(Boolean) ?? null : null
    const bullets = [...(cur.bullets ?? [])]
    if (bullet && !bullets.includes(bullet) && bullets.length < 6) bullets.push(bullet)
    const definitions = [...(cur.definitions ?? [])]
    if (def && !definitions.some((d) => d.term === def.term) && definitions.length < 5) definitions.push(def)
    const formulas = n.formula && !(cur.formulas ?? []).some((f) => f.latex === n.formula!.latex) ? [...(cur.formulas ?? []), n.formula] : cur.formulas
    const checks = n.check && !(cur.checks ?? []).some((c) => c.q === n.check!.q) ? [...(cur.checks ?? []), n.check] : cur.checks
    let notes = cur.notes
    // Only a split section has a content column to write in; a full-width diagram carries no text
    // (its notes still go into the study notes).
    if (!notes && bullets.length && cur.layout !== 'full') {
      const heading = objectsOf(cur.ids.slice(0, 1))[0]
      const at = heading ? contentOrigin(heading.position) : { x: 0, y: 0 }
      const before = new Set(pageObjects().map((o) => o.id))
      await sceneAdd.run({ component: 'text', text: notesMarkdown(bullets, definitions), x: at.x, y: at.y }, { pageId })
      notes = pageObjects().find((o) => !before.has(o.id))?.id
    }
    if (notes) {
      useDocStore.getState().setStringParam(pageId, notes, 'text', notesMarkdown(bullets, definitions))
      useDocStore.getState().updateObject(pageId, notes, { size: { w: 400, h: notesHeight(bullets, 400, definitions) } }, { history: false })
    }
    L().set({ sections: sections().map((s) => (s.id === cur.id ? { ...s, bullets, definitions, formulas, checks, notes, ids: notes && !s.ids.includes(notes) ? [...s.ids, notes] : s.ids } : s)) })
    layoutContent() // the formulas sit under the points, wherever those have grown to
  }
  /** One note at a time: two concurrent notes would each find no block yet and each create one. */
  let noteQueue: Promise<void> = Promise.resolve()
  const note = (n: Parameters<typeof doNote>[0]): Promise<void> => (noteQueue = noteQueue.then(() => doNote(n)).catch(() => undefined))
  const addBullet = (raw: string | null) => note({ say: raw })
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
    async say(text, instant) {
      void addBullet(text)
      if (instant) return
      T().set({ pose: gestureFor(text, speakN++) })
      await speak(text)
    },
    async title(text, sub, instant) {
      lastTitle = text
      if (textOnly && hasWords(beatOfTitle(text))) await openSection({ layout: 'split' })
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
        const headingId = pageObjects().find((o) => !before.has(o.id))?.id
        const withHeading = new Set([...before, ...(headingId ? [headingId] : [])])
        place(pageId, script, { reserveBottom: FRAME_BOTTOM })
        useDocStore.getState().setViewport(pageId, vp)
        // place() leaves room for an answer panel beside the scene; a lesson has none, so bring the
        // picture up under its heading — heading, picture and notes then read as one block.
        const picture = pageObjects().filter((o) => !withHeading.has(o.id))
        const pbox = boxOf(picture)
        const layout = layoutOf(sb.beats as { t: string; text?: string; clear?: boolean }[], beatOfScene(script))
        if (pbox) {
          const ids = picture.map((o) => o.id)
          const to = diagramOrigin(layout, at, pbox.w)
          moveBy(ids, to.x - pbox.x, to.y - pbox.y)
          // Wires re-route to their terminals when parts move, which can change the picture's extent:
          // measure again and settle it once more so it lands where the layout says.
          const again = boxOf(objectsOf(ids))
          if (again) { const to2 = diagramOrigin(layout, at, again.w); if (Math.abs(to2.x - again.x) > 2 || Math.abs(to2.y - again.y) > 2) moveBy(ids, to2.x - again.x, to2.y - again.y) }
        }
        const made = pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id)
        L().set({ sections: [...sections(), { id: `s${n}`, title, ids: made, beat: L().index, layout }] })
      } else {
        place(pageId, script, { reserveBottom: FRAME_BOTTOM })
        addToSection(pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id))
      }
      if (caption && caption !== 'Watch it happen') void addBullet(caption)
      if (caption && !opts?.instant) L().set({ caption, spoken: caption.length })
      if (opts?.instant) return
      void frame()
      await drawIn(pageObjects().filter((o) => !before.has(o.id)).map((o) => o.id))
    },
    async equation(latex, text, instant) {
      // Formulas never float free: the section's ONE formula card, on the content side, takes each as a new line.
      if (!current()) await openSection({ layout: 'split' })
      await note({ formula: { latex, text }, say: text })
      const cur = current()!
      const lines = (cur.formulas ?? []).map((f) => f.latex)
      const index = Math.max(0, lines.indexOf(latex))
      let cardId = cur.formulaBox
      if (!cardId) {
        const heading = objectsOf(cur.ids.slice(0, 1))[0]
        const at = heading ? contentOrigin(heading.position) : { x: safeBounds(pageId).left + 40, y: safeBounds(pageId).top + 100 }
        const before = new Set(pageObjects().map((o) => o.id))
        await sceneAdd.run({ component: 'formula', text: lines.join('\n'), x: at.x, y: at.y }, { pageId })
        cardId = pageObjects().find((o) => !before.has(o.id))?.id
        if (!cardId) return
        L().set({ sections: sections().map((s) => (s.id === cur.id ? { ...s, formulaBox: cardId, ids: [...s.ids, cardId!] } : s)) })
      } else {
        useDocStore.getState().setStringParam(pageId, cardId, 'latex', lines.join('\n'))
      }
      layoutContent()
      if (instant) return
      void frame()
      // Written out while it is explained: the new line takes about as long to write as the
      // explanation takes to say, so the two arrive together.
      const spokenMs = text ? ((text.split(' ').length / 150) * 60 * 1000) / Math.max(0.5, useWalkthroughStore.getState().speed) : 0
      const writeMs = Math.round(Math.min(3600, Math.max(1100, spokenMs * 0.7, latex.length * 60)) / Math.max(0.5, useWalkthroughStore.getState().speed))
      const card = () => useDocStore.getState().pages[pageId]?.objects[cardId!]
      if (card()) useDocStore.getState().updateObject(pageId, cardId, { parameters: { ...card()!.parameters, writeMs: num(writeMs), writeLine: num(index) } }, { history: false })
      if (text) await Promise.all([pointAndSay(cardId, text), sleep(writeMs)])
      else await sleep(writeMs + 400)
      if (card()) {
        const { writeMs: _a, writeLine: _b, ...rest } = card()!.parameters // leave a clean card behind
        void _a; void _b
        useDocStore.getState().updateObject(pageId, cardId, { parameters: rest }, { history: false })
      }
    },
    async run(seconds) {
      play(pageId)
      await sleep(seconds * 1000)
    },
    async point(object, text) {
      const o = pageObjects().find((x) => x.name === object)
      const at = o && canvasToScreen(pageId, { x: o.position.x + o.size.w / 2, y: o.position.y + o.size.h / 2 })
      void addBullet(text)
      await Promise.all([at ? glideTo(at, 900) : Promise.resolve(), pointAndSay(o?.id ?? null, text)])
      hideCursor()
    },
    async animate(object, param, from, to, seconds, text) {
      const o = pageObjects().find((x) => x.name === object)
      if (!o) return
      play(pageId)
      if (text) { void addBullet(text); void speak(text) }
      const steps = Math.max(8, Math.round(seconds * 12))
      for (let i = 0; i <= steps && alive(); i++) {
        applyParam(pageId, object, param, from + ((to - from) * i) / steps) // the slider thumb really moves
        await sleep((seconds * 1000) / steps)
      }
    },
    ask(beat) {
      return new Promise<number>((resolve) => {
        T().set({ mood: 'curious', pose: 'palm' })
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
      void note({ bullet: `Check: ${beat.prompt.replace(/\s+/g, ' ').slice(0, 90)} — ${beat.choices[beat.correct]}`, check: { q: beat.prompt, a: `${beat.choices[beat.correct]} ${beat.responses[beat.correct].replace(/^Correct\.\s*/i, '')}` } })
      T().set({ mood: right ? 'excited' : 'sympathetic', pose: right ? 'thumb' : 'open' })
      setTimeout(() => { if (T().pose === 'thumb') T().set({ pose: 'read' }) }, 2600)
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
    onBeat: (index) => {
      L().set({ index })
      prefetch(upcomingLines(sb, index + 1), 1) // fetch the next lines' audio while this one plays
    },
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
    /** The lesson is over: close the board with everything it covered, so one look (or one print) revises it. */
    async finish() {
      const sum = buildSummary(sb.title, sections())
      if (!sum.parts.length) return
      const n = sections().length + 1
      const at = nextOrigin(pageObjects(), { x: safeBounds(pageId).left + 40, y: safeBounds(pageId).top + 40 })
      const mk = async (component: string, text: string, x: number, y: number, h?: number, w = CONTENT_W) => {
        const before = new Set(pageObjects().map((o) => o.id))
        await sceneAdd.run({ component, text, x, y }, { pageId })
        const id = pageObjects().find((o) => !before.has(o.id))?.id
        if (id && h) useDocStore.getState().updateObject(pageId, id, { size: { w, h } }, { history: false })
        return id
      }
      const ids: string[] = []
      const push = (id?: string) => { if (id) ids.push(id) }
      push(await mk('text', `## ${n} · Summary: ${sb.title.length > 44 ? sb.title.slice(0, 43) + '…' : sb.title}`, at.x, at.y))
      const lines = sum.parts.flatMap((p) => [p.title, ...p.points.slice(0, 3)])
      const sumH = notesHeight(lines, CONTENT_W) + sum.parts.length * 22
      push(await mk('text', summaryMarkdown(sum), at.x, at.y + 64, sumH))
      let y = at.y + 64 + sumH + 24
      if (sum.glossary.length) {
        const gh = notesHeight(sum.glossary.map((g) => `${g.term} — ${g.meaning}`), CONTENT_W)
        push(await mk('text', glossaryMarkdown(sum), at.x, y, gh))
        y += gh
      }
      // every formula, in one card at the foot of the content column
      if (sum.formulas.length) {
        const shown = sum.formulas.slice(0, 8)
        const before = new Set(pageObjects().map((o) => o.id))
        await sceneAdd.run({ component: 'formula', text: shown.map((f) => f.latex).join('\n'), x: at.x, y: y + 12 }, { pageId })
        const id = pageObjects().find((o) => !before.has(o.id))?.id
        if (id) { useDocStore.getState().updateObject(pageId, id, { size: { w: CONTENT_W, h: 36 + shown.length * 64 } }, { history: false }); ids.push(id) }
      }
      L().set({ sections: [...sections(), { id: `s${n}`, title: 'Summary', ids, beat: sb.beats.length, summary: true, layout: 'split' }] })
      void frame()
      T().set({ mood: 'proud', pose: 'open' })
      await speak('That is the lesson. Everything we covered is gathered here: the key points, the formulas, and the words to remember. Open Study notes whenever you want to print it or revise.')
    },
    async settle() {
      await frame()
    },
    async gate() {
      while (L().paused && alive()) await new Promise((r) => setTimeout(r, 150))
    },
  }
}

export const lessonSpeed = () => useWalkthroughStore.getState().speed
