import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const dda = run('raster', { algo: 'dda', x1: 0, y1: 0, x2: 4, y2: 2 }), br = run('raster', { algo: 'bresenham', x1: 0, y1: 0, x2: 5, y2: 2 }), ci = run('raster', { algo: 'circle', r: 5, cx: 8, cy: 8 }), ff = run('raster', { algo: 'floodfill' })
  return lesson({
    title: 'Drawing lines, circles and filling regions',
    kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapter 2 (output primitives)',
    subtitle: 'A screen has only whole pixels. These are the classic ways to choose which ones to light.',
    sections: [
      sec('dda', '2.1', 'The DDA line algorithm', { eyebrow: 'Incremental',
        body: `<p>The ${term('DDA')} (digital differential analyser) steps along the longer axis one pixel at a time and adds the slope to the other coordinate, rounding each point: steps = max(|Δx|, |Δy|), x increment = Δx/steps, y increment = Δy/steps. It uses floating point and rounding in the loop. From (0,0) to (4,2) it lights <b>${dda.pixels}</b>.</p>`,
        figs: [lab('raster', { algo: 'dda', x1: 2, y1: 2, x2: 13, y2: 8 }, 'Each frame rounds one point to a pixel.', ['pixels'], { caption: 'DDA from (2,2) to (13,8)', name: 'dda' })],
        worked: [step('Line from (0,0) to (4,2): Δx = 4, Δy = 2, so steps = 4.', '\\text{steps}=\\max(4,2)=4', { toc: 'Steps' }), step('Increments: x += 1, y += 0.5. Points: (0,0), (1,0.5→1), (2,1), (3,1.5→2), (4,2).', '(0,0),(1,1),(2,1),(3,2),(4,2)', { hero: true, toc: 'Points' })],
        qs: [q('ddaq', 'Why does DDA step along the longer axis?', ['So the other coordinate changes by at most 1 per step and no gaps appear.', 'Each step moves one pixel in the major direction.'], [['Because it is faster.', 'Not the reason.'], ['To avoid rounding.', 'It still rounds.']])] }),
      sec('bres', '2.2', 'Bresenham’s line algorithm', { eyebrow: 'Integers only',
        body: `<p>${term('Bresenham')} keeps an integer ${term('decision (error) term')} saying whether the ideal line is closer to the pixel straight ahead or the one diagonally above. No multiplication or rounding: only additions and sign tests, hence its use in hardware. From (0,0) to (5,2): <b>${br.pixels}</b>.</p>`,
        figs: [lab('raster', { algo: 'bresenham', x1: 2, y1: 2, x2: 13, y2: 8 }, 'The error term decides each step.', ['pixels'], { caption: 'Bresenham from (2,2) to (13,8)', name: 'br' })],
        qs: [q('bresq', 'The main advantage of Bresenham over DDA is…', ['It uses only integer arithmetic.', 'No floating-point additions or rounding.'], [['It draws curves.', 'It draws lines.'], ['It is less accurate.', 'It is exact in choosing pixels.']])],
        probs: [pr('p-br', '<p>Which pixels does Bresenham light for (0,0) → (5,2)?</p>', `<b>${br.pixels}</b>.`, { verify: lab('raster', { algo: 'bresenham', x1: 0, y1: 0, x2: 5, y2: 2 }, 'Watch the decision term.', ['pixels'], { caption: 'answer', name: 'ans' }) })] }),
      sec('circle', '2.3', 'The mid-point circle algorithm', { eyebrow: 'Eight-way symmetry',
        body: `<p>A circle is symmetric about both axes and the diagonals, so compute one octant (x from 0 to y) and reflect each point 8 ways. The ${term('mid-point')} method tests whether the midpoint between the two candidate pixels is inside the circle using a decision parameter p: start p₀ = 1 − r; if p &lt; 0 keep y and p += 2x + 1, else y−− and p += 2(x − y) + 1. For r = 5 the first octant is <b>${ci.octant}</b>.</p>`,
        figs: [lab('raster', { algo: 'circle', r: 6, cx: 8, cy: 8 }, 'Each frame plots eight points.', ['octant'], { caption: 'mid-point circle, r = 6', name: 'cir' })],
        worked: [step('Radius 5: p₀ = 1 − 5 = −4.', 'p_0=1-r=-4', { toc: 'Start' }), step('Start (0,5). p < 0 → x=1, y=5, p = −4 + 2(1) + 1 = −1. Again p<0 → x=2, p = −1 + 5 = 4. Now p ≥ 0 → y=4 at x=3.', '(0,5),(1,5),(2,5),(3,4)', { hero: true, toc: 'First octant' })],
        qs: [q('sym', 'Why compute only one octant of a circle?', ['Symmetry gives the other seven octants by reflecting coordinates.', '(x,y) → (±x,±y) and (±y,±x).'], [['Circles are lines.', 'No.'], ['It is more accurate.', 'It saves work, not accuracy.']])] }),
      sec('fill', '2.4', 'Filling: scan-line, boundary and flood fill', { eyebrow: 'Colouring regions',
        body: `<p>${term('Scan-line fill')} intersects each row with the polygon edges and fills between pairs of crossings (odd–even rule). ${term('Boundary fill')} starts inside and spreads until it meets a boundary colour; ${term('flood fill')} spreads through all pixels of the old colour. Both can use 4-connected neighbours (up, down, left, right) or 8-connected (plus diagonals); 8-connected fill can leak through a diagonal gap in a boundary drawn with 4-connected lines. The default pentagon fills <b>${ff.filled}</b> pixels.</p>`,
        figs: [lab('raster', { algo: 'floodfill', connect: 4 }, 'The fill spreads from the seed to the boundary.', ['filled'], { caption: '4-connected flood fill', name: 'ff' })],
        qs: [q('conn', 'Which fill can leak through a diagonal gap in the boundary?', ['8-connected fill.', 'It also moves diagonally, through the gap.'], [['4-connected fill.', 'It cannot cross a diagonal.'], ['Scan-line fill.', 'Uses edge intersections.']])] }),
      sec('attr', '2.5', 'Aliasing and antialiasing', { eyebrow: 'Jaggies',
        body: `<p>Because pixels are discrete, slanted lines look stepped (${term('aliasing')}). ${term('Antialiasing')} reduces it: supersample (compute at higher resolution and average), or shade edge pixels in proportion to how much of the pixel the line covers. The cost is more computation.</p>`,
        qs: [q('alias', 'Antialiasing by supersampling…', ['Renders at a higher resolution and averages down.', 'Edge pixels get intermediate shades.'], [['Removes pixels.', 'No.'], ['Makes the display larger.', 'No.']])],
        probs: [pr('p1', '<p>A line has slope 0.3. Does Bresenham step mostly in x or in y?</p>', '|slope| < 1, so x is the major axis: x advances every step and y increases by 1 about 3 times in 10 steps.')] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>DDA: float increments; Bresenham: integers; circle: one octant + symmetry.</li><li>Fill by scan line, boundary or flood (4 vs 8 connectivity).</li></ul>` }),
    ],
  })
}
