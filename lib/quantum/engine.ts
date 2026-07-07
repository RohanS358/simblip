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
