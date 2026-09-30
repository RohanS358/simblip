import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Display devices and the graphics pipeline',
  kicker: 'ENCT 201 · Computer Graphics and Visualization · Chapter 1',
  subtitle: 'How a description of a scene becomes a grid of coloured dots.',
  sections: [
    sec('display', '1.1', 'Raster and random-scan displays', { eyebrow: 'Hardware',
      body: `<p>A ${term('raster-scan')} display refreshes a grid of pixels row by row, 60+ times a second, from a ${term('frame buffer')} in memory; its memory need is resolution × bits per pixel. A ${term('random-scan')} (vector) display draws lines directly and only what is needed — sharp lines, poor fills. Flat panels (LCD, LED, OLED) are raster devices.</p>`,
      worked: [step('A 1920 × 1080 display with 24 bits (3 bytes) per pixel.', '1920\\times1080\\times3', { toc: 'Given' }), step('Frame-buffer size.', '\\approx 6.2\\ \\text{MB}', { hero: true, toc: 'Memory' }), step('At 60 Hz the buffer is read 60 times a second: bandwidth ≈ 373 MB/s.', '6.2\\times60', { toc: 'Bandwidth' })],
      qs: [q('fb', 'The frame buffer stores…', ['The colour of every pixel on the screen.', 'The display hardware scans it continuously.'], [['The program code.', 'No.'], ['Only the lines to draw.', 'That is the display list of a random-scan device.']])] }),
    sec('pipe', '1.2', 'The graphics pipeline', { eyebrow: 'From model to pixels',
      body: `<p>Every renderer applies the same stages: a ${term('model')} (vertices and faces) is transformed into world space, then into the camera’s view, ${term('clipped')} against the view volume, ${term('projected')} to 2-D, mapped to the viewport, and finally ${term('rasterised')} — converted to pixels, where visibility and shading are resolved. OpenGL, DirectX, WebGL and game engines are implementations of it.</p>`,
      figs: [dia(`direction: right
[Model: vertices, faces] as m #blue
[Model → world transform] as w #violet
[View transform] as v #violet
[Clipping] as c #amber
[Projection] as p #mint
[Viewport + rasterise] as r #rose
(Pixels) as px
m -> w
w -> v
v -> c
c -> p
p -> r
r -> px
@0 m -> w : triangle
@1 w -> v : in the world
@2 v -> c : from the camera
@3 c -> p : visible part
@4 p -> r : 2-D
@5 r -> px : pixels
loop 7`, 'Press Simulate: one triangle travels the whole pipeline.', { caption: 'the graphics pipeline' })],
      qs: [q('order', 'Rasterisation happens…', ['At the end of the pipeline, turning projected primitives into pixels.', 'Earlier stages work on vertices, not pixels.'], [['First, on the model.', 'Models are vertex data.'], ['Before clipping.', 'Clipping precedes it.']])] }),
    sec('soft', '1.3', 'Graphics software and standards', { eyebrow: 'Tools',
      body: `<p>Low-level graphics APIs: OpenGL (and its web form ${term('WebGL')}), DirectX, Vulkan, Metal. PHIGS and GKS were early standards. On top sit engines and tools: Unity, Unreal, Blender and Maya for modelling and animation. Coordinates are usually Cartesian; graphics functions cover output primitives, attributes, transformations and input.</p>`,
      qs: [q('webgl', 'WebGL is…', ['A JavaScript API for GPU-accelerated 2-D/3-D graphics in the browser.', 'It is based on OpenGL ES.'], [['A modelling tool.', 'That is Blender/Maya.'], ['A display device.', 'No.']])] }),
    sec('app', '1.4', 'Applications', { eyebrow: 'Where it is used',
      body: `<p>Computer-aided design, medical imaging (CT/MRI volumes), scientific visualisation, games and film, user interfaces, simulation and training, virtual and augmented reality, and data visualisation. The same pipeline underlies all of them; what differs is the model and the speed requirement.</p>`,
      probs: [pr('p1', '<p>Why must a game renderer finish a frame in under about 16 ms?</p>', 'To keep 60 frames per second: 1 s / 60 ≈ 16.7 ms per frame for everything — transformation, clipping and shading of millions of triangles — which is why the work is done by parallel GPU hardware.')],
      qs: [q('fps', 'At 60 frames per second each frame has about…', ['16.7 ms.', '1000 ms / 60.'], [['60 ms.', 'That would be about 17 fps.'], ['1 ms.', 'That would be 1000 fps.']])] }),
    sec('viewing', '1.5', '2-D and 3-D viewing pipelines', { eyebrow: 'Windows and viewports',
      body: `<p>In 2-D, a rectangular ${term('window')} in world coordinates selects what to show; the ${term('viewport')} is where it appears on screen; the window-to-viewport mapping scales and translates. In 3-D, a camera (position, direction, up) defines the view; a view volume (a box for parallel, a frustum for perspective) is clipped and projected onto a view plane.</p>`,
      worked: [step('Window x from 0 to 100 mapped to a viewport x from 200 to 600. Where does x = 25 land?', '', { toc: 'Question' }), step('Scale 400/100 = 4, then shift: 200 + 4 × 25.', 'x_v=200+4(25)=300', { hero: true, toc: 'Mapping' })],
      qs: [q('vp', 'The window-to-viewport transformation consists of…', ['A scaling and a translation.', 'It maps one rectangle onto another.'], [['A rotation only.', 'No.'], ['A projection.', 'That is the 3-D step.']])] }),
    sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Frame buffer = width × height × bytes per pixel.</li><li>Pipeline: model → world → view → clip → project → viewport → raster.</li></ul>` }),
  ],
})
