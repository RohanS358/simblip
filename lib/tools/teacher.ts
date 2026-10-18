'use client'

// teacher.* — set work and see where a class is stuck (docs/ai-plans §6.8).
// Permission is checked by runTool from `needs`, so a student asking for
// teacher.assignment.create is refused by code whatever the model says.

import { z } from 'zod'
import { can } from '@/lib/auth/types'
import { useAuthStore } from '@/lib/auth/store'
import { createAssignment, listInstitutionSubmissions } from '@/lib/data/assignments'
import { bundlePage } from '@/lib/store/page-bundle'
import { useDocStore } from '@/lib/store/document'
import { defineTool, fail, ok } from './types'
import { registerTool, setPermissionCheck } from './registry'

setPermissionCheck((p) => can(useAuthStore.getState().profile?.role, p as Parameters<typeof can>[1]))

export const teacherAssignmentCreate = registerTool(
  defineTool({
    name: 'teacher.assignment.create',
    summary: 'Assign the current page to rooms as work',
    effect: 'write',
    needs: 'create-assignments',
    keywords: ['assign', 'set homework', 'give this to my class'],
    input: z.object({ title: z.string().min(2), roomIds: z.array(z.string()).max(20).default([]), dueAt: z.string().optional() }),
    async run({ title, roomIds, dueAt }, ctx) {
      if (!ctx.pageId || !useDocStore.getState().pages[ctx.pageId]) return fail('Open the page to assign first.')
      if (dueAt && Number.isNaN(Date.parse(dueAt))) return fail(`dueAt "${dueAt}" is not a date; use ISO format like 2026-10-25T17:00.`)
      await createAssignment({ title, content: bundlePage(ctx.pageId), roomIds: roomIds ?? [], dueAt: dueAt ? new Date(dueAt).toISOString() : null })
      return ok(`Assigned "${title}"${roomIds?.length ? ` to ${roomIds.length} room(s)` : ''}.`)
    },
  })
)

/** Aggregate only — counts per status, never a student's name or work. */
export const teacherClassInsights = registerTool(
  defineTool({
    name: 'teacher.class_insights',
    summary: 'Show how many students are done or stuck',
    effect: 'read',
    needs: 'review-submissions',
    keywords: ['class insights', 'where is the class stuck', 'who has submitted'],
    input: z.object({ assignmentId: z.string().optional() }),
    async run({ assignmentId }) {
      const rows = (await listInstitutionSubmissions()).filter((s) => !assignmentId || s.assignment_id === assignmentId)
      const counts: Record<string, number> = {}
      for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
      if (!rows.length) return ok('No submissions yet.', { counts })
      return ok(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '), { counts, total: rows.length })
    },
  })
)
