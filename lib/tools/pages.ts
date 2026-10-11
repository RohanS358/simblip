'use client'

// page.*, doc.* and slides.* — navigate the notebook and put written content
// on it. Same store actions as the sidebar and the text tools.

import { z } from 'zod'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { createDeckFromMarkdown } from '@/lib/ai/make-deck'
import type { PageKind } from '@/lib/scene/types'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'
import { sceneAdd } from './scene'

const KINDS = ['board', 'doc', 'pptx'] as const

export const pageList = registerTool(
  defineTool({
    name: 'page.list',
    summary: 'List the pages in the notebook',
    effect: 'read',
    keywords: ['pages', 'notebook', 'list pages', 'what pages', 'my notes'],
    input: z.object({ query: z.string().optional() }),
    run({ query }) {
      const s = useWorkspaceStore.getState()
      const q = query?.toLowerCase()
      const pages = Object.values(s.nodes)
        .filter((n) => n.kind === 'page' && (!q || n.name.toLowerCase().includes(q)))
        .slice(0, 60)
        .map((n) => ({ id: n.id, name: n.name, kind: (n as { pageKind?: string }).pageKind ?? 'board' }))
      return ok(
        pages.map((p) => `${p.name} [${p.kind}] id=${p.id}${p.id === s.activePageId ? ' (open)' : ''}`).join('\n') || 'No pages.',
        { pages }
      )
    },
  })
)

export const pageOpen = registerTool(
  defineTool({
    name: 'page.open',
    summary: 'Open a page by id',
    effect: 'run',
    keywords: ['open', 'go to', 'switch to', 'show page'],
    input: z.object({ id: z.string() }),
    run({ id }) {
      const s = useWorkspaceStore.getState()
      const n = s.nodes[id]
      if (!n || n.kind !== 'page') return fail(`No page with id "${id}". Use page.list.`)
      s.setActivePage(id)
      return ok(`Opened "${n.name}".`)
    },
  })
)

export const pageCreate = registerTool(
  defineTool({
    name: 'page.create',
    summary: 'Create a new page next to the current one and open it',
    effect: 'write',
    keywords: ['new page', 'create a page', 'blank page', 'new board', 'new document'],
    input: z.object({ name: z.string().max(80).optional(), kind: z.enum(KINDS).optional() }),
    run({ name, kind }) {
      const s = useWorkspaceStore.getState()
      const parentId = s.activePageId ? s.nodes[s.activePageId]?.parentId : null
      if (!parentId) return fail('Open a notebook page first.')
      const id = s.addPageIn(parentId, name || 'Untitled Page', (kind ?? 'board') as PageKind)
      return ok(`Created "${name || 'Untitled Page'}" and opened it.`, { id })
    },
  })
)

export const docNote = registerTool(
  defineTool({
    name: 'doc.note',
    summary: 'Write a note on the page',
    help: 'Plain text; **bold** and $inline maths$ work. Optional x,y place it; otherwise it lands at the view centre.',
    effect: 'write',
    keywords: ['note', 'write', 'jot', 'sticky', 'remember'],
    input: z.object({ text: z.string().min(1).max(4000), x: z.number().optional(), y: z.number().optional() }),
    run({ text, x, y }, ctx) {
      return sceneAdd.run({ component: 'note', text, x, y }, ctx)
    },
  })
)

export const docFormula = registerTool(
  defineTool({
    name: 'doc.formula',
    summary: 'Put a LaTeX formula on the page',
    effect: 'write',
    keywords: ['formula', 'equation', 'latex'],
    input: z.object({ latex: z.string().min(1).max(1000), x: z.number().optional(), y: z.number().optional() }),
    run({ latex, x, y }, ctx) {
      return sceneAdd.run({ component: 'formula', text: latex, x, y }, ctx)
    },
  })
)

export const slidesFromMarkdown = registerTool(
  defineTool({
    name: 'slides.from_markdown',
    summary: 'Turn Markdown into a slide deck page',
    help: 'Each # or ## heading starts a slide; bullets become slide body. Long bodies continue on extra slides. The deck is a normal editable presentation page.',
    effect: 'write',
    keywords: ['slides', 'deck', 'presentation', 'powerpoint', 'pptx'],
    input: z.object({ markdown: z.string().min(1).max(30_000), title: z.string().max(120).optional() }),
    run({ markdown, title }, ctx) {
      const r = createDeckFromMarkdown(ctx.pageId, markdown, title ?? '')
      return r ? ok(`Made "${r.title}" — ${r.slides} slide${r.slides === 1 ? '' : 's'}.`, r) : fail('Open a notebook page first, and give some content.')
    },
  })
)
