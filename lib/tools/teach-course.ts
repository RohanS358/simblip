'use client'

// teach.course — "/teach-course circuits": play a whole course as narrated lessons, one after another. Each lesson is the
// authored course lesson turned into a film (lib/lesson/from-course.ts), so nothing is generated and nothing is guessed:
// the course is exactly what its author wrote.

import { z } from 'zod'
import { storyboardFromCourse } from '@/lib/lesson/from-course'
import { lintStoryboard } from '@/lib/lesson/storyboard'
import { openLessonPage, startLesson } from '@/lib/lesson/controller'
import { useLesson } from '@/lib/lesson/store'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'
import { findCourse, loadLesson } from './course-corpus'

/** Each new course replaces the one running: only the latest chain may carry on. */
let chain = 0

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function playCourse(lessons: { id: string; title: string }[], from: number) {
  const mine = ++chain
  for (let i = from; i < lessons.length; i++) {
    if (mine !== chain) return
    const l = await loadLesson(lessons[i].id)
    if (!l) continue
    const sb = storyboardFromCourse(l.doc, lessons[i].id)
    if (lintStoryboard(sb).length) continue // a lesson that cannot be played is skipped, not allowed to stop the course
    const pageId = openLessonPage(l.title)
    if (!pageId) return
    await startLesson(sb, pageId)
    // Finished by itself: the same film is still on stage. Anything else — stopped, replaced — ends the course here.
    const s = useLesson.getState()
    if (mine !== chain || !s.active || s.storyboard !== sb) return
    await pause(3500)
  }
}

export const teachCourse = registerTool(
  defineTool({
    name: 'teach.course',
    summary: 'Play a whole course as narrated lessons, one after another',
    help: 'Finds the course by name, then plays its lessons in order, each as an animated, narrated film with predictions to answer. Stopping a lesson stops the course.',
    effect: 'run',
    keywords: ['teach course', 'play the course', 'whole course'],
    input: z.object({ name: z.string().min(2).max(120) }),
    async run({ name }) {
      const { course, all } = await findCourse(name)
      if (!course) {
        if (!all.length) return fail('I could not load the courses just now. Check you are signed in, then try again.')
        return fail(`I could not find a course called “${name}”. Your courses are: ${all.map((c) => c.title).join(', ')}.`)
      }
      void playCourse(course.lessons, 0)
      return ok(`Starting “${course.title}” — ${course.lessons.length} lesson${course.lessons.length === 1 ? '' : 's'}, one after another. The first one begins in a moment; stop it any time to end the course.`, { lessons: course.lessons.length })
    },
  })
)
