'use client'

/**
 * The walkthrough script.
 *
 * Rule for every step: the cursor must go somewhere real and do something real
 * BEFORE the result appears. Nothing is created "out of thin air" — each object
 * is placed at the exact screen point the pointer just travelled to, using the
 * same tool the viewer would pick from the dock themselves.
 *
 * Narration is written for a complete beginner (an eight-year-old should follow
 * it): short sentences, plain words, and it always names the thing on screen.
 */

import { useDocStore } from '../store/document'
import { createGeometry, componentById } from '../scene/factory'
import { str, num } from '../scene/types'
import { play, stop } from '../physics/world'
import {
  clickElement,
  glideTo,
  pressCursor,
  centerOf,
  canvasPoint,
  screenToCanvas,
  canvasToScreen,
  dragAlong,
  clearTrail,
  sleep,
  type Pt,
} from './walkthrough-cursor-driver'

export interface WalkthroughStep {
  /** Spoken + subtitled line. Said while `run` executes. */
  narration: string
  /** Selector to ring-highlight while this step runs. */
  highlight?: string
  /** The actual interaction. Receives the demo page id. */
  run?: (pageId: string) => Promise<void> | void
  /** Beat after the step, so the viewer can see the result. */
  pauseAfter?: number
}

export interface WalkthroughAct {
  id: string
  title: string
  description: string
  steps: WalkthroughStep[]
}

// ── Small helpers shared by the acts ─────────────────────────────────────────

/** Dock buttons carry long descriptive labels, so match on the prefix. */
const tool = (label: string) => `[aria-label^="${label}"]`

const doc = () => useDocStore.getState()

/** Type a string into an object's text parameter, one letter at a time. */
async function typeInto(pageId: string, objId: string, text: string, per = 45) {
  for (let i = 1; i <= text.length; i++) {
    const cur = doc().pages[pageId]?.objects[objId]
    if (!cur) return
    doc().updateObject(pageId, objId, {
      parameters: { ...cur.parameters, text: str(text.slice(0, i)) },
    })
    await sleep(per)
  }
}

/** Points along a rough circle, in screen space — what a hand-drawn loop is. */
function circlePath(c: Pt, r: number, n = 22): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const wobble = 1 + Math.sin(i * 1.7) * 0.045 // hand tremor, not a perfect circle
    return { x: c.x + Math.cos(a) * r * wobble, y: c.y + Math.sin(a) * r * wobble }
  })
}

export const WALKTHROUGH_ACTS: WalkthroughAct[] = [
  {
    id: 'welcome',
    title: '1. Welcome',
    description: 'What this app is, and what the screen is showing you.',
    steps: [
      {
        narration:
          'Hi! This is SIMBLIP. It is a giant sheet of paper where you can draw things — and then watch them actually move.',
        run: async () => {
          const c = canvasPoint(0.5, 0.45)
          if (c) await glideTo(c, 1100)
        },
        pauseAfter: 900,
      },
      {
        narration:
          'This big empty space in the middle is your canvas. You draw everything here.',
        highlight: '[aria-label="Infinite canvas"]',
        pauseAfter: 1400,
      },
      {
        narration:
          'Down at the bottom is your toolbox. Every button here is a different tool, like pens and shapes in a pencil case.',
        highlight: '[aria-label="Select"]',
        run: async () => {
          const c = centerOf(tool('Select'))
          if (c) await glideTo({ x: c.x, y: c.y - 60 }, 1000)
        },
        pauseAfter: 1600,
      },
      {
        narration:
          'On the left is your sidebar. It holds all your notebooks and pages, like a school bag.',
        highlight: '[aria-label="Sidebar"]',
        pauseAfter: 1600,
      },
    ],
  },

  {
    id: 'note',
    title: '2. Write a note',
    description: 'Pick the Note tool, click the canvas, and type.',
    steps: [
      {
        narration:
          'Let us start easy. I will click the Note button at the bottom — this one makes a sticky note.',
        highlight: tool('Note'),
        run: async () => {
          await clickElement(tool('Note'))
        },
        pauseAfter: 700,
      },
      {
        narration:
          'Now watch my pointer. I move it onto the canvas, and I click right here. The note appears exactly where I clicked.',
        run: async (pageId) => {
          const at = canvasPoint(0.18, 0.16)
          if (!at) return
          await glideTo(at, 1100)
          await pressCursor()
          const pos = screenToCanvas(pageId, at)
          const note = createGeometry('note', pos)
          note.id = 'wt-note'
          note.size = { w: 240, h: 150 }
          note.position = { x: pos.x - 120, y: pos.y - 75 }
          note.parameters.text = str('')
          note.metadata.color = 'amber'
          doc().addObject(pageId, note)
          doc().setSelection(['wt-note'])
          doc().setTool('select')
        },
        pauseAfter: 800,
      },
      {
        narration: 'And now I can just type into it, like any notebook.',
        run: async (pageId) => {
          await typeInto(pageId, 'wt-note', 'My bouncing spring experiment', 55)
        },
        pauseAfter: 1600,
      },
    ],
  },

  {
    id: 'draw',
    title: '3. Draw with the pen',
    description: 'Use the pen tool to draw a real stroke on the canvas.',
    steps: [
      {
        narration:
          'Next, the Pen. I press the pen button — now my pointer draws ink instead of selecting things.',
        highlight: tool('Pen'),
        run: async () => {
          await clickElement(tool('Pen'))
        },
        pauseAfter: 700,
      },
      {
        narration:
          'I hold the button down and drag, and it draws a line, exactly like a real pen on paper. Watch me draw a circle.',
        run: async (pageId) => {
          const c = canvasPoint(0.42, 0.24)
          if (!c) return
          const path = circlePath(c, 62)
          await dragAlong(path, 1900)
          // Commit the stroke as a real ink object at the drawn location.
          const pts = path.map((p) => screenToCanvas(pageId, p))
          const xs = pts.map((p) => p.x)
          const ys = pts.map((p) => p.y)
          const minX = Math.min(...xs)
          const minY = Math.min(...ys)
          const ink = createGeometry('stroke', { x: minX, y: minY })
          ink.id = 'wt-ink'
          ink.size = { w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
          ink.position = { x: minX, y: minY }
          ink.geometry.points = pts.map((p) => [p.x - minX, p.y - minY])
          doc().addObject(pageId, ink)
          await sleep(400)
          clearTrail()
          doc().setTool('select')
        },
        pauseAfter: 1500,
      },
    ],
  },

  {
    id: 'build',
    title: '4. Build a spring and a weight',
    description: 'Place real physics parts from the components panel.',
    steps: [
      {
        narration:
          'Now the fun part. SIMBLIP has real physics parts — springs, weights, wires. I open the Components panel on the left.',
        highlight: '[aria-label="Components"]',
        run: async () => {
          await clickElement('[aria-label="Components"]')
        },
        pauseAfter: 1200,
      },
      {
        narration:
          'First I need something solid to hang things from. I click up here to put down a ground bar — like a ceiling.',
        run: async (pageId) => {
          const at = canvasPoint(0.62, 0.16)
          if (!at) return
          await glideTo(at, 1100)
          await pressCursor()
          const pos = screenToCanvas(pageId, at)
          const ground = componentById('ground')?.create(pos)
          if (ground) {
            ground.id = 'wt-ground'
            ground.size = { w: 220, h: 20 }
            ground.position = { x: pos.x - 110, y: pos.y - 10 }
            doc().addObject(pageId, ground)
          }
        },
        pauseAfter: 1100,
      },
      {
        narration:
          'Now the spring. I click just under the ceiling — the top of the spring touches it, so it hangs from it.',
        run: async (pageId) => {
          const at = canvasPoint(0.62, 0.16)
          if (!at) return
          await glideTo({ x: at.x, y: at.y + 20 }, 900)
          await pressCursor()
          const top = screenToCanvas(pageId, { x: at.x, y: at.y })
          const spring = componentById('spring')?.create(top)
          if (spring) {
            spring.id = 'wt-spring'
            spring.name = 'Spring'
            // Vertical, starting ON the ground bar so the endpoint connects.
            spring.position = { x: top.x, y: top.y }
            spring.geometry.points = [
              [0, 0],
              [0, 150],
            ]
            spring.size = { w: 2, h: 150 }
            // Demo tuning: the stock damping (0.05) settles in about a second,
            // so the bounce is over before the narration finishes. A springier,
            // barely-damped setup is what makes the motion readable on screen.
            const b = spring.behaviors.find((x) => x.type === 'spring')
            if (b) {
              b.params.damping = num('0.004')
              b.params.k = num('26')
              b.params.restScale = num('0.62')
            }
            doc().addObject(pageId, spring)
          }
        },
        pauseAfter: 1300,
      },
      {
        narration:
          'Then I hang a heavy weight on the bottom end of the spring, so the spring has something to pull on.',
        run: async (pageId) => {
          const spring = doc().pages[pageId]?.objects['wt-spring']
          if (!spring) return
          // Aim at the spring's actual lower endpoint, so the weight touches it
          // — a guessed screen fraction is what left them unconnected before.
          const endX = spring.position.x
          const endY = spring.position.y + 150
          const screen = canvasToScreen(pageId, { x: endX, y: endY })
          if (screen) await glideTo(screen, 1000)
          await pressCursor()
          const mass = componentById('mass')?.create({ x: endX, y: endY })
          if (mass) {
            mass.id = 'wt-mass'
            mass.name = 'Mass'
            mass.position = { x: endX - mass.size.w / 2, y: endY - mass.size.h / 2 }
            doc().addObject(pageId, mass)
            doc().setSelection(['wt-mass'])
          }
        },
        pauseAfter: 1600,
      },
    ],
  },

  {
    id: 'graph',
    title: '5. Add a live graph',
    description: 'Place a graph that draws the motion as it happens.',
    steps: [
      {
        narration:
          'I want to see the movement as a picture. So I press the Graph button in the toolbox.',
        highlight: tool('Graph'),
        run: async () => {
          await clickElement(tool('Graph'))
        },
        pauseAfter: 700,
      },
      {
        narration:
          'And I click over here on the right to drop the graph in. It will draw a wiggly line while the weight bounces.',
        run: async (pageId) => {
          const at = canvasPoint(0.84, 0.3)
          if (!at) return
          await glideTo(at, 1100)
          await pressCursor()
          const pos = screenToCanvas(pageId, at)
          const graph = createGeometry('graph', pos)
          graph.id = 'wt-graph'
          graph.size = { w: 320, h: 220 }
          graph.position = { x: pos.x - 160, y: pos.y - 110 }
          graph.parameters.sourceId = str('wt-mass')
          graph.parameters.yChannels = str('y')
          doc().addObject(pageId, graph)
          doc().setTool('select')
        },
        pauseAfter: 1500,
      },
    ],
  },

  {
    id: 'play',
    title: '6. Press Play',
    description: 'Run the simulation and watch it move.',
    steps: [
      {
        narration:
          'Everything is ready. Up at the top is the green Play button. This is the magic button.',
        highlight: '[aria-label="Play"]',
        run: async () => {
          const c = centerOf('[aria-label="Play"]')
          if (c) await glideTo(c, 1100)
        },
        pauseAfter: 1100,
      },
      {
        narration:
          'I press it — and the weight starts bouncing up and down, all by itself. The graph draws the bounce at the same time.',
        run: async (pageId) => {
          const ok = await clickElement('[aria-label="Play"]')
          if (!ok) play(pageId)
        },
        pauseAfter: 5000,
      },
      {
        narration:
          'That is a real physics simulation. Gravity pulls the weight down, the spring pulls it back up, over and over.',
        pauseAfter: 3000,
      },
      {
        narration:
          'To stop it, I press the same button again. Now everything holds still.',
        highlight: '[aria-label="Pause"]',
        run: async () => {
          const ok = await clickElement('[aria-label="Pause"]')
          if (!ok) stop()
        },
        pauseAfter: 1600,
      },
    ],
  },

  {
    id: 'finish',
    title: '7. Your turn',
    description: 'Where to click next, and how to undo mistakes.',
    steps: [
      {
        narration:
          'If you ever make a mistake, this curved arrow at the top is Undo. It takes the last thing back.',
        highlight: '[aria-label="Undo"]',
        run: async () => {
          const c = centerOf('[aria-label="Undo"]')
          if (c) await glideTo(c, 1100)
        },
        pauseAfter: 1800,
      },
      {
        narration:
          'And that is it! Pick a tool at the bottom, click on the canvas, then press Play. Go and build something.',
        run: async () => {
          const c = canvasPoint(0.5, 0.5)
          if (c) await glideTo(c, 1000)
        },
        pauseAfter: 2200,
      },
    ],
  },
]
