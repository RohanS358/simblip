'use client'

// life.* — the notebook's own sticky notes, to-dos and calendar, from chat. Same store calls as the Note Gallery's buttons.

import { z } from 'zod'
import { useNotesGallery } from '@/lib/store/notes-gallery'
import { parseWhen } from '@/lib/calendar/when'
import { defineTool, fail, ok } from './types'
import { registerTool } from './registry'

const niceDay = (d: string) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const niceTime = (t: string) => new Date(`2000-01-01T${t}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const when = (date: string, time?: string) => `${niceDay(date)}${time ? ` at ${niceTime(time)}` : ''}`

export const lifeNote = registerTool(
  defineTool({
    name: 'life.note',
    summary: 'Pin a sticky note in the Note Gallery',
    effect: 'write',
    keywords: ['sticky note', 'jot down'],
    input: z.object({ text: z.string().min(1).max(4000) }),
    run({ text }) {
      const g = useNotesGallery.getState()
      g.editNote(g.addSticky(), { text })
      return ok('Pinned that as a note in your Note Gallery.')
    },
  })
)

export const lifeTodo = registerTool(
  defineTool({
    name: 'life.todo',
    summary: 'Add a to-do',
    effect: 'write',
    keywords: ['todo', 'to-do', 'task'],
    input: z.object({ text: z.string().min(1).max(300) }),
    run({ text }) {
      useNotesGallery.getState().addTodo(text)
      return ok(`Added “${text}” to your to-dos.`)
    },
  })
)

const addEvent = (text: string, reminder: boolean) => {
  const w = parseWhen(text)
  if (!w.title) return fail(reminder ? 'What should I remind you about? For example: /remind call mom tomorrow 5pm.' : 'What is the event called? For example: /event team meeting friday 3pm.')
  if (reminder && !w.date) return fail(`When should I remind you? Add a day or time, like “${w.title} tomorrow 9am” or “${w.title} in 2 hours”.`)
  const date = w.date ?? new Date().toLocaleDateString('en-CA')
  useNotesGallery.getState().addEvent({ date, time: w.time, title: reminder ? `⏰ ${w.title}` : w.title, color: reminder ? 'rose' : 'blue' })
  return ok(
    reminder
      ? `Set a reminder: “${w.title}”, ${when(date, w.time)}. It's on your calendar; SIMBLIP can't alert you while it's closed.`
      : `Added “${w.title}” to your calendar for ${when(date, w.time)}${w.date ? '' : ' (no day given, so today)'}.`
  )
}

export const lifeEvent = registerTool(
  defineTool({
    name: 'life.event',
    summary: 'Add an event to the calendar',
    help: 'Say the title and when in one line, e.g. "team meeting friday 3pm".',
    effect: 'write',
    keywords: ['calendar', 'event', 'meeting'],
    input: z.object({ text: z.string().min(1).max(300) }),
    run: ({ text }) => addEvent(text, false),
  })
)

export const lifeRemind = registerTool(
  defineTool({
    name: 'life.remind',
    summary: 'Set a reminder on the calendar',
    effect: 'write',
    keywords: ['remind me', 'reminder'],
    input: z.object({ text: z.string().min(1).max(300) }),
    run: ({ text }) => addEvent(text, true),
  })
)
