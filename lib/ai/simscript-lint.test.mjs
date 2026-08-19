// The SimScript verifier — where the AI pipeline's reliability comes from.
// Run: node lib/ai/simscript-lint.test.mjs
//
// Generation costs ~2s of GPU; verification costs microseconds and no model.
// So every failure mode the model actually produces must be caught HERE, and
// no valid script may ever be rejected (a false positive burns a real
// generation round and can loop).
//
// The failing cases below are not invented: they are the verbatim output the
// local 7B produced on its first benchmark run.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'simscript-lint-'))
const bundle = join(dir, 'lint.mjs')
execFileSync('npx', ['esbuild', resolve(import.meta.dirname, 'simscript-lint.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`,
  '--alias:@=' + resolve(import.meta.dirname, '../..')], { stdio: 'pipe' })
const { lintSimScript } = await import(bundle)
rmSync(dir, { recursive: true, force: true })

const lint = (s) => lintSimScript(s)

// ── The four failure modes measured from real model output ─────────────────

test('a reserved word gets an actionable message, not "Unexpected token"', () => {
  const r = lint('var switch = create("switch", { closed: 1 });')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /reserved JavaScript word/)
  assert.match(r.errors[0], /switch/, 'names the offending word so the model can rename it')
})

test('connect() with a missing anchor is caught', () => {
  // The silent killer: two args, parses fine, wires to nothing.
  const r = lint('var b = create("bulb", {});\nvar t = create("battery", {});\nconnect(t.positive, b);')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /missing an anchor/)
  // The suggestion names the VARIABLE (what the model must type), not the kind,
  // and leads with the idiomatic anchor the corpus teaches.
  assert.match(r.errors[0], /write b\.a\b/, 'suggests a concrete, idiomatic replacement')
})

test('an anchor the kind does not have is caught, with the legal set', () => {
  const r = lint('var r = create("resistor", {});\nvar t = create("battery", {});\nconnect(t.positive, r.gate);')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /no anchor "gate"/)
  assert.match(r.errors[0], /input1/, 'lists what IS valid')
})

test('an invented graph channel is caught, with the real channels', () => {
  const r = lint('var b = create("bulb", {});\ngraph.plot(b.channel);')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /no channel "channel"/)
  assert.match(r.errors[0], /V, I, P/, 'names the channels a bulb actually publishes')
})

test('plotting a component that publishes nothing is caught', () => {
  const r = lint('var g = create("and-gate", {});\ngraph.plot(g.V);')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /publishes no data/)
})

test('physics attached to a circuit component is caught', () => {
  const r = lint('var t = create("battery", {});\naddproperty(t, "rigidBody", { mass: 1 });')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /not a physical body/)
})

test('unknown kinds and the create("graph") anti-pattern still error', () => {
  assert.match(lint('var x = create("flux-capacitor", {});').errors[0], /unknown kind/)
  assert.match(lint('var g = create("graph", {});').errors[0], /graph\.plot/)
  assert.match(lint('var s = create("symbol", { symbol: "resistor" });').errors[0], /directly/)
})

// ── Fences are stripped, never a hard failure ──────────────────────────────

test('markdown fences are stripped and warned about, not errored', () => {
  // Erroring would spend a full ~2s generation round on something a
  // replace() fixes for free.
  const r = lint('```simscript\nvar t = create("battery", { V: 9 });\n```')
  assert.equal(r.ok, true, 'fences alone must not fail a valid script')
  assert.equal(r.cleaned, 'var t = create("battery", { V: 9 });')
  assert.match(r.warnings.join(' '), /fences/)
})

test('cleaned is always returned, even on failure', () => {
  const r = lint('```\nvar switch = create("switch", {});\n```')
  assert.equal(r.ok, false)
  assert.ok(!r.cleaned.includes('```'), 'repair must receive fence-free source')
})

test('a trailing // comment does not read as a syntax error', () => {
  // The syntax probe wraps the script in `with(sandbox) { … }`. On one line,
  // a trailing comment swallows the closing brace and EVERY commented script
  // was rejected — a false positive that burns a full generation round.
  const r = lint('var p = create("probe");\ngraph.plot(p.V); // Plot the voltage')
  assert.equal(r.ok, true, `got: ${r.errors.join('; ')}`)
})

test('a prose preamble is stripped, not errored', () => {
  // Models preface code with "Here is the script:". Same reasoning as fences:
  // a ~2s model round is far too expensive to spend on chit-chat.
  const r = lint('Here is the script:\n\nvar p = create("probe");\ngraph.plot(p.V);')
  assert.equal(r.ok, true, `got: ${r.errors.join('; ')}`)
  assert.ok(!r.cleaned.startsWith('Here'), 'prose is removed from cleaned')
})

test('an all-prose reply still fails loudly', () => {
  // Stripping must never turn a non-answer into an empty "valid" script.
  const r = lint("I'm not sure what you mean by that.")
  assert.equal(r.ok, false)
})

test('create() with no props object is valid', () => {
  const r = lint('var p = create("probe");\nvar t = create("battery", { V: 9 });\nconnect(t.positive, p.terminal);')
  assert.equal(r.ok, true, `got: ${r.errors.join('; ')}`)
})

test('commented-out code is not flagged', () => {
  // The model's most common way to obey "drop this line" is to comment it
  // out. Flagging the comment makes the repair loop unwinnable — measured:
  // it burned all 3 attempts on exactly this.
  const r = lint('var b = create("bulb", { R: 20 });\n// addproperty(b, "rigidBody", { mass: 1 }); // dropped\n/* connect(b, b); */')
  assert.equal(r.ok, true, `got: ${r.errors.join('; ')}`)
})

test('chained property access is rejected in plot and connect', () => {
  // `graph.plot(battery.channel.V)` — real model output — parses fine and
  // plots nothing. An anchor or channel is always exactly one property deep,
  // and the model reaches for a chain when unsure of the real name.
  const plot = lint('var b = create("battery", {});\ngraph.plot(b.channel.V);')
  assert.equal(plot.ok, false)
  assert.match(plot.errors[0], /too deep/)
  assert.match(plot.errors[0], /b\.V/, 'suggests the real one-level channel')

  const conn = lint('var b = create("bulb", {});\nvar t = create("battery", {});\nconnect(t.positive, b.a.x);')
  assert.equal(conn.ok, false)
  assert.match(conn.errors[0], /too deep/)
})

test('the channel tables survive the server module boundary', () => {
  // Regression: these tables used to be re-exported from channels.ts, which
  // is a 'use client' module. A Set crossing that boundary arrives on the
  // server as a plain object with no prototype, so `.has()` was undefined and
  // every /api/ai request died with "SILENT_SYMBOLS.has is not a function".
  // They are plain arrays in the pure module now. Exercising a silent symbol
  // and a V/I/P symbol proves both lookups still work.
  const silent = lint('var g = create("and-gate", {});\ngraph.plot(g.V);')
  assert.equal(silent.ok, false)
  assert.match(silent.errors[0], /publishes no data/)

  const vip = lint('var b = create("bulb", {});\ngraph.plot(b.V);')
  assert.equal(vip.ok, true, `got: ${vip.errors.join('; ')}`)

  const named = lint('var p = create("potentiometer", {});\ngraph.plot(p.Vwiper);')
  assert.equal(named.ok, true, 'a per-symbol channel table entry still resolves')
})

test('an invented domain name is not a component', () => {
  // The model reaches for the DOMAIN ("mechanics") instead of a real kind.
  const r = lint('var p = create("mechanics", { mass: 1 });\ngraph.plot(p.x);')
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /unknown kind "mechanics"/)
})

// ── System boundary: buildWorld's Play/Step scoping (lib/physics/world.ts
// scopeId) only simulates what a system's rect contains, so a multi-body
// scene placed loose on the page is silently unplayable as a unit — and
// AI-authored scenes never agreed on where "the page" even was, each
// generation guessing fresh absolute coordinates. ───────────────────────────

test('two or more placed components with no system is an error', () => {
  const r = lint(
    'var floor = create("ground", { x: 0, y: 500 });\nvar ball = create("mass", { x: 200, y: 100, mass: 2 });'
  )
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /never creates a "system"/)
})

test('a single loose component is fine — the rule is for real multi-body scenes', () => {
  const r = lint('var field = create("bfield", { x: 250, y: 150, width: 320, height: 260, Bz: 2 });')
  assert.equal(r.ok, true)
})

test('a system followed by components inside its bounds lints clean', () => {
  const r = lint(
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 400 });\n' +
      'var floor = create("ground", { x: 40, y: 340 });\n' +
      'var ball = create("mass", { x: 200, y: 100, mass: 2 });'
  )
  assert.equal(r.ok, true)
})

test('a component placed outside every system\'s bounds is an error, by centre not corner', () => {
  const r = lint(
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 300, height: 300 });\n' +
      'var floor = create("ground", { x: 40, y: 200 });\n' +
      // centre lands at (900+32, 100+32) — nowhere near the 300x300 box.
      'var ball = create("mass", { x: 900, y: 100, mass: 2 });'
  )
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /"ball".*outside every system/)
})

test('an object straddling the edge is judged by its centre, not its corner', () => {
  // top-left at (280, 40) with a default ~64px box puts the CENTRE at
  // (312, 72) — just inside a 0..320 system, even though the corner is at
  // x=280 and the far edge (280+64=344) pokes past 320. buildWorld itself
  // only ever tests the centre, so the lint check must match that exactly
  // or it would flag scenes the real engine plays just fine.
  const r = lint(
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 320, height: 320 });\n' +
      'var a = create("ground", { x: 20, y: 20 });\n' +
      'var b = create("mass", { x: 280, y: 40, mass: 1 });'
  )
  assert.equal(r.ok, true)
})

// ── No false positives: every one of these MUST pass ───────────────────────
// A false positive burns a real generation round and can loop, so this is
// the half of the suite that matters most.

test('valid scripts are never rejected', () => {
  const good = {
    'basic circuit': 'var t = create("battery", { V: 9 });\nvar b = create("bulb", { R: 20 });\nconnect(t.positive, b.a);\nconnect(b.b, t.negative);',
    'real channels': 'var b = create("bulb", {});\ngraph.plot(b.V);\ngraph.plot(b.I, "bar");',
    'mechanics motion': 'var m = create("block", { mass: 2 });\ngraph.plot(m.vy);',
    'centre anchors': 'var a = create("mass", {});\nvar b = create("mass", {});\nconnect(a.centre, b.centre, "spring");',
    'physics on a bare shape': 'var s = create("rect", {});\naddproperty(s, "rigidBody", { mass: 2 });',
    't2 anchor synonyms': 'var d = create("diode", {});\nvar t = create("battery", {});\nconnect(t.plus, d.anode);',
    'numeric pin anchors': 'var q = create("bjt", {});\nvar t = create("battery", {});\nconnect(t.positive, q.pin0);',
    'styling props': 'var x = create("rect", { fill: "#f00", locked: true });\nvar tx = create("text", { text: "# Hi" });',
    'y-vs-x plot': 'var m = create("mass", {});\ngraph.plot(m.vy, m.vx, "scatter");',
  }
  for (const [name, src] of Object.entries(good)) {
    const r = lint(src)
    assert.equal(r.ok, true, `${name} must lint clean, got: ${r.errors.join('; ')}`)
  }
})

test('the whole real failing output converges within the 2-retry cap', () => {
  // Round 1: the syntax error masks everything else (parsing stops).
  const round1 = lint('```simscript\nvar battery = create("battery", { V: 9 });\nvar bulb = create("bulb", { R: 20 });\nvar switch = create("switch", { closed: false });\nconnect(battery.positive, switch.a);\nconnect(switch.b, bulb);\naddproperty(battery, "rigidBody", { mass: 1 });\ngraph.plot(bulb.channel);\n```')
  assert.equal(round1.ok, false)

  // Round 2: with only the rename applied, EVERY remaining error surfaces at
  // once — so the worst case is 2 repair rounds, inside the cap.
  const round2 = lint('var battery = create("battery", { V: 9 });\nvar bulb = create("bulb", { R: 20 });\nvar sw1 = create("switch", { closed: 0 });\nconnect(battery.positive, sw1.a);\nconnect(sw1.b, bulb);\naddproperty(battery, "rigidBody", { mass: 1 });\ngraph.plot(bulb.channel);')
  assert.equal(round2.ok, false)
  assert.ok(round2.errors.length >= 3, 'all remaining problems reported in one batch')

  // Round 3: the fully corrected script.
  const fixed = lint('var battery = create("battery", { V: 9 });\nvar bulb = create("bulb", { R: 20 });\nvar sw1 = create("switch", { closed: 0 });\nconnect(battery.positive, sw1.a);\nconnect(sw1.b, bulb.a);\nconnect(bulb.b, battery.negative);\ngraph.plot(bulb.V);')
  assert.equal(fixed.ok, true, `corrected script must pass, got: ${fixed.errors.join('; ')}`)
})

// Control wiring — a slider aimed at a param its target does not have.
//
// Measured escape: asked for "a simple pendulum with a length slider", the
// model wired `targetParamName: "length"` onto a `mass`. Nothing rejected
// it, so the slider shipped inert — the user got a slider that did nothing
// when dragged, and an unresolvable target also lets a bad value reach the
// object's position.
test('a control aimed at a non-existent param is rejected', () => {
  const bad = lint([
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 500 });',
    'var bob = create("mass", { x: 320, y: 340, mass: 1 });',
    'var lSlider = create("slider", { x: 60, y: 460, min: 50, max: 300, value: 200, targetObjectId: bob, targetParamName: "length" });',
  ].join('\n'))
  assert.equal(bad.ok, false)
  assert.ok(
    bad.errors.some((e) => /targetParamName/.test(e) && /length/.test(e)),
    `expected a targetParamName error, got: ${bad.errors.join('; ')}`
  )
})

test('legitimate control wiring still passes', () => {
  // A behavior param, a geometry property, and a spring's real param name
  // (`k`, not "stiffness") — all three are what the corpus teaches.
  for (const [target, kind, param] of [
    ['bob', 'mass', 'mass'],
    ['bob', 'mass', 'y'],
    ['sp', 'spring', 'k'],
  ]) {
    const r = lint([
      'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 500 });',
      `var ${target} = create("${kind}", { x: 200, y: 200 });`,
      `var s = create("slider", { x: 60, y: 460, min: 1, max: 20, value: 5, targetObjectId: ${target}, targetParamName: "${param}" });`,
    ].join('\n'))
    assert.ok(
      !r.errors.some((e) => /targetParamName/.test(e)),
      `${kind}.${param} must not be flagged, got: ${r.errors.join('; ')}`
    )
  }
})
