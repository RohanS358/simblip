// connect() for MECHANICS connectors — the bug where scripted pendulums came
// out as a flat stick, a schematic elbow-wire and a stray ball.
// Run: node lib/scene/simscript-mechconnect.test.mjs
//
// Why this test exists: buildWorld (lib/physics/world.ts:471) binds a
// rod/spring/rope/damper to its bodies with Matter.Query.point at the
// connector's OWN endpoints — whatever body sits under an endpoint is the
// attachment. connect() used to only draw a cosmetic line and push a circuit
// routing edge, so it moved nothing and the physics never saw a link.
//
// The contract pinned here is endpointWorld's, verbatim from world.ts:354 —
// position + points[i], rotation IGNORED. That last part is why moveEndpoint
// rewrites points and zeroes rotation instead of rotating the object: a rod
// "rotated" into place still reports horizontal endpoints to the solver.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'simscript-mech-'))
const bundle = join(dir, 'sim.mjs')
execFileSync('npx', ['esbuild', resolve(import.meta.dirname, 'simscript.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`,
  // The store is a browser/React module; we only need the pure exports here.
  '--external:react', '--external:zustand',
], { stdio: 'pipe' })

// endpointWorld, copied verbatim from lib/physics/world.ts:354. If that
// function ever changes, this copy must change with it — that divergence
// failing loudly is the point.
const endpointWorld = (obj, index) => {
  const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
  const p = index === 0 ? pts[0] : pts[pts.length - 1]
  return { x: obj.position.x + p[0], y: obj.position.y + p[1] }
}

// Mirror of moveEndpoint's math (simscript.ts). Kept minimal and pure so the
// geometry contract can be checked without booting Zustand + Matter.
const moveEndpoint = (c, index, p) => {
  const pts = c.geometry.points ?? [[0, 0], [c.size.w, 0]]
  const world = pts.map(pt => ({ x: c.position.x + pt[0], y: c.position.y + pt[1] }))
  world[index === 0 ? 0 : world.length - 1] = p
  const minX = Math.min(...world.map(w => w.x))
  const minY = Math.min(...world.map(w => w.y))
  return {
    position: { x: minX, y: minY },
    geometry: { ...c.geometry, points: world.map(w => [w.x - minX, w.y - minY]) },
    size: {
      w: Math.max(...world.map(w => w.x)) - minX || 2,
      h: Math.max(...world.map(w => w.y)) - minY || 2,
    },
    rotation: 0,
  }
}

const rodAt = (x, y, len) => ({
  position: { x, y }, size: { w: len, h: 2 },
  geometry: { kind: 'line', points: [[0, 0], [len, 0]] }, rotation: 0,
})

test('endpoint lands exactly on the target body centre', () => {
  const rod = rodAt(200, 100, 150)
  const bobCentre = { x: 235, y: 300 }
  const moved = moveEndpoint(rod, 1, bobCentre)
  const got = endpointWorld(moved, 1)
  assert.deepEqual(got, bobCentre,
    'endpoint 1 must sit ON the bob, or Matter.Query.point finds no body')
})

test('the other endpoint does not move', () => {
  const rod = rodAt(200, 100, 150)
  const before = endpointWorld(rod, 0)
  const moved = moveEndpoint(rod, 1, { x: 235, y: 300 })
  assert.deepEqual(endpointWorld(moved, 0), before,
    'moving one end must not drag the pivot end off its anchor')
})

test('a vertical rod keeps a non-degenerate box and zero rotation', () => {
  // The pendulum case: pivot directly above bob, so the rod is vertical and
  // its bounding box is 0 wide. A 0-width box would make the object
  // unselectable and unrenderable, hence the `|| 2` floor.
  const moved = moveEndpoint(rodAt(200, 100, 150), 1, { x: 200, y: 300 })
  assert.ok(moved.size.w >= 2, 'zero-width box must be floored, got ' + moved.size.w)
  assert.equal(moved.size.h, 200)
  assert.equal(moved.rotation, 0,
    'rotation must be zeroed — endpointWorld ignores it, so a leftover value ' +
    'renders the rod at an angle the solver never sees')
})

test('both ends attachable — pivot then bob', () => {
  let rod = rodAt(200, 100, 150)
  rod = moveEndpoint(rod, 0, { x: 130, y: 6 })    // connect(rod.a, pivot.centre)
  rod = moveEndpoint(rod, 1, { x: 200, y: 225 })  // connect(rod.b, bob.centre)
  assert.deepEqual(endpointWorld(rod, 0), { x: 130, y: 6 })
  assert.deepEqual(endpointWorld(rod, 1), { x: 200, y: 225 })
})

test('length prop drives rod geometry', async () => {
  // Guards the second half of the fix: `length` is not a declared param of the
  // rod behavior, so it was silently dropped and every rod came out 150px.
  const src = await import('node:fs').then(m =>
    m.readFileSync(resolve(import.meta.dirname, 'simscript.ts'), 'utf8'))
  assert.match(src, /props\.length \?\? props\.width/,
    'create() must honour `length` for line-kind mechanics components')
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
