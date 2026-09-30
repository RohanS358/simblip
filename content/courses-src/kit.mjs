// Authoring kit for the computer-engineering lessons.
//
// A lesson is written as a compact module and expanded into the CourseDoc JSON
// the reader and the lint gate consume (content/courses/<course>/<lesson>.json).
// The point of the kit is the boilerplate it removes — figure scripts, per-choice
// responses, ids — and one guarantee it adds: every figure that runs a Step Lab
// engine PINS the engine's own numbers (`expect`), and prose gets those numbers
// from `run()` rather than from the author's head, so a quoted result can never
// drift from what the figure shows.

const esc = (v) => JSON.stringify(v)
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

/** `run(engine, params)` → the engine's named results (summary). Injected by the builder. */
export function makeKit(run) {
  let figN = 0
  const nextId = (p) => `${p}${++figN}`

  /** A Step Lab card. `pin` lists the result keys the gate must re-check. */
  const lab = (engine, params = {}, note = '', pin = [], o = {}) => {
    const name = o.name ?? 'lab'
    for (const k of Object.keys(params)) if (['x', 'y', 'z', 'width', 'height', 'name', 'rotation', 'dir', 'fill', 'stroke', 'opacity', 'radius', 'color', 'align', 'locked', 'hidden'].includes(k)) throw new Error(`Step Lab param "${k}" collides with a SimScript positional/styling prop — rename it in the engine`)
    const summary = run(engine, params)
    const props = { name, engine, ...params, width: o.w ?? 600, height: o.h ?? 440 }
    const expect = pin.length ? { [name]: Object.fromEntries(pin.map((k) => [k, summary[k]])) } : undefined
    return { id: o.id ?? nextId('lab'), caption: o.caption ?? '', note, script: `var lab = create("steplab", ${esc(props)});`, ...(o.locked ? { locked: true } : {}), ...(expect ? { expect } : {}), _summary: summary }
  }
  /** A diagram (flow / sequence / UML / block), optionally animated with @ lines. */
  const dia = (source, note = '', o = {}) => ({ id: o.id ?? nextId('dia'), caption: o.caption ?? '', note, script: `diagram(${esc(source.trim())});`, ...(o.locked ? { locked: true } : {}) })
  /** A C++ program in the DSA Lab. `pin` = { output: "…" } is checked by the gate. */
  const cpp = (source, note = '', o = {}) => ({ id: o.id ?? nextId('cpp'), caption: o.caption ?? '', note, script: `var lab = create("dsa", ${esc({ name: 'prog', source: source.trim() + '\n', width: 760, height: 520 })});`, ...(o.output !== undefined ? { expect: { prog: { output: o.output } } } : {}) })
  /** Any SimScript (circuits, charts, tables). */
  const scr = (script, note = '', o = {}) => ({ id: o.id ?? nextId('scr'), caption: o.caption ?? '', note, script: script.trim(), ...(o.expect ? { expect: o.expect } : {}) })

  /** One multiple-choice question. right = [text, why]; wrongs = [[text, why]…]. */
  const q = (id, prompt, right, wrongs, o = {}) => {
    const n = wrongs.length + 1
    const at = hash(id) % n
    const all = [...wrongs]
    all.splice(at, 0, right)
    const titles = ['A tempting idea.', 'Close, but not it.', 'It looks right at first.', 'A common shortcut.']
    return {
      id, prompt,
      choices: all.map((c, i) => ({ text: c[0], ...(i === at ? { correct: true } : {}) })),
      responses: all.map((c, i) => (i === at ? { title: 'Correct.', body: c[1] } : { title: titles[i % titles.length], body: c[1] })),
      ...(o.verify ? { verify: o.verify } : {}),
    }
  }
  const pr = (id, prompt, answer, o = {}) => ({ id, prompt, answer, ...(o.math ? { math: o.math } : {}), ...(o.verify ? { verify: o.verify } : {}) })
  const step = (why, math, o = {}) => ({ ...(o.toc ? { toc: o.toc } : {}), why, ...(math ? { math } : {}), ...(o.hero ? { hero: true } : {}) })

  /** A section. `figs` are numbered "Figure <locator>.<k> — caption". */
  const sec = (id, locator, title, o = {}) => {
    const figures = (o.figs ?? []).map((f, k) => ({ ...f, caption: `Figure ${locator}.${k + 1} — ${f.caption || title}` }))
    const strip = (f) => { const { _summary, ...rest } = f; return rest }
    return {
      id, locator, title,
      ...(o.eyebrow ? { eyebrow: o.eyebrow } : {}),
      ...(o.body ? { body: o.body } : {}),
      ...(o.deriv ? { derivation: o.deriv } : {}),
      ...(o.worked ? { worked: o.worked } : {}),
      ...(o.qs ? { questions: o.qs.map((x) => (x.verify ? { ...x, verify: { ...strip(x.verify), caption: `Verify — ${x.verify.caption || 'run it'}` } } : x)) } : {}),
      ...(figures.length ? { figures: figures.map(strip) } : {}),
      ...(o.probs ? { problems: o.probs.map((p) => (p.verify ? { ...p, verify: strip(p.verify) } : p)) } : {}),
      ...(o.after ? { after: o.after } : {}),
    }
  }
  const term = (t) => `<em class="term">${t}</em>`
  return { lab, dia, cpp, scr, q, pr, step, sec, term, run }
}

export const lesson = (o) => o
