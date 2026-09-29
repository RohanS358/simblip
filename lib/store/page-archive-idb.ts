'use client'

// The durable tier under the page archive (lib/store/page-archive.ts).
//
// localStorage is small (~5-10 MB per origin) and synchronous, which is why
// the archive uses it: ensurePage must rehydrate a page in the same tick. But
// when it fills up, the archive had to EVICT pages to make room — and for a
// page that never synced, that deleted the only copy of the user's work.
//
// Every archived page is now also written here (IndexedDB: hundreds of MB,
// async). localStorage becomes a fast cache over it: eviction only drops the
// cache entry, and a page missing from localStorage is reloaded from here.

const DB_NAME = 'simblip-pages'
const STORE = 'pages'

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'))
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

/** Values are the JSON text, exactly what localStorage holds. */
export const idbPut = (key: string, json: string) => run('readwrite', (s) => s.put(json, key)).then(() => {})
export const idbGet = (key: string) => run<string | undefined>('readonly', (s) => s.get(key) as IDBRequest<string | undefined>)
export const idbDelete = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => {})
export const idbKeys = () => run<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((ks) => ks.map(String))
