import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'Animation, AR/VR and real-time graphics',
  kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapters 7–8',
  subtitle: 'Motion is many pictures in a row — and the tricks that make a computer produce them fast enough.',
  sections: [
    sec('anim', '7.1', 'How animation works', { eyebrow: 'Persistence of vision',
      body: `<p>Showing at least ~24 still images per second fools the eye into seeing motion; games aim for 60. ${term('Raster animation')} copies pixel blocks and cycles colour tables; ${term('key-frame')} systems define important poses and let the computer generate the ${term('in-betweens')}. Animation functions: object definition, path specification, key frames, in-betweening, a scene description.</p>`,
      worked: [step('A 10-second clip at 24 frames/s.', '10\\times24', { toc: 'Frames' }), step('With key frames every 12 frames an animator poses 20 and the computer generates the other 220.', '240-20=220', { hero: true, toc: 'In-betweens' })],
      qs: [q('kf', 'In key-frame animation the computer generates…', ['The in-between frames.', 'The animator supplies only key poses.'], [['The key poses.', 'The animator draws those.'], ['The camera.', 'Unrelated.']])] }),
    sec('interp', '7.2', 'Interpolating motion', { eyebrow: 'In-betweening',
      body: `<p>Linear interpolation moves at constant speed and looks mechanical; real motion eases in and out. A spline through the key positions gives smooth paths; a Bézier speed curve controls the timing (“ease-in-out”). Below, one control point shapes a path.</p>`,
      figs: [lab('bezier', { points: '0,0;1,4;5,4;6,0', t: '0.2 0.4 0.6 0.8' }, 'The path an object follows between two key positions.', ['mid'], { caption: 'an animation path', name: 'path' })],
      qs: [q('ease', 'Ease-in-out motion…', ['Starts slowly, speeds up, then slows to a stop.', 'It looks natural because real objects accelerate.'], [['Moves at constant speed.', 'That is linear.'], ['Jumps between frames.', 'No.']])] }),
    sec('motion', '7.3', 'Motion specification', { eyebrow: 'Telling objects how to move',
      body: `<p>${term('Direct specification')}: give positions or velocities explicitly. ${term('Goal-directed')}: say where the object should end up and let the system work out the motion. ${term('Kinematics')} describes motion without forces (forward kinematics: joint angles → hand position; inverse kinematics: hand position → joint angles). ${term('Dynamics')} uses forces and mass — a ball bouncing, cloth draping: exactly what this notebook’s physics engine does.</p>`,
      figs: [dia(`direction: right
[Joint angles θ1, θ2] as a #blue
[Forward kinematics] as f #violet
[Hand position x, y] as h #mint
a -> f
f -> h
h --> a : inverse kinematics`, 'Forward kinematics is easy; the inverse may have several solutions.', { caption: 'kinematics' })],
      qs: [q('ik', 'Inverse kinematics finds…', ['The joint angles that put the hand at a desired position.', 'Forward kinematics goes the other way.'], [['The hand position from angles.', 'That is forward.'], ['The forces on a joint.', 'That is dynamics.']])] }),
    sec('viz', '8.1', 'Interactive visualisation and distributed rendering', { eyebrow: 'Scale',
      body: `<p>Interactive visualisation lets users rotate, slice and query data in real time. Very large scenes are rendered across many machines (distributed/cloud rendering): split the image into tiles or the animation into frames, render in parallel, and assemble the result. Film studios use render farms; cloud gaming streams rendered video to thin clients.</p>`,
      probs: [pr('p1', '<p>A film frame takes 2 hours to render on one machine. How long do 1 000 frames take on a 100-machine farm?</p>', 'Total work 1000 × 2 h = 2000 machine-hours; on 100 machines (perfect split) <b>20 hours</b>.')],
      qs: [q('farm', 'Why are animation frames ideal for a render farm?', ['Each frame can be rendered independently, so work splits cleanly.', 'Near-linear speed-up.'], [['They must be rendered in order.', 'Frames are independent.'], ['They are tiny.', 'They are large.']])] }),
    sec('arvr', '8.2', 'AR, VR and mixed reality', { eyebrow: 'Immersion',
      body: `<p>${term('VR')} replaces the world with a rendered one (head-mounted display plus head tracking; needs low latency, under about 20 ms from motion to photon, or users feel sick). ${term('AR')} overlays graphics on the real view (phone camera, glasses). ${term('MR')} anchors virtual objects in real space so they interact with it. All three run the same pipeline twice (one image per eye) at 90 Hz or more, plus tracking and registration.</p>`,
      figs: [dia(`direction: right
[Head / camera tracking] as t #blue
[Scene update] as s #violet
[Render: left and right eye] as r #mint
[Display] as d #amber
t -> s
s -> r
r -> d
d --> t : next head pose
@0 t -> s : pose
@1 s -> r : scene
@2 r -> d : two images
@3 d -> t : new pose
loop 4`, 'The latency of this loop must stay tiny.', { caption: 'the VR loop' })],
      qs: [q('lat', 'Why must VR have very low latency?', ['Delay between head motion and the image causes discomfort and nausea.', 'The brain expects the world to move with the head.'], [['To save power.', 'Not the reason.'], ['To use fewer polygons.', 'Unrelated.']])] }),
    sec('games', '8.3', 'Game development and real-time graphics', { eyebrow: 'Engines',
      body: `<p>A game engine (Unity, Unreal) runs a loop: read input, update the world (physics, AI), render, repeat — within one frame time. Real-time tricks: level of detail, culling, baked lighting, instancing, shaders programmed on the GPU. Applications of AR/VR/gaming: training, design review, therapy, education, entertainment.</p>`,
      worked: [step('A target of 60 fps; physics takes 4 ms, AI 3 ms, rendering 8 ms.', '4+3+8', { toc: 'Budget' }), step('Total 15 ms &lt; 16.7 ms: the frame fits, with 1.7 ms to spare.', '15<16.7', { hero: true, toc: 'Verdict' })],
      qs: [q('loop', 'The heart of a game engine is…', ['A loop: input → update → render, once per frame.', 'Everything must finish within the frame time.'], [['A single render call.', 'Much more.'], ['A database.', 'Not the core.']])] }),
    sec('summary', '8.4', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Animation = key frames + in-betweens; ease with splines.</li><li>VR needs low latency; engines loop input-update-render.</li></ul>` }),
  ],
})
