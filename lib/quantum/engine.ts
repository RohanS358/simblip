import { C, cAdd, cSub, cMul, cDiv, cAbs, type Complex } from '@/lib/waves/engine'

// Quantum demos for the Engineering Physics modern-physics unit. These are
// the exact closed forms already verified in the syllabus coverage plan's
// Phase H (against the sandboxed mathjs instance in lib/formula/engine.ts) —
// this file just gives them a home so `quantumWell`/`tunnelBarrier` objects
// can read them directly instead of the user hand-building a Formula/Graph.
//
// Both are stationary-state demos (no time dependence) and, like ℏ and m
// below, are pedagogically normalized to 1 — the same normalization
// convention as lib/waves/engine.ts's ε0 = μ0 = 1 — so n, L, E, V0 can be
// small human-editable numbers instead of real SI magnitudes.

/** Particle-in-a-box wavefunction ψn(x), 0 ≤ x ≤ L. */
export function psi(n: number, L: number, x: number): number {
  if (L <= 0 || x < 0 || x > L) return 0
  return Math.sqrt(2 / L) * Math.sin((n * Math.PI * x) / L)
}

export function probabilityDensity(n: number, L: number, x: number): number {
  const p = psi(n, L, x)
  return p * p
}

/** Energy level n of a particle in a 1-D infinite well of width L. */
export function energyLevel(n: number, L: number, m = 1, hbar = 1): number {
  return (n * n * Math.PI * Math.PI * hbar * hbar) / (2 * m * L * L)
}

/** Transmission probability through a rectangular barrier of height V0,
 * width L, for a particle of energy E and mass m. E < V0 is the tunneling
 * regime (sinh); E > V0 is classically allowed but still partially
 * reflected (sin) — same formula analytically continued across E = V0. */
export function transmissionCoefficient(E: number, V0: number, L: number, m = 1, hbar = 1): number {
  if (E <= 0) return 0
  if (Math.abs(E - V0) < 1e-9) {
    // limit of the sinh branch as k2 → 0
    return 1 / (1 + (m * V0 * L * L) / (2 * hbar * hbar))
  }
  if (E < V0) {
    const k2 = Math.sqrt(2 * m * (V0 - E)) / hbar
    const s = Math.sinh(k2 * L)
    return 1 / (1 + (V0 * V0 * s * s) / (4 * E * (V0 - E)))
  }
  const k2 = Math.sqrt(2 * m * (E - V0)) / hbar
  const s = Math.sin(k2 * L)
  return 1 / (1 + (V0 * V0 * s * s) / (4 * E * (E - V0)))
}

/** Probability density of the equal superposition (ψn + ψm)/√2 at time t
 *  (ħ = m = 1). The cross term beats at ω = (Em − En): the particle sloshes
 *  across the well with period 2π/(Em − En) — real dynamics, and the one
 *  thing a single stationary state can never show. */
export function superpositionDensity(n: number, m: number, L: number, x: number, t: number): number {
  const a = psi(n, L, x)
  const b = psi(m, L, x)
  const w = energyLevel(m, L) - energyLevel(n, L)
  return 0.5 * (a * a + b * b + 2 * a * b * Math.cos(w * t))
}

/** Re Ψ(x,t) for the same superposition (the part that visibly oscillates). */
export function superpositionRe(n: number, m: number, L: number, x: number, t: number): number {
  return (psi(n, L, x) * Math.cos(energyLevel(n, L) * t) + psi(m, L, x) * Math.cos(energyLevel(m, L) * t)) / Math.SQRT2
}

const cExpI = (z: Complex): Complex => {
  // e^{i z} for complex z = a + ib → e^{−b}(cos a + i sin a)
  const m = Math.exp(-z.im)
  return C(m * Math.cos(z.re), m * Math.sin(z.re))
}

export interface BarrierSolution {
  k: number
  r: Complex
  t: Complex
  /** complex ψ(x); x = 0..L is the barrier, incident wave e^{ikx} from the left */
  psi: (x: number) => Complex
}

/** Exact stationary scattering state for a rectangular barrier (ħ = m = 1):
 *    x < 0:      e^{ikx} + r e^{−ikx}
 *    0 ≤ x ≤ L:  A e^{iqx} + B e^{−iqx},  q = √(2(E − V0))  (imaginary below the top)
 *    x > L:      t e^{ikx}
 *  with A, B, r, t fixed by continuity of ψ and ψ′ at both edges. */
export function solveBarrier(E: number, V0: number, L: number): BarrierSolution {
  const e = Math.max(E, 1e-6)
  const k = Math.sqrt(2 * e)
  const d = 2 * (e - V0)
  let q = d >= 0 ? C(Math.sqrt(d)) : C(0, Math.sqrt(-d))
  if (cAbs(q) < 1e-6) q = C(1e-6)
  const K = C(k)
  const kp = cAdd(K, q)
  const km = cSub(K, q)
  const eNeg = cExpI(cMul(C(-1), cMul(q, C(L)))) // e^{−iqL}
  const ePos = cExpI(cMul(q, C(L))) // e^{iqL}
  const den = cSub(cMul(cMul(kp, kp), eNeg), cMul(cMul(km, km), ePos))
  const t = cMul(cDiv(cMul(C(4 * k), q), den), cExpI(C(-k * L)))
  const tE = cMul(t, cExpI(C(k * L))) // t e^{ikL}
  const twoQ = cMul(C(2), q)
  const A = cDiv(cMul(cMul(tE, eNeg), kp), twoQ)
  const B = cDiv(cMul(cMul(tE, ePos), cMul(C(-1), km)), twoQ)
  const r = cSub(cAdd(A, B), C(1))
  return {
    k,
    r,
    t,
    psi: (x) => {
      if (x < 0) return cAdd(cExpI(C(k * x)), cMul(r, cExpI(C(-k * x))))
      if (x > L) return cMul(t, cExpI(C(k * x)))
      return cAdd(cMul(A, cExpI(cMul(q, C(x)))), cMul(B, cExpI(cMul(C(-1), cMul(q, C(x))))))
    },
  }
}
