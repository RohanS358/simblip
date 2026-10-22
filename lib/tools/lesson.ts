'use client'

// teach.lesson — "teach me Ohm's law": a narrated, interactive film on a fresh page.
//   1. an AUTHORED course lesson for the topic → converted deterministically (no model);
//   2. a film generated earlier → from the cache;
//   3. otherwise the Director builds one in the background (lib/lesson/director.ts):
//      the model plans, the fine-tuned model draws, and the real simulator supplies every
//      number and every prediction answer.

import { z } from 'zod'
import { storyboardFromCourse } from '@/lib/lesson/from-course'
import { durationOf, lintStoryboard } from '@/lib/lesson/storyboard'
import { openLessonPage, startLesson } from '@/lib/lesson/controller'
import { generateAndPlay } from '@/lib/lesson/generate'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'
import { findLesson } from './course-corpus'

export const teachLesson = registerTool(
  defineTool({
    name: 'teach.lesson',
    summary: 'Teach any topic as a narrated interactive lesson',
    help: 'Plays the best course lesson for the topic, or builds a new animated lesson on demand: narration, live simulations, parameter sweeps, and predict-then-reveal questions whose answers are measured by the simulator. Opens its own page.',
    effect: 'run',
    keywords: ['teach me', 'teach', 'lesson on', 'video', 'animate', 'walk me through'],
    input: z.object({ topic: z.string().min(2).max(120) }),
    async run({ topic }) {
      const lesson = await findLesson(topic)
      if (!lesson) {
        void generateAndPlay(topic) // builds in the background; the overlay shows progress and a Cancel
        return ok(`Building a lesson on "${topic}" — about a minute the first time. You can keep working; it starts when ready.`, { generated: true })
      }
      const sb = storyboardFromCourse(lesson.doc, lesson.id)
      const issues = lintStoryboard(sb)
      if (issues.length) return fail(`The lesson "${lesson.title}" cannot be played yet: ${issues[0]}`)
      const pageId = openLessonPage(lesson.title)
      if (!pageId) return fail('Open a notebook page first.')
      void startLesson(sb, pageId) // plays in the background; the overlay owns it from here
      const predictions = sb.beats.filter((b) => b.t === 'predict').length
      return ok(`Playing "${lesson.title}" — about ${Math.max(1, Math.round(durationOf(sb) / 60))} min, with ${predictions} prediction${predictions === 1 ? '' : 's'} for you to answer.`, { lessonId: lesson.id, pageId })
    },
  })
)
