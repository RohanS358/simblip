// Which pulled tree nodes this device is allowed to SHOW.
//
// Split out of page-sync.ts as a leaf module on purpose: it is pure, and
// page-sync.ts pulls in the doc store, which makes it unimportable from a plain
// node test. See tree-visibility.test.mjs — this rule is silent in both
// directions if it's wrong (too strict and a synced page never appears on the
// second device, too loose and private page titles leak onto every device the
// user signs in on), so it gets a real test rather than a mirrored copy.

import type { Node, PageNode } from '@/lib/scene/types'

export interface PulledTreeSplit {
  /** Shown in every list, tree and picker. */
  nodes: Record<string, Node>
  /** Carried and pushed back, never rendered. */
  hiddenNodes: Record<string, Node>
  /** The new origin ledger — feed it back in on the next pull. */
  cloudNodeIds: string[]
}

/**
 * Split a freshly pulled tree into what this device may SHOW and what it merely
 * CARRIES.
 *
 * A node is shown when either:
 *   • it did NOT come from the cloud — it is this device's own work, and the
 *     blob coming back is just its own backup returning; or
 *   • the pushing device stamped `syncedContent` on it, meaning the content
 *     rows are genuinely up there and about to land in the archive.
 *
 * Ancestors of a shown node come along regardless, or a synced page nested in
 * an unsynced folder would have nowhere to render.
 *
 * Everything else goes to `hiddenNodes`: still persisted, still pushed back
 * verbatim by cloud.ts's pushWorkspace so no other device loses its tree, but
 * invisible to every list in the UI because it never enters `nodes`.
 *
 * `cloudNodeIds` is what makes revocation work, and is the whole reason origin
 * is tracked rather than inferred from "is it in `localNodes`". A page synced TO
 * this device is in `localNodes` precisely because it was synced; if presence
 * alone kept it visible, switching sync back off could never take effect here.
 * So a node adopted from the cloud is remembered as cloud-origin for good, and
 * from then on only the stamp decides whether it shows.
 */
export function splitPulledTree(
  remote: Record<string, Node>,
  localNodes: Record<string, Node>,
  cloudNodeIds: Iterable<string> = []
): PulledTreeSplit {
  const fromCloud = new Set(cloudNodeIds)
  /** This device's own work: what it holds minus what it once adopted. */
  const isOwn = (id: string) => Boolean(localNodes[id]) && !fromCloud.has(id)

  const visible = new Set<string>()
  const show = (startId: string) => {
    // Walk to the root, stopping early once we hit an already-visible ancestor
    // (its chain is done). A parentId missing from `remote` just ends the walk.
    let cur: string | null | undefined = startId
    while (cur && remote[cur] && !visible.has(cur)) {
      visible.add(cur)
      cur = remote[cur].parentId
    }
  }
  for (const [id, node] of Object.entries(remote)) {
    if (isOwn(id) || (node.kind === 'page' && (node as PageNode).syncedContent === true)) show(id)
  }

  const nodes: Record<string, Node> = {}
  const hiddenNodes: Record<string, Node> = {}
  for (const [id, node] of Object.entries(remote)) {
    if (visible.has(id)) nodes[id] = node
    else hiddenNodes[id] = node
  }
  // Rebuilt from `remote` every pull, so ids deleted upstream fall out on their
  // own instead of accumulating.
  return { nodes, hiddenNodes, cloudNodeIds: Object.keys(remote).filter((id) => !isOwn(id)) }
}
