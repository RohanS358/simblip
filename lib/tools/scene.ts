'use client'

// scene.* and graph.* — read, build, edit and run the page you are on.
// Each tool is a thin wrapper over code the app already trusts.

import { z } from 'zod'
import { useDocStore } from '@/lib/store/document'
import { useRuntimeStore, play, pause, stop } from '@/lib/physics/world'
import { readBuffer } from '@/lib/physics/bus'
import { executeSimScript } from '@/lib/scene/simscript'
import { viewportBounds } from '@/lib/scene/insertables'
import { verifyScene } from '@/lib/scene/verify-scene'
import { COMPONENTS } from '@/lib/scene/factory'
import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { lintSimScript } from '@/lib/ai/simscript-lint'
import { autofixSimScript } from '@/lib/ai/simscript-fix'
import { generateSimScript, GenerationFailedError, GeneratorUnavailableError } from '@/lib/ai/generate'
import { buildDigest } from '@/lib/ai/page-context'
import { applyPlan } from '@/lib/ai/apply-ops'
import { editOpSchema, verifyPlan, describePlan } from '@/lib/ai/edit-ops'
import { placeAnswerAndScene } from '@/lib/ai/placement'
import { SIMSCRIPT_SYSTEM_PROMPT } from '@/lib/ai/simscript-corpus'
import { defineTool, fail, ok, type ToolContext } from './types'
import { registerTool, toolGenerator } from './registry'

const noPage = () => fail('No page is open. Open a notebook page first.')

/** viewportBounds() divides by a measured canvas; with no canvas on screen
 *  (a headless MCP call, a page not yet mounted) it can return a NaN edge, and
 *  a NaN position serialises to null — an object nobody can ever find. */
function safeBounds(pageId: string) {
  const b = viewportBounds(pageId)
  return [b.left, b.top, b.right, b.bottom].every(Number.isFinite) ? b : { left: 0, top: 0, right: 1200, bottom: 800 }
}

/** Run verified SimScript onto the page, placed by geometry (never by the
 *  script's own guess) — identical to the panel's Add button. */
function place(pageId: string, script: string) {
  // One discrete undo step for the whole scene, however recently the user last edited.
  useDocStore.getState().pushHistory(pageId, true)
  const bounds = safeBounds(pageId)
  const origin = placeAnswerAndScene(null, true, bounds).scene ?? { x: bounds.left + 40, y: bounds.top + 40 }
  const kind = findPageMeta(useWorkspaceStore.getState().nodes, pageId)?.pageKind
  const before = Object.keys(useDocStore.getState().pages[pageId]?.objects ?? {}).length
  executeSimScript(pageId, script, origin, { bounds, fixedFrame: kind === 'pptx' || kind === 'doc' })
  const page = useDocStore.getState().pages[pageId]
  const added = Object.keys(page?.objects ?? {}).length - before
  const errors = page ? verifyScene(Object.values(page.objects)).issues.filter((i) => i.level === 'error') : []
  return { added, warning: errors[0]?.message }
}

export const sceneDescribe = registerTool(
  defineTool({
    name: 'scene.describe',
    summary: 'Describe what is on the current page',
    help: 'Returns one line per object with its real id, kind, position and key parameters. Use these ids with scene.edit.',
    effect: 'read',
    keywords: ['describe', 'what is on', 'what\'s on', 'look at', 'show me the page', 'list objects', 'read the page'],
    input: z.object({ scope: z.enum(['page', 'selection']).optional() }),
    run({ scope }, ctx) {
      if (!ctx.pageId) return noPage()
      const st = useDocStore.getState()
      const page = st.pages[ctx.pageId]
      if (!page) return noPage()
      const digest = buildDigest(page, scope === 'selection' ? st.selection : [])
      const n = Object.keys(page.objects).length
      return ok(digest.text || 'The page is empty.', { objects: n, text: digest.text })
    },
  })
)

export const sceneScript = registerTool(
  defineTool({
    name: 'scene.script',
    summary: 'Run SimScript to build a scene on the page',
    help:
      'SimScript is SIMBLIP\'s scene language: create(kind, props), connect(a.anchor, b.anchor), addproperty(obj, behavior, params), graph.plot(obj.channel). It is linted first; errors come back so you can fix and retry. Circuits take no x/y (auto-layout draws them). Use scene.components for valid kinds.',
    effect: 'write',
    keywords: ['script', 'simscript', 'create(', 'run this code'],
    input: z.object({ script: z.string().min(1).max(20_000) }),
    run({ script }, ctx) {
      if (!ctx.pageId) return noPage()
      let lint = lintSimScript(script)
      if (!lint.ok) {
        const fixed = autofixSimScript(lint.cleaned)
        if (fixed.notes.length) lint = lintSimScript(fixed.code)
      }
      if (!lint.ok) return fail(`SimScript rejected: ${lint.errors.slice(0, 5).join(' | ')}`)
      const { added, warning } = place(ctx.pageId, lint.cleaned)
      return ok(`Added ${added} object${added === 1 ? '' : 's'}.${warning ? ` Warning: ${warning}` : ''}`, { added, warning })
    },
  })
)

export const sceneBuild = registerTool(
  defineTool({
    name: 'scene.build',
    summary: 'Build a simulation from a plain-language description',
    help: 'Uses the on-device model to write the scene, verifies it, and places it. Example: "a 2 kg pendulum with a graph of its angle".',
    effect: 'write',
    keywords: ['build', 'make', 'create', 'draw', 'simulate', 'simulation', 'circuit', 'pendulum', 'spring', 'add a'],
    input: z.object({ request: z.string().min(3).max(1000) }),
    async run({ request }, ctx) {
      if (!ctx.pageId) return noPage()
      const gen = await toolGenerator()?.()
      if (!gen) return fail('No AI model is available. Download the on-device model, or use scene.script.')
      try {
        const res = await generateSimScript(request, { generator: gen, systemPrompt: SIMSCRIPT_SYSTEM_PROMPT })
        const { added, warning } = place(ctx.pageId, res.script)
        return ok(
          `Built it: ${added} object${added === 1 ? '' : 's'}${res.attempts > 1 ? ` (${res.attempts} passes)` : ''}.${warning ? ` Warning: ${warning}` : ''}`,
          { added, script: res.script }
        )
      } catch (e) {
        if (e instanceof GenerationFailedError) return fail(`${e.message} ${e.errors.slice(0, 2).join(' | ')}`)
        if (e instanceof GeneratorUnavailableError) return fail(e.message)
        throw e
      }
    },
  })
)

const opsInput = z.object({
  ops: z.array(editOpSchema).min(1).max(40),
  summary: z.string().optional(),
})

export const sceneEdit = registerTool(
  defineTool({
    name: 'scene.edit',
    summary: 'Change objects already on the page',
    help:
      'Ops: add{component,position,name?,params?} | update{id,position?,size?,rotation?,name?} | remove{ids} | setParam{id,name,value} | addBehavior{id,type} | setVariable{name,expr}. Ids come from scene.describe. The whole batch is ONE undo step and is verified first: any bad id aborts everything.',
    effect: 'write',
    keywords: ['change', 'move', 'edit', 'set', 'delete', 'remove', 'rename', 'resize', 'rotate', 'heavier', 'bigger', 'smaller'],
    input: opsInput,
    run({ ops, summary }, ctx) {
      if (!ctx.pageId) return noPage()
      const check = verifyPlan({ ops, summary: summary ?? 'Edit' }, useDocStore.getState().pages[ctx.pageId])
      if (!check.ok || !check.plan) return fail(`Edit rejected: ${check.errors.join(' | ')}`)
      const plan = check.plan
      const res = applyPlan(ctx.pageId, plan)
      const said = describePlan(plan, useDocStore.getState().pages[ctx.pageId]).slice(0, 4).join('; ')
      return res.ok
        ? ok(`Applied ${res.applied} change${res.applied === 1 ? '' : 's'}: ${said}`, { applied: res.applied })
        : fail(`Applied ${res.applied}, then failed: ${res.errors.join(' | ')}`)
    },
  })
)

export const sceneAdd = registerTool(
  defineTool({
    name: 'scene.add',
    summary: 'Add one component or note to the page',
    help: 'component is a scene.components id (resistor, mass, …) or a kind: note, text, formula, graph, chart, table, slider, rect, circle. text fills a note/text/formula.',
    effect: 'write',
    keywords: ['add', 'note', 'text box', 'label', 'insert', 'place'],
    input: z.object({
      component: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      name: z.string().optional(),
      text: z.string().max(4000).optional(),
    }),
    run({ component, x, y, name, text }, ctx) {
      if (!ctx.pageId) return noPage()
      const b = safeBounds(ctx.pageId)
      const position = { x: x ?? (b.left + b.right) / 2 - 100, y: y ?? (b.top + b.bottom) / 2 - 60 }
      const params = text === undefined ? undefined : { [component === 'formula' ? 'latex' : 'text']: text }
      const check = verifyPlan(
        { ops: [{ op: 'add', component, position, name, params }], summary: `Add ${component}` },
        useDocStore.getState().pages[ctx.pageId]
      )
      if (!check.ok || !check.plan) return fail(check.errors.join(' | '))
      const res = applyPlan(ctx.pageId, check.plan)
      return res.ok ? ok(`Added ${component}.`) : fail(res.errors.join(' | '))
    },
  })
)

export const sceneComponents = registerTool(
  defineTool({
    name: 'scene.components',
    summary: 'List the components you can add or create',
    effect: 'read',
    keywords: ['components', 'what can you add', 'parts', 'kinds'],
    input: z.object({ query: z.string().optional() }),
    run({ query }) {
      const q = query?.toLowerCase()
      const list = COMPONENTS.filter((c) => !q || c.id.includes(q) || c.label.toLowerCase().includes(q) || String(c.domain).includes(q))
      return ok(list.map((c) => `${c.id} (${c.label}, ${c.domain})`).join('; ') || 'No match.', { count: list.length })
    },
  })
)

// ── Transport ───────────────────────────────────────────────────────────────

const running = (pageId: string) => {
  const rt = useRuntimeStore.getState()
  return rt.mode === 'running' && rt.pageId === pageId
}

export const sceneRun = registerTool(
  defineTool({
    name: 'scene.run',
    summary: 'Start or resume the simulation',
    effect: 'run',
    keywords: ['run', 'play', 'start', 'simulate it', 'go', 'resume', 'press play'],
    input: z.object({}),
    run(_a, ctx: ToolContext) {
      if (!ctx.pageId) return noPage()
      if (!Object.keys(useDocStore.getState().pages[ctx.pageId]?.objects ?? {}).length) return fail('The page is empty — nothing to run.')
      play(ctx.pageId)
      return ok('Simulation running.')
    },
  })
)

export const scenePause = registerTool(
  defineTool({
    name: 'scene.pause',
    summary: 'Pause the running simulation',
    effect: 'run',
    keywords: ['pause', 'freeze', 'hold on'],
    input: z.object({}),
    run(_a, ctx) {
      if (!ctx.pageId || !running(ctx.pageId)) return fail('Nothing is running.')
      pause()
      return ok('Paused.')
    },
  })
)

export const sceneReset = registerTool(
  defineTool({
    name: 'scene.reset',
    summary: 'Stop the simulation and restore the drawn scene',
    effect: 'run',
    keywords: ['reset', 'stop', 'restart', 'rewind', 'back to start'],
    input: z.object({}),
    run() {
      stop()
      return ok('Reset — the scene is back as drawn.')
    },
  })
)

export const sceneMeasure = registerTool(
  defineTool({
    name: 'scene.measure',
    summary: 'Read a live value from the running simulation',
    help: 'id is an object id from scene.describe; channel e.g. x y vx vy speed angle omega ke (mechanics) or V I P (electrical). Omit channel to list what is available. Returns the latest sample plus min/max over the run.',
    effect: 'read',
    keywords: ['measure', 'value', 'reading', 'how fast', 'what is the', 'current through', 'voltage across'],
    input: z.object({ id: z.string(), channel: z.string().optional() }),
    run({ id, channel }) {
      const buf = readBuffer(id)
      const last = buf?.samples[buf.samples.length - 1]
      if (!buf || !last) return fail('No samples yet. Run the simulation first (scene.run), then measure.')
      if (!channel) return ok(`Channels: ${buf.channelNames.join(', ')}`, { channels: buf.channelNames })
      const v = last.channels[channel]
      if (v === undefined) return fail(`No channel "${channel}". Available: ${buf.channelNames.join(', ')}`)
      let min = Infinity
      let max = -Infinity
      for (const s of buf.samples) {
        const c = s.channels[channel]
        if (c < min) min = c
        if (c > max) max = c
      }
      const r = (n: number) => Number(n.toPrecision(4))
      return ok(`${channel} = ${r(v)} at t = ${r(last.t)} s (min ${r(min)}, max ${r(max)}).`, { value: v, t: last.t, min, max })
    },
  })
)

// ── History ─────────────────────────────────────────────────────────────────

export const sceneUndo = registerTool(
  defineTool({
    name: 'scene.undo',
    summary: 'Undo the last change on the page',
    effect: 'write',
    keywords: ['undo', 'take that back', 'revert'],
    input: z.object({}),
    run(_a, ctx) {
      if (!ctx.pageId) return noPage()
      useDocStore.getState().undo(ctx.pageId)
      return ok('Undone.')
    },
  })
)

export const sceneRedo = registerTool(
  defineTool({
    name: 'scene.redo',
    summary: 'Redo the change that was undone',
    effect: 'write',
    keywords: ['redo', 'put it back'],
    input: z.object({}),
    run(_a, ctx) {
      if (!ctx.pageId) return noPage()
      useDocStore.getState().redo(ctx.pageId)
      return ok('Redone.')
    },
  })
)

// ── Seeing the page ─────────────────────────────────────────────────────────

export const sceneSnapshot = registerTool(
  defineTool({
    name: 'scene.snapshot',
    summary: 'Take a picture of the page as it looks now',
    help: 'Returns a JPEG so a vision-capable agent can SEE the result of what it built. Costs a render, so use it to check work, not on every step.',
    effect: 'read',
    keywords: ['screenshot', 'picture', 'snapshot', 'what does it look like', 'see the page'],
    input: z.object({ scale: z.number().min(0.25).max(1).optional() }),
    async run({ scale }, ctx) {
      if (!ctx.pageId) return noPage()
      const el = typeof document === 'undefined'
        ? null
        : (Array.from(document.querySelectorAll<HTMLElement>('[data-canvas-root]')).find((e) => e.dataset.canvasRoot === ctx.pageId) ?? null)
      if (!el) return fail('The page is not on screen, so there is nothing to photograph. Open it first (page.open).')
      // Loaded on demand: a 200 KB renderer nobody needs until an agent asks.
      const { default: html2canvas } = await import('html2canvas-pro')
      const canvas = await html2canvas(el, { scale: scale ?? 0.6, backgroundColor: null, logging: false, useCORS: true })
      const image = canvas.toDataURL('image/jpeg', 0.72)
      return ok(`Snapshot ${canvas.width}x${canvas.height}.`, { image, width: canvas.width, height: canvas.height })
    },
  })
)
