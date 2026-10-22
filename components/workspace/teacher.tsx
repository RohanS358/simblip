'use client'

// The teacher: a drawn character who stands at the bottom-right of the board while a lesson
// plays, facing the board. She is the reference illustration traced into flat SVG layers
// (teacher-art.ts), with the parts that must move split out — head, working arm, hand — and the
// face (eyes, brows, mouth) painted by code so it can emote. Every frame is painted by code: a
// FrameLoop (lib/frame/loop) eases a handful of numbers towards what the lesson is doing and writes
// them straight onto the SVG's attributes. React renders the figure once; it never re-renders per frame.
//
// Her mouth follows the letters being spoken (the caption writes itself out to the voice, and
// `spoken` says how far it has got), her arm points at the thing she is explaining, her hands
// gesture (open palm for a question, thumbs-up for a right answer, a shrug, a wave), and her face
// shows how the lesson is going — curious, delighted, concerned, thoughtful, proud.

import { useEffect, useRef } from 'react'
import { FrameLoop, damp } from '@/lib/frame/loop'
import { useLesson } from '@/lib/lesson/store'
import { useTeacher } from '@/lib/teacher/store'
import { arm, MOODS, POSES, pointTarget, SHOULDER_R, visemeOf, type HandShape, type Pt } from '@/lib/teacher/rig'
import { ART, type ArtPath } from './teacher-art'

const SKIN = '#F7B286', SKIN_SHADE = '#E58354', PINK = '#EEADD5', INK = '#141414', LIP = '#2a1212', TONGUE = '#e07a7a'
const VIEW = { x: -40, w: 560, h: 741 }
const EYE_L: Pt = { x: 213.6, y: 130.4 }, EYE_R: Pt = { x: 246.2, y: 131.2 }
const BROW_L: Pt = { x: 213.5, y: 120.6 }, BROW_R: Pt = { x: 247, y: 119.6 }
const MOUTH: Pt = { x: 225.6, y: 157.6 }
const NECK: Pt = { x: 218, y: 176 }
const HANDS: HandShape[] = ['fist', 'open', 'point', 'thumb', 'palm']

const f1 = (n: number) => n.toFixed(1)
const lineD = (a: Pt, b: Pt, c?: Pt) => `M${f1(a.x)},${f1(a.y)} L${f1(b.x)},${f1(b.y)}${c ? ` L${f1(c.x)},${f1(c.y)}` : ''}`
const layer = (paths: ArtPath[]) => paths.map((p) => <path key={p.id} data-art={p.id} fill={p.fill} fillRule="evenodd" d={p.d} />)

/** Everything the painter eases. One number each; written to the DOM, never to React state. */
interface P {
  rx: number; ry: number // working hand
  rest: number // 1 = the traced arm holding the book is showing, 0 = the gesturing arm is
  browL: number; browR: number; inner: number; smile: number; tilt: number; eye: number; squint: number; blush: number
  mouth: number; blink: number
  gx: number; gy: number
  nod: number; lean: number; shrug: number; sway: number
  hand: Record<HandShape, number>
}

export function Teacher({ height, className }: { height: number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = svg.current
    if (!root) return
    const q = (name: string) => root.querySelector(`[data-r="${name}"]`) as SVGElement | null
    const el = {
      upper: q('upper'), head: q('head'), armRest: q('armRest'), armR: q('armR'),
      upperArm: q('upperArm'), foreArm: q('foreArm'), sleeve: q('sleeve'), hand: q('hand'),
      browL: q('browL'), browR: q('browR'), eyeL: q('eyeL'), eyeR: q('eyeR'), happyL: q('happyL'), happyR: q('happyR'),
      mouth: q('mouth'), tongue: q('tongue'), blushL: q('blushL'), blushR: q('blushR'),
    }
    const shapes = Object.fromEntries(HANDS.map((h) => [h, q(`hand-${h}`)])) as Record<HandShape, SVGElement | null>
    const p: P = {
      rx: 298, ry: 246, rest: 1, browL: 0.3, browR: 0.3, inner: 0, smile: 0.35, tilt: 0, eye: 1, squint: 0, blush: 0,
      mouth: 0.1, blink: 0, gx: 0, gy: 0, nod: 0, lean: 0, shrug: 0, sway: 0,
      hand: { fist: 1, open: 0, point: 0, thumb: 0, palm: 0 },
    }
    let nextBlink = 1.5, blinkT = -1, nextGlance = 2, glanceX = 0, glanceY = 0
    const loop = new FrameLoop({ fps: 60 })

    /** Screen point → the figure's own coordinates. */
    const toFigure = (sx: number, sy: number): Pt => {
      const r = root.getBoundingClientRect()
      // She is mirrored on screen (she stands at the board's right edge, facing left), so screen-x runs backwards.
      return { x: VIEW.x + (1 - (sx - r.left) / r.width) * VIEW.w, y: ((sy - r.top) / r.height) * VIEW.h }
    }

    const paint = ({ t, dt }: { t: number; dt: number }) => {
      const tc = useTeacher.getState()
      const ls = useLesson.getState()
      const face = MOODS[tc.mood]
      const spec = POSES[tc.pose]

      // ── Where the working hand wants to be, and which hand it is
      let target: Pt | null = spec.hand
      if (tc.pose === 'point') target = pointTarget(SHOULDER_R, tc.aim ? toFigure(tc.aim.x, tc.aim.y) : { x: 520, y: 120 })
      else if (tc.pose === 'wave') target = { x: spec.hand!.x + Math.sin(t * 9) * 26, y: spec.hand!.y + Math.sin(t * 4.5) * 6 }
      else if (tc.pose === 'celebrate') target = { x: spec.hand!.x + Math.sin(t * 12) * 18, y: spec.hand!.y + Math.abs(Math.sin(t * 6)) * -16 }
      else if (tc.pose === 'open' || tc.pose === 'palm') target = { x: spec.hand!.x, y: spec.hand!.y + Math.sin(t * 2.2) * 9 }
      else if (tc.pose === 'shrug') target = { x: spec.hand!.x, y: spec.hand!.y - Math.max(0, Math.sin(t * 3)) * 6 }
      const resting = target === null
      p.rest = damp(p.rest, resting ? 1 : 0, 0.08, dt)
      if (target) { p.rx = damp(p.rx, target.x, 0.09, dt); p.ry = damp(p.ry, target.y, 0.09, dt) }
      else { p.rx = damp(p.rx, 296, 0.12, dt); p.ry = damp(p.ry, 248, 0.12, dt) }
      for (const h of HANDS) p.hand[h] = damp(p.hand[h], spec.shape === h ? 1 : 0, 0.05, dt)

      // ── Speech: the mouth follows the letter the voice has reached
      const talking = !!ls.caption && ls.spoken < ls.caption.length && ls.spoken > 0 && !ls.paused
      const letter = ls.caption[Math.max(0, ls.spoken - 1)]
      const wantMouth = talking ? Math.max(visemeOf(letter), 0.12) * (0.75 + 0.25 * Math.sin(t * 22)) : 0
      p.mouth = damp(p.mouth, Math.max(wantMouth, face.mouthMin * (0.8 + 0.2 * Math.sin(t * 9))), 0.035, dt)
      const laugh = tc.mood === 'laughing' ? Math.sin(t * 14) * 1.8 : 0
      p.nod = damp(p.nod, talking ? Math.sin(t * 5.2) * 1.6 + Math.sin(t * 2.3) * 1.2 : laugh, 0.12, dt)
      p.lean = damp(p.lean, spec.lean + (talking ? 0.25 : 0), 0.25, dt)
      p.shrug = damp(p.shrug, spec.shrug, 0.1, dt)
      p.sway = Math.sin(t * 0.7) * 0.35

      // ── Face
      p.browL = damp(p.browL, face.browL, 0.1, dt)
      p.browR = damp(p.browR, face.browR, 0.1, dt)
      p.inner = damp(p.inner, face.inner, 0.12, dt)
      p.smile = damp(p.smile, face.smile, 0.13, dt)
      p.tilt = damp(p.tilt, face.tilt + spec.tilt, 0.18, dt)
      p.eye = damp(p.eye, face.eye, 0.1, dt)
      p.squint = damp(p.squint, face.squint, 0.08, dt)
      p.blush = damp(p.blush, face.blush, 0.2, dt)
      if (t >= nextBlink && blinkT < 0) { blinkT = t; nextBlink = t + 2.4 + Math.random() * 3 }
      p.blink = blinkT >= 0 ? Math.sin(((t - blinkT) / 0.16) * Math.PI) : 0
      if (blinkT >= 0 && t - blinkT > 0.16) blinkT = -1
      if (t >= nextGlance) { nextGlance = t + 1.2 + Math.random() * 2.2; glanceX = (Math.random() - 0.5) * 0.7; glanceY = (Math.random() - 0.5) * 0.5 }
      // Eyes go to the board while she explains, and to whatever she points at.
      const aimed = tc.pose === 'point' && tc.aim ? Math.max(-1, Math.min(1, (toFigure(tc.aim.x, tc.aim.y).x - 230) / 260)) : null
      const gazeX = (aimed ?? (talking ? 0.5 : 0.1)) + glanceX * 0.4
      const gazeY = (tc.pose === 'point' ? -0.45 : tc.mood === 'thinking' ? -0.7 : talking ? -0.25 : 0) + glanceY * 0.4
      p.gx = damp(p.gx, gazeX, 0.1, dt)
      p.gy = damp(p.gy, gazeY, 0.1, dt)

      // ── Paint: body, arm (two-bone IK), hand, head, face — straight onto the SVG
      const breathe = Math.sin(t * 1.7) * 1.4
      el.upper?.setAttribute('transform', `translate(${(p.lean * 4).toFixed(2)} ${(breathe - p.shrug * 5).toFixed(2)}) rotate(${p.sway.toFixed(2)} 215 360)`)
      el.armRest?.setAttribute('opacity', p.rest.toFixed(3))
      const R = arm(SHOULDER_R, { x: p.rx, y: p.ry })
      const ang = Math.atan2(R.hand.y - R.elbow.y, R.hand.x - R.elbow.x)
      el.armR?.setAttribute('opacity', (1 - p.rest).toFixed(3))
      el.upperArm?.setAttribute('d', lineD(SHOULDER_R, R.elbow))
      el.foreArm?.setAttribute('d', lineD(R.elbow, R.hand))
      const sl = { x: SHOULDER_R.x + (R.elbow.x - SHOULDER_R.x) * 0.5, y: SHOULDER_R.y + (R.elbow.y - SHOULDER_R.y) * 0.5 }
      el.sleeve?.setAttribute('d', lineD(SHOULDER_R, sl))
      el.hand?.setAttribute('transform', `translate(${f1(R.hand.x)} ${f1(R.hand.y)}) rotate(${((ang * 180) / Math.PI).toFixed(1)})`)
      for (const h of HANDS) shapes[h]?.setAttribute('opacity', p.hand[h].toFixed(3))

      el.head?.setAttribute('transform', `rotate(${(p.tilt + p.nod).toFixed(2)} ${NECK.x} ${NECK.y}) translate(${(p.lean * 1.5).toFixed(2)} ${(p.nod * 0.5).toFixed(2)})`)
      // brows: raised or lowered, inner ends pulled up when worried
      const brow = (c: Pt, raise: number, side: number) => {
        const y = c.y - raise * 6, lift = p.inner * 4 * side
        return `M${f1(c.x - 7)},${f1(y - lift * -0.5 + 0.8 + lift)} Q${f1(c.x)},${f1(y - 4 - raise * 1.5)} ${f1(c.x + 7)},${f1(y + 0.8 - lift)}`
      }
      el.browL?.setAttribute('d', brow(BROW_L, p.browL, 1))
      el.browR?.setAttribute('d', brow(BROW_R, p.browR, -1))
      // eyes: round ovals that blink, widen and look about — or happy crescents when she is delighted
      const open = Math.max(0.04, p.eye * (1 - p.blink * 0.95))
      const gx = p.gx * 2.4, gy = p.gy * 1.8
      const oval = (c: Pt) => `translate(${f1(c.x + gx)} ${f1(c.y + gy)}) scale(1 ${open.toFixed(3)})`
      el.eyeL?.setAttribute('transform', oval(EYE_L))
      el.eyeR?.setAttribute('transform', oval(EYE_R))
      el.eyeL?.setAttribute('opacity', (1 - p.squint).toFixed(3))
      el.eyeR?.setAttribute('opacity', (1 - p.squint).toFixed(3))
      el.happyL?.setAttribute('opacity', p.squint.toFixed(3))
      el.happyR?.setAttribute('opacity', p.squint.toFixed(3))
      // mouth: a smile whose lips part by `mouth`; a frown when the smile is negative
      const s = p.smile, o = p.mouth, w = 7 + Math.max(0, s) * 1.6 + o * 1.5
      const corner = MOUTH.y - s * 1.8, up = MOUTH.y + s * 4.6 - o * 1.2, low = MOUTH.y + s * 4.6 + 1.2 + o * 12
      el.mouth?.setAttribute('d', `M${f1(MOUTH.x - w)},${f1(corner)} Q${f1(MOUTH.x)},${f1(up)} ${f1(MOUTH.x + w)},${f1(corner)} Q${f1(MOUTH.x)},${f1(low)} ${f1(MOUTH.x - w)},${f1(corner)} Z`)
      el.mouth?.setAttribute('fill', o > 0.07 ? LIP : 'none')
      el.tongue?.setAttribute('opacity', Math.max(0, Math.min(1, (o - 0.35) * 2.2)).toFixed(3))
      el.tongue?.setAttribute('transform', `translate(${f1(MOUTH.x)} ${f1(low - 3.2)})`)
      el.blushL?.setAttribute('opacity', (p.blush * 0.6).toFixed(3))
      el.blushR?.setAttribute('opacity', (p.blush * 0.5).toFixed(3))
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
      style={{ overflow: 'visible', transform: 'scaleX(-1)' }}
    >
      <ellipse cx="205" cy="735" rx="118" ry="11" fill="#000" opacity="0.1" />
      {layer(ART.legs)}
      {layer(ART.skirt)}
      <g data-r="upper">
        {layer(ART.torso)}
        {layer(ART.book)}
        {layer(ART.armL)}
        <g data-r="armRest">{layer(ART.armRest)}</g>

        {/* the working arm: shown while she gestures; the traced arm holding the book takes over at rest */}
        <g data-r="armR" opacity="0">
          <path data-r="upperArm" d="M282,234 L300,310" fill="none" stroke={SKIN} strokeWidth="25" strokeLinecap="round" />
          <path data-r="foreArm" d="M300,310 L296,246" fill="none" stroke={SKIN} strokeWidth="21" strokeLinecap="round" />
          <path data-r="sleeve" d="M282,234 L291,272" fill="none" stroke={PINK} strokeWidth="31" strokeLinecap="round" />
          <g data-r="hand" transform="translate(296 246)">
            <g data-r="hand-fist" fill={SKIN}><circle r="13" /><ellipse cx="3" cy="-11" rx="5" ry="8" /></g>
            <g data-r="hand-open" fill={SKIN} opacity="0"><circle r="12" /><rect x="6" y="-17" width="21" height="7" rx="3.5" transform="rotate(-24 6 -13)" /><rect x="8" y="-8" width="25" height="7" rx="3.5" transform="rotate(-8 8 -4)" /><rect x="8" y="1" width="25" height="7" rx="3.5" transform="rotate(8 8 4)" /><rect x="6" y="9" width="21" height="7" rx="3.5" transform="rotate(24 6 13)" /><ellipse cx="-3" cy="-13" rx="9" ry="5" transform="rotate(-40 -3 -13)" /></g>
            <g data-r="hand-point" fill={SKIN} opacity="0"><circle r="11" /><rect x="6" y="-4" width="30" height="8" rx="4" /><circle cx="5" cy="9" r="5" /><circle cx="-1" cy="11" r="5" /></g>
            <g data-r="hand-thumb" fill={SKIN} opacity="0"><circle r="13" /><rect x="-4" y="-34" width="9" height="26" rx="4.5" transform="rotate(-90 0 0) rotate(90 0 0)" /></g>
            <g data-r="hand-palm" fill={SKIN} opacity="0"><rect x="-2" y="-14" width="26" height="28" rx="9" /><rect x="22" y="-14" width="14" height="7" rx="3.5" /><rect x="22" y="-6" width="16" height="7" rx="3.5" /><rect x="22" y="2" width="15" height="7" rx="3.5" /><rect x="20" y="10" width="12" height="6" rx="3" /></g>
          </g>
        </g>

        <g data-r="head">
          {layer(ART.head)}
          {/* her face, painted by code: cheeks, eyes (ovals, or crescents when delighted), brows, mouth */}
          <ellipse data-r="blushL" cx="203" cy="147" rx="8" ry="5" fill="#ff7a7a" opacity="0" />
          <ellipse data-r="blushR" cx="248" cy="148" rx="8" ry="5" fill="#ff7a7a" opacity="0" />
          <g data-r="eyeL" transform="translate(213.6 130.4)"><ellipse rx="4.2" ry="5.8" fill={INK} /></g>
          <g data-r="eyeR" transform="translate(246.2 131.2)"><ellipse rx="4.2" ry="5.8" fill={INK} /></g>
          <path data-r="happyL" d="M207,133 Q213.6,124 220,133" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0" />
          <path data-r="happyR" d="M239.6,134 Q246.2,125 252.8,134" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0" />
          <path data-r="browL" d="M206.5,121 Q213.5,116 220.5,121" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path data-r="browR" d="M240,120 Q247,115 254,120" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <path data-r="mouth" d="M218.6,157.6 Q225.6,161 232.6,157.6 Q225.6,159 218.6,157.6 Z" fill="none" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          <ellipse data-r="tongue" rx="4.5" ry="2.6" fill={TONGUE} opacity="0" />
        </g>
      </g>
    </svg>
  )
}
