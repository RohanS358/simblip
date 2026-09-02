// Pins splitPulledTree, the rule that decides which of another device's pages
// this device is allowed to SHOW. Wrong in either direction and it's silent:
// too strict, a page the user switched sync on for never appears on the second
// laptop; too loose, private page titles leak onto every device they sign in on.
//
// Run directly:  node --experimental-strip-types lib/sync/tree-visibility.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { splitPulledTree } from './tree-visibility.ts'

const folder = (id, parentId = null) => ({ id, parentId, name: id, order: 0, kind: 'folder' })
const page = (id, parentId, synced) => ({
  id,
  parentId,
  name: id,
  order: 0,
  kind: 'page',
  ...(synced === undefined ? {} : { syncedContent: synced }),
})

const tree = (...nodes) => Object.fromEntries(nodes.map((n) => [n.id, n]))
const ids = (m) => Object.keys(m).sort()

test('a second device shows only the synced page, not its unsynced siblings', () => {
  const remote = tree(
    folder('nb'),
    page('shared', 'nb', true),
    page('private', 'nb', false),
    page('legacy', 'nb') // predates the stamp — must be treated as NOT synced
  )
  const { nodes, hiddenNodes } = splitPulledTree(remote, {})
  assert.deepEqual(ids(nodes), ['nb', 'shared'], 'notebook comes along as the path')
  assert.deepEqual(ids(hiddenNodes), ['legacy', 'private'])
})

test('nothing is lost — every pulled node lands in exactly one half', () => {
  const remote = tree(folder('nb'), page('a', 'nb', true), page('b', 'nb', false))
  const { nodes, hiddenNodes } = splitPulledTree(remote, {})
  assert.deepEqual(ids({ ...nodes, ...hiddenNodes }), ids(remote))
  for (const id of Object.keys(nodes)) assert.ok(!(id in hiddenNodes), `${id} in both`)
})

test('the owning device keeps seeing its own unsynced pages', () => {
  // Device A pulls back its own backup: nothing there is cloud-origin, so
  // nothing may be hidden — otherwise sync would erase the user's own sidebar.
  const remote = tree(folder('nb'), page('private', 'nb', false))
  const { nodes, hiddenNodes } = splitPulledTree(remote, remote, [])
  assert.deepEqual(ids(nodes), ['nb', 'private'])
  assert.deepEqual(ids(hiddenNodes), [])
})

test('a synced page drags its whole unsynced folder path into view', () => {
  const remote = tree(
    folder('nb'),
    folder('section', 'nb'),
    folder('sub', 'section'),
    page('deep', 'sub', true),
    page('other', 'sub', false)
  )
  const { nodes, hiddenNodes } = splitPulledTree(remote, {})
  assert.deepEqual(ids(nodes), ['deep', 'nb', 'section', 'sub'])
  assert.deepEqual(ids(hiddenNodes), ['other'])
})

test('a folder holding nothing synced stays hidden', () => {
  const remote = tree(folder('nb'), folder('empty', 'nb'), page('p', 'nb', true))
  const { hiddenNodes } = splitPulledTree(remote, {})
  assert.deepEqual(ids(hiddenNodes), ['empty'])
})

test('a full sync round trip: appear on enable, vanish on revoke', () => {
  // The bug this pins: after device B adopts a synced page, the page IS in B's
  // `nodes`. If presence alone kept it visible, revoking sync on device A could
  // never hide it again — B would show the title forever, which is the exact
  // thing the whole feature exists to prevent. Origin has to be remembered.
  const nb = folder('nb')

  // 1. B pulls while the page is private → hidden, and marked cloud-origin.
  let st = splitPulledTree(tree(nb, page('p', 'nb', false)), {}, [])
  assert.deepEqual(ids(st.nodes), [])
  assert.deepEqual(ids(st.hiddenNodes), ['nb', 'p'])

  // 2. A enables sync → B adopts it.
  st = splitPulledTree(tree(nb, page('p', 'nb', true)), st.nodes, st.cloudNodeIds)
  assert.deepEqual(ids(st.nodes), ['nb', 'p'])

  // 3. A revokes. `p` is sitting in B's nodes right now — it must still go.
  st = splitPulledTree(tree(nb, page('p', 'nb', false)), st.nodes, st.cloudNodeIds)
  assert.deepEqual(ids(st.nodes), [], 'revoked page must not survive on its own presence')
  assert.deepEqual(ids(st.hiddenNodes), ['nb', 'p'])
})

test("a device's own pages survive any number of pulls", () => {
  // The mirror image: device A pulls its own backup repeatedly. Its unsynced
  // pages are never cloud-origin, so they can never be hidden from it.
  const own = tree(folder('nb'), page('mine', 'nb', false))
  let st = { nodes: own, cloudNodeIds: [] }
  for (let i = 0; i < 3; i++) {
    st = splitPulledTree(own, st.nodes, st.cloudNodeIds)
    assert.deepEqual(ids(st.nodes), ['mine', 'nb'], `pull ${i + 1} hid the user's own work`)
    assert.deepEqual(st.cloudNodeIds, [])
  }
})

test('a page created locally on the receiving device stays visible', () => {
  // B makes its own page next to one synced from A. B's page is not in the
  // pulled blob's cloud-origin set, so it is never hidden.
  const prior = splitPulledTree(tree(folder('nb'), page('fromA', 'nb', true)), {}, [])
  const withMine = { ...prior.nodes, mine: page('mine', 'nb', false) }
  const remote = tree(folder('nb'), page('fromA', 'nb', true), page('mine', 'nb', false))
  const st = splitPulledTree(remote, withMine, prior.cloudNodeIds)
  assert.deepEqual(ids(st.nodes), ['fromA', 'mine', 'nb'])
})

test('the origin ledger forgets ids deleted upstream', () => {
  const first = splitPulledTree(tree(folder('nb'), page('p', 'nb', true)), {}, [])
  assert.deepEqual(first.cloudNodeIds.sort(), ['nb', 'p'])
  const second = splitPulledTree(tree(folder('nb')), first.nodes, first.cloudNodeIds)
  assert.deepEqual(second.cloudNodeIds, ['nb'])
})

test('a node whose parent is missing from the blob still resolves', () => {
  const remote = tree(page('orphan', 'gone', true))
  const { nodes, hiddenNodes } = splitPulledTree(remote, {}, [])
  assert.deepEqual(ids(nodes), ['orphan'])
  assert.deepEqual(ids(hiddenNodes), [])
})
