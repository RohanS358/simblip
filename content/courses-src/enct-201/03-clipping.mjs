import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const c = run('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 20 60 40' }), l = run('clip', { algo: 'liang', window: '10 10 50 50', line: '0 20 60 40' }), rej = run('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 0 5 60' })
  return lesson({
    title: 'Clipping',
    kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapter 2 (clipping)',
    subtitle: 'Do not draw what you cannot see: find the part of each line that lies inside the window.',
    sections: [
      sec('why', '2.6', 'Why clip', { eyebrow: 'Saving work',
        body: `<p>Anything outside the window is wasted effort (and could overflow the frame buffer). ${term('Clipping')} removes it before rasterising. The design goal: decide most cases — fully inside, fully outside — very cheaply, and compute intersections only when needed.</p>`,
        qs: [q('clipwhy', 'Main purpose of clipping is to…', ['Discard geometry outside the window before drawing it.', 'Saves time and protects memory.'], [['Colour the objects.', 'That is shading.'], ['Rotate the scene.', 'That is a transformation.']])] }),
      sec('cohen', '2.7', 'Cohen–Sutherland', { eyebrow: 'Outcodes',
        body: `<p>Give each endpoint a 4-bit ${term('outcode')} (Top, Bottom, Right, Left): a bit is 1 if the point lies beyond that edge. If both codes are 0000 — ${term('trivially accept')}. If the AND of the codes is non-zero — both ends are beyond the same edge — ${term('trivially reject')}. Otherwise clip the outside endpoint to one window edge by intersection and repeat. For the window (10,10)–(50,50) the line (0,20)–(60,40) clips to <b>${c.result}</b>.</p>`,
        figs: [lab('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 20 60 40' }, 'Amber box = window; the blue line shrinks edge by edge.', ['result'], { caption: 'Cohen–Sutherland', name: 'cs' }), lab('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 0 5 60' }, 'Both ends are left of the window: trivially rejected.', ['result'], { caption: 'trivial reject', name: 'rj' })],
        worked: [step('P1 = (0,20) is left of x = 10: outcode 0001. P2 = (60,40) is right of x = 50: outcode 0010.', '', { toc: 'Outcodes' }), step('AND = 0000, OR ≠ 0000: undecided, so clip. Intersection with x = 10: y = 20 + (40−20)·(10−0)/(60−0).', 'y=20+\\tfrac{10}{60}\\cdot20=23.33', { hero: true, toc: 'Left edge' })],
        qs: [q('accept', 'Both endpoints have outcode 0000. The line is…', ['Trivially accepted — entirely inside.', 'No intersection needed.'], [['Trivially rejected.', 'That needs a shared 1 bit.'], ['Clipped twice.', 'Nothing to clip.']])],
        probs: [pr('p-cs', '<p>Clip the line (0,20)–(60,40) against the window x,y ∈ [10,50].</p>', `Result <b>${c.result}</b> (left edge at y≈23.33, right edge at y≈36.67).`, { verify: lab('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 20 60 40' }, 'Steps.', ['result'], { caption: 'answer', name: 'ans' }) })] }),
      sec('liang', '2.8', 'Liang–Barsky', { eyebrow: 'Parametric',
        body: `<p>Write the line as P(t) = P₁ + t·(P₂ − P₁), 0 ≤ t ≤ 1. Each window edge gives an inequality t·p ≤ q with p = −Δx, Δx, −Δy, Δy and q = x₁ − xmin, xmax − x₁, …. Where p &lt; 0 the line enters: raise t₀ to max(q/p); where p &gt; 0 it leaves: lower t₁ to min(q/p). If t₀ &gt; t₁ the line is outside. Faster than Cohen–Sutherland because it computes at most one intersection per end. Same example: <b>${l.result}</b>.</p>`,
        figs: [lab('clip', { algo: 'liang', window: '10 10 50 50', line: '0 20 60 40' }, 'Watch t₀ rise and t₁ fall.', ['result'], { caption: 'Liang–Barsky', name: 'lb' })],
        qs: [q('lb', 'In Liang–Barsky, t₀ > t₁ means…', ['No part of the line is inside the window.', 'The entering point comes after the leaving point.'], [['The line is inside.', 'Then t₀ ≤ t₁.'], ['The window is empty.', 'Unrelated.']])] }),
      sec('poly', '2.9', 'Polygon and text clipping', { eyebrow: 'More than lines',
        body: `<p>Clipping a polygon must produce a polygon, not loose lines. Sutherland–Hodgman clips against one window edge at a time, keeping inside vertices and adding intersection points; it is right for convex polygons and can leave extra edges for concave ones, which Weiler–Atherton handles by walking the boundaries. Text is clipped per character (all-or-none), per string, or per pixel (most exact).</p>`,
        qs: [q('wa', 'Which algorithm clips concave polygons correctly?', ['Weiler–Atherton.', 'It follows the polygon and window boundaries, allowing several output pieces.'], [['Cohen–Sutherland.', 'That is for lines.'], ['DDA.', 'That is a line-drawing algorithm.']])] }),
      sec('point', '2.10', 'Point clipping', { eyebrow: 'The simplest',
        body: `<p>A point (x, y) is inside the window iff xmin ≤ x ≤ xmax and ymin ≤ y ≤ ymax. Everything else builds on this test.</p>`,
        worked: [step('Window [10, 50] × [10, 50]. Is (30, 55) inside?', '', { toc: 'Question' }), step('y = 55 > 50: outside (outcode 1000, above).', '1000_2', { hero: true, toc: 'Answer' })],
        qs: [q('pt', 'Is (50, 50) inside the window [10, 50] × [10, 50]?', ['Yes — the edges are included.', 'The tests use ≤.'], [['No.', 'Boundaries are inside.'], ['Only for x.', 'Both coordinates pass.']])] }),
      sec('summary', '2.11', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Cohen–Sutherland: outcodes, accept/reject fast, else clip an edge at a time.</li><li>Liang–Barsky: parametric t₀…t₁ interval, fewer intersections.</li></ul>` }),
    ],
  })
}
