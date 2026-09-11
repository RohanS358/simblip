'use client'

// The Courses rail section: lessons this profile has been granted.
//
// Courses are PUBLISHED by dev and GRANTED by an admin (docs/course-mode.md),
// so this panel lists and opens — it never creates. That is also why the empty
// state offers no "New course" button: there is nothing a student could press
// it to do.
//
// Grouped by SEMESTER, then opened as a tree following the syllabus, because
// that is how a student is told where they are: "second semester, ENEX 101,
// unit 2". The tree comes from each lesson's stored path, built server-side.

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, GraduationCap, FileText } from 'lucide-react'
import { PanelHeader } from './panel-header'
import { getAccessToken } from '@/lib/auth/store'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { writeCourse } from '@/lib/store/course-content'
import type { CourseDoc } from '@/lib/store/course'
import { cn } from '@/lib/utils'

interface Node {
  name: string
  lessons: { id: string; title: string }[]
  children: Node[]
}
interface Course {
  id: string
  code: string
  title: string
  subject: string
  semester: number | null
  version: number
  tree: Node[]
}

const ORDINAL = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth']
const semesterLabel = (n: number | null) =>
  n && ORDINAL[n] ? `${ORDINAL[n]} Semester` : 'Unscheduled'

export function CoursesPanel() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const activePageId = useWorkspaceStore((s) => s.activePageId)

  useEffect(() => {
    let alive = true
    const token = getAccessToken()
    fetch('/api/courses', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
      // Never surface a status code: a student cannot act on "HTTP 500", and a
      // raw error where a course list belongs reads as the app being broken.
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(
              new Error(
                r.status === 401
                  ? 'Sign in to see your courses.'
                  : 'Courses are unavailable right now.'
              )
            )
      )
      .then((d: { courses: Course[] }) => alive && setCourses(d.courses ?? []))
      .catch((e: Error) => alive && (setError(e.message), setCourses([])))
    return () => {
      alive = false
    }
  }, [])

  /** Open a lesson: fetch its CourseDoc, then put it on a course-kind page.
   *  The page id is derived from the lesson id, so reopening a lesson returns
   *  to the SAME page — and therefore to the answers already committed on it
   *  (progress is keyed by page id in lib/store/course.ts). */
  const openLesson = useCallback(
    async (courseId: string, lessonId: string, title: string) => {
      setBusy(lessonId)
      try {
        const token = getAccessToken()
        const res = await fetch(`/api/courses?lesson=${encodeURIComponent(lessonId)}`,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { lesson } = (await res.json()) as { lesson: { doc: CourseDoc } }

        const pageId = `course:${lessonId}`
        const ws = useWorkspaceStore.getState()
        if (!ws.nodes[pageId]) {
          useWorkspaceStore.setState((s) => ({
            nodes: {
              ...s.nodes,
              [pageId]: {
                id: pageId,
                kind: 'page',
                pageKind: 'course',
                parentId: null,
                name: title,
                order: 0,
              },
            },
          }))
        }
        useDocStore.getState().ensurePage(pageId)
        writeCourse(pageId, lesson.doc)
        useWorkspaceStore.getState().setActivePage(pageId)
      } catch {
        setError('Could not open that lesson.')
      } finally {
        setBusy(null)
      }
    },
    []
  )

  if (courses === null) {
    return (
      <>
        <PanelHeader icon={GraduationCap} title="Courses" accent="var(--accent-violet)" />
        <p className="px-5 py-8 text-center text-ui-sm text-muted-foreground">Loading…</p>
      </>
    )
  }

  if (courses.length === 0) {
    return (
      <>
        <PanelHeader icon={GraduationCap} title="Courses" accent="var(--accent-violet)" />
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <GraduationCap className="h-5 w-5 text-muted-foreground opacity-50" />
          <p className="m-0 text-ui-sm leading-relaxed text-muted-foreground">
            {error ?? 'No courses yet.'}
          </p>
          {!error && (
            <p className="m-0 text-ui-xs leading-relaxed text-muted-foreground opacity-80">
              Lessons your institution grants you appear here.
            </p>
          )}
        </div>
      </>
    )
  }

  // Group by semester, preserving the server's ordering within each.
  const bySemester = new Map<string, Course[]>()
  for (const c of courses) {
    const k = semesterLabel(c.semester)
    const list = bySemester.get(k)
    if (list) list.push(c)
    else bySemester.set(k, [c])
  }

  return (
    <>
      <PanelHeader icon={GraduationCap} title="Courses" accent="var(--accent-violet)" />
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {[...bySemester.entries()].map(([sem, list]) => (
          <div key={sem}>
            <p className="m-0 px-2 pb-1 pt-2.5 text-ui-3xs font-bold uppercase tracking-[0.08em] text-muted-foreground opacity-70">
              {sem}
            </p>
            {list.map((c) => {
              const isOpen = open[c.id] ?? false
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-ui-sm text-foreground transition-colors hover:bg-accent/60"
                  >
                    <ChevronRight
                      className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
                    />
                    <span className="truncate font-medium">{c.code}</span>
                    <span className="truncate text-ui-xs text-muted-foreground">{c.title}</span>
                  </button>
                  {isOpen && (
                    <div className="pl-3">
                      {c.tree.map((n, i) => (
                        <Unit
                          key={n.name || i}
                          node={n}
                          depth={0}
                          activePageId={activePageId}
                          busy={busy}
                          onOpen={(lid, t) => openLesson(c.id, lid, t)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

/** One syllabus unit: its own lessons, then any nested units. */
function Unit({
  node,
  depth,
  activePageId,
  busy,
  onOpen,
}: {
  node: Node
  depth: number
  activePageId: string | null
  busy: string | null
  onOpen: (lessonId: string, title: string) => void
}) {
  return (
    <div>
      {node.name && (
        <p
          className="m-0 truncate px-2 pb-0.5 pt-2 text-ui-2xs font-semibold text-muted-foreground"
          style={{ paddingLeft: `${depth * 0.6 + 0.5}rem` }}
        >
          {node.name}
        </p>
      )}
      {node.lessons.map((l) => {
        const active = activePageId === `course:${l.id}`
        return (
          <button
            key={l.id}
            type="button"
            disabled={busy === l.id}
            onClick={() => onOpen(l.id, l.title)}
            style={{ paddingLeft: `${depth * 0.6 + 0.75}rem` }}
            className={cn(
              'flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-ui-sm transition-colors',
              active
                ? 'bg-[var(--accent-blue)]/15 font-medium text-[var(--accent-blue)]'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              busy === l.id && 'opacity-50'
            )}
          >
            <FileText className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate leading-tight">{l.title}</span>
          </button>
        )
      })}
      {node.children.map((c, i) => (
        <Unit
          key={c.name || i}
          node={c}
          depth={depth + 1}
          activePageId={activePageId}
          busy={busy}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
