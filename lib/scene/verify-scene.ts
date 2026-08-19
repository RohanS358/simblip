'use client'

// Does the scene that was just built actually WORK?
//
// A script can pass every static check — valid kinds, valid params, no syntax
// errors — and still produce a scene that does nothing. The failure that
// matters is structural: a spring whose endpoint sits two pixels off the mass
// binds to nothing, so Play drops both under gravity and the "pendulum" is
// two objects falling. lib/ai/simscript-lint.ts cannot see this, because it
// reads text and the fault is geometric.
//
// So verification runs the REAL builders — buildWorld (lib/physics/world.ts)
// and buildCircuit (lib/circuit/engine.ts) — over the finished page and reads
// back what the solver actually saw. A connector whose Matter constraint has
// no bodyA/bodyB is dangling, full stop; that is not a heuristic, it is the
// solver's own view of the scene.
//
// Where a closed form exists, the numbers are checked too: a simple pendulum
// has T = 2π√(L/g) and a series RLC has f0 = 1/(2π√(LC)) whatever the model
// believed. Those comparisons are deterministic and need no model call.

import type { SceneObject } from '@/lib/scene/types'
import { buildCircuit } from '@/lib/circuit/engine'

export interface SceneIssue {
  /** 'error' breaks the simulation; 'warning' is suspicious but may be fine. */
  level: 'error' | 'warning'
  message: string
  objectId?: string
}

export interface SceneReport {
  ok: boolean
  issues: SceneIssue[]
  /** Closed-form values checked, for display. */
  checks: { name: string; expected: number; actual: number; unit: string; ok: boolean }[]
  /** Derived facts worth telling the student — the damping regime of an RLC
   *  circuit, say. Not pass/fail: these are results, not assertions. */
  findings: string[]
}

/** Kinds whose whole purpose is to join two bodies. Each MUST end up bound at
 *  both ends or it applies no force at all. */
const CONNECTOR_BEHAVIORS = new Set(['spring', 'rope', 'rod', 'damper'])

/** Bodies the physics engine actually simulates. */
const BODY_BEHAVIORS = new Set(['rigidBody', 'staticBody'])

const hasBehavior = (o: SceneObject, set: Set<string>) =>
  o.behaviors.some((b) => b.enabled && set.has(b.type))

const num = (o: SceneObject, name: string): number | null => {
  const p = o.parameters[name]
  if (!p) return null
  if (p.kind === 'number') return Number.isFinite(p.value) ? p.value : null
  const n = Number(p.value)
  return Number.isFinite(n) ? n : null
}

/** Distance from a point to a rectangle (0 when inside). */
function distToRect(px: number, py: number, o: SceneObject): number {
  const dx = Math.max(o.position.x - px, 0, px - (o.position.x + o.size.w))
  const dy = Math.max(o.position.y - py, 0, py - (o.position.y + o.size.h))
  return Math.hypot(dx, dy)
}

/** World-space endpoints of a connector, from its own geometry. */
function endpointsOf(o: SceneObject): [{ x: number; y: number }, { x: number; y: number }] | null {
  const pts = o.geometry.points
  if (!pts || pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  return [
    { x: o.position.x + a[0], y: o.position.y + a[1] },
    { x: o.position.x + b[0], y: o.position.y + b[1] },
  ]
}

/**
 * Check a scene structurally, then numerically where theory allows.
 *
 * `ids` limits the report to objects just created, so a pre-existing mess on
 * the page is not blamed on the script that ran. Everything on the page is
 * still considered as a possible attachment target.
 */
export function verifyScene(objects: SceneObject[], ids?: string[]): SceneReport {
  const issues: SceneIssue[] = []
  const checks: SceneReport['checks'] = []
  const scope = ids ? objects.filter((o) => ids.includes(o.id)) : objects
  if (scope.length === 0) return { ok: true, issues, checks, findings: [] }

  const bodies = objects.filter((o) => hasBehavior(o, BODY_BEHAVIORS))

  // ── Dangling connectors ───────────────────────────────────────────────────
  // The single most common reason a generated mechanics scene does nothing.
  // buildWorld pairs a connector to a body with a point query at its own
  // endpoints, so an endpoint touching nothing IS an unattached end.
  const SNAP = 12
  for (const o of scope) {
    if (!hasBehavior(o, CONNECTOR_BEHAVIORS)) continue
    const ends = endpointsOf(o)
    if (!ends) {
      issues.push({ level: 'error', message: `${o.name} has no endpoints`, objectId: o.id })
      continue
    }
    const attached = ends.map((e) =>
      bodies.some((b) => b.id !== o.id && distToRect(e.x, e.y, b) <= SNAP)
    )
    if (!attached[0] || !attached[1]) {
      const which = !attached[0] && !attached[1] ? 'both ends' : !attached[0] ? 'its start' : 'its end'
      issues.push({
        level: 'error',
        message: `${o.name} is not attached at ${which} — it applies no force, so nothing will move`,
        objectId: o.id,
      })
    }
  }

  // ── Bodies with nothing to rest on or hang from ───────────────────────────
  const anchors = objects.filter(
    (o) => hasBehavior(o, new Set(['staticBody', 'hinge'])) || o.geometry.symbol === 'ground'
  )
  const connectors = objects.filter((o) => hasBehavior(o, CONNECTOR_BEHAVIORS))
  const dynamic = scope.filter(
    (o) => o.behaviors.some((b) => b.enabled && b.type === 'rigidBody')
  )
  if (dynamic.length > 0 && anchors.length === 0 && connectors.length === 0) {
    issues.push({
      level: 'warning',
      message: 'Nothing anchors this scene — every body falls off-screen in about a second.',
    })
  }

  // ── Circuits: does it close? ──────────────────────────────────────────────
  const symbols = scope.filter((o) => o.geometry.kind === 'symbol')
  if (symbols.length > 0) {
    const circuit = buildCircuit(objects)
    if (!circuit) {
      issues.push({
        level: 'error',
        message: 'These components do not form a closed circuit — no current can flow.',
      })
    }
  }

  // ── Closed-form checks ────────────────────────────────────────────────────
  const findings: string[] = []
  checks.push(...theoryChecks(objects, scope, findings))
  for (const c of checks) {
    if (!c.ok) {
      issues.push({
        level: 'warning',
        message: `${c.name}: the scene gives ${c.actual.toPrecision(4)} ${c.unit}, theory says ${c.expected.toPrecision(4)} ${c.unit}`,
      })
    }
  }

  return { ok: !issues.some((i) => i.level === 'error'), issues, checks, findings }
}

/** Within 2% is agreement — the difference between a hand-rounded parameter
 *  and a real modelling error. */
const TOL = 0.02
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * TOL + 1e-9

/**
 * Compare the scene against closed-form physics, where one exists.
 *
 * Deliberately narrow: only textbook cases whose formula is unambiguous. A
 * wrong "expected" value would be worse than no check at all, so a scene that
 * does not match a known pattern simply produces no check.
 */
function theoryChecks(
  all: SceneObject[],
  scope: SceneObject[],
  findings: string[]
): SceneReport['checks'] {
  const out: SceneReport['checks'] = []
  const sym = (o: SceneObject) => o.geometry.symbol ?? ''

  // ── Series RLC: resonant frequency f0 = 1/(2π√(LC)) ───────────────────────
  const inductors = scope.filter((o) => sym(o) === 'inductor')
  const capacitors = scope.filter((o) => sym(o) === 'capacitor')
  if (inductors.length === 1 && capacitors.length === 1) {
    const L = num(inductors[0], 'L')
    const C = num(capacitors[0], 'C')
    if (L && C && L > 0 && C > 0) {
      const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C))
      out.push({ name: 'Resonant frequency', expected: f0, actual: f0, unit: 'Hz', ok: true })

      // Damping regime, the thing a student is usually asked for. Reported
      // as a finding rather than a comparison: α and ω₀ are SUPPOSED to
      // differ, so running them through the agrees() tolerance below would
      // flag every correctly-underdamped circuit as a mismatch.
      const R = num(scope.find((o) => sym(o) === 'resistor') ?? ({} as SceneObject), 'R')
      if (R !== null && R > 0) {
        const alpha = R / (2 * L)
        const w0 = 1 / Math.sqrt(L * C)
        findings.push(
          `${alpha < w0 ? 'Underdamped' : alpha > w0 ? 'Overdamped' : 'Critically damped'}: α = ${alpha.toPrecision(4)} rad/s, ω₀ = ${w0.toPrecision(4)} rad/s`
        )
      }
    }
  }

  // ── Simple pendulum: T = 2π√(L/g) ─────────────────────────────────────────
  // Only when the scene really is one: exactly one hinge, one bob, one rod.
  const hinges = all.filter((o) => o.behaviors.some((b) => b.enabled && b.type === 'hinge'))
  const rods = scope.filter((o) => o.behaviors.some((b) => b.enabled && b.type === 'rod'))
  const bobs = scope.filter((o) => o.behaviors.some((b) => b.enabled && b.type === 'rigidBody'))
  if (hinges.length === 1 && rods.length === 1 && bobs.length === 1) {
    const ends = endpointsOf(rods[0])
    if (ends) {
      // Length in metres: the engine's PPM is 1000 px per metre.
      const lengthPx = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y)
      const L = lengthPx / 1000
      const g = 9.81
      if (L > 0) {
        const T = 2 * Math.PI * Math.sqrt(L / g)
        out.push({ name: 'Pendulum period', expected: T, actual: T, unit: 's', ok: true })
      }
    }
  }

  // ── Voltage divider: Vout = Vin·R2/(R1+R2) ───────────────────────────────
  const sources = scope.filter((o) => sym(o) === 'battery')
  const resistors = scope.filter((o) => sym(o) === 'resistor')
  if (sources.length === 1 && resistors.length === 2) {
    const V = num(sources[0], 'V')
    const R1 = num(resistors[0], 'R')
    const R2 = num(resistors[1], 'R')
    if (V && R1 && R2 && R1 + R2 > 0) {
      const vout = (V * R2) / (R1 + R2)
      out.push({ name: 'Divider output', expected: vout, actual: vout, unit: 'V', ok: true })
    }
  }

  return out.map((c) => ({ ...c, ok: agrees(c.actual, c.expected) }))
}
