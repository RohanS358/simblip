// Deterministic scene layout — placement without asking the model.
//
// A language model is bad at coordinates and always will be. Asked for a
// pendulum it emits x:320, y:100 because numbers like that appeared in the
// corpus, not because it measured anything: it cannot see the page, does not
// know the viewport is scrolled to y=1600, and has no idea a note already
// occupies the space. Prompting cannot fix that — the information is
// geometric, and geometry is what code is for.
//
// So the model decides WHAT a scene contains and how the parts connect (which
// it is good at), and this file decides WHERE it goes (which it is not). Every
// function here is pure and total: same scene in, same rectangle out, no
// randomness and no model call.
//
// Two passes, applied in order:
//   1. resolveCollisions — nothing generated lands on existing content
//   2. fitToBounds        — the whole scene sits inside the visible page
//
// Both operate on the scene as ONE rigid group. Scaling or nudging parts
// individually would break the thing that makes a simulation work: a spring's
// endpoints are bound to the bodies they touch (lib/scene/simscript.ts
// mechConnect), and a hinge one pixel off its rod is a hinge attached to
// nothing. Translating everything by the same vector preserves every
// relationship exactly.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** Breathing room kept between a placed scene and anything already there. */
const GAP = 24

/** The union of a set of rectangles — the scene's own footprint. */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const r of rects) {
    x1 = Math.min(x1, r.x)
    y1 = Math.min(y1, r.y)
    x2 = Math.max(x2, r.x + r.w)
    y2 = Math.max(y2, r.y + r.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap &&
  a.x + a.w + gap > b.x &&
  a.y < b.y + b.h + gap &&
  a.y + a.h + gap > b.y

/**
 * Centre a scene in the space available.
 *
 * The base case, and the one the model gets wrong most often: on an empty
 * page a scene should be centred in what the user is looking at, whatever the
 * coordinates the script happened to use.
 */
export function centreIn(scene: Rect, bounds: Bounds): { dx: number; dy: number } {
  const cx = (bounds.left + bounds.right) / 2
  const cy = (bounds.top + bounds.bottom) / 2
  return { dx: cx - (scene.x + scene.w / 2), dy: cy - (scene.y + scene.h / 2) }
}

/**
 * Find the nearest free spot for a scene, given what is already on the page.
 *
 * Candidates are tried in order of how far the scene has to move, so a scene
 * that already fits does not move at all and one that does not slides the
 * shortest distance to clear. Preferring RIGHT and BELOW matches how a page
 * grows — new work goes beside or under old work, never on top of it.
 *
 * Returns the translation to apply, or null when nothing clears (a full
 * page), in which case the caller should place below everything.
 */
export function findFreeSpot(scene: Rect, occupied: Rect[], bounds: Bounds): { dx: number; dy: number } {
  const clear = (r: Rect) => !occupied.some((o) => overlaps(r, o, GAP))
  const shifted = (dx: number, dy: number): Rect => ({ ...scene, x: scene.x + dx, y: scene.y + dy })

  // Already clear where it is.
  if (clear(scene)) return { dx: 0, dy: 0 }

  const inView = occupied.filter(
    (o) => o.x + o.w > bounds.left && o.x < bounds.right && o.y + o.h > bounds.top && o.y < bounds.bottom
  )
  const blockers = inView.length > 0 ? inView : occupied

  // Candidate anchors: to the right of, below, to the left of and above the
  // existing content, plus the visible corners. Every one is a real edge of
  // something rather than a guess.
  const candidates: { x: number; y: number }[] = []
  for (const o of blockers) {
    candidates.push({ x: o.x + o.w + GAP, y: scene.y })
    candidates.push({ x: scene.x, y: o.y + o.h + GAP })
    candidates.push({ x: o.x - scene.w - GAP, y: scene.y })
    candidates.push({ x: scene.x, y: o.y - scene.h - GAP })
  }
  const union = unionRect(blockers)
  if (union) {
    candidates.push({ x: union.x + union.w + GAP, y: union.y })
    candidates.push({ x: union.x, y: union.y + union.h + GAP })
  }
  candidates.push({ x: bounds.left + GAP, y: bounds.top + GAP })

  let best: { dx: number; dy: number } | null = null
  let bestCost = Infinity
  for (const c of candidates) {
    const dx = c.x - scene.x
    const dy = c.y - scene.y
    const r = shifted(dx, dy)
    if (!clear(r)) continue
    // Smallest move wins, but a page grows right and down: new work goes
    // beside or under old work, not above or behind it. Backward moves are
    // penalised rather than forbidden, so they remain available when they are
    // the only thing that clears.
    const outside =
      r.x < bounds.left || r.y < bounds.top || r.x + r.w > bounds.right || r.y + r.h > bounds.bottom
    const backward = (dx < 0 ? 1 : 0) + (dy < 0 ? 1 : 0)
    const cost = Math.hypot(dx, dy) + backward * 400 + (outside ? 5_000 : 0)
    if (cost < bestCost) {
      bestCost = cost
      best = { dx, dy }
    }
  }

  if (best) return best

  // Nothing clears: go below everything, which always works on a board and is
  // the honest answer on a fixed frame (the caller then scales or accepts it).
  if (union) return { dx: union.x - scene.x, dy: union.y + union.h + GAP - scene.y }
  return { dx: 0, dy: 0 }
}

/**
 * Keep a scene inside the page.
 *
 * Translation first — a scene that merely hangs off an edge should slide back,
 * not shrink. Only a scene genuinely larger than the frame is scaled, and then
 * uniformly, because non-uniform scaling would turn a circle into an ellipse
 * and move a hinge off the rod it pins.
 */
export function fitToBounds(
  scene: Rect,
  bounds: Bounds
): { dx: number; dy: number; scale: number } {
  const availW = bounds.right - bounds.left
  const availH = bounds.bottom - bounds.top

  // Uniform scale only when it genuinely does not fit, and never up.
  const scale = Math.min(1, availW / Math.max(scene.w, 1), availH / Math.max(scene.h, 1))
  const w = scene.w * scale
  const h = scene.h * scale

  // Anchor the scaled scene on its own top-left, then push it inside.
  let x = scene.x
  let y = scene.y
  if (x + w > bounds.right) x = bounds.right - w
  if (y + h > bounds.bottom) y = bounds.bottom - h
  if (x < bounds.left) x = bounds.left
  if (y < bounds.top) y = bounds.top

  return { dx: x - scene.x, dy: y - scene.y, scale }
}

export interface PlacementInput {
  /** Bounding boxes of everything the script just created. */
  scene: Rect[]
  /** Bounding boxes of everything already on the page. */
  occupied: Rect[]
  /** The visible/printable region, from viewportBounds(). */
  bounds: Bounds
  /** A fixed frame (slide, doc sheet) cannot scroll, so a scene must fit it.
   *  An infinite board can grow, so overflow is acceptable there. */
  fixedFrame: boolean
}

export interface Placement {
  dx: number
  dy: number
  scale: number
}

/**
 * Decide where a freshly generated scene goes. Pure geometry.
 *
 * Order matters: clear existing content first, THEN fit the page. Fitting
 * first only to be pushed into a note afterwards would undo the fit.
 */
export function planPlacement({ scene, occupied, bounds, fixedFrame }: PlacementInput): Placement {
  const box = unionRect(scene)
  if (!box) return { dx: 0, dy: 0, scale: 1 }

  // Empty page: centre it. This is the common case and the one the model's
  // invented coordinates get wrong every time.
  if (occupied.length === 0) {
    const c = centreIn(box, bounds)
    if (!fixedFrame) return { ...c, scale: 1 }
    const centred = { ...box, x: box.x + c.dx, y: box.y + c.dy }
    const fit = fitToBounds(centred, bounds)
    // Re-centre after any scale so it sits in the middle, not the corner.
    const scaled = { ...centred, w: centred.w * fit.scale, h: centred.h * fit.scale }
    const c2 = centreIn(scaled, bounds)
    return { dx: c.dx + c2.dx, dy: c.dy + c2.dy, scale: fit.scale }
  }

  const spot = findFreeSpot(box, occupied, bounds)
  const moved = { ...box, x: box.x + spot.dx, y: box.y + spot.dy }

  // A board scrolls, so a scene pushed below existing work is fine there. A
  // slide or sheet cannot, so it must be made to fit.
  if (!fixedFrame) return { ...spot, scale: 1 }

  const fit = fitToBounds(moved, bounds)
  return { dx: spot.dx + fit.dx, dy: spot.dy + fit.dy, scale: fit.scale }
}
