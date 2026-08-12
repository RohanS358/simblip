'use client'

// Soft aurora background (adapted from React Bits' SoftAurora).
//
// Two changes from the upstream component, both required to fit this app:
//
//  1. COLORS COME FROM THE THEME. Upstream takes hex props and parses them
//     with a hex-only helper. This app's palette is OKLCH custom properties
//     that change with the active theme (light, dim, midnight, contrast,
//     mountains, diva — see app/globals.css), so colors are read from the
//     resolved CSS variables at runtime and re-read when the theme changes.
//     Passing "#e100ff" would pin one hard-coded colour across every theme.
//
//  2. IT STOPS WHEN IT ISN'T WANTED. Upstream runs a rAF loop forever. A
//     room board is a long-lived always-on display, so the loop pauses when
//     the tab is hidden, and honours prefers-reduced-motion by rendering a
//     single static frame instead of animating.

import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Triangle } from 'ogl'

/**
 * Is the active theme a light one?
 *
 * Measured from the resolved --background, not from a class allowlist: this
 * app ships six themes (light, dim, midnight, contrast, mountains, diva) and
 * more can be added, so `class === 'dark'` would silently mis-tag any new
 * light theme. Luminance of the actual page ground is the thing that
 * matters, so that is what's asked.
 *
 * Returns 0..1 rather than a boolean so mid-tone themes get a partial
 * correction instead of snapping to one extreme.
 */
function lightness(el: HTMLElement): number {
  const bg = cssColorToVec3(el, '--background', [0, 0, 0])
  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]
  // Below ~0.5 is a dark ground and needs no correction at all; above it,
  // ramp up to full by the time the page is near-white.
  return Math.max(0, Math.min(1, (lum - 0.5) / 0.35))
}

/**
 * Resolve a CSS colour (any format — oklch(), hex, rgb()) to linear-ish RGB
 * in 0..1, by letting the browser do the conversion. `color-mix` and OKLCH
 * are not parseable by hand, and hard-coding a hex would defeat theming.
 */
function cssColorToVec3(
  el: HTMLElement,
  cssVar: string,
  fallback: [number, number, number]
): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue(cssVar).trim()
  if (!raw) return fallback

  const probe = document.createElement('span')
  // A sentinel first: if the browser rejects `raw` as a colour, the assignment
  // is a no-op and the sentinel survives — that's how we detect failure.
  // Without it an unparseable value silently reads back as the inherited
  // colour (usually black), which looks like a working-but-wrong aurora.
  const SENTINEL = 'rgb(1, 2, 3)'
  probe.style.color = SENTINEL
  probe.style.color = raw
  if (probe.style.color === SENTINEL) return fallback

  probe.style.display = 'none'
  el.appendChild(probe)
  const computed = getComputedStyle(probe).color
  el.removeChild(probe)

  // getComputedStyle returns one of three things depending on the engine:
  //   rgb(r, g, b)        channels 0..255
  //   color(srgb r g b)   channels already 0..1
  //   oklch(l c h)        NOT converted — some engines pass it through
  // The third is the trap: this app's palette is entirely oklch, and reading
  // "0.58 0.14 255" as if it were rgb collapses every theme to the same blue.
  // So oklch is converted here rather than assumed to be handled.
  if (computed.startsWith('oklch')) return clamp01(oklchToRgb(computed) ?? fallback)

  const m = computed.match(/-?[\d.]+/g)
  if (!m || m.length < 3) return fallback
  const [r, g, b] = m.slice(0, 3).map(Number)
  return clamp01(
    computed.startsWith('color(') ? [r, g, b] : [r / 255, g / 255, b / 255]
  )
}

const clamp01 = (c: number[]): [number, number, number] =>
  [
    Math.min(1, Math.max(0, c[0])),
    Math.min(1, Math.max(0, c[1])),
    Math.min(1, Math.max(0, c[2])),
  ]

/**
 * oklch() → linear sRGB, via Oklab. Needed because not every engine converts
 * oklch in getComputedStyle, and the whole palette is authored in it.
 * Reference: Björn Ottosson's Oklab, the same matrices the CSS spec uses.
 */
function oklchToRgb(css: string): [number, number, number] | null {
  const m = css.match(/-?[\d.]+/g)
  if (!m || m.length < 3) return null
  const L = Number(m[0])
  const C = Number(m[1])
  const hDeg = Number(m[2])
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const bb = C * Math.sin(h)

  // Oklab → LMS (cube of the intermediate), → linear sRGB.
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb
  const l = l_ * l_ * l_
  const mm = m_ * m_ * m_
  const s = s_ * s_ * s_

  const lr = +4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s
  const lg = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s
  const lb = -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s

  // The shader multiplies colours in linear space and the canvas is not
  // colour-managed here, so gamma-encode to match how the rest of the UI
  // renders these same tokens.
  const enc = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
  return [enc(lr), enc(lg), enc(lb)]
}

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform float uSpeed;
uniform float uScale;
uniform float uBrightness;
/** 1 on a light theme, 0 on a dark one. Drives the light-mode correction
 *  at the end of main() — see the comment there. */
uniform float uLight;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform float uNoiseFreq;
uniform float uNoiseAmp;
uniform float uBandHeight;
uniform float uBandSpread;
uniform float uOctaveDecay;
uniform float uLayerOffset;
uniform float uColorSpeed;
uniform vec2 uMouse;
uniform float uMouseInfluence;
uniform bool uEnableMouse;

#define TAU 6.28318

vec3 gradientHash(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 234.6)),
    dot(p, vec3(269.5, 183.3, 198.3)),
    dot(p, vec3(169.5, 283.3, 156.9))
  );
  vec3 h = fract(sin(p) * 43758.5453123);
  float phi = acos(2.0 * h.x - 1.0);
  float theta = TAU * h.y;
  return vec3(cos(theta) * sin(phi), sin(theta) * cos(phi), cos(phi));
}

float quinticSmooth(float t) {
  float t2 = t * t;
  float t3 = t * t2;
  return 6.0 * t3 * t2 - 15.0 * t2 * t2 + 10.0 * t3;
}

vec3 cosineGradient(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(TAU * (c * t + d));
}

float perlin3D(float amplitude, float frequency, float px, float py, float pz) {
  float x = px * frequency;
  float y = py * frequency;

  float fx = floor(x); float fy = floor(y); float fz = floor(pz);
  float cx = ceil(x);  float cy = ceil(y);  float cz = ceil(pz);

  vec3 g000 = gradientHash(vec3(fx, fy, fz));
  vec3 g100 = gradientHash(vec3(cx, fy, fz));
  vec3 g010 = gradientHash(vec3(fx, cy, fz));
  vec3 g110 = gradientHash(vec3(cx, cy, fz));
  vec3 g001 = gradientHash(vec3(fx, fy, cz));
  vec3 g101 = gradientHash(vec3(cx, fy, cz));
  vec3 g011 = gradientHash(vec3(fx, cy, cz));
  vec3 g111 = gradientHash(vec3(cx, cy, cz));

  float d000 = dot(g000, vec3(x - fx, y - fy, pz - fz));
  float d100 = dot(g100, vec3(x - cx, y - fy, pz - fz));
  float d010 = dot(g010, vec3(x - fx, y - cy, pz - fz));
  float d110 = dot(g110, vec3(x - cx, y - cy, pz - fz));
  float d001 = dot(g001, vec3(x - fx, y - fy, pz - cz));
  float d101 = dot(g101, vec3(x - cx, y - fy, pz - cz));
  float d011 = dot(g011, vec3(x - fx, y - cy, pz - cz));
  float d111 = dot(g111, vec3(x - cx, y - cy, pz - cz));

  float sx = quinticSmooth(x - fx);
  float sy = quinticSmooth(y - fy);
  float sz = quinticSmooth(pz - fz);

  float lx00 = mix(d000, d100, sx);
  float lx10 = mix(d010, d110, sx);
  float lx01 = mix(d001, d101, sx);
  float lx11 = mix(d011, d111, sx);

  float ly0 = mix(lx00, lx10, sy);
  float ly1 = mix(lx01, lx11, sy);

  return amplitude * mix(ly0, ly1, sz);
}

float auroraGlow(float t, vec2 shift) {
  vec2 uv = gl_FragCoord.xy / uResolution.y;
  uv += shift;

  float noiseVal = 0.0;
  float freq = uNoiseFreq;
  float amp = uNoiseAmp;
  vec2 samplePos = uv * uScale;

  for (float i = 0.0; i < 3.0; i += 1.0) {
    noiseVal += perlin3D(amp, freq, samplePos.x, samplePos.y, t);
    amp *= uOctaveDecay;
    freq *= 2.0;
  }

  float yBand = uv.y * 10.0 - uBandHeight * 10.0;
  return 0.3 * max(exp(uBandSpread * (1.0 - 1.1 * abs(noiseVal + yBand))), 0.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float t = uSpeed * 0.4 * uTime;

  vec2 shift = vec2(0.0);
  if (uEnableMouse) {
    shift = (uMouse - 0.5) * uMouseInfluence;
  }

  vec3 col = vec3(0.0);
  col += 0.99 * auroraGlow(t, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.2 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.20, 0.20)) * uColor1;
  col += 0.99 * auroraGlow(t + uLayerOffset, shift) * cosineGradient(uv.x + uTime * uSpeed * 0.1 * uColorSpeed, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25)) * uColor2;

  col *= uBrightness;

  // Light themes need the opposite treatment to dark ones. The shader
  // composites additively over the page, which is luminous on a dark ground
  // but on white just DARKENS toward the accent hue — the same values that
  // glow at night read as a grey-blue haze by day.
  //
  // So on light: push saturation up and lift the whole band toward white, so
  // what lands on the page is a bright tint rather than a dim wash. uLight is
  // 0 on dark themes, which leaves everything above untouched.
  if (uLight > 0.0) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, 1.0 + 0.45 * uLight);   // richer hue, not grey
    col = mix(col, vec3(1.0), 0.30 * uLight);          // lift toward white
  }

  float alpha = clamp(length(col), 0.0, 1.0);
  // A light page also needs LESS coverage: the same alpha that reads as a
  // soft glow on black reads as dirt on white. Scale it back rather than
  // asking the caller to pass a different brightness per theme.
  alpha *= mix(1.0, 0.62, uLight);
  gl_FragColor = vec4(col, alpha);
}
`

export interface SoftAuroraProps {
  speed?: number
  scale?: number
  brightness?: number
  /** CSS custom property to tint layer 1 with. Defaults to the theme accent. */
  colorVar1?: string
  /** CSS custom property to tint layer 2 with. */
  colorVar2?: string
  noiseFrequency?: number
  noiseAmplitude?: number
  bandHeight?: number
  bandSpread?: number
  octaveDecay?: number
  layerOffset?: number
  colorSpeed?: number
  enableMouseInteraction?: boolean
  mouseInfluence?: number
  className?: string
}

export default function SoftAurora({
  speed = 0.6,
  scale = 1.5,
  brightness = 1.0,
  colorVar1 = '--accent-blue',
  colorVar2 = '--accent-violet',
  noiseFrequency = 2.5,
  noiseAmplitude = 1.0,
  bandHeight = 0.5,
  bandSpread = 1.0,
  octaveDecay = 0.1,
  layerOffset = 0,
  colorSpeed = 1.0,
  enableMouseInteraction = true,
  mouseInfluence = 0.25,
  className,
}: SoftAuroraProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Reduced motion: render one still frame rather than a looping animation.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    let renderer: Renderer
    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: false })
    } catch {
      // No WebGL (old board hardware, blocked context) — the page still works
      // without a background, so fail quietly rather than crashing the board.
      return
    }
    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)

    const currentMouse = [0.5, 0.5]
    let targetMouse = [0.5, 0.5]

    const handleMouseMove = (e: MouseEvent) => {
      const rect = gl.canvas.getBoundingClientRect()
      targetMouse = [
        (e.clientX - rect.left) / rect.width,
        1.0 - (e.clientY - rect.top) / rect.height,
      ]
    }
    const handleMouseLeave = () => {
      targetMouse = [0.5, 0.5]
    }

    const geometry = new Triangle(gl)
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height],
        },
        uSpeed: { value: speed },
        uScale: { value: scale },
        uBrightness: { value: brightness },
        uLight: { value: lightness(container) },
        uColor1: { value: cssColorToVec3(container, colorVar1, [0.4, 0.6, 1]) },
        uColor2: { value: cssColorToVec3(container, colorVar2, [0.7, 0.4, 1]) },
        uNoiseFreq: { value: noiseFrequency },
        uNoiseAmp: { value: noiseAmplitude },
        uBandHeight: { value: bandHeight },
        uBandSpread: { value: bandSpread },
        uOctaveDecay: { value: octaveDecay },
        uLayerOffset: { value: layerOffset },
        uColorSpeed: { value: colorSpeed },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseInfluence: { value: mouseInfluence },
        uEnableMouse: { value: enableMouseInteraction && !reduceMotion },
      },
    })
    const mesh = new Mesh(gl, { geometry, program })

    const resize = () => {
      renderer.setSize(container.offsetWidth, container.offsetHeight)
      program.uniforms.uResolution.value = [
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height,
      ]
    }
    // ResizeObserver, not window resize: this sits inside a flex layout whose
    // box can change without the window doing so (panel opens, split resize).
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    container.appendChild(gl.canvas)
    gl.canvas.style.display = 'block'

    if (enableMouseInteraction && !reduceMotion) {
      gl.canvas.addEventListener('mousemove', handleMouseMove)
      gl.canvas.addEventListener('mouseleave', handleMouseLeave)
    }

    // Re-read the palette when the theme changes. next-themes swaps a class
    // on <html>, which no CSS-variable listener can observe — so watch the
    // attribute and resolve the variables again.
    const themeObserver = new MutationObserver(() => {
      program.uniforms.uColor1.value = cssColorToVec3(container, colorVar1, [0.4, 0.6, 1])
      program.uniforms.uColor2.value = cssColorToVec3(container, colorVar2, [0.7, 0.4, 1])
      // Light↔dark is a theme change too — re-measure the ground.
      program.uniforms.uLight.value = lightness(container)
      // Under reduced motion there is no rAF loop, so new uniforms would sit
      // unused and the board would keep showing the old theme's colours until
      // something else forced a repaint. Paint the one frame ourselves.
      if (reduceMotion) renderer.render({ scene: mesh })
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    let frame = 0
    const update = (time: number) => {
      frame = requestAnimationFrame(update)
      program.uniforms.uTime.value = time * 0.001
      if (enableMouseInteraction) {
        currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0])
        currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1])
        program.uniforms.uMouse.value[0] = currentMouse[0]
        program.uniforms.uMouse.value[1] = currentMouse[1]
      }
      renderer.render({ scene: mesh })
    }

    // A board display runs for hours; don't spend a GPU on a hidden tab.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else if (!frame && !reduceMotion) {
        frame = requestAnimationFrame(update)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    if (reduceMotion) {
      program.uniforms.uTime.value = 0
      renderer.render({ scene: mesh })
    } else {
      frame = requestAnimationFrame(update)
    }

    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      themeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      if (enableMouseInteraction && !reduceMotion) {
        gl.canvas.removeEventListener('mousemove', handleMouseMove)
        gl.canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [
    speed,
    scale,
    brightness,
    colorVar1,
    colorVar2,
    noiseFrequency,
    noiseAmplitude,
    bandHeight,
    bandSpread,
    octaveDecay,
    layerOffset,
    colorSpeed,
    enableMouseInteraction,
    mouseInfluence,
  ])

  return <div ref={containerRef} className={className} aria-hidden />
}
