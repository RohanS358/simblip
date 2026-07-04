// AI gateway. The real AI server is external; this route owns the contract:
// validate the request, (later) proxy to the AI service, validate its output
// against the Simulation JSON schema, return it.
//
// The stub answers assemble the SAME primitives + behaviors a user places by
// hand — a pendulum is a rod whose free end holds a mass, not a template.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { aiResponseSchema, type AiResponse } from '@/lib/ai/schema'

const requestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  pageContext: z
    .object({
      variables: z.array(z.object({ name: z.string(), expr: z.string() })),
      objectCount: z.number(),
    })
    .optional(),
})

function respond(prompt: string): AiResponse {
  const p = prompt.toLowerCase()

  if (p.includes('pendul')) {
    return {
      message:
        'I assembled a pendulum from primitives: a rigid rod anchored to the world at its top end, with a mass at the free end. Press Play. The rod is just a line with a Rod behavior — you could have drawn it. Change g in Variables (try 1.62 for the Moon) or the mass in its Inspector while it swings.',
      simulation: {
        title: 'Pendulum',
        explanation: 'Rod constraint + rigid-body bob. Period T ≈ 2π√(L/g) for small angles.',
        variables: [{ name: 'g', expr: '9.81' }],
        objects: [
          {
            geometry: 'circle', name: 'Pivot', dx: 192, dy: -8, w: 16, h: 16,
            render: 'hinge', behaviors: [],
          },
          {
            geometry: 'line', name: 'Rod', dx: 200, dy: 0,
            points: [[0, 0], [120, 160]],
            behaviors: [{ type: 'rod', params: {} }],
          },
          {
            geometry: 'circle', name: 'Bob', dx: 285, dy: 125, w: 70, h: 70,
            behaviors: [{ type: 'rigidBody', params: { mass: '2', restitution: '0.2' } }],
          },
          {
            geometry: 'graph', dx: 420, dy: -40, w: 420, h: 300,
            graphSource: 2, graphChannels: ['x', 'vx'], behaviors: [],
          },
        ],
      },
    }
  }

  if (p.includes('spring') || p.includes('oscillat') || p.includes('resonan')) {
    return {
      message:
        'A hanging spring–mass oscillator, built from a spring (line + Spring behavior) whose top end anchors to the world and whose bottom end touches a mass. Stiffness is the page variable k — sweep it in Variables while it runs and watch the frequency shift (ω₀ = √(k/m)).',
      simulation: {
        title: 'Spring–Mass Oscillator',
        explanation: 'Spring constraint + rigid body. Natural frequency ω₀ = √(k/m).',
        variables: [
          { name: 'g', expr: '9.81' },
          { name: 'k', expr: '30' },
        ],
        objects: [
          {
            geometry: 'line', name: 'Spring', dx: 235, dy: 0,
            points: [[0, 0], [0, 140]], render: 'spring',
            behaviors: [{ type: 'spring', params: { k: 'k', damping: '0.05' } }],
          },
          {
            geometry: 'circle', name: 'Mass', dx: 200, dy: 105, w: 70, h: 70,
            behaviors: [{ type: 'rigidBody', params: { mass: '1.5' } }],
          },
          {
            geometry: 'graph', dx: 420, dy: 0, w: 420, h: 300,
            graphSource: 1, graphChannels: ['y', 'vy'], behaviors: [],
          },
          {
            geometry: 'formula', dx: 0, dy: 320, w: 300, h: 90,
            text: '\\omega_0 = \\sqrt{k/m}', behaviors: [],
          },
        ],
      },
    }
  }

  if (p.includes('projectile') || p.includes('trajector')) {
    return {
      message:
        'A projectile: one ball with initial velocity set from the variables v0 and launch (degrees), plus a static ground to land on. The velocity expressions are evaluated when you press Play — edit the angle and Play again to compare trajectories on the graph.',
      simulation: {
        title: 'Projectile Motion',
        explanation: 'Rigid body with initial velocity; range R = v0²·sin(2θ)/g.',
        variables: [
          { name: 'g', expr: '9.81' },
          { name: 'v0', expr: '9' },
          { name: 'launch', expr: '45' },
        ],
        objects: [
          {
            geometry: 'circle', name: 'Ball', dx: 20, dy: 260, w: 44, h: 44,
            behaviors: [
              {
                type: 'rigidBody',
                params: {
                  mass: '1', restitution: '0.5',
                  vx: 'v0*cos(launch*pi/180)', vy: 'v0*sin(launch*pi/180)',
                },
              },
            ],
          },
          {
            geometry: 'rect', name: 'Ground', dx: -40, dy: 320, w: 900, h: 26,
            render: 'ground', behaviors: [{ type: 'staticBody', params: { friction: '0.6' } }],
          },
          {
            geometry: 'graph', dx: 480, dy: 0, w: 420, h: 290,
            graphSource: 0, graphChannels: ['y', 'x'], behaviors: [],
          },
        ],
      },
    }
  }

  if (p.includes('wheel') || p.includes('car') || p.includes('motor')) {
    return {
      message:
        'A motorized wheel on the ground — a circle with Rigid Body + Motor behaviors. The motor drives angular velocity; friction converts spin into rolling. Change the motor speed in the Inspector while it runs.',
      simulation: {
        title: 'Motorized Wheel',
        explanation: 'Motor behavior drives rotation; friction makes it roll.',
        variables: [{ name: 'g', expr: '9.81' }],
        objects: [
          {
            geometry: 'circle', name: 'Wheel', dx: 60, dy: 160, w: 100, h: 100, render: 'motor',
            behaviors: [
              { type: 'rigidBody', params: { mass: '2', friction: '0.9' } },
              { type: 'motor', params: { speed: '3' } },
            ],
          },
          {
            geometry: 'rect', name: 'Ground', dx: -60, dy: 290, w: 1000, h: 26,
            render: 'ground', behaviors: [{ type: 'staticBody', params: { friction: '0.9' } }],
          },
        ],
      },
    }
  }

  return {
    message:
      'I assemble experiments from the same primitives you can draw yourself — shapes with behaviors attached. Try: "build a pendulum", "spring oscillator", "projectile motion", or "motorized wheel". Or do it by hand: draw a circle, add a Rigid Body behavior in the Inspector, draw a rectangle under it, make it a Static Body, press Play.',
  }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Validate our own output too — the same gate the external AI will pass through.
  const response = aiResponseSchema.parse(respond(parsed.data.prompt))
  return NextResponse.json(response)
}
