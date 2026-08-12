// Shared shape for a file's identity/sync-status, both client-side (IndexedDB,
// lib/storage/manifest.ts) and server-side (simblip_file_manifest table,
// db/schema.sql) — "cloud stores metadata first, files second": a second
// device can list this shape from the server before pulling any bytes.

export type SyncStatus = 'local-only' | 'uploading' | 'synced' | 'sync-failed'

export interface FileManifestEntry {
  /** = uid() from lib/scene/types.ts — same id used as the OPFS filename and
   *  a FileNode's fileId. */
  id: string
  /** Profile id — mirrors simblip_workspaces.id scoping. */
  ownerId: string
  /** Original filename, for downloads/display. */
  name: string
  mime: string
  size: number
  /** Integrity check + future dedup key. */
  sha256: string
  /** Epoch ms. */
  createdAt: number
  modifiedAt: number
  syncStatus: SyncStatus
  /**
   * Does the user want this file's BYTES to leave the device?
   *
   * Opt-in, default false: files can be large and personal, and uploading
   * every one by default costs the user bandwidth and us storage for content
   * nobody asked to share. The manifest ROW still syncs either way (that's
   * how another device knows the file exists at all) — this only gates the
   * blob upload in device-file-sync.ts.
   *
   * Optional so entries written before this field existed keep loading;
   * everything reading it treats `undefined` as false.
   */
  syncEnabled?: boolean
  /** True once confirmed present in Vercel Blob. */
  cloudBackedUp: boolean
  /** Blob URL once uploaded. */
  cloudUrl?: string
  // Deliberately absent: device-availability/peer fields — P2P sync and a
  // device registry are out of scope for this phase (see the storage
  // migration plan's non-goals). Consumers should treat unknown future keys
  // on a stored entry as opaque rather than stripping them on write, so a
  // later phase can add e.g. `availableOnDevices?: string[]` without a
  // manifest-store migration.
}
