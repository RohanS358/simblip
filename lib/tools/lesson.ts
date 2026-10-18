'use client'

// teach.lesson — "teach me Ohm's law": play the course's own lesson as a
// narrated, interactive film on a fresh page. Grounded: the content, figures and
// questions are the authored lesson's, converted deterministically — the model is
// not involved, so it cannot invent physics.

import { z } from 'zod'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { storyboardFromCourse } from '@/lib/lesson/from-course'
import { durationOf, lintStoryboard } from '@/lib/lesson/storyboard'
import { startLesson } from '@/lib/lesson/controller'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'
import { findLesson } from './course-corpus'

export const teachLesson = registerTool(
  defineTool({
    name: 'teach.lesson',
    summary: 'Teach a topic as a narrated interactive lesson',
    help: 'Finds the best course lesson for the topic and plays it: narration, live simulations, derivations, and predict-then-reveal questions. Opens its own page.',
    effect: 'run',
    keywords: ['teach me', 'teach', 'lesson on', 'video', 'animate', 'walk me through'],
    input: z.object({ topic: z.string().min(2).max(120) }),
    async run({ topic }) {
      const lesson = await findLesson(topic)
      if (!lesson) return fail(`No course lesson matches "${topic}".`)
      const sb = storyboardFromCourse(lesson.doc, lesson.id)
      const issues = lintStoryboard(sb)
      if (issues.length) return fail(`The lesson "${lesson.title}" cannot be played yet: ${issues[0]}`)

      const s = useWorkspaceStore.getState()
      const parentId = s.activePageId ? s.nodes[s.activePageId]?.parentId : null
      if (!parentId) return fail('Open a notebook page first.')
      const pageId = s.addPageIn(parentId, `Lesson: ${lesson.title}`.slice(0, 80), 'board')
      void startLesson(sb, pageId) // plays in the background; the overlay owns it from here
      const predictions = sb.beats.filter((b) => b.t === 'predict').length
      return ok(`Playing "${lesson.title}" — about ${Math.max(1, Math.round(durationOf(sb) / 60))} min, with ${predictions} prediction${predictions === 1 ? '' : 's'} for you to answer.`, { lessonId: lesson.id, pageId })
    },
  })
)
