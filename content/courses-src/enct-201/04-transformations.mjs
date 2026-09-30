import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const rt = run('transform2d', { shape: '1,0', ops: 'translate 2 3; rotate 90' }), tr = run('transform2d', { shape: '1,0', ops: 'rotate 90; translate 2 3' }), ab = run('transform2d', { shape: '2,1', ops: 'rotate 90 about 1 1' }), pr3 = run('project3d', { rx: 0, ry: 0, distance: 4 })
  return lesson({
    title: '2-D and 3-D transformations and projection',
    kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapter 3',
    subtitle: 'Moving, turning and scaling are just matrices. Combine them by multiplying — and watch the order.',
    sections: [
      sec('basic', '3.1', 'The basic 2-D transformations', { eyebrow: 'Five moves',
        body: `<p>Translate (x + tx, y + ty); scale (sx·x, sy·y); rotate by θ about the origin (x cos θ − y sin θ, x sin θ + y cos θ); reflect (negate a coordinate); shear (x + shx·y). Each is a matrix, except translation in ordinary 2×2 form — which is why graphics uses homogeneous coordinates.</p>`,
        worked: [step('Rotate the point (1, 0) by 90° about the origin.', '\\begin{pmatrix}\\cos90&-\\sin90\\\\\\sin90&\\cos90\\end{pmatrix}\\begin{pmatrix}1\\\\0\\end{pmatrix}', { toc: 'Matrix' }), step('cos 90° = 0 and sin 90° = 1.', '(0,1)', { hero: true, toc: 'Result' })],
        qs: [q('rot', 'Rotating (1, 0) by 90° counter-clockwise about the origin gives…', ['(0, 1).', 'The point moves up the y-axis.'], [['(0, −1).', 'That is clockwise.'], ['(−1, 0).', 'That is 180°.']])] }),
      sec('homog', '3.2', 'Homogeneous coordinates and composition', { eyebrow: 'One matrix for everything',
        body: `<p>Write a point as (x, y, 1) and every transformation — including translation — becomes a 3×3 matrix. A sequence of transformations is then the product of their matrices, applied right to left: M = Mₙ⋯M₂M₁ applies M₁ first. Matrix multiplication is not commutative, so order matters: translate (2,3) then rotate 90° sends (1,0) to <b>${rt.vertices}</b>, but rotate then translate sends it to <b>${tr.vertices}</b>.</p>`,
        figs: [lab('transform2d', { shape: '1,1;4,1;2,3', ops: 'translate 2 3; rotate 90 about 1 1; scale 0.5' }, 'The matrix on the right is the running product.', ['vertices'], { caption: 'composing three transformations', name: 'tf' })],
        qs: [q('order', 'Translate (2,3) then rotate 90° versus rotate 90° then translate (2,3): same result?', ['No — matrix multiplication is not commutative.', `They give ${rt.vertices} and ${tr.vertices} for the point (1,0).`], [['Yes, always.', 'Only special pairs commute.'], ['Only for scaling.', 'Uniform scaling commutes with rotation, not translation.']])],
        probs: [pr('p-ord', '<p>Apply translate(2,3) then rotate(90°) to the point (1,0).</p>', `(1,0) → (3,3) → <b>${rt.vertices}</b>. Reversed order gives ${tr.vertices}.`, { verify: lab('transform2d', { shape: '1,0', ops: 'translate 2 3; rotate 90' }, 'Step through.', ['vertices'], { caption: 'answer', name: 'ans' }) })] }),
      sec('pivot', '3.3', 'Rotation about an arbitrary point', { eyebrow: 'A composite',
        body: `<p>To rotate about a pivot (px, py): translate the pivot to the origin, rotate, translate back: T(px,py)·R(θ)·T(−px,−py). Rotating (2,1) by 90° about (1,1) gives <b>${ab.vertices}</b>. Scaling about a fixed point uses the same sandwich.</p>`,
        figs: [lab('transform2d', { shape: '2,1', ops: 'rotate 90 about 1 1' }, 'The sandwich is applied for you.', ['vertices'], { caption: 'rotate about (1,1)', name: 'piv' })],
        worked: [step('Translate so the pivot (1,1) is the origin: (2,1) → (1,0).', '', { toc: 'Shift' }), step('Rotate 90°: (1,0) → (0,1). Translate back: (0,1) + (1,1).', '(1,2)', { hero: true, toc: 'Rotate and return' })],
        qs: [q('sand', 'To rotate about a point other than the origin you…', ['Translate it to the origin, rotate, translate back.', 'T·R·T⁻¹.'], [['Just rotate.', 'That rotates about the origin.'], ['Scale first.', 'Not needed.']])] }),
      sec('proj', '3.4', 'Parallel and perspective projection', { eyebrow: 'From 3-D to 2-D',
        body: `<p>In ${term('parallel projection')} lines of projection are parallel: drop z (orthographic) — sizes are preserved, so it is used in engineering drawing. In ${term('perspective projection')} they converge at the eye: x′ = x·d/(d − z), so nearer things look bigger. A cube vertex at z = −1 with eye distance d = 4 is scaled by 4/5: (−1,−1) becomes <b>${pr3.v0perspective}</b>.</p>`,
        figs: [lab('project3d', { rx: 25, ry: 35, distance: 4 }, 'Step: model, rotated, parallel, perspective, side by side.', ['v0parallel', 'v0perspective'], { caption: 'a cube, two projections', name: 'pj' })],
        qs: [q('persp', 'In perspective projection distant objects appear…', ['Smaller, because coordinates are divided by depth.', 'Parallel lines converge toward a vanishing point.'], [['Larger.', 'That is nearer objects.'], ['The same size.', 'That is parallel projection.']])] }),
      sec('t3d', '3.5', '3-D transformations', { eyebrow: 'One dimension more',
        body: `<p>Use 4×4 homogeneous matrices. Translation and scaling extend directly; rotation is about an axis: Rz(θ) rotates x–y, Rx(θ) y–z, Ry(θ) z–x. Composite 3-D transformations are again products; rotations about different axes do not commute.</p>`,
        worked: [step('Rotate (1,0,0) by 90° about the z-axis.', '(\\cos\\theta,\\sin\\theta,0)', { toc: 'Rz' }), step('The point moves to (0,1,0).', '(0,1,0)', { hero: true, toc: 'Result' })],
        qs: [q('axes', 'Do 3-D rotations about different axes commute?', ['No — the order matters.', 'Rotate a book 90° about two axes in both orders and compare.'], [['Yes, always.', 'That is false in 3-D.'], ['Only about z.', 'Same-axis rotations commute; different axes do not.']])] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Homogeneous matrices turn every transformation into a product.</li><li>M = Mₙ⋯M₁; order matters; pivot rotation = T·R·T⁻¹.</li><li>Parallel keeps size; perspective divides by depth.</li></ul>` }),
    ],
  })
}
