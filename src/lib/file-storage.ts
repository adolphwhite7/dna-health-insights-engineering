/**
 * file-storage.ts — IndexedDB persistence for pending DNA file uploads
 *
 * Solves: File selected by an authenticated user is lost when navigation to
 * /analyze replaces React state.
 *
 * Flow:
 *   1. Authenticated user selects file → savePendingFile() → navigate to /analyze
 *   2. /analyze mount: getPendingFile() → auto-load into analysis pipeline
 *   3. Clear only on explicit purge, replacement, signout, expiry, or lifecycle completion.
 *
 * DNA files can be 17MB+, so IndexedDB is used (not localStorage).
 * Stale entries (>1 hour) are automatically ignored and cleared.
 *
 * @ticket DNA-713
 */

const DB_NAME = "dna-pending-upload";
const DB_VERSION = 1;
const STORE_NAME = "pending-file";
const RECORD_KEY = "current";
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

interface PendingFileRecord {
  file: File;
  storedAt: number;
  ownerUserId?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Store a DNA file in IndexedDB before navigating away from the homepage.
 * Silently fails if IndexedDB is unavailable (user can re-upload on /analyze).
 */
export async function savePendingFile(
  file: File,
  ownerUserId: string,
): Promise<void> {
  if (!ownerUserId) {
    return;
  }

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const record: PendingFileRecord = {
      file,
      storedAt: Date.now(),
      ownerUserId,
    };
    store.put(record, RECORD_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-critical — user can always re-upload on /analyze
    console.warn("[file-storage] Failed to save pending file to IndexedDB");
  }
}

/**
 * Retrieve a pending DNA file from IndexedDB.
 * Returns null if no file, if stale (>1hr), or if IndexedDB is unavailable.
 * Does NOT clear the entry after successful load; continuity survives route
 * away/back until an explicit lifecycle boundary clears it.
 */
export async function getPendingFile(
  ownerUserId?: string | null,
): Promise<File | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);
    const record = await new Promise<PendingFileRecord | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as PendingFileRecord | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();

    if (!record || !record.file) return null;

    // Reject stale entries
    if (Date.now() - record.storedAt > STALE_THRESHOLD_MS) {
      await clearPendingFile();
      return null;
    }

    if (!record.ownerUserId || !ownerUserId) {
      await clearPendingFile();
      return null;
    }

    if (record.ownerUserId !== ownerUserId) {
      await clearPendingFile();
      return null;
    }

    return record.file;
  } catch {
    console.warn("[file-storage] Failed to read pending file from IndexedDB");
    return null;
  }
}

/**
 * Remove the pending file entry from IndexedDB.
 */
export async function clearPendingFile(): Promise<void> {
  const db = await openDB();
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(RECORD_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to remove pending DNA file"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Pending DNA file removal was aborted"));
    });
  } finally {
    db.close();
  }
}
