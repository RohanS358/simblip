// Engineering-economics arithmetic for lesson prose. The cashflow card computes these live; this
// mirrors it so a number quoted in text is computed, not remembered.
export const fmt = (v, d = 2) => Number(v).toFixed(d).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m))
export const comma = (v) => Math.round(v).toLocaleString('en-US')
export const pf = (i, n) => (1 + i) ** -n                                   // P/F
export const fp = (i, n) => (1 + i) ** n                                    // F/P
export const pa = (i, n) => (1 - (1 + i) ** -n) / i                         // P/A
export const ap = (i, n) => (i * (1 + i) ** n) / ((1 + i) ** n - 1)         // A/P
export const af = (i, n) => i / ((1 + i) ** n - 1)                          // A/F
export const npv = (i, flows) => flows.reduce((s, c, t) => s + c / (1 + i) ** t, 0)
export const irr = (flows) => { let lo = -0.99, hi = 10; for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (npv(m, flows) > 0) lo = m; else hi = m } return (lo + hi) / 2 }
