// Plane-wave and transmission-line formulas for the Electromagnetics unit
// (ENEX 254 ch. 4–6). Everything here is closed-form — like the optics ray
// tracer, no time-stepping solver is needed; the only time-varying quantity
// is the traveling-wave snapshot rendered by `waveSource` objects, driven by
// the existing runtime clock (`useRuntimeStore` in lib/physics/world.ts).
//
// Units are pedagogically normalized (ε0 = μ0 = 1, a fixed pedagogical wave
// speed `C_PX`) so a legible wave fits on a canvas at human-editable f/εr/σ
// values. The *formulas* below are the real Hayt/Sadiku closed forms for
// γ = α + jβ, η, Γ, τ and SWR — only the absolute unit scale is chosen for
// on-screen visibility, exactly like this app's springs/charges already use
// illustrative rather than strict-SI magnitudes (see docs/architecture.md).

export interface Complex {
  re: number
  im: number
}

export const C = (re: number, im = 0): Complex => ({ re, im })
export const cAdd = (a: Complex, b: Complex): Complex => C(a.re + b.re, a.im + b.im)
export const cSub = (a: Complex, b: Complex): Complex => C(a.re - b.re, a.im - b.im)
export const cMul = (a: Complex, b: Complex): Complex =>
  C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im || 1e-12
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im)
export const cArg = (a: Complex): number => Math.atan2(a.im, a.re)
export const cSqrt = (a: Complex): Complex => {
  const r = cAbs(a)
  const re = Math.sqrt((r + a.re) / 2)
  const im = (a.im < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - a.re) / 2))
  return C(re, im)
}

/** Pedagogical wave speed at εr = μr = 1, in px/s — chosen so a f≈1 wave has
 * a screen-legible wavelength, not a real-world 3×10⁸ m/s. */
export const C_PX = 200

export interface Medium {
  epsr: number
  mur: number
  sigma: number
}

/** Propagation constant γ = α + jβ for a uniform plane wave — one closed
 * form covering lossless (σ=0), lossy-dielectric and good-conductor media
 * (Hayt, Engineering Electromagnetics, ch. 11). */
export function propagationConstant(f: number, m: Medium): { alpha: number; beta: number } {
  const w = 2 * Math.PI * f
  const lossTangent = m.sigma / (w * m.epsr || 1e-12)
  const root = Math.sqrt(1 + lossTangent * lossTangent)
  const base = (w * Math.sqrt(m.epsr * m.mur)) / C_PX / Math.SQRT2
  return {
    alpha: base * Math.sqrt(Math.max(0, root - 1)),
    beta: base * Math.sqrt(Math.max(0, root + 1)),
  }
}

/** Intrinsic impedance η = √(jωμ / (σ + jωε)) — complex; real when lossless. */
export function intrinsicImpedance(f: number, m: Medium): Complex {
  const w = 2 * Math.PI * f
  return cSqrt(cDiv(C(0, w * m.mur), C(m.sigma, w * m.epsr)))
}

export function reflectionCoefficient(eta1: Complex, eta2: Complex): Complex {
  return cDiv(cSub(eta2, eta1), cAdd(eta2, eta1))
}

export function transmissionCoefficient(eta1: Complex, eta2: Complex): Complex {
  return cDiv(C(2 * eta2.re, 2 * eta2.im), cAdd(eta2, eta1))
}

/** Standing wave ratio from |Γ|, capped shy of ∞ for a perfect short/open. */
export function swr(gammaAbs: number): number {
  const g = Math.min(0.999, Math.max(0, gammaAbs))
  return (1 + g) / (1 - g)
}

/** Instantaneous field of a damped traveling wave, x ≥ 0 from the source —
 * the one time-varying quantity here; η/Γ/SWR are steady-state numbers. */
export function waveInstant(E0: number, beta: number, alpha: number, x: number, wt: number): number {
  return E0 * Math.cos(beta * x - wt) * Math.exp(-alpha * Math.max(0, x))
}

// ── Transmission lines (ch. 6) — lossless line, complex load ───────────────
// Posed directly in electrical length βl (standard transmission-line-problem
// convention — "a quarter-wave line" — so no separate f/velocity-factor pair
// is needed: l = λ·lambdaFrac and β = 2π/λ make βl = 2π·lambdaFrac exactly.

export function lineInputImpedance(Z0: number, ZL: Complex, betaL: number): Complex {
  const t = Math.tan(betaL)
  const num = cAdd(ZL, C(0, Z0 * t))
  const den = cAdd(C(Z0), cMul(C(0, t), ZL))
  return cMul(C(Z0), cDiv(num, den))
}

export function lineReflectionCoefficient(Z0: number, ZL: Complex): Complex {
  return cDiv(cSub(ZL, C(Z0)), cAdd(ZL, C(Z0)))
}

/** |V(x)| / |V0+| standing-wave envelope, x measured as electrical distance
 * (βx) from the load — the pattern drawn in transmission-line labs. */
export function voltageEnvelope(gamma: Complex, betaLMax: number, samples = 40): number[] {
  const gAbs = cAbs(gamma)
  const gArg = cArg(gamma)
  const out: number[] = []
  for (let i = 0; i < samples; i++) {
    const bx = (i / (samples - 1)) * betaLMax
    out.push(Math.sqrt(1 + gAbs * gAbs + 2 * gAbs * Math.cos(2 * bx + gArg)))
  }
  return out
}
