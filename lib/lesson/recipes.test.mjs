import test from 'node:test'
import assert from 'node:assert/strict'
import { circuitRecipe } from './recipes.ts'
import { lintSimScript } from '../ai/simscript-lint.ts'

test('"three resistors in parallel" is drawn exactly: every branch across the battery, an ammeter in each', () => {
  const s = circuitRecipe('A 12 V battery with three 100 ohm resistors in parallel')
  assert.match(s, /battery", \{ V: 12/)
  assert.equal((s.match(/create\("resistor"/g) ?? []).length, 3)
  assert.equal((s.match(/create\("ammeter"/g) ?? []).length, 4) // total + one per branch
  for (const i of [1, 2, 3]) {
    assert.match(s, new RegExp(`connect\\(at\\.b, a${i}\\.a`))
    assert.match(s, new RegExp(`connect\\(r${i}\\.b, bat\\.negative`)) // each branch returns straight to the battery
  }
  assert.equal(lintSimScript(s).ok, true)
})

test('series puts every part in one loop', () => {
  const s = circuitRecipe('two bulbs in series with a 6V battery')
  assert.match(s, /create\("bulb"/)
  assert.match(s, /connect\(r1\.b, r2\.a/)
  assert.match(s, /connect\(r2\.b, bat\.negative/)
  assert.equal(lintSimScript(s).ok, true)
})

test('values: one given is reused, a list is honoured, none spreads a parallel bank; defaults to 9 V', () => {
  assert.equal((circuitRecipe('three resistors in parallel').match(/R: (\d+)/g)).join(), 'R: 100,R: 220,R: 330')
  assert.match(circuitRecipe('3 resistors of 47 ohm in series').match(/R: \d+/g).join(), /R: 47,R: 47,R: 47/)
  assert.match(circuitRecipe('three resistors 100, 200 ohm and 300 ohm in parallel'), /V: 9/)
})

test('anything that is not a plain resistor/bulb circuit is left to the model', () => {
  assert.equal(circuitRecipe('a capacitor charging through a resistor in series'), null)
  assert.equal(circuitRecipe('resistors in series and parallel'), null)
  assert.equal(circuitRecipe('a pendulum swinging'), null)
  assert.equal(circuitRecipe('some resistors in parallel'), null) // no count: do not guess
})
