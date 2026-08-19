// Where AI output lands — the arithmetic behind "when I add simulation to
// slides, it goes out of the visible slide".
//
// A slide is a FIXED 960x540 frame. Anything placed outside it is invisible:
// it does not render in Present mode and it does not survive pptx export. So
// unlike an infinite board, placement here has a hard boundary that must be
// respected rather than merely aimed at.
//
// Run: node --test lib/ai/placement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-placement-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'p.mjs')

writeFileSync(entry, `
export { placeAnswerAndScene, clampToBounds } from '@/lib/ai/placement'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const { placeAnswerAndScene, clampToBounds } = await import(bundle)

/** A deck slide: the frame the bug was reported against. */
const SLIDE = { left: 0, top: 0, right: 960, bottom: 540 }
/** A doc sheet: A4 at 96dpi — narrow and tall, the opposite shape. */
const SHEET = { left: 0, top: 0, right: 794, bottom: 1123 }
/** A freeform board, panned somewhere far from the origin. */
const BOARD = { left: -500, top: -300, right: 1100, bottom: 700 }

const SCENE = { w: 520, h: 400 }

/** Assert a placed box lies entirely inside the frame. */
const inside = (pos, size, b, what) => {
  assert.ok(pos.x >= b.left, `${what} starts left of the frame (${pos.x} < ${b.left})`)
  assert.ok(pos.y >= b.top, `${what} starts above the frame (${pos.y} < ${b.top})`)
  assert.ok(pos.x + size.w <= b.right, `${what} runs off the right (${pos.x + size.w} > ${b.right})`)
  assert.ok(pos.y + size.h <= b.bottom, `${what} runs off the bottom (${pos.y + size.h} > ${b.bottom})`)
}

test('a scene alone on a slide stays fully on the slide', () => {
  // The exact reported bug: the scene used to be placed beside the answer at
  // x = originX + 520 + 80, which on a 960px slide starts it at ~600 and ran
  // 160px off the right edge. Alone, it must sit wholly inside the frame.
  const got = placeAnswerAndScene(null, true, SLIDE)
  inside(got.scene, SCENE, SLIDE, 'scene')
})

test('an answer alone on a slide stays fully on the slide', () => {
  const answer = { w: 520, h: 300 }
  const got = placeAnswerAndScene(answer, false, SLIDE)
  inside(got.answer, answer, SLIDE, 'answer')
})

test('a slide cannot hold a full answer column AND a scene without overlap', () => {
  // 300 + 400 = 700px of content in a 540px frame: no arrangement fits both.
  // What placement guarantees here is only that they never OVERLAP — the
  // caller is responsible for not asking for both on one slide (the AI panel
  // sends the answer to the deck and the scene to its own slide).
  const answer = { w: 520, h: 300 }
  const got = placeAnswerAndScene(answer, true, SLIDE)
  assert.ok(got.scene.y >= got.answer.y + answer.h,
    'even when it cannot fit, the scene must not be drawn over the answer')
  // Horizontally, both must still be on the slide — width is the axis that
  // actually caused the reported bug.
  assert.ok(got.scene.x >= SLIDE.left && got.scene.x + SCENE.w <= SLIDE.right)
  assert.ok(got.answer.x >= SLIDE.left && got.answer.x + answer.w <= SLIDE.right)
})

test('a slide is too narrow for side-by-side, so the pair stacks', () => {
  // 520 + 80 + 520 = 1120 > 960. Side by side cannot fit, so it must stack
  // rather than overflow.
  const answer = { w: 520, h: 200 }
  const got = placeAnswerAndScene(answer, true, SLIDE)
  assert.ok(got.scene.y > got.answer.y, 'scene should sit BELOW the answer on a narrow frame')
  // and they must not overlap
  assert.ok(got.scene.y >= got.answer.y + answer.h, 'scene overlaps the answer')
})

test('a wide board still places them side by side', () => {
  // The fix must not force stacking where there is genuinely room — on a
  // board, reading the notes beside the scene is the better layout.
  const answer = { w: 520, h: 300 }
  const got = placeAnswerAndScene(answer, true, BOARD)
  assert.ok(got.scene.x >= got.answer.x + answer.w, 'scene should sit BESIDE the answer when it fits')
  assert.equal(got.scene.y, got.answer.y, 'side-by-side pair should share a top edge')
  inside(got.answer, answer, BOARD, 'answer')
  inside(got.scene, SCENE, BOARD, 'scene')
})

test('a scene with no answer is centred on the frame', () => {
  const got = placeAnswerAndScene(null, true, SLIDE)
  assert.equal(got.answer, undefined)
  assert.equal(got.scene.x, (960 - SCENE.w) / 2)
  assert.equal(got.scene.y, (540 - SCENE.h) / 2)
  inside(got.scene, SCENE, SLIDE, 'scene')
})

test('an answer taller than the frame starts at the top, not centred', () => {
  // Centring a 2000px column on a 540px slide would cut off its first ~700px
  // — the derivation would start mid-working. Pin to the top instead.
  const answer = { w: 520, h: 2000 }
  const got = placeAnswerAndScene(answer, false, SLIDE)
  assert.equal(got.answer.y, 0, 'an oversized column must show its first line')
  assert.equal(got.answer.x, (960 - 520) / 2)
})

test('an answer wider than the frame is pinned left, never negative', () => {
  const answer = { w: 1200, h: 200 }
  const got = placeAnswerAndScene(answer, false, SLIDE)
  assert.equal(got.answer.x, 0, 'must not start at a negative x')
})

test('placement respects a board panned away from the origin', () => {
  // Bounds are page coordinates and can be negative; nothing may assume 0,0.
  const answer = { w: 300, h: 200 }
  const got = placeAnswerAndScene(answer, false, BOARD)
  const cx = (BOARD.left + BOARD.right) / 2
  assert.equal(got.answer.x, cx - 150)
  inside(got.answer, answer, BOARD, 'answer')
})

test('a tall narrow sheet stacks and stays inside', () => {
  const answer = { w: 520, h: 400 }
  const got = placeAnswerAndScene(answer, true, SHEET)
  inside(got.answer, answer, SHEET, 'answer')
  inside(got.scene, SCENE, SHEET, 'scene')
  assert.ok(got.scene.y > got.answer.y, 'A4 is too narrow for side-by-side')
})

test('clampToBounds keeps a box inside, and prefers the near edge when oversized', () => {
  assert.deepEqual(clampToBounds({ x: 900, y: 500 }, { w: 200, h: 100 }, SLIDE), { x: 760, y: 440 })
  assert.deepEqual(clampToBounds({ x: -50, y: -50 }, { w: 200, h: 100 }, SLIDE), { x: 0, y: 0 })
  // Larger than the frame: flush at the near edge rather than centred-and-cut.
  assert.deepEqual(clampToBounds({ x: 10, y: 10 }, { w: 2000, h: 2000 }, SLIDE), { x: 0, y: 0 })
})

test('nothing is placed when there is nothing to place', () => {
  assert.deepEqual(placeAnswerAndScene(null, false, SLIDE), {})
})

test.after(() => rmSync(dir, { recursive: true, force: true }))
