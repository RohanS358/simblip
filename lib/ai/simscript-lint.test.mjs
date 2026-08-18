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
