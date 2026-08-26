// The deterministic repair pass — every fix here is a ~2.2s model round the
// pipeline does not have to spend. Run: node lib/ai/simscript-fix.test.mjs
//
// Two contracts, and the second matters more than the first:
//   1. a script that failed the linter for a MECHANICAL reason now passes
//   2. a script that was already valid comes out byte-identical
//
// (2) is the one that can cause real damage. A wrong autofix produces a scene
// that lints clean and is silently mis-wired — strictly worse than the error
// it replaced, because nothing downstream will ever catch it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simscript-fix-'))
const build = (name) => {
  const out = join(dir, `${name}.mjs`)
  execFileSync('npx', ['esbuild', resolve(import.meta.dirname, `${name}.ts`),
    '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`], { stdio: 'pipe' })
  return out
}
const { autofixSimScript } = await import(build('simscript-fix'))
const { lintSimScript } = await import(build('simscript-lint'))
rmSync(dir, { recursive: true, force: true })

/** Assert the pass turns a linter failure into a linter pass. */
function repairs(label, src) {
  assert.equal(lintSimScript(src).ok, false, `${label}: fixture should fail the linter to begin with`)
  const { code, notes } = autofixSimScript(src)
  const after = lintSimScript(code)
  assert.equal(after.ok, true, `${label}: still failing — ${after.errors.join(' | ')}`)
  assert.ok(notes.length > 0, `${label}: repaired silently, with no note`)
  return code
}

test('a reserved word as a variable name is renamed', () => {
  // `switch` is both a component kind and a reserved word, so the model reaches
  // for it constantly — and it is a SYNTAX error, which makes the linter bail
  // before any other check runs. Fixing it unblocks everything downstream.
  const out = repairs('reserved', [
    'var switch = create("switch", { closed: true });',
    'var bat = create("battery", { V: 9 });',
    'connect(bat.positive, switch.a);',
    'connect(switch.b, bat.negative);',
  ].join('\n'))
  assert.match(out, /var switch1 = create\("switch"/)
  // The KIND is a string and must not be renamed with the variable.
  assert.match(out, /create\("switch"/)
  assert.doesNotMatch(out, /create\("switch1"/)
})

test('an invented channel name becomes the real one', () => {
  const out = repairs('channel', [
    'var r = create("resistor", { R: 100 });',
    'var b = create("battery", { V: 5 });',
    'connect(b.positive, r.a);',
    'connect(r.b, b.negative);',
    'graph.plot(r.voltage);',
  ].join('\n'))
  assert.match(out, /graph\.plot\(r\.V\)/)
})

test('an invented kind becomes the real one', () => {
  const out = repairs('kind', [
    'var c = create("cap", { C: 0.001 });',
    'var b = create("battery", { V: 5 });',
    'connect(b.positive, c.a);',
    'connect(c.b, b.negative);',
  ].join('\n'))
  assert.match(out, /create\("capacitor"/)
})

test('create("graph") is dropped and its plots re-pointed', () => {
  const out = repairs('graph object', [
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 360 });',
    'var g = create("graph");',
    'var m = create("mass", { x: 100, y: 100, mass: 2 });',
    'var gnd = create("ground", { x: 100, y: 300 });',
    'g.plot(m.y);',
  ].join('\n'))
  assert.doesNotMatch(out, /create\("graph"\)/)
  assert.match(out, /graph\.plot\(m\.y\)/)
})

test('a scene with no system wrapper gets one sized to its contents', () => {
  const out = repairs('missing system', [
    'var m = create("mass", { x: 200, y: 120, mass: 2 });',
    'var gnd = create("ground", { x: 100, y: 400 });',
    'graph.plot(m.y);',
  ].join('\n'))
  assert.match(out, /create\("system", \{ x: 0, y: 0, domain: "mechanics"/)
  // Sized to hold the lowest component, not left at the 360 default.
  const height = Number(/height: (\d+)/.exec(out)[1])
  assert.ok(height >= 464, `system too short to hold a body at y=400 (got ${height})`)
})

test('the wrapper picks the domain from the components present', () => {
  const out = repairs('optics domain', [
    'var src = create("light-source", { x: 40, y: 200 });',
    'var lens = create("thin-lens", { x: 240, y: 200, f: 80 });',
    'var scr = create("optical-screen", { x: 440, y: 200 });',
  ].join('\n'))
  assert.match(out, /domain: "optics"/)
})

test('a component outside the only system widens it instead of failing', () => {
  const out = repairs('outside bounds', [
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 300, height: 200 });',
    'var m = create("mass", { x: 500, y: 100, mass: 1 });',
    'var gnd = create("ground", { x: 500, y: 300 });',
  ].join('\n'))
  const w = Number(/width: (\d+)/.exec(out)[1])
  const h = Number(/height: (\d+)/.exec(out)[1])
  assert.ok(w >= 532 && h >= 332, `system was not widened enough (${w}x${h})`)
})

test('a valid script is returned untouched', () => {
  // The false-positive guard. Every one of these is idiomatic corpus output.
  const valid = [
    [
      'var b = create("battery", { V: 9 });',
      'var r = create("resistor", { R: 220 });',
      'var l = create("bulb", { R: 100 });',
      'connect(b.positive, r.a);',
      'connect(r.b, l.a);',
      'connect(l.b, b.negative);',
      'graph.plot(r.I);',
    ].join('\n'),
    [
      'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 360 });',
      'var m = create("mass", { x: 200, y: 60, mass: 2 });',
      'addproperty(m, "rigidBody", { mass: 2 });',
      'var g = create("ground", { x: 40, y: 300 });',
      'graph.plot(m.y);',
    ].join('\n'),
    'var n = create("note", { text: "Ohm\'s law", color: "yellow", x: 20, y: 20 });',
  ]
  for (const src of valid) {
    assert.equal(lintSimScript(src).ok, true, 'fixture is not actually valid')
    const { code, notes } = autofixSimScript(src)
    assert.equal(code, src, `changed a valid script:\n${notes.join('\n')}`)
    assert.deepEqual(notes, [])
  }
})

test('the pass is idempotent', () => {
  // The repair loop runs it on every attempt, so a second application must be
  // a no-op — otherwise the fixes fight each other across rounds.
  const src = [
    'var switch = create("switch", { closed: true });',
    'var c = create("cap", { C: 0.002 });',
    'var b = create("battery", { V: 5 });',
    'connect(b.positive, switch.a);',
    'connect(switch.b, c.a);',
    'connect(c.b, b.negative);',
    'graph.plot(c.voltage);',
  ].join('\n')
  const once = autofixSimScript(src).code
  const twice = autofixSimScript(once)
  assert.equal(twice.code, once)
  assert.deepEqual(twice.notes, [])
})

test('a one-letter quantity is never typo-matched to another', () => {
  // Measured escape. A transformer publishes only `I`, so `graph.plot(tr.V)`
  // is a real request for something it does not report — and edit distance
  // "fixes" V to I, which is a different physical quantity and lints clean.
  // Silently plotting current for voltage is exactly the failure this pass
  // must never produce, so short names get exact and alias matching only.
  const src = [
    'var ac = create("ac-source", { V: 12, f: 50 });',
    'var tr = create("transformer", { n: 2 });',
    'connect(ac.positive, tr.a);',
    'connect(ac.negative, tr.b);',
    'graph.plot(tr.V);',
  ].join('\n')
  const { code, notes } = autofixSimScript(src)
  assert.match(code, /graph\.plot\(tr\.V\)/, `rewrote a one-letter channel: ${notes.join(', ')}`)
})

test('a placeholder channel resolves on an instrument that reads one quantity', () => {
  // The most common measured channel failure: the model writes the word
  // "channel" literally, having read it in the API description.
  const out = repairs('placeholder channel', [
    'var b = create("battery", { V: 9 });',
    'var r = create("resistor", { R: 100 });',
    'var vm = create("voltmeter");',
    'connect(b.positive, r.a);',
    'connect(r.b, b.negative);',
    'connect(vm.a, r.a);',
    'connect(vm.b, r.b);',
    'graph.plot(vm.channel);',
  ].join('\n'))
  assert.match(out, /graph\.plot\(vm\.V\)/)
})

test('a param spelled out longhand resolves to the real one', () => {
  const out = repairs('longhand param', [
    'var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 360 });',
    'var m = create("mass", { x: 200, y: 80, mass: 2 });',
    'var g = create("ground", { x: 40, y: 300 });',
    'var d = create("damper", { damping: 0.4 });',
    'connect(d.a, m.centre);',
    'connect(d.b, g.centre);',
    'var sl = create("slider", { x: 20, y: 20, target: d, targetParamName: "dampingCoefficient", min: 0, max: 2 });',
  ].join('\n'))
  assert.match(out, /targetParamName: "damping"/)
})

test('an ambiguous name is left for the model', () => {
  // Two legal anchors within edit distance 2 means we cannot know which was
  // meant. Changing nothing keeps the error, which is the correct outcome —
  // guessing here would ship wiring the user never asked for.
  const src = [
    'var b = create("battery", { V: 5 });',
    'var r = create("resistor", { R: 10 });',
    'connect(b.positive, r.zzzzzzzz);',
    'connect(r.b, b.negative);',
  ].join('\n')
  const { code } = autofixSimScript(src)
  assert.match(code, /r\.zzzzzzzz/)
})
