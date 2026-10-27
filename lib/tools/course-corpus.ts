'use client'

// Where course.search reads from: the same /api/courses the Course reader
// uses, so a student only ever searches lessons they were granted.
// Lesson trees are small (titles); only the best few lessons are downloaded.

import { getAccessToken } from '@/lib/auth/store'
import { bm25, covers, type Doc } from '@/lib/learning/bm25'
import type { CourseDoc } from '@/lib/store/course'
import { setCourseCorpus } from './learn'

interface TreeNode { name: string; lessons: { id: string; title: string }[]; children: TreeNode[] }
let titles: { id: string; title: string; text: string }[] | null = null
const lessons = new Map<string, Doc[]>()
const docs = new Map<string, { title: string; doc: CourseDoc }>()

const headers = (): HeadersInit => {
  const t = getAccessToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const walk = (n: TreeNode, path: string[], out: NonNullable<typeof titles>) => {
  for (const l of n.lessons) out.push({ id: l.id, title: l.title, text: [...path, n.name].join(' ') })
  for (const c of n.children) walk(c, [...path, n.name], out)
}

const sectionDocs = (id: string, title: string, doc: CourseDoc): Doc[] =>
  doc.sections.map((s) => ({
    id: `${id}#${s.id}`,
    title: `${title} — ${s.title}`,
    text: [s.body, s.after, ...(s.derivation ?? []).map((d) => d.why), ...(s.questions ?? []).map((q) => q.prompt)].filter(Boolean).join(' '),
    lessonId: id,
    sectionId: s.id,
  }))

const getCorpus = async (query: string): Promise<Doc[]> => {
  if (!titles) {
    const res = await fetch('/api/courses', { headers: headers() })
    if (!res.ok) return []
    const { courses } = (await res.json()) as { courses: { title: string; tree: TreeNode[] }[] }
    titles = []
    for (const c of courses) for (const n of c.tree) walk(n, [c.title], titles)
  }
  const top = bm25(titles.map((t) => ({ ...t })), query.replace(/['’]/g, ''), 3)
  for (const { doc } of top) {
    if (lessons.has(doc.id)) continue
    const r = await fetch(`/api/courses?lesson=${encodeURIComponent(doc.id)}`, { headers: headers() })
    if (r.ok) {
      const d = ((await r.json()) as { lesson: { doc: CourseDoc } }).lesson.doc
      docs.set(doc.id, { title: doc.title, doc: d })
      lessons.set(doc.id, sectionDocs(doc.id, doc.title, d))
    }
  }
  return top.flatMap(({ doc }) => lessons.get(doc.id) ?? [])
}
setCourseCorpus(getCorpus)

/** The best-matching authored lesson for a topic, whole — for teach.lesson. Titles
 *  AND their course/unit path are searched, so "ohms law" finds "Ohm's Law and Resistance". */
export async function findLesson(topic: string): Promise<{ id: string; title: string; doc: CourseDoc } | null> {
  await getCorpus(topic)
  const best = bm25((titles ?? []).map((t) => ({ ...t })), topic.replace(/['’]/g, ''), 1)[0]
  // A lesson that only shares a filler word ("theorem", "law") is NOT the lesson asked for.
  if (!best || !covers(topic, `${best.doc.title} ${best.doc.text}`)) return null
  const d = docs.get(best.doc.id)
  return d ? { id: best.doc.id, ...d } : null
}

// ── whole courses, for /teach-course ────────────────────────────────────────

export interface CourseSummary { title: string; lessons: { id: string; title: string }[] }
let courseList: CourseSummary[] | null = null

const flatten = (n: TreeNode, out: { id: string; title: string }[]) => {
  for (const l of n.lessons) out.push({ id: l.id, title: l.title })
  for (const c of n.children) flatten(c, out)
}

/** Every course the student may read, each with its lessons in order. */
export async function listCourses(): Promise<CourseSummary[]> {
  if (courseList) return courseList
  const res = await fetch('/api/courses', { headers: headers() })
  if (!res.ok) return []
  const { courses } = (await res.json()) as { courses: { title: string; tree: TreeNode[] }[] }
  courseList = courses.map((c) => {
    const lessons: { id: string; title: string }[] = []
    for (const n of c.tree) flatten(n, lessons)
    return { title: c.title, lessons }
  }).filter((c) => c.lessons.length > 0)
  return courseList
}

/** The course the student named: by title (or a code like "ENCT 351"), tolerant of case and punctuation. */
export async function findCourse(query: string): Promise<{ course?: CourseSummary; all: CourseSummary[] }> {
  const all = await listCourses()
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const q = norm(query)
  const words = q.split(' ').filter(Boolean)
  const scored = all
    .map((c) => {
      const t = norm(c.title)
      const score = t === q ? 100 : t.includes(q) ? 60 : words.length ? (words.filter((w) => t.includes(w)).length / words.length) * 40 : 0
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)
  return { course: scored[0] && scored[0].score >= 20 ? scored[0].c : undefined, all }
}

/** One lesson, whole. */
export async function loadLesson(id: string): Promise<{ title: string; doc: CourseDoc } | null> {
  const hit = docs.get(id)
  if (hit) return hit
  const r = await fetch(`/api/courses?lesson=${encodeURIComponent(id)}`, { headers: headers() })
  if (!r.ok) return null
  const d = (await r.json()) as { lesson: { title?: string; doc: CourseDoc } }
  const entry = { title: d.lesson.title ?? d.lesson.doc.title, doc: d.lesson.doc }
  docs.set(id, entry)
  return entry
}
