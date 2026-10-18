'use client'

// Where course.search reads from: the same /api/courses the Course reader
// uses, so a student only ever searches lessons they were granted.
// Lesson trees are small (titles); only the best few lessons are downloaded.

import { getAccessToken } from '@/lib/auth/store'
import { bm25, type Doc } from '@/lib/learning/bm25'
import type { CourseDoc } from '@/lib/store/course'
import { setCourseCorpus } from './learn'

interface TreeNode { name: string; lessons: { id: string; title: string }[]; children: TreeNode[] }
let titles: { id: string; title: string; text: string }[] | null = null
const lessons = new Map<string, Doc[]>()

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

setCourseCorpus(async (query) => {
  if (!titles) {
    const res = await fetch('/api/courses', { headers: headers() })
    if (!res.ok) return []
    const { courses } = (await res.json()) as { courses: { title: string; tree: TreeNode[] }[] }
    titles = []
    for (const c of courses) for (const n of c.tree) walk(n, [c.title], titles)
  }
  const top = bm25(titles.map((t) => ({ ...t })), query, 3)
  for (const { doc } of top) {
    if (lessons.has(doc.id)) continue
    const r = await fetch(`/api/courses?lesson=${encodeURIComponent(doc.id)}`, { headers: headers() })
    if (r.ok) lessons.set(doc.id, sectionDocs(doc.id, doc.title, ((await r.json()) as { lesson: { doc: CourseDoc } }).lesson.doc))
  }
  return top.flatMap(({ doc }) => lessons.get(doc.id) ?? [])
})
