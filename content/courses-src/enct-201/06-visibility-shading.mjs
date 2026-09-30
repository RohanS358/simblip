import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const ph = run('phong', { ka: 0.1, kd: 0.5, ks: 0.4, shininess: 10 })
  return lesson({
    title: 'Hidden surfaces, lighting and shading',
    kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapters 5–6',
    subtitle: 'Decide which surface is in front, then decide how bright it looks.',
    sections: [
      sec('hsr', '5.1', 'Visible-surface determination', { eyebrow: 'What is in front?',
        body: `<p>When objects overlap, only the nearest surface along each line of sight may be drawn. ${term('Object-space')} methods compare polygons geometrically (painter’s algorithm); ${term('image-space')} methods decide per pixel. ${term('Back-face detection')} discards polygons facing away: a face is hidden if its normal N and the view vector V satisfy N·V &gt; 0 (roughly half the faces of a closed solid).</p>`,
        worked: [step('A face has normal N = (0, 0, −1); the viewer looks along V = (0, 0, −1) (into the screen).', '', { toc: 'Given' }), step('N·V = 1 > 0 means the face points away from the viewer: back-facing, cull it.', 'N\\cdot V=(0)(0)+(0)(0)+(-1)(-1)=1>0', { hero: true, toc: 'Test' })],
        qs: [q('bf', 'Back-face culling removes…', ['Polygons facing away from the viewer.', 'About half of a closed object’s faces.'], [['The farthest objects.', 'That needs depth sorting.'], ['Polygons outside the window.', 'That is clipping.']])] }),
      sec('z', '5.2', 'The Z-buffer', { eyebrow: 'Image space',
        body: `<p>The ${term('Z-buffer')} keeps, for every pixel, the depth of the nearest surface drawn so far. Start with depth = ∞. For each polygon and each pixel it covers, compute the depth z; if z is smaller (nearer) than the stored value, write the colour and the new depth. Polygons can arrive in any order — no sorting, simple in hardware, cost O(pixels × overlapping surfaces) and one depth value per pixel. The A-buffer adds transparency; scan-line methods handle one row at a time.</p>`,
        figs: [dia(`direction: down
(Start: depth buffer = infinity) as s
[Take the next polygon, next pixel] as a #blue
<z nearer than stored depth?> as c #amber
[Write colour, store z] as w #mint
[Keep the old pixel] as k #grey
s -> a
a -> c
c -> w : yes
c -> k : no
w -> a
k -> a`, 'The test-and-write loop of the Z-buffer.', { caption: 'Z-buffer algorithm' })],
        qs: [q('zq', 'A Z-buffer stores, per pixel…', ['The depth of the nearest surface drawn so far.', 'A new fragment is kept only if it is nearer.'], [['The colour only.', 'That is the frame buffer.'], ['The polygon normal.', 'No.']])] }),
      sec('light', '6.1', 'Illumination models', { eyebrow: 'Brightness',
        body: `<p>The Phong model sums three terms: ${term('ambient')} I = kₐ (light from everywhere), ${term('diffuse')} kd·cos θ (Lambert: proportional to the angle between the normal and the light — matte surfaces) and ${term('specular')} ks·cosⁿ α (a highlight where the reflection points at the eye; larger n = tighter, shinier). With ka = 0.1, kd = 0.5, ks = 0.4, n = 10, a surface lit head-on has I = <b>${ph.totalAt0}</b>; at 60° it drops to <b>${ph.totalAt60}</b>.</p>`,
        figs: [lab('phong', { ka: 0.1, kd: 0.5, ks: 0.4, shininess: 10 }, 'Three frames add the three terms one at a time.', ['totalAt0', 'totalAt60'], { caption: 'Phong components', name: 'phong' })],
        worked: [step('Lit head-on (θ = 0): ambient + diffuse + specular = 0.1 + 0.5·1 + 0.4·1.', '0.1+0.5+0.4=1.0', { hero: true, toc: 'Intensity' })],
        qs: [q('spec', 'Increasing the shininess exponent n makes the specular highlight…', ['Smaller and sharper.', 'cosⁿ falls faster away from the mirror direction.'], [['Larger and softer.', 'That is a smaller n.'], ['Brighter everywhere.', 'It narrows, not brightens.']])] }),
      sec('shade', '6.2', 'Shading methods', { eyebrow: 'Per polygon or per pixel',
        body: `<p>Computing the illumination model at every pixel is expensive, so surfaces are shaded by interpolation. ${term('Constant (flat)')} shading: one intensity per polygon — faceted look. ${term('Gouraud')}: compute intensity at the vertices and interpolate across the polygon — smooth, but can miss highlights that fall inside a polygon. ${term('Phong shading')}: interpolate the <em>normals</em> and apply the illumination model per pixel — accurate highlights, more expensive.</p>`,
        figs: [dia(`direction: right
[Flat: one colour per face] as f #grey
[Gouraud: interpolate colours] as g #blue
[Phong: interpolate normals] as p #mint
f -> g : smoother
g -> p : better highlights, more cost`, 'Cost and quality both rise left to right.', { caption: 'shading models' })],
        qs: [q('gour', 'Gouraud shading interpolates…', ['Vertex intensities across the polygon.', 'Phong shading interpolates the normals instead.'], [['Normals.', 'That is Phong shading.'], ['Depth values.', 'That is the Z-buffer.']])],
        probs: [pr('p-shade', '<p>Why can Gouraud shading miss a specular highlight that lies in the middle of a large polygon?</p>', 'It evaluates lighting only at the vertices; if the bright spot is between them the interpolated colour never reaches it. Phong shading evaluates lighting per pixel so the highlight appears.')] }),
      sec('summary', '6.3', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Back-face: N·V &gt; 0 → cull. Z-buffer: keep the nearest fragment per pixel.</li><li>Phong model = ambient + diffuse + specular; flat &lt; Gouraud &lt; Phong shading.</li></ul>` }),
      sec('try', '6.4', 'Try it', { eyebrow: 'Practice', figs: [lab('phong', { ka: 0.1, kd: 0.5, ks: 0.4, shininess: 80 }, 'Shininess 80: a much narrower highlight.', ['totalAt60'], { caption: 'shininess 80', name: 'p80' })],
        qs: [q('n80', 'At 60° from the normal, the specular term of a very shiny surface is…', ['Essentially zero — the highlight is confined to a narrow angle.', 'cos^80 of a large angle is tiny.'], [['Its maximum.', 'The maximum is at the mirror angle.'], ['Negative.', 'Clamped at zero.']])] }),
    ],
  })
}
