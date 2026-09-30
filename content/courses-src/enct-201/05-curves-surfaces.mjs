import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const b = run('bezier', {})
  return lesson({
    title: 'Bézier curves and polygon surfaces',
    kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapter 4',
    subtitle: 'How fonts, paths and car bodies are drawn with a handful of control points.',
    sections: [
      sec('why', '4.1', 'Curves from control points', { eyebrow: 'The idea',
        body: `<p>Storing a smooth curve as thousands of tiny lines is wasteful and awkward to edit. A ${term('parametric curve')} is a point Q(t) = (x(t), y(t)) as t runs from 0 to 1, defined by a few ${term('control points')}. A ${term('spline')} joins cubic pieces smoothly. Designers drag control points; the curve follows.</p>`,
        qs: [q('cp', 'What do control points do?', ['They shape the curve — it is pulled toward them but need not pass through them (except the ends for Bézier).', 'Moving one changes the curve smoothly.'], [['They are the pixels of the curve.', 'The curve is computed from them.'], ['They fix the curve’s colour.', 'No.']])] }),
      sec('bez', '4.2', 'Bézier curves', { eyebrow: 'Cubic Bézier',
        body: `<p>A cubic ${term('Bézier curve')} has four control points P₀…P₃ and Q(t) = (1−t)³P₀ + 3t(1−t)²P₁ + 3t²(1−t)P₂ + t³P₃. It starts at P₀ tangent to P₀P₁ and ends at P₃ tangent to P₂P₃, and always lies inside the convex hull of its control points. The ${term('de Casteljau')} construction finds the point at t by repeated linear interpolation: join neighbouring control points, take the point a fraction t along each segment, and repeat until one point remains. At t = 0.5 for P = (0,0), (1,3), (4,3), (5,0) the point is <b>${b.mid}</b>, which matches (P₀ + 3P₁ + 3P₂ + P₃)/8 = <b>${b.formulaMid}</b>.</p>`,
        figs: [lab('bezier', { points: '0,0;1,3;4,3;5,0', t: '0.25 0.5 0.75' }, 'Each frame shows the de Casteljau triangles for one t.', ['mid', 'formulaMid'], { caption: 'de Casteljau', name: 'bz' })],
        worked: [step('Cubic, P = (0,0), (1,3), (4,3), (5,0), t = ½. At t = ½ the weights are (1, 3, 3, 1)/8.', '', { toc: 'Weights' }), step('x = (0 + 3·1 + 3·4 + 5)/8 = 20/8 = 2.5; y = (0 + 9 + 9 + 0)/8 = 2.25.', '(2.5,\\ 2.25)', { hero: true, toc: 'Point' })],
        qs: [q('hull', 'A Bézier curve always lies within…', ['The convex hull of its control points.', 'It is a weighted average with non-negative weights summing to 1.'], [['A circle through P₀ and P₃.', 'No.'], ['The bounding box of P₀ and P₃ only.', 'The hull of all four points.']])],
        probs: [pr('p-bz', '<p>Find the point at t = 0.5 for control points (0,0), (1,3), (4,3), (5,0).</p>', `Weights 1/8, 3/8, 3/8, 1/8: <b>${b.mid}</b>.`, { verify: lab('bezier', { points: '0,0;1,3;4,3;5,0', t: '0.5' }, 'The construction at t = 0.5.', ['mid'], { caption: 'answer', name: 'ans' }) })] }),
      sec('spline', '4.3', 'Splines and continuity', { eyebrow: 'Joining pieces',
        body: `<p>Long curves are built from several low-degree pieces. ${term('C⁰')} continuity: the pieces meet. ${term('C¹')}: same tangent direction and speed at the join. ${term('C²')}: same curvature too. For two Bézier segments to join with C¹ the last two points of one and the first two of the next must be collinear and evenly spaced. B-splines and NURBS give local control and exact circles.</p>`,
        qs: [q('c1', 'Two curve pieces meet at a point but with different tangents. The continuity is…', ['C⁰ only — a visible corner.', 'They join, but not smoothly.'], [['C¹.', 'C¹ requires equal tangents.'], ['C².', 'Even stronger.']])] }),
      sec('surf', '4.4', 'Polygon surfaces', { eyebrow: 'Solid objects',
        body: `<p>A 3-D object is stored as a polygon mesh: a ${term('vertex table')} (coordinates), an ${term('edge table')} (vertex pairs) and a ${term('polygon table')} (edges of each face). Each face has a surface ${term('normal')} N = (V₂ − V₁) × (V₃ − V₁), needed for lighting and for deciding which side faces the viewer. Smooth surfaces use Bézier patches, revolution and sweeps.</p>`,
        worked: [step('Triangle V₁ = (0,0,0), V₂ = (1,0,0), V₃ = (0,1,0). Edges: (1,0,0) and (0,1,0).', '', { toc: 'Edges' }), step('Normal = (1,0,0) × (0,1,0).', '(0,0,1)', { hero: true, toc: 'Cross product' })],
        figs: [dia(`direction: right
[Vertex table: V1 V2 V3 V4] as v #blue
[Edge table: E1 = V1V2 …] as e #mint
[Polygon table: F1 = E1 E2 E3] as p #amber
v -> e
e -> p`, 'Three linked tables describe a mesh.', { caption: 'mesh data structure' })],
        qs: [q('norm', 'Why does a polygon need a surface normal?', ['For lighting calculations and to tell front from back faces.', 'Shading depends on the angle between the normal and the light.'], [['To colour it.', 'Colour comes from the material.'], ['To store its area.', 'Unrelated.']])] }),
      sec('summary', '4.5', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Bézier: Q(t) from control points; de Casteljau by repeated interpolation.</li><li>Joins: C⁰, C¹, C²; meshes = vertex, edge, polygon tables.</li></ul>` }),
      sec('try', '4.6', 'Try it', { eyebrow: 'Practice', figs: [lab('bezier', { points: '0,0;2,4;5,4;7,0;9,3', t: '0.5' }, 'A degree-4 Bézier (five points) — one more level of the construction.', ['mid'], { caption: 'five control points', name: 'q4' })],
        qs: [q('deg', 'Five control points define a Bézier curve of degree…', ['4.', 'Degree = number of points − 1.'], [['5.', 'One too many.'], ['3.', 'That takes four points.']])] }),
    ],
  })
}
