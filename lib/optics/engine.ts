// Optics engine — 2D geometric ray tracer for the Engineering Physics optics
// unit (lens/mirror diagrams, refraction and dispersion through glass,
// single/double-slit and grating diffraction).
//
// Unlike the circuit/physics engines this needs no time-stepping: a ray
// path is a pure function of the current scene, so it's recomputed
// reactively whenever an object moves or a param changes (see the
// light-source render branch in components/objects/geometry.tsx).
//
// Elements are drawn as 'line' geometry (their two endpoints define the
// aperture, like a real optical-bench diagram) carrying one behavior:
// 'thinLens', 'opticalMirror', 'opticalScreen' or 'slit'. Refracting glass
// is a filled shape (rect / polygon / circle) carrying 'refractor' — its
// OUTLINE is the interface, so a triangle is a prism, a rect a slab and a
// circle a ball lens, with Snell's law, total internal reflection, Fresnel
// partial reflection and Cauchy dispersion at every edge. A light source is
// a 'circle' with a 'lightSource' behavior — its rotation sets the beam
// direction, and it fires a parallel bundle of `rays` across `aperture` px.

import type { SceneObject } from '@/lib/scene/types'

export interface Vec2 {
  x: number
  y: number
}

export interface RayPath {
  sourceId: string
  points: Vec2[]
  wavelengthNm: number
  /** 0..1 — drops at every partial (Fresnel) reflection split. */
  intensity: number
  /** White light: the first `shared` points are common to every wavelength
   *  of this ray (nothing dispersive hit yet) and are drawn once, white. */
  shared?: number
  hitScreen?: Vec2
  /** Refractive index of the medium each segment runs through
   *  (segment i = points[i]→points[i+1]) — sets λ/n and c/n for the
   *  wave-crest and photon views. */
  n: number[]
}

/** Read a numeric param off the object's optics behavior (falls back to an
 *  object-level parameter of the same name, then the default). */
export function opticParam(obj: SceneObject, type: string, name: string, fallback: number): number {
  const b = obj.behaviors.find((bb) => bb.enabled && bb.type === type)
  const p = b?.params[name]
  if (p?.kind === 'number' && Number.isFinite(p.value)) return p.value
  const op = obj.parameters[name]
  return op?.kind === 'number' && Number.isFinite(op.value) ? op.value : fallback
}

function hasBehavior(obj: SceneObject, type: string): boolean {
  return obj.behaviors.some((b) => b.enabled && b.type === type)
}

/** Local → world for a point in the object's own box (rotation about its centre). */
function toWorld(obj: SceneObject): (p: number[]) => Vec2 {
  const cx = obj.position.x + obj.size.w / 2
  const cy = obj.position.y + obj.size.h / 2
  const rad = (obj.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return (p) => {
    const dx = obj.position.x + p[0] - cx
    const dy = obj.position.y + p[1] - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
}

/** World-space endpoints of a 'line' object (rotation applied about its own center). */
function lineEndpoints(obj: SceneObject): [Vec2, Vec2] {
  const pts = obj.geometry.points ?? [
    [0, 0],
    [obj.size.w, 0],
  ]
  const world = toWorld(obj)
  return [world(pts[0]), world(pts[pts.length - 1])]
}

/** World-space outline of a filled shape, as a closed vertex list. */
export function shapeOutline(obj: SceneObject): Vec2[] {
  const { w, h } = obj.size
  const world = toWorld(obj)
  const kind = obj.geometry.kind
  if (kind === 'polygon' && obj.geometry.points && obj.geometry.points.length >= 3) {
    return obj.geometry.points.map(world)
  }
  if (kind === 'circle') {
    // ponytail: 64-gon ellipse — edge normals are within 3° of the true
    // curve, well under what a ball-lens diagram can show. Analytic
    // ray–ellipse intersection if someone needs exact caustics.
    const N = 64
    return Array.from({ length: N }, (_, i) => {
      const a = (i / N) * 2 * Math.PI
      return world([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)])
    })
  }
  return [world([0, 0]), world([w, 0]), world([w, h]), world([0, h])]
}

type ElementKind = 'lens' | 'mirror' | 'screen' | 'slit' | 'glass'

interface OpticalElement {
  obj: SceneObject
  kind: ElementKind
  a: Vec2 // one aperture endpoint (for glass: one edge endpoint)
  b: Vec2 // the other
  /** glass only: which body this edge bounds */
  glass?: Glass
}

interface Glass {
  poly: Vec2[]
  /** Cauchy coefficients, λ in µm: n(λ) = A + B/λ² */
  A: number
  B: number
}

/** Cauchy dispersion with `n` quoted at the sodium d-line (589 nm) — the
 *  number printed in every glass catalogue (BK7: n_d = 1.517, B ≈ 0.0042 µm²). */
function glassOf(obj: SceneObject): Glass {
  const nd = Math.max(1, opticParam(obj, 'refractor', 'n', 1.52))
  const B = Math.max(0, opticParam(obj, 'refractor', 'dispersion', 0.0042))
  return { poly: shapeOutline(obj), A: nd - B / (0.589 * 0.589), B }
}

export function refractiveIndex(g: { A: number; B: number }, nm: number): number {
  const um = nm / 1000
  return g.A + g.B / (um * um)
}

function collectElements(objects: SceneObject[]): OpticalElement[] {
  const out: OpticalElement[] = []
  for (const obj of objects) {
    if (hasBehavior(obj, 'refractor') && obj.geometry.kind !== 'line') {
      const glass = glassOf(obj)
      const P = glass.poly
      for (let i = 0; i < P.length; i++) out.push({ obj, kind: 'glass', a: P[i], b: P[(i + 1) % P.length], glass })
      continue
    }
    if (obj.geometry.kind !== 'line') continue
    const kind: ElementKind | null = hasBehavior(obj, 'thinLens')
      ? 'lens'
      : hasBehavior(obj, 'opticalMirror')
        ? 'mirror'
        : hasBehavior(obj, 'opticalScreen')
          ? 'screen'
          : hasBehavior(obj, 'slit')
            ? 'slit'
            : null
    if (!kind) continue
    const [a, b] = lineEndpoints(obj)
    out.push({ obj, kind, a, b })
  }
  return out
}

/** Ray (origin o, direction d, t≥EPS) ∩ segment (a→b, s∈[0,1]). Returns the ray parameter t. */
function intersectRaySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b.x - a.x
  const ey = b.y - a.y
  const det = ex * d.y - ey * d.x
  if (Math.abs(det) < 1e-9) return null // parallel
  const ax = a.x - o.x
  const ay = a.y - o.y
  const t = (ex * ay - ey * ax) / det
  const s = (d.x * ay - d.y * ax) / det
  const EPS = 1e-6
  if (t < EPS || s < 0 || s > 1) return null
  return t
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}

/** Signed height of a point along the element's own aperture axis, from its midpoint. */
function heightAlong(el: OpticalElement, p: Vec2): number {
  const mid = { x: (el.a.x + el.b.x) / 2, y: (el.a.y + el.b.y) / 2 }
  const t = normalize({ x: el.b.x - el.a.x, y: el.b.y - el.a.y })
  return (p.x - mid.x) * t.x + (p.y - mid.y) * t.y
}

/** Unit normal to the element's aperture line (either sense — callers orient it). */
function normalOf(el: OpticalElement): Vec2 {
  const t = normalize({ x: el.b.x - el.a.x, y: el.b.y - el.a.y })
  return { x: -t.y, y: t.x }
}

function insidePoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Refractive index of whatever medium contains p (air = 1). */
function indexAt(p: Vec2, glasses: Glass[], nm: number): number {
  for (const g of glasses) if (insidePoly(p, g.poly)) return refractiveIndex(g, nm)
  return 1
}

/** Paraxial focusing kick shared by thin lenses and curved mirrors:
 *  tan θ' = tan θ − y/f, measured about the element's own axis. */
function focusKick(el: OpticalElement, d: Vec2, hit: Vec2, f: number): Vec2 {
  const n = normalOf(el)
  const t = normalize({ x: el.b.x - el.a.x, y: el.b.y - el.a.y })
  const y = heightAlong(el, hit)
  const dn = d.x * n.x + d.y * n.y // forward component
  const dt = d.x * t.x + d.y * t.y // transverse component
  const dtNew = dt - (y / f) * Math.abs(dn || 1)
  return normalize({ x: dn * n.x + dtNew * t.x, y: dn * n.y + dtNew * t.y })
}

/** Unpolarized Fresnel reflectance (average of s and p). */
export function fresnelR(n1: number, n2: number, cosi: number, cost: number): number {
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost)
  const rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost)
  return (rs * rs + rp * rp) / 2
}

/** Slit mask geometry — centres of the N openings along the mask axis. */
export function slitCenters(count: number, spacing: number): number[] {
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing)
}

function slitParams(obj: SceneObject) {
  const gap = Math.max(0.1, opticParam(obj, 'slit', 'gap', 10))
  const count = Math.max(1, Math.min(MAX_SLITS, Math.round(opticParam(obj, 'slit', 'count', 1))))
  const spacing = opticParam(obj, 'slit', 'spacing', 60)
  return { gap, count, spacing, centers: slitCenters(count, spacing) }
}

const MAX_SLITS = 20
const MAX_BOUNCES = 24
const MAX_LEN = 4000
/** A partial reflection is only worth a new ray while it is still visible. */
const MIN_BRANCH_INTENSITY = 0.04
const MAX_SEGMENTS_PER_SOURCE = 1200

interface Pending {
  origin: Vec2
  dir: Vec2
  intensity: number
  prefix: Vec2[]
  dispersed: boolean
}

/** Particle mode: a single photon can't split. At a partial reflector it
 *  goes one way or the other with probability R (`rand`), and after a slit
 *  its direction is re-drawn from the diffraction pattern (`diffract`). */
interface Quantum {
  rand: () => number
  diffract: (slit: SceneObject, hit: Vec2, nm: number) => Vec2 | null
}

function traceOneRay(
  origin: Vec2,
  dir: Vec2,
  elements: OpticalElement[],
  glasses: Glass[],
  wavelengthNm: number,
  sourceId: string,
  budget: { segments: number },
  quantum?: Quantum
): RayPath[] {
  const out: RayPath[] = []
  const queue: Pending[] = [{ origin, dir: normalize(dir), intensity: 1, prefix: [origin], dispersed: false }]

  while (queue.length) {
    const job = queue.shift()!
    const points = job.prefix.slice()
    const media: number[] = []
    let o = job.origin
    let d = job.dir
    // `shared` = how many leading points precede the first dispersive event.
    let shared: number | undefined
    let dispersed = job.dispersed
    let hitScreen: Vec2 | undefined

    for (let bounce = 0; bounce < MAX_BOUNCES && budget.segments > 0; bounce++) {
      budget.segments--
      let bestT = Infinity
      let bestEl: OpticalElement | null = null
      for (const el of elements) {
        const t = intersectRaySegment(o, d, el.a, el.b)
        if (t !== null && t < bestT) {
          bestT = t
          bestEl = el
        }
      }
      const segT = !bestEl || bestT > MAX_LEN ? MAX_LEN : bestT
      media.push(glasses.length ? indexAt({ x: o.x + (d.x * segT) / 2, y: o.y + (d.y * segT) / 2 }, glasses, wavelengthNm) : 1)
      if (!bestEl || bestT > MAX_LEN) {
        points.push({ x: o.x + d.x * MAX_LEN, y: o.y + d.y * MAX_LEN })
        break
      }
      const hit = { x: o.x + d.x * bestT, y: o.y + d.y * bestT }
      points.push(hit)
      const nudge = (dir: Vec2) => ({ x: hit.x + dir.x * 1e-3, y: hit.y + dir.y * 1e-3 })

      if (bestEl.kind === 'screen') {
        hitScreen = hit
        break
      }
      if (bestEl.kind === 'slit') {
        const y = heightAlong(bestEl, hit)
        const { gap, centers } = slitParams(bestEl.obj)
        if (!centers.some((c) => Math.abs(y - c) <= gap / 2)) break // absorbed by the mask
        const target = quantum?.diffract(bestEl.obj, hit, wavelengthNm)
        if (target) d = normalize({ x: target.x - hit.x, y: target.y - hit.y })
        o = nudge(d)
        continue
      }
      if (bestEl.kind === 'mirror') {
        const n = normalOf(bestEl)
        const dot = d.x * n.x + d.y * n.y
        d = normalize({ x: d.x - 2 * dot * n.x, y: d.y - 2 * dot * n.y })
        // Curved mirror (f ≠ 0): concave f > 0 converges, convex f < 0
        // diverges — the same paraxial kick as a lens, applied after the
        // specular bounce (1/v + 1/u = 1/f, f = R/2).
        const f = opticParam(bestEl.obj, 'opticalMirror', 'f', 0)
        if (f) d = focusKick(bestEl, d, hit, f)
        o = nudge(d)
        continue
      }
      if (bestEl.kind === 'lens') {
        const f = opticParam(bestEl.obj, 'thinLens', 'f', 150) || 1e6
        d = focusKick(bestEl, d, hit, f)
        o = nudge(d)
        continue
      }
      // glass edge: Snell's law, with TIR and a Fresnel partial reflection.
      const g = bestEl.glass!
      let n = normalOf(bestEl)
      let cosi = -(d.x * n.x + d.y * n.y)
      if (cosi < 0) {
        n = { x: -n.x, y: -n.y }
        cosi = -cosi
      }
      const n1 = indexAt({ x: hit.x - d.x * 0.01, y: hit.y - d.y * 0.01 }, glasses, wavelengthNm)
      const n2 = indexAt({ x: hit.x + d.x * 0.01, y: hit.y + d.y * 0.01 }, glasses, wavelengthNm)
      // A reflection is achromatic, so a branch split off here is still
      // shared by every wavelength unless the parent had already dispersed.
      const dispersedBefore = dispersed
      if (!dispersed && g.B > 0 && n1 !== n2) {
        dispersed = true
        shared = points.length
      }
      const eta = n1 / n2
      const k = 1 - eta * eta * (1 - cosi * cosi)
      const reflect = { x: d.x + 2 * cosi * n.x, y: d.y + 2 * cosi * n.y }
      if (k < 0) {
        // Total internal reflection — all the light stays inside.
        d = normalize(reflect)
        o = nudge(d)
        continue
      }
      const cost = Math.sqrt(k)
      const R = fresnelR(n1, n2, cosi, cost)
      const refr = normalize({ x: eta * d.x + (eta * cosi - cost) * n.x, y: eta * d.y + (eta * cosi - cost) * n.y })
      if (quantum) {
        // One photon, one outcome: reflected with probability R, else transmitted.
        d = quantum.rand() < R ? normalize(reflect) : refr
        o = nudge(d)
        continue
      }
      if (job.intensity * R > MIN_BRANCH_INTENSITY && budget.segments > 0) {
        const rd = normalize(reflect)
        queue.push({
          origin: { x: hit.x + rd.x * 1e-3, y: hit.y + rd.y * 1e-3 },
          dir: rd,
          intensity: job.intensity * R,
          prefix: [hit],
          dispersed: dispersedBefore,
        })
      }
      job.intensity *= 1 - R
      d = refr
      o = nudge(d)
    }

    out.push({
      sourceId,
      points,
      wavelengthNm,
      intensity: job.intensity,
      shared: dispersed ? (shared ?? 0) : points.length,
      hitScreen,
      n: media,
    })
  }
  return out
}

/** The wavelengths a white source is traced at — seven, one per band of the
 *  visible spectrum, is enough for a prism to fan out a readable rainbow. */
export const WHITE_NM = [410, 460, 500, 540, 580, 620, 670]

function sourceWavelengths(src: SceneObject): number[] {
  if (opticParam(src, 'lightSource', 'white', 0) >= 0.5) return WHITE_NM
  return [opticParam(src, 'lightSource', 'wavelength', 550)]
}

/** Trace every light source in the scene against every optical element. Pure function of the scene — call it fresh whenever objects change. */
export function traceRays(objects: SceneObject[]): RayPath[] {
  const sources = objects.filter((o) => o.geometry.kind === 'circle' && hasBehavior(o, 'lightSource'))
  if (sources.length === 0) return []
  const elements = collectElements(objects)
  const glasses = [...new Set(elements.filter((e) => e.glass).map((e) => e.glass!))]
  const rays: RayPath[] = []

  for (const src of sources) {
    const angle = (src.rotation * Math.PI) / 180
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const perp = { x: -dir.y, y: dir.x }
    const n = Math.max(1, Math.round(opticParam(src, 'lightSource', 'rays', 3)))
    const aperture = opticParam(src, 'lightSource', 'aperture', 80)
    const cx = src.position.x + src.size.w / 2
    const cy = src.position.y + src.size.h / 2
    const budget = { segments: MAX_SEGMENTS_PER_SOURCE }
    for (const nm of sourceWavelengths(src)) {
      for (let i = 0; i < n; i++) {
        const offset = n === 1 ? 0 : -aperture / 2 + (aperture * i) / (n - 1)
        const origin = { x: cx + perp.x * offset, y: cy + perp.y * offset }
        rays.push(...traceOneRay(origin, dir, elements, glasses, nm, src.id, budget))
      }
    }
  }
  return rays
}

// ═══ Wave & quantum layer ════════════════════════════════════════════════
// Real physics, not decoration — at a display scale of 1 px = NM_PER_PX nm
// (633 nm ≈ 25 px). At true micron scale λ is sub-pixel and a bench only a
// few hundred px long is deep in the near field: the screen just shows the
// slits' geometric shadow and the fringes (λL/d ≈ 1 px) are invisible. Like
// every teaching sim (PhET's Wave Interference) we scale λ up to the slits
// instead, so the same crests drawn along the rays are the waves that
// interfere, and Δy = λL/d, d sin θ = mλ hold in px.
//
// For every screen behind a slit mask we do a Huygens–Fresnel phasor sum
// (Fresnel–Kirchhoff, with the (1+cos θ)/2 obliquity factor): each open gap
// is sampled as M secondary emitters, and the complex amplitude at a screen
// point is Σ K(θ)·e^{ikr}/√r over all emitters (2D wave, hence 1/√r). |A|²
// gives the intensity — the single-slit sinc² envelope, double-slit cos²
// fringes and a grating's sharp principal maxima all fall out of the sum,
// nothing is faked. Emitters sit < λ/2 apart where the budget allows, so the
// sampling itself can't create spurious "grating lobes".
//
// Quantum view: while the transport runs, photons land one at a time at
// positions drawn from |A|² (Born rule) — the canonical build-up of an
// interference pattern from individually detected quanta.

/** Display scale of the wave layer: 1 canvas px = this many nm. */
export const NM_PER_PX = 25

export interface ScreenPattern {
  /** World centres of the mask's open gaps and the unit direction toward
   *  the screen — where the wave view draws the diffracted wavelets. */
  openings: Vec2[]
  toward: Vec2
  /** Slit → screen distance (px), how far the wavelets are drawn. */
  reach: number
  screenId: string
  sourceId: string
  slitId: string
  a: Vec2 // screen aperture endpoints (world)
  b: Vec2
  /** |A|² sampled uniformly from a→b; normalized so the brightest wavelength
   *  of this source peaks at 1 (white light keeps relative brightness). */
  intensity: number[]
  wavelengthNm: number
}

const MIN_SCREEN_SAMPLES = 140
const MAX_SCREEN_SAMPLES = 900
/** emitters × screen samples per wavelength — keeps a drag at 60 fps. */
const PHASOR_BUDGET = 260_000

/** Interference/diffraction pattern on every screen fed by a coherent
 *  source through a slit mask. Pure function of the scene. */
export function screenPatterns(objects: SceneObject[]): ScreenPattern[] {
  const all = collectElements(objects)
  const screens = all.filter((e) => e.kind === 'screen')
  const slits = all.filter((e) => e.kind === 'slit')
  const sources = objects.filter((o) => o.geometry.kind === 'circle' && hasBehavior(o, 'lightSource'))
  if (screens.length === 0 || slits.length === 0 || sources.length === 0) return []

  const out: ScreenPattern[] = []
  for (const screen of screens) {
    for (const src of sources) {
      const cx = src.position.x + src.size.w / 2
      const cy = src.position.y + src.size.h / 2
      // The mask this beam actually passes through (its axis crosses the
      // slit line), nearer than this screen, and facing the screen — a slit
      // merely CLOSER to the source than the screen used to count, so a
      // screen lit by an unrelated beam showed fringes.
      const sMid = { x: (screen.a.x + screen.b.x) / 2, y: (screen.a.y + screen.b.y) / 2 }
      const aim = (src.rotation * Math.PI) / 180
      const axisDir = { x: Math.cos(aim), y: Math.sin(aim) }
      const screenT = intersectRaySegment({ x: cx, y: cy }, axisDir, screen.a, screen.b)
      const slit = slits
        .map((el) => ({
          el,
          mid: { x: (el.a.x + el.b.x) / 2, y: (el.a.y + el.b.y) / 2 },
          t: intersectRaySegment({ x: cx, y: cy }, axisDir, el.a, el.b),
        }))
        // …and the beam axis must actually reach this screen: a screen off to
        // the side only catches the far wings of the pattern, which (after
        // normalising) drew as bright noise on an unrelated detector.
        .filter((q) => q.t !== null && screenT !== null && q.t < screenT)
        .filter(({ mid }) => (sMid.x - mid.x) * axisDir.x + (sMid.y - mid.y) * axisDir.y > 0)
        .sort((p, q) => p.t! - q.t!)[0]
      if (!slit) continue

      const { gap, centers } = slitParams(slit.el.obj)
      const mid = slit.mid
      const beamAngle = (src.rotation * Math.PI) / 180
      const beam = { x: Math.cos(beamAngle), y: Math.sin(beamAngle) }
      const axis = normalize({ x: slit.el.b.x - slit.el.a.x, y: slit.el.b.y - slit.el.a.y })
      // Mask normal pointing toward the screen, for the obliquity factor.
      let nrm = { x: -axis.y, y: axis.x }
      if ((sMid.x - mid.x) * nrm.x + (sMid.y - mid.y) * nrm.y < 0) nrm = { x: -nrm.x, y: -nrm.y }

      const screenLen = Math.hypot(screen.b.x - screen.a.x, screen.b.y - screen.a.y) || 1
      const L = Math.max(1, Math.hypot(sMid.x - mid.x, sMid.y - mid.y))
      const span = Math.max(gap, Math.abs(centers[centers.length - 1] - centers[0]) + gap)

      const group: ScreenPattern[] = []
      let groupMax = 0
      for (const wavelengthNm of sourceWavelengths(src)) {
        const lambdaPx = wavelengthNm / NM_PER_PX
        const k = (2 * Math.PI) / lambdaPx
        // Finest fringe on the screen ≈ λL / (whole aperture) — sample it ≥6×.
        const samples = Math.round(
          Math.min(MAX_SCREEN_SAMPLES, Math.max(MIN_SCREEN_SAMPLES, (6 * screenLen * span) / (lambdaPx * L)))
        )
        const perGap = Math.max(
          6,
          Math.min(Math.ceil((2 * gap) / lambdaPx) + 1, Math.floor(PHASOR_BUDGET / samples / centers.length))
        )
        const emitters: { x: number; y: number; phase0: number }[] = []
        for (const c of centers) {
          for (let m = 0; m < perGap; m++) {
            const off = c - gap / 2 + (gap * (m + 0.5)) / perGap
            const p = { x: mid.x + axis.x * off, y: mid.y + axis.y * off }
            // The source is a laser: a collimated beam, i.e. a plane wave
            // along its aim — the same parallel bundle the ray tracer fires.
            emitters.push({ x: p.x, y: p.y, phase0: k * ((p.x - cx) * beam.x + (p.y - cy) * beam.y) })
          }
        }

        const intensity: number[] = new Array(samples)
        for (let i = 0; i < samples; i++) {
          const t = i / (samples - 1)
          const qx = screen.a.x + (screen.b.x - screen.a.x) * t
          const qy = screen.a.y + (screen.b.y - screen.a.y) * t
          let re = 0
          let im = 0
          for (const e of emitters) {
            const rx = qx - e.x
            const ry = qy - e.y
            const r = Math.hypot(rx, ry) || 1e-6
            const cosT = (rx * nrm.x + ry * nrm.y) / r
            if (cosT <= 0) continue
            const ph = e.phase0 + k * r
            const amp = (0.5 * (1 + cosT)) / Math.sqrt(r)
            re += amp * Math.cos(ph)
            im += amp * Math.sin(ph)
          }
          const I = re * re + im * im
          intensity[i] = I
          if (I > groupMax) groupMax = I
        }
        group.push({
          openings: centers.map((c) => ({ x: mid.x + axis.x * c, y: mid.y + axis.y * c })),
          toward: nrm,
          reach: L,
          screenId: screen.obj.id, sourceId: src.id, slitId: slit.el.obj.id, a: screen.a, b: screen.b, intensity, wavelengthNm })
      }
      if (groupMax > 0) for (const p of group) for (let i = 0; i < p.intensity.length; i++) p.intensity[i] /= groupMax
      out.push(...group)
    }
  }
  return out
}

/** Born rule: draw one photon landing position (0..1 along the screen)
 *  from the pattern's |A|² distribution via inverse-CDF sampling. */
export function samplePhoton(pattern: ScreenPattern, rand: () => number = Math.random): number {
  const total = pattern.intensity.reduce((s, v) => s + v, 0) || 1
  let r = rand() * total
  for (let i = 0; i < pattern.intensity.length; i++) {
    r -= pattern.intensity[i]
    if (r <= 0) return i / (pattern.intensity.length - 1)
  }
  return 1
}

export interface PhotonFlight extends RayPath {
  /** Set when the photon is detected on an interference screen: which
   *  pattern and where along it (0..1), for the Born-rule build-up. */
  landed?: { s: number; t: number }
}

/** Particle view: emit ONE photon from a random source, at a random point
 *  across its beam (and, for white light, a random wavelength), and follow
 *  it through the scene. Where a wave splits (Fresnel), the photon picks a
 *  branch with probability R; where a wave diffracts (slit → screen), the
 *  photon's landing point is drawn from |A|² — so many photons reproduce
 *  exactly the intensities the wave view computes. */
export function tracePhoton(
  objects: SceneObject[],
  patterns: ScreenPattern[],
  rand: () => number = Math.random
): PhotonFlight | null {
  const sources = objects.filter((o) => o.geometry.kind === 'circle' && hasBehavior(o, 'lightSource'))
  if (sources.length === 0) return null
  const src = sources[Math.floor(rand() * sources.length)]
  const nms = sourceWavelengths(src)
  const nm = nms[Math.floor(rand() * nms.length)]
  const angle = (src.rotation * Math.PI) / 180
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const aperture = opticParam(src, 'lightSource', 'aperture', 80)
  const off = (rand() - 0.5) * aperture
  const origin = { x: src.position.x + src.size.w / 2 - dir.y * off, y: src.position.y + src.size.h / 2 + dir.x * off }
  const elements = collectElements(objects)
  const glasses = [...new Set(elements.filter((e) => e.glass).map((e) => e.glass!))]
  let landed: PhotonFlight['landed']
  const quantum: Quantum = {
    rand,
    diffract: (slit, _hit, wl) => {
      const s = patterns.findIndex((p) => p.slitId === slit.id && p.sourceId === src.id && p.wavelengthNm === wl)
      if (s < 0) return null
      const pat = patterns[s]
      const t = samplePhoton(pat, rand)
      landed = { s, t }
      return { x: pat.a.x + (pat.b.x - pat.a.x) * t, y: pat.a.y + (pat.b.y - pat.a.y) * t }
    },
  }
  const [path] = traceOneRay(origin, dir, elements, glasses, nm, src.id, { segments: MAX_BOUNCES }, quantum)
  // Only count it as a detection if the photon actually reached that screen.
  if (landed && path.hitScreen) {
    const pat = patterns[landed.s]
    const t = landed.t
    const want = { x: pat.a.x + (pat.b.x - pat.a.x) * t, y: pat.a.y + (pat.b.y - pat.a.y) * t }
    if (Math.hypot(want.x - path.hitScreen.x, want.y - path.hitScreen.y) > 1) landed = undefined
  } else landed = undefined
  return { ...path, landed }
}

/** Linear sRGB-ish triple (0..1) for a visible wavelength — the standard
 *  piecewise fit (Bruton), with the eye's falloff toward both ends. */
export function wavelengthRGB(nm: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60
    b = 1
  } else if (nm < 490) {
    g = (nm - 440) / 50
    b = 1
  } else if (nm < 510) {
    g = 1
    b = -(nm - 510) / 20
  } else if (nm < 580) {
    r = (nm - 510) / 70
    g = 1
  } else if (nm < 645) {
    r = 1
    g = -(nm - 645) / 65
  } else if (nm <= 780) {
    r = 1
  }
  const fall = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1
  const f = Math.max(0, Math.min(1, fall))
  return [r * f, g * f, b * f]
}

/** Display colour of a wavelength, for rays, fringes and photons. */
export function wavelengthColor(nm: number): string {
  const [r, g, b] = wavelengthRGB(nm)
  // Gamma 0.8 lifts the dim ends so violet/deep red still read on a canvas.
  const c = (v: number) => Math.round(255 * Math.pow(Math.max(0, v), 0.8))
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`
}

/** Colour of a set of wavelengths weighted by their intensities — how a
 *  white-light fringe actually looks (white centre, coloured edges). */
export function mixColor(parts: { nm: number; I: number }[]): { color: string; alpha: number } {
  let r = 0
  let g = 0
  let b = 0
  for (const p of parts) {
    const [pr, pg, pb] = wavelengthRGB(p.nm)
    r += pr * p.I
    g += pg * p.I
    b += pb * p.I
  }
  const m = Math.max(r, g, b)
  if (m <= 0) return { color: 'rgb(0,0,0)', alpha: 0 }
  const c = (v: number) => Math.round(255 * Math.pow(v / m, 0.8))
  return { color: `rgb(${c(r)}, ${c(g)}, ${c(b)})`, alpha: Math.min(1, m / Math.max(1, parts.length / 2.5)) }
}
