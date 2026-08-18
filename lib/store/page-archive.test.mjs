// Page archive quota eviction — what stops annotations from vanishing.
// Run: node lib/store/page-archive.test.mjs
//
// localStorage is ~5MB. A PDF with ink on many pages fills it, and the write
// that overflows has to reclaim space from SOMETHING. The old rule ("delete
// the first 10 simblip-page* keys in index order, across all users") could
// delete the archive of the very annotation canvas being drawn on — ink saved
// a second earlier just disappeared on the next reload. These are the rules
// that replaced it.
//
// The module is browser-only ('use client' + localStorage), so this mirrors
// its eviction logic rather than importing it. Keep in sync with
// `evictArchives`/`writePage` in page-archive.ts.

import assert from 'node:assert/strict'

const PREFIX = 'simblip-page'

/** localStorage stub with a hard cap on how many entries fit. Real quota is
 *  in bytes, but the eviction POLICY (who gets dropped, who is spared) is
 *  what's under test, and an entry cap makes "the next write overflows"
 *  exact instead of a byte-budget guessing game. */
function makeStore(maxEntries = Infinity) {
  const map = new Map()
  return {
    map,
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    removeItem: (k) => void map.delete(k),
    setItem(k, v) {
      if (!map.has(k) && map.size >= maxEntries) {
        const e = new Error('quota')
        e.name = 'QuotaExceededError'
        throw e
      }
      map.set(k, v)
    },
  }
}

// ── The logic under test (mirrors page-archive.ts) ──────────────────────────

function makeArchive(ls, user = 'u1') {
  const prefix = `${PREFIX}:${user}:`
  const key = (id) => prefix + id
  let protectedIds = new Set()
  const writtenAt = new Map()

  const evictArchives = (keepKey, want = 10) => {
    const candidates = []
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i)
      if (!k || !k.startsWith(prefix) || k === keepKey) continue
      if (protectedIds.has(k.slice(prefix.length))) continue
      candidates.push({ k, at: writtenAt.get(k) ?? 0 })
    }
    if (candidates.length === 0) return false
    candidates.sort((a, b) => a.at - b.at)
    for (const { k } of candidates.slice(0, Math.min(want, candidates.length))) {
      ls.removeItem(k)
      writtenAt.delete(k)
    }
    return true
  }

  return {
    setProtectedPages: (ids) => { protectedIds = new Set(ids) },
    evictArchives,
    readPage: (id) => { const raw = ls.getItem(key(id)); return raw ? JSON.parse(raw) : null },
    writePage(id, content, now = Date.now()) {
      const k = key(id)
      const value = JSON.stringify(content)
      try {
        ls.setItem(k, value)
        writtenAt.set(k, now)
        return true
      } catch (e) {
        if (e.name !== 'QuotaExceededError') return false
        for (let round = 0; round < 5; round++) {
          if (!evictArchives(k)) break
          try {
            ls.setItem(k, value)
            writtenAt.set(k, now)
            return true
          } catch { /* another round */ }
        }
        return false
      }
    },
  }
}

const page = (n) => ({ objects: { blob: 'x'.repeat(n) }, variables: [] })

// ── A protected page is never evicted to make room ──────────────────────────
{
  const ls = makeStore(2)
  const a = makeArchive(ls)
  a.writePage('old-1', page(100), 1)
  a.writePage('annot-pdf-p7', page(100), 2) // the page being drawn on
  a.setProtectedPages(['annot-pdf-p7'])

  assert.equal(a.writePage('new', page(400), 3), true, 'the overflowing write must still land')
  assert.notEqual(a.readPage('annot-pdf-p7'), null,
    'the on-screen annotation canvas must survive quota eviction')
  assert.equal(a.readPage('old-1'), null, 'the unprotected page is what gets reclaimed')
}

// ── Eviction is least-recently-WRITTEN, not insertion order ─────────────────
// Checked against evictArchives directly with want=1, so exactly one victim is
// chosen and the ORDER is what's asserted (writePage evicts 10 at a time,
// which would take both candidates and prove nothing about ranking).
{
  const ls = makeStore()
  const a = makeArchive(ls)
  a.writePage('early-key-hot', page(10), 1) // inserted first…
  a.writePage('later-key-cold', page(10), 2)
  a.writePage('early-key-hot', page(10), 99) // …but rewritten most recently

  assert.equal(a.evictArchives('none', 1), true)
  assert.notEqual(a.readPage('early-key-hot'), null,
    'a page rewritten seconds ago must outrank one merely inserted later')
  assert.equal(a.readPage('later-key-cold'), null, 'the coldest page is evicted first')
}

// ── Another user's pages are never touched ──────────────────────────────────
{
  const ls = makeStore(2)
  ls.setItem(`${PREFIX}:someone-else:their-page`, JSON.stringify(page(100)))
  const a = makeArchive(ls, 'u1')
  a.writePage('mine', page(100), 1)
  a.writePage('big', page(400), 2)
  assert.notEqual(ls.getItem(`${PREFIX}:someone-else:their-page`), null,
    'eviction must stay inside the signed-in user\'s own key prefix')
}

// ── Everything protected + no room = write fails, nothing is destroyed ──────
{
  const ls = makeStore(1)
  const a = makeArchive(ls)
  a.writePage('keep', page(10), 1)
  a.setProtectedPages(['keep'])
  assert.equal(a.writePage('huge', page(10), 2), false, 'an impossible write reports failure')
  assert.notEqual(a.readPage('keep'), null, 'and takes nothing down with it')
}

console.log('page-archive: all checks passed')
