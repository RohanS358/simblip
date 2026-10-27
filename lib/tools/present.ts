// How a tool call reads to a person. Tool ids (teach.lesson, scene.run) are for the program; in the thread they become a short verb phrase.

const LABELS: Record<string, string> = {
  'teach.lesson': 'Teaching a lesson',
  'teach.page': 'Teaching this page',
  'teach.course': 'Playing a course',
  'teach.ask': 'Explaining with your page',
  'teach.material': 'Working through your material',
  'scene.run': 'Running the simulation',
  'scene.pause': 'Pausing',
  'scene.reset': 'Resetting',
  'scene.undo': 'Undoing',
  'scene.redo': 'Redoing',
  'scene.describe': 'Looking at the page',
  'page.list': 'Listing your pages',
  'page.open': 'Opening a page',
  'page.create': 'Creating a page',
  'learn.cards.next': 'Finding your next card',
}

const words = (id: string) => {
  const w = id.replace(/[._-]+/g, ' ').trim()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

export const toolLabel = (id: string): string => LABELS[id] ?? words(id)

/** True when the written answer only repeats what a tool step already said. */
export const repeatsSteps = (answer: string | undefined, steps: { summary: string }[]): boolean => {
  const a = answer?.trim()
  return !a || steps.some((s) => s.summary.trim() === a)
}
