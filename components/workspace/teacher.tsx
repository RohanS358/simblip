'use client'

// The teacher: a drawn character who stands at the bottom-left of the board while a lesson
// plays. She is not a video and not a GIF — every frame is painted by code. A FrameLoop
// (lib/frame/loop) eases a handful of numbers (where each hand is, how open the mouth is, the
// eyebrows, the lean of the head) towards whatever the lesson is doing, and writes them straight
// onto the SVG's attributes. React renders the figure once; it never re-renders per frame.
//
// Her mouth follows the letters being spoken (the caption writes itself out to the voice, and
// `spoken` says how far it has got), her arm points at the thing she is explaining, and her face
// shows how the lesson is going: curious when she asks, concerned after a wrong answer.

import { useEffect, useRef } from 'react'
import { FrameLoop, damp } from '@/lib/frame/loop'
import { useLesson } from '@/lib/lesson/store'
import { useTeacher } from '@/lib/teacher/store'
import { arm, BOOK_HAND, MOODS, pointTarget, RIGHT_HAND, SHOULDER_L, SHOULDER_R, visemeOf, type Pt } from '@/lib/teacher/rig'

const SKIN = '#F7B286', SKIN_SHADE = '#E89A6C', HAIR = '#141414', PINK = '#EDADD6', PINK_SHADE = '#D58DBC'
const NAVY = '#143E87', NAVY_DARK = '#0E2D66', BOOK = '#12293A', BOOK_EDGE = '#1d3b52', FRAME = '#3a3a3a'
const VIEW = { x: -40, w: 560, h: 770 }

const lineD = (a: Pt, b: Pt, c?: Pt) => `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}${c ? ` L${c.x.toFixed(1)},${c.y.toFixed(1)}` : ''}`

/** Everything the painter eases. One number each; written to the DOM, never to React state. */
interface P {
  rx: number; ry: number // right hand
  brow: number; smile: number; tilt: number; eye: number
  mouth: number; blink: number
  gx: number; gy: number
  nod: number
}

export function Teacher({ height, className }: { height: number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = svg.current
    if (!root) return
    const q = (name: string) => root.querySelector(`[data-r="${name}"]`) as SVGElement | null
    const el = {
      figure: q('figure'), head: q('head'),
      armL: q('armL'), sleeveL: q('sleeveL'), handL: q('handL'),
      armR: q('armR'), sleeveR: q('sleeveR'), handR: q('handR'),
      book: q('book'),
      browL: q('browL'), browR: q('browR'),
      eyeL: q('eyeL'), eyeR: q('eyeR'), pupL: q('pupL'), pupR: q('pupR'),
      mouth: q('mouth'), blush: q('blush'),
    }
    const p: P = { rx: RIGHT_HAND.read.x, ry: RIGHT_HAND.read.y, brow: 0, smile: 0.35, tilt: 0, eye: 1, mouth: 0.1, blink: 0, gx: 0, gy: 0, nod: 0 }
    let nextBlink = 1.5, blinkT = -1
    const loop = new FrameLoop({ fps: 60 })

    /** Screen point → the figure's own coordinates. */
    const toFigure = (sx: number, sy: number): Pt => {
      const r = root.getBoundingClientRect()
      return { x: VIEW.x + ((sx - r.left) / r.width) * VIEW.w, y: ((sy - r.top) / r.height) * VIEW.h }
    }

    const paint = ({ t, dt }: { t: number; dt: number }) => {
      const tc = useTeacher.getState()
      const ls = useLesson.getState()
      const face = MOODS[tc.mood]

      // ── Where the right hand wants to be
      let target: Pt
      if (tc.pose === 'point' && tc.aim) target = pointTarget(SHOULDER_R, toFigure(tc.aim.x, tc.aim.y))
      else if (tc.pose === 'point') target = RIGHT_HAND.open
      else if (tc.pose === 'wave') target = { x: RIGHT_HAND.wave.x + Math.sin(t * 9) * 26, y: RIGHT_HAND.wave.y + Math.sin(t * 4.5) * 6 }
      else if (tc.pose === 'open') target = { x: RIGHT_HAND.open.x, y: RIGHT_HAND.open.y + Math.sin(t * 2.2) * 9 }
      else target = RIGHT_HAND[tc.pose]
      p.rx = damp(p.rx, target.x, 0.09, dt)
      p.ry = damp(p.ry, target.y, 0.09, dt)

      // ── Speech: the mouth follows the letter the voice has reached
      const talking = !!ls.caption && ls.spoken < ls.caption.length && ls.spoken > 0 && !ls.paused
      const letter = ls.caption[Math.max(0, ls.spoken - 1)]
      const wantMouth = talking ? Math.max(visemeOf(letter), 0.12) * (0.75 + 0.25 * Math.sin(t * 22)) : 0
      p.mouth = damp(p.mouth, wantMouth, 0.035, dt)
      p.nod = damp(p.nod, talking ? Math.sin(t * 5.2) * 1.6 + Math.sin(t * 2.3) * 1.2 : 0, 0.15, dt)

      // ── Face
      p.brow = damp(p.brow, face.brow, 0.12, dt)
      p.smile = damp(p.smile, face.smile, 0.15, dt)
      p.tilt = damp(p.tilt, face.tilt, 0.2, dt)
      p.eye = damp(p.eye, face.eye, 0.12, dt)
      if (t >= nextBlink && blinkT < 0) { blinkT = t; nextBlink = t + 2.4 + Math.random() * 3 }
      p.blink = blinkT >= 0 ? Math.sin(((t - blinkT) / 0.16) * Math.PI) : 0
      if (blinkT >= 0 && t - blinkT > 0.16) blinkT = -1
      // Eyes drift towards the board (up and right) while she explains, and to what she points at.
      const gazeX = tc.pose === 'point' && tc.aim ? Math.max(-1, Math.min(1, (toFigure(tc.aim.x, tc.aim.y).x - 230) / 260)) : talking ? 0.5 : 0.15
      const gazeY = tc.pose === 'point' ? -0.5 : talking ? -0.3 : 0
      p.gx = damp(p.gx, gazeX, 0.12, dt)
      p.gy = damp(p.gy, gazeY, 0.12, dt)

      // ── Paint: arms (two-bone IK), book, head, face — straight onto the SVG
      const breathe = Math.sin(t * 1.7) * 1.6
      el.figure?.setAttribute('transform', `translate(0 ${breathe.toFixed(2)})`)
      const L = arm(SHOULDER_L, BOOK_HAND)
      const R = arm(SHOULDER_R, { x: p.rx, y: p.ry })
      const sleeve = (s: Pt, e: Pt) => ({ x: s.x + (e.x - s.x) * 0.62, y: s.y + (e.y - s.y) * 0.62 })
      el.armL?.setAttribute('d', lineD(SHOULDER_L, L.elbow, L.hand))
      el.sleeveL?.setAttribute('d', lineD(SHOULDER_L, sleeve(SHOULDER_L, L.elbow)))
      el.handL?.setAttribute('transform', `translate(${L.hand.x.toFixed(1)} ${L.hand.y.toFixed(1)})`)
      el.armR?.setAttribute('d', lineD(SHOULDER_R, R.elbow, R.hand))
      el.sleeveR?.setAttribute('d', lineD(SHOULDER_R, sleeve(SHOULDER_R, R.elbow)))
      el.handR?.setAttribute('transform', `translate(${R.hand.x.toFixed(1)} ${R.hand.y.toFixed(1)})`)
      el.book?.setAttribute('transform', `translate(${(L.hand.x + 42).toFixed(1)} ${(L.hand.y - 8).toFixed(1)}) rotate(${(Math.sin(t * 1.3) * 0.6).toFixed(2)})`)

      el.head?.setAttribute('transform', `rotate(${(p.tilt + p.nod).toFixed(2)} 218 196) translate(0 ${(p.nod * 0.6).toFixed(2)})`)
      const bw = p.brow
      const brow = (cx: number, side: number) => {
        const y = 108 - bw * 5, tilt = bw < 0 ? -bw * 5 * side : 0 // worried brows slope up in the middle
        return `M${cx - 13},${(y + tilt).toFixed(1)} Q${cx},${(y - 4 - bw * 2).toFixed(1)} ${cx + 13},${(y - tilt).toFixed(1)}`
      }
      el.browL?.setAttribute('d', brow(206, 1))
      el.browR?.setAttribute('d', brow(248, -1))
      const open = Math.max(0.02, p.eye * (1 - p.blink * 0.95))
      el.eyeL?.setAttribute('transform', `translate(207 132) scale(1 ${open.toFixed(3)})`)
      el.eyeR?.setAttribute('transform', `translate(248 132) scale(1 ${open.toFixed(3)})`)
      el.pupL?.setAttribute('transform', `translate(${(p.gx * 2.6).toFixed(2)} ${(p.gy * 2).toFixed(2)})`)
      el.pupR?.setAttribute('transform', `translate(${(p.gx * 2.6).toFixed(2)} ${(p.gy * 2).toFixed(2)})`)
      // Mouth: a smile curve whose lips part by `mouth`
      const mx = 228, my = 160, w = 12, s = p.smile, o = p.mouth
      const corner = my - s * 2.2
      const up = my + s * 4 - o * 1.5, low = my + s * 4 + 1.5 + o * 20
      el.mouth?.setAttribute('d', `M${mx - w},${corner.toFixed(1)} Q${mx},${up.toFixed(1)} ${mx + w},${corner.toFixed(1)} Q${mx},${low.toFixed(1)} ${mx - w},${corner.toFixed(1)} Z`)
      el.mouth?.setAttribute('fill', o > 0.07 ? '#8b2c2c' : 'none')
      el.blush?.setAttribute('opacity', String(Math.max(0, Math.min(0.5, p.smile * 0.45))))
    }

    const off = loop.add(paint)
    loop.start()
    return () => { loop.stop(); off() }
  }, [])

  return (
    <svg
      ref={svg}
      viewBox={`${VIEW.x} 0 ${VIEW.w} ${VIEW.h}`}
      height={height}
      width={(height * VIEW.w) / VIEW.h}
      className={className}
      role="img"
      aria-label="Your teacher"
      style={{ overflow: 'visible' }}
    >
      <ellipse cx="205" cy="752" rx="120" ry="12" fill="#000" opacity="0.12" />
      <g data-r="figure">
        {/* legs */}
        <path d="M141,548 L196,552 L190,742 L146,742 Z" fill={SKIN} />
        <path d="M204,552 L262,546 L258,742 L206,742 Z" fill={SKIN} />
        <path d="M146,725 L190,725 L190,742 L146,742 Z" fill={SKIN_SHADE} opacity="0.35" />
        {/* skirt */}
        <path d="M150,352 L268,352 Q286,450 274,548 Q200,572 126,552 Q128,450 150,352 Z" fill={NAVY} />
        <path d="M150,352 L268,352 L266,372 L146,372 Z" fill={NAVY_DARK} />
        {/* torso */}
        <path d="M104,222 Q128,204 168,198 L256,198 Q292,206 302,244 L296,356 L148,360 Q134,330 116,292 Q100,262 104,222 Z" fill={PINK} />
        <path d="M296,356 L302,244 Q300,300 280,356 Z" fill={PINK_SHADE} opacity="0.5" />
        {/* neck + collar */}
        <path d="M196,176 L240,176 L240,206 Q218,222 196,206 Z" fill={SKIN} />
        <path d="M176,196 L222,246 L196,200 Z M268,196 L222,246 L252,200 Z" fill="#fff" />
        <path d="M172,196 L222,250 L270,196 L252,196 L222,232 L190,196 Z" fill="#fff" />

        {/* head */}
        <g data-r="head">
          {/* hair behind */}
          <circle cx="172" cy="68" r="40" fill={HAIR} />
          <path d="M148,100 Q146,60 190,46 Q250,34 284,80 L278,118 L158,128 Z" fill={HAIR} />
          {/* ear + face */}
          <ellipse cx="172" cy="132" rx="9" ry="13" fill={SKIN_SHADE} />
          <ellipse cx="226" cy="136" rx="46" ry="52" fill={SKIN} />
          {/* fringe: a straight-cut fringe over the forehead */}
          <path d="M170,96 Q176,66 214,56 Q262,52 282,84 L282,96 Q250,108 226,100 Q200,112 172,106 Z" fill={HAIR} />
          <path d="M270,92 Q288,110 280,140 L270,128 Z" fill={HAIR} />
          {/* brows */}
          <path data-r="browL" d="M193,108 Q206,104 219,108" fill="none" stroke={HAIR} strokeWidth="3" strokeLinecap="round" />
          <path data-r="browR" d="M235,108 Q248,104 261,108" fill="none" stroke={HAIR} strokeWidth="3" strokeLinecap="round" />
          {/* eyes */}
          <g data-r="eyeL" transform="translate(207 132)"><ellipse rx="6.5" ry="7.5" fill="#fff" /><g data-r="pupL"><circle r="4" fill="#2a1a12" /><circle cx="1.4" cy="-1.6" r="1.2" fill="#fff" /></g></g>
          <g data-r="eyeR" transform="translate(248 132)"><ellipse rx="6.5" ry="7.5" fill="#fff" /><g data-r="pupR"><circle r="4" fill="#2a1a12" /><circle cx="1.4" cy="-1.6" r="1.2" fill="#fff" /></g></g>
          {/* glasses */}
          <circle cx="207" cy="132" r="17" fill="#fff" fillOpacity="0.12" stroke={FRAME} strokeWidth="3.2" />
          <circle cx="248" cy="132" r="17" fill="#fff" fillOpacity="0.12" stroke={FRAME} strokeWidth="3.2" />
          <path d="M224,130 Q227.5,126 231,130" fill="none" stroke={FRAME} strokeWidth="3" />
          <path d="M190,128 L176,124 M265,128 L279,124" stroke={FRAME} strokeWidth="3" strokeLinecap="round" />
          {/* nose, cheeks, mouth */}
          <path d="M228,142 Q231,150 226,152" fill="none" stroke={SKIN_SHADE} strokeWidth="2" strokeLinecap="round" />
          <ellipse data-r="blush" cx="196" cy="156" rx="9" ry="5" fill="#ff8a8a" opacity="0.2" />
          <ellipse cx="258" cy="156" rx="9" ry="5" fill="#ff8a8a" opacity="0.15" />
          <path data-r="mouth" d="M216,160 Q228,166 240,160 Q228,162 216,160 Z" fill="none" stroke="#6a1f1f" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        </g>

        {/* the book she teaches from */}
        <g data-r="book" transform="translate(250 294)">
          <rect x="-58" y="-62" width="116" height="124" rx="5" fill={BOOK} />
          <rect x="-58" y="-62" width="16" height="124" rx="5" fill={BOOK_EDGE} />
          <rect x="52" y="-58" width="9" height="116" rx="2" fill="#cfd3d6" />
          <rect x="-40" y="-40" width="62" height="5" rx="2.5" fill="#2c4d66" />
          <rect x="-40" y="-26" width="46" height="5" rx="2.5" fill="#2c4d66" />
        </g>

        {/* arms, in front of the book */}
        <path data-r="armL" d="M122,236 L110,320 L208,302" fill="none" stroke={SKIN} strokeWidth="23" strokeLinecap="round" strokeLinejoin="round" />
        <path data-r="sleeveL" d="M122,236 L114,290" fill="none" stroke={PINK} strokeWidth="27" strokeLinecap="round" />
        <g data-r="handL" transform="translate(208 302)"><circle r="14" fill={SKIN} /></g>
        <path data-r="armR" d="M282,236 L292,320 L300,240" fill="none" stroke={SKIN} strokeWidth="23" strokeLinecap="round" strokeLinejoin="round" />
        <path data-r="sleeveR" d="M282,236 L288,290" fill="none" stroke={PINK} strokeWidth="27" strokeLinecap="round" />
        <g data-r="handR" transform="translate(300 240)"><circle r="14" fill={SKIN} /></g>
      </g>
    </svg>
  )
}
