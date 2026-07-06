// Optics engine — 2D geometric ray tracer for the Engineering Physics optics
// unit (lens/mirror diagrams, single/double-slit blocking).
//
// Unlike the circuit/physics engines this needs no time-stepping: a ray
// path is a pure function of the current scene, so it's recomputed
// reactively whenever an object moves or a param changes (see the
// light-source render branch in components/objects/geometry.tsx).
//
// Elements are drawn as 'line' geometry (their two endpoints define the
// aperture, like a real optical-bench diagram) carrying one behavior:
// 'thinLens', 'opticalMirror', 'opticalScreen' or 'slit'. A light source is
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
  hitScreen?: Vec2
}

function pv(obj: SceneObject, name: string, fallback: number): number {
  const p = obj.parameters[name]
  return p?.kind === 'number' && Number.isFinite(p.value) ? p.value : fallback
}

function hasBehavior(obj: SceneObject, type: string): boolean {
  return obj.behaviors.some((b) => b.enabled && b.type === type)
}

/** World-space endpoints of a 'line' object (rotation applied about its own center). */
function lineEndpoints(obj: SceneObject): [Vec2, Vec2] {
  const pts = obj.geometry.points ?? [
    [0, 0],
    [obj.size.w, 0],
  ]
  const cx = obj.position.x + obj.size.w / 2
  const cy = obj.position.y + obj.size.h / 2
  const rad = (obj.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const world = (p: number[]): Vec2 => {
    const wx = obj.position.x + p[0]
    const wy = obj.position.y + p[1]
    const dx = wx - cx
    const dy = wy - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }
  return [world(pts[0]), world(pts[pts.length - 1])]
}

type ElementKind = 'lens' | 'mirror' | 'screen' | 'slit'

interface OpticalElement {
  obj: SceneObject
  kind: ElementKind
  a: Vec2 // one aperture endpoint
  b: Vec2 // the other
}

function collectElements(objects: SceneObject[]): OpticalElement[] {
  const out: OpticalElement[] = []
  for (const obj of objects) {
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

/** Unit normal to the element's aperture line (either sense — we only use it for reflection/refraction geometry, which is sign-symmetric). */
function normalOf(el: OpticalElement): Vec2 {
  const t = normalize({ x: el.b.x - el.a.x, y: el.b.y - el.a.y })
  return { x: -t.y, y: t.x }
}

const MAX_BOUNCES = 12
const MAX_LEN = 4000

function traceOneRay(origin: Vec2, dir: Vec2, elements: OpticalElement[], wavelengthNm: number, sourceId: string): RayPath {
  const points: Vec2[] = [origin]
  let o = origin
  let d = normalize(dir)
  let hitScreen: Vec2 | undefined

  for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
    let bestT = Infinity
    let bestEl: OpticalElement | null = null
    for (const el of elements) {
      const t = intersectRaySegment(o, d, el.a, el.b)
      if (t !== null && t < bestT) {
        bestT = t
        bestEl = el
      }
    }
    if (!bestEl || bestT > MAX_LEN) {
      const end = { x: o.x + d.x * MAX_LEN, y: o.y + d.y * MAX_LEN }
      points.push(end)
      break
    }
    const hit = { x: o.x + d.x * bestT, y: o.y + d.y * bestT }
    points.push(hit)

    if (bestEl.kind === 'screen') {
      hitScreen = hit
      break
    }
    if (bestEl.kind === 'slit') {
      const y = heightAlong(bestEl, hit)
      const gap = pv(bestEl.obj, 'gap', 20)
      const count = Math.max(1, Math.min(2, Math.round(pv(bestEl.obj, 'count', 1))))
      const spacing = pv(bestEl.obj, 'spacing', 60)
      const centers = count === 2 ? [-spacing / 2, spacing / 2] : [0]
      const open = centers.some((c) => Math.abs(y - c) <= gap / 2)
      if (!open) break // absorbed by the mask
      // passes straight through — nudge origin past the slit line and continue
      o = { x: hit.x + d.x * 1e-3, y: hit.y + d.y * 1e-3 }
      continue
    }
    if (bestEl.kind === 'mirror') {
      const n = normalOf(bestEl)
      const dot = d.x * n.x + d.y * n.y
      d = normalize({ x: d.x - 2 * dot * n.x, y: d.y - 2 * dot * n.y })
      o = { x: hit.x + d.x * 1e-3, y: hit.y + d.y * 1e-3 }
      continue
    }
    if (bestEl.kind === 'lens') {
      const f = pv(bestEl.obj, 'f', 150) || 1e6
      const n = normalOf(bestEl)
      const t = normalize({ x: bestEl.b.x - bestEl.a.x, y: bestEl.b.y - bestEl.a.y })
      const y = heightAlong(bestEl, hit)
      const dn = d.x * n.x + d.y * n.y // forward component
      const dt = d.x * t.x + d.y * t.y // transverse component
      // Paraxial thin-lens kick: Δ(transverse/forward) = -y/f
      const dtNew = dt - (y / f) * Math.abs(dn || 1)
      d = normalize({ x: dn * n.x + dtNew * t.x, y: dn * n.y + dtNew * t.y })
      o = { x: hit.x + d.x * 1e-3, y: hit.y + d.y * 1e-3 }
      continue
    }
  }

  return { sourceId, points, wavelengthNm, hitScreen }
}

/** Trace every light source in the scene against every optical element. Pure function of the scene — call it fresh whenever objects change. */
export function traceRays(objects: SceneObject[]): RayPath[] {
  const sources = objects.filter((o) => o.geometry.kind === 'circle' && hasBehavior(o, 'lightSource'))
  if (sources.length === 0) return []
  const elements = collectElements(objects)
  const rays: RayPath[] = []

  for (const src of sources) {
    const angle = (src.rotation * Math.PI) / 180
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    const perp = { x: -dir.y, y: dir.x }
    const n = Math.max(1, Math.round(pv(src, 'rays', 3)))
    const aperture = pv(src, 'aperture', 80)
    const wavelengthNm = pv(src, 'wavelength', 550)
    const cx = src.position.x + src.size.w / 2
    const cy = src.position.y + src.size.h / 2
    for (let i = 0; i < n; i++) {
      const offset = n === 1 ? 0 : -aperture / 2 + (aperture * i) / (n - 1)
      const origin = { x: cx + perp.x * offset, y: cy + perp.y * offset }
      rays.push(traceOneRay(origin, dir, elements, wavelengthNm, src.id))
    }
  }
  return rays
}

/** Rough visible-spectrum tint for a wavelength, purely cosmetic. */
export function wavelengthColor(nm: number): string {
  if (nm < 450) return '#7c4dff'
  if (nm < 495) return '#2979ff'
  if (nm < 570) return '#00c853'
  if (nm < 590) return '#ffd600'
  if (nm < 620) return '#ff9100'
  return '#ff1744'
}
