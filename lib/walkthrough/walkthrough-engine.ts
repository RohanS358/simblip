'use client'

import { useWalkthroughStore } from '../store/walkthrough-store'
import { WALKTHROUGH_ACTS } from './walkthrough-acts'
import { narrator } from './walkthrough-narrator'
import { useWorkspaceStore } from '../store/workspace'
import { useDocStore } from '../store/document'
import { stop as stopPhysics } from '../physics/world'
import { hideCursor, setCursorSpeed, clearTrail, sleep } from './walkthrough-cursor-driver'

class WalkthroughEngine {
  private isRunning = false
  private runId = 0
  private originalActivePageId: string | null = null
  private originalTool: string | null = null
  private demoPageId: string | null = null
  /** Scratch notebook created for the tour, torn down on exit. */
  private demoNotebookId: string | null = null

  public async start(actIndex = 0) {
    // A blocking modal (the terms gate, a confirm dialog) means the app isn't
    // usable yet — the tour would drive controls the viewer can't reach and
    // narrate over a dialog they must answer first.
    if (document.querySelector('[role="dialog"][data-state="open"]')) return

    if (this.isRunning) this.stop()
    this.isRunning = true
    const myRun = ++this.runId

    const ws = useWorkspaceStore.getState()
    this.originalActivePageId = ws.activePageId
    this.originalTool = useDocStore.getState().tool

    this.setupDemoPage()
    useWalkthroughStore.getState().start(actIndex)

    // Give the canvas a moment to mount and lay out — every step measures real
    // element positions, so starting before layout settles aims at nothing.
    await sleep(700)
    this.runFrom(actIndex, 0, myRun)
  }

  private setupDemoPage() {
    const ws = useWorkspaceStore.getState()
    const doc = useDocStore.getState()

    // Always a fresh notebook: reusing one across runs is what left stale
    // half-built demos (and duplicate sidebar entries) behind.
    const nbId = ws.addNotebook('Walkthrough Demo')
    const secId = ws.addSection(nbId, 'Guided Tour')
    const pageId = ws.addPage(nbId, secId, 'Interactive Demo')

    doc.ensurePage(pageId)
    doc.setTool('select')

    ws.setActivePage(pageId)
    this.demoNotebookId = nbId
    this.demoPageId = pageId
    useWalkthroughStore.getState().setDemoPageId(pageId)
  }

  /** Runs acts sequentially from a starting position until stopped or done. */
  private async runFrom(actIndex: number, stepIndex: number, myRun: number) {
    const store = useWalkthroughStore.getState

    for (let a = actIndex; a < WALKTHROUGH_ACTS.length; a++) {
      const act = WALKTHROUGH_ACTS[a]
      if (!this.alive(myRun)) return
      store().setActIndex(a)

      for (let s = a === actIndex ? stepIndex : 0; s < act.steps.length; s++) {
        if (!this.alive(myRun)) return

        // Pause gate — hold here without burning the step.
        while (store().paused) {
          await new Promise((r) => setTimeout(r, 150))
          if (!this.alive(myRun)) return
        }

        store().setStepIndex(s)
        const step = act.steps[s]
        setCursorSpeed(store().speed || 1)
        store().setTargetSelector(step.highlight ?? null)

        // Narration and action run together: the viewer hears what is being
        // done while the pointer does it, instead of watching a silent pause
        // and then a silent action.
        const spoken = step.narration ? narrator.speak(step.narration) : Promise.resolve()
        try {
          if (step.run && this.demoPageId) await step.run(this.demoPageId)
        } catch {
          // A missing control must not kill the tour — skip and keep going.
        }
        await spoken
        if (!this.alive(myRun)) return
        if (step.pauseAfter) await sleep(step.pauseAfter)
      }
    }

    if (this.alive(myRun)) this.finish()
  }

  private alive(myRun: number) {
    return this.isRunning && myRun === this.runId && useWalkthroughStore.getState().active
  }

  public jumpToAct(actIndex: number) {
    narrator.stop()
    clearTrail()
    const myRun = ++this.runId
    useWalkthroughStore.getState().setActIndex(actIndex)
    this.runFrom(actIndex, 0, myRun)
  }

  public pause() {
    narrator.pause()
    useWalkthroughStore.getState().pause()
  }

  public resume() {
    narrator.resume()
    useWalkthroughStore.getState().resume()
  }

  public stop() {
    this.isRunning = false
    this.runId++
    narrator.stop()
    stopPhysics()
    hideCursor()

    const ws = useWorkspaceStore.getState()
    const doc = useDocStore.getState()

    // Restore the user's tool and page first, then bin the scratch notebook —
    // the tour should leave the workspace exactly as it found it.
    if (this.originalTool) doc.setTool(this.originalTool as Parameters<typeof doc.setTool>[0])
    if (this.originalActivePageId && ws.nodes[this.originalActivePageId]) {
      ws.setActivePage(this.originalActivePageId)
    }
    if (this.demoNotebookId && ws.nodes[this.demoNotebookId]) {
      ws.removeNode(this.demoNotebookId)
    }
    this.demoNotebookId = null
    this.demoPageId = null

    useWalkthroughStore.getState().stop()
  }

  public finish() {
    this.stop()
  }
}

export const walkthroughEngine = new WalkthroughEngine()
