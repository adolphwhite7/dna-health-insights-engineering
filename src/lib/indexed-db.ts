/**
 * IndexedDB Manager for DNA Health Insights
 *
 * Manages client-side reference databases:
 *   - clinvar_curated    (~4 MB gzipped)
 *   - pharmacogenomic_annotations (~300 KB)
 *   - snp_database       (~15 KB)
 *
 * Each database is stored in its own IndexedDB object store within a
 * single "dna_reference" database. A metadata store tracks load status
 * and version numbers for cache invalidation.
 *
 * Implements reference loading, querying, and atomic bundle replacement.
 */

import { clearStoredDnaResults } from "@/lib/report-storage";
import { clearPendingFile } from "@/lib/file-storage";

const DB_NAME = "dna_reference";
const DB_VERSION = 5;

/** The three reference database names used by the enrichment pipeline */
export const REFERENCE_DBS = [
  "clinvar_curated",
  "pharmacogenomic_annotations",
  "snp_database",
] as const;

export type ReferenceDatabaseName = (typeof REFERENCE_DBS)[number];

interface DatabaseMetadata {
  name: ReferenceDatabaseName;
  loaded: boolean;
  version: string;
  sha256: string;
  storageSchema?: string;
  loadedAt: string;
  recordCount: number;
}

export interface VariantAnnotation {
  rsid: string;
  gene?: string;
  significance?: string;
  description?: string;
  source: ReferenceDatabaseName;
  [key: string]: unknown;
}

interface BulkVariantAnnotationChunk {
  rsid: string;
  source: ReferenceDatabaseName;
  records: VariantAnnotation[];
}

const BULK_CHUNK_PREFIX = "__bulk__:";
const CLINVAR_BULK_INDEX_STORE = "clinvar_bulk_index";
const REFERENCE_BUNDLE_STORE = "reference_bundle";
const CLINVAR_BULK_CHUNK_SIZE = 10_000;
const CLINVAR_STORAGE_SCHEMA = "clinvar-bulk-v2";
const PHARMGKB_STORAGE_SCHEMA = "pharmgkb-association-outcome-v2";

function storageSchemaFor(
  dbName: ReferenceDatabaseName,
): string | undefined {
  if (dbName === "clinvar_curated") return CLINVAR_STORAGE_SCHEMA;
  if (dbName === "pharmacogenomic_annotations") {
    return PHARMGKB_STORAGE_SCHEMA;
  }
  return undefined;
}

interface ClinvarBulkIndexEntry {
  rsid: string;
  chunkKey: string;
}

export interface ActiveReferenceBundle {
  name: "active";
  bundleId: string;
  sequence: number;
  activatedAt: string;
}

export interface ReferenceBundleDatabaseLoad {
  name: ReferenceDatabaseName;
  records: VariantAnnotation[];
  version: string;
  sha256: string;
}

// ---- Internal helpers ----

/** Track open IDBDatabase connections so purgeAll can close them */
const openConnections = new Set<IDBDatabase>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Metadata store tracks which databases have been loaded
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "name" });
      }

      // One object store per reference database, keyed by rsid
      for (const dbName of REFERENCE_DBS) {
        if (!db.objectStoreNames.contains(dbName)) {
          db.createObjectStore(dbName, { keyPath: "rsid" });
        }
      }

      if (!db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE)) {
        db.createObjectStore(CLINVAR_BULK_INDEX_STORE, { keyPath: "rsid" });
      }

      if (!db.objectStoreNames.contains(REFERENCE_BUNDLE_STORE)) {
        db.createObjectStore(REFERENCE_BUNDLE_STORE, { keyPath: "name" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      openConnections.add(db);
      db.onclose = () => openConnections.delete(db);
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked. Close other DNA Health Insights tabs and retry."));
  });
}

function txPromise<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Public API ----

/**
 * Initialize the IndexedDB database and object stores.
 * Safe to call multiple times — only creates stores on version upgrade.
 */
export async function initDatabases(): Promise<void> {
  const db = await openDB();
  db.close();
}

/**
 * Check whether a reference database has been loaded with data.
 */
export async function isDatabaseLoaded(
  dbName: ReferenceDatabaseName,
  expectedVersion?: string,
  expectedSha256?: string,
  expectedRecordCount?: number,
): Promise<boolean> {
  const db = await openDB();
  try {
    const meta = await txPromise<DatabaseMetadata | undefined>(
      db,
      "metadata",
      "readonly",
      (store) => store.get(dbName)
    );
    if (!meta?.loaded) return false;
    if (expectedVersion && meta.version !== expectedVersion) return false;
    if (expectedSha256 && meta.sha256 !== expectedSha256) return false;
    if (expectedRecordCount !== undefined && meta.recordCount !== expectedRecordCount) return false;
    const expectedStorageSchema = storageSchemaFor(dbName);
    if (expectedStorageSchema && meta.storageSchema !== expectedStorageSchema) {
      return false;
    }
    return true;
  } finally {
    db.close();
  }
}

/**
 * Check whether ALL reference databases are loaded and ready for enrichment.
 */
export async function areAllDatabasesLoaded(): Promise<boolean> {
  for (const dbName of REFERENCE_DBS) {
    const loaded = await isDatabaseLoaded(dbName);
    if (!loaded) return false;
  }
  return true;
}

/** True only when every database was activated together from the signed bundle. */
export async function isReferenceBundleActive(bundleId: string, sequence: number): Promise<boolean> {
  const db = await openDB();
  try {
    const active = await txPromise<ActiveReferenceBundle | undefined>(
      db,
      REFERENCE_BUNDLE_STORE,
      "readonly",
      (store) => store.get("active"),
    );
    return active?.bundleId === bundleId && active.sequence === sequence;
  } finally {
    db.close();
  }
}

export async function hasActiveReferenceBundle(): Promise<boolean> {
  return Boolean(await getActiveReferenceBundle());
}

/** Returns the immutable identity of the complete bundle currently in use. */
export async function getActiveReferenceBundle(): Promise<ActiveReferenceBundle | null> {
  const db = await openDB();
  try {
    const active = await txPromise<ActiveReferenceBundle | undefined>(
      db,
      REFERENCE_BUNDLE_STORE,
      "readonly",
      (store) => store.get("active"),
    );
    return active ?? null;
  } finally {
    db.close();
  }
}

/**
 * Load / populate a reference database from parsed data.
 *
 * @param dbName - Which reference database to populate
 * @param records - Array of annotation records (must have `rsid` field)
 * @param version - Version string for cache invalidation
 * @param sha256 - SHA-256 hex digest of the downloaded file for integrity tracking
 */
export async function loadDatabase(
  dbName: ReferenceDatabaseName,
  records: VariantAnnotation[],
  version: string,
  sha256: string = ""
): Promise<void> {
  const db = await openDB();
  const storedRecords: Array<VariantAnnotation | BulkVariantAnnotationChunk> =
    dbName === "clinvar_curated" && records.length > CLINVAR_BULK_CHUNK_SIZE
      ? Array.from({ length: Math.ceil(records.length / CLINVAR_BULK_CHUNK_SIZE) }, (_, index) => ({
          rsid: `${BULK_CHUNK_PREFIX}${index}`,
          source: dbName,
          records: records.slice(
            index * CLINVAR_BULK_CHUNK_SIZE,
            (index + 1) * CLINVAR_BULK_CHUNK_SIZE,
          ),
        }))
      : records;

  try {
    // Clear existing data
    await new Promise<void>((resolve, reject) => {
      const storeNames =
        dbName === "clinvar_curated" && db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE)
          ? [dbName, CLINVAR_BULK_INDEX_STORE]
          : [dbName];
      const tx = db.transaction(storeNames, "readwrite");
      const store = tx.objectStore(dbName);
      const clearReq = store.clear();
      if (dbName === "clinvar_curated" && db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE)) {
        tx.objectStore(CLINVAR_BULK_INDEX_STORE).clear();
      }
      clearReq.onerror = () => reject(clearReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Batch-insert new records
    await new Promise<void>((resolve, reject) => {
      const storeNames =
        dbName === "clinvar_curated" && db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE)
          ? [dbName, CLINVAR_BULK_INDEX_STORE]
          : [dbName];
      const tx = db.transaction(storeNames, "readwrite");
      const store = tx.objectStore(dbName);
      const bulkIndexStore =
        dbName === "clinvar_curated" && db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE)
          ? tx.objectStore(CLINVAR_BULK_INDEX_STORE)
          : null;
      for (const record of storedRecords) {
        store.put(record);
        if (bulkIndexStore && Array.isArray((record as BulkVariantAnnotationChunk).records)) {
          const chunk = record as BulkVariantAnnotationChunk;
          for (const chunkRecord of chunk.records) {
            bulkIndexStore.put({
              rsid: chunkRecord.rsid,
              chunkKey: chunk.rsid,
            } satisfies ClinvarBulkIndexEntry);
          }
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Update metadata
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("metadata", "readwrite");
      const store = tx.objectStore("metadata");
      const meta: DatabaseMetadata = {
        name: dbName,
        loaded: true,
        version,
        sha256,
        storageSchema: storageSchemaFor(dbName),
        loadedAt: new Date().toISOString(),
        recordCount: records.length,
      };
      const req = store.put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Replaces the complete reference set in one IndexedDB transaction. A failed
 * transaction leaves the prior active bundle untouched.
 */
export async function loadReferenceBundle(
  bundleId: string,
  sequence: number,
  databases: ReferenceBundleDatabaseLoad[],
): Promise<void> {
  if (
    databases.length !== REFERENCE_DBS.length ||
    !REFERENCE_DBS.every((name) => databases.some((database) => database.name === name))
  ) {
    throw new Error("Reference bundle must contain every database exactly once.");
  }

  const db = await openDB();
  try {
    const storeNames = [
      ...REFERENCE_DBS,
      "metadata",
      CLINVAR_BULK_INDEX_STORE,
      REFERENCE_BUNDLE_STORE,
    ];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeNames, "readwrite");
      const clinvarIndex = tx.objectStore(CLINVAR_BULK_INDEX_STORE);
      for (const name of REFERENCE_DBS) {
        tx.objectStore(name).clear();
      }
      clinvarIndex.clear();

      for (const database of databases) {
        const store = tx.objectStore(database.name);
        const storedRecords: Array<VariantAnnotation | BulkVariantAnnotationChunk> =
          database.name === "clinvar_curated" && database.records.length > CLINVAR_BULK_CHUNK_SIZE
            ? Array.from({ length: Math.ceil(database.records.length / CLINVAR_BULK_CHUNK_SIZE) }, (_, index) => ({
                rsid: `${BULK_CHUNK_PREFIX}${index}`,
                source: database.name,
                records: database.records.slice(
                  index * CLINVAR_BULK_CHUNK_SIZE,
                  (index + 1) * CLINVAR_BULK_CHUNK_SIZE,
                ),
              }))
            : database.records;

        for (const record of storedRecords) {
          store.put(record);
          if (database.name === "clinvar_curated" && Array.isArray((record as BulkVariantAnnotationChunk).records)) {
            const chunk = record as BulkVariantAnnotationChunk;
            for (const chunkRecord of chunk.records) {
              clinvarIndex.put({ rsid: chunkRecord.rsid, chunkKey: chunk.rsid } satisfies ClinvarBulkIndexEntry);
            }
          }
        }

        tx.objectStore("metadata").put({
          name: database.name,
          loaded: true,
          version: database.version,
          sha256: database.sha256,
          storageSchema: storageSchemaFor(database.name),
          loadedAt: new Date().toISOString(),
          recordCount: database.records.length,
        } satisfies DatabaseMetadata);
      }

      tx.objectStore(REFERENCE_BUNDLE_STORE).put({
        name: "active",
        bundleId,
        sequence,
        activatedAt: new Date().toISOString(),
      } satisfies ActiveReferenceBundle);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Reference bundle activation aborted."));
    });
  } finally {
    db.close();
  }
}

async function scanClinvarBulkChunks(
  db: IDBDatabase,
  missing: Set<string>,
  results: Map<string, VariantAnnotation>
): Promise<void> {
  if (missing.size === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("clinvar_curated", "readonly");
    const store = tx.objectStore("clinvar_curated");
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || missing.size === 0) {
        resolve();
        return;
      }

      const value = cursor.value as Partial<BulkVariantAnnotationChunk>;
      if (Array.isArray(value.records)) {
        for (const record of value.records) {
          if (missing.has(record.rsid)) {
            results.set(record.rsid, record);
            missing.delete(record.rsid);
            if (missing.size === 0) break;
          }
        }
      }

      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function lookupClinvarBulkIndex(
  db: IDBDatabase,
  missing: Set<string>
): Promise<Map<string, Set<string>> | null> {
  if (!db.objectStoreNames.contains(CLINVAR_BULK_INDEX_STORE) || missing.size === 0) {
    return null;
  }

  const chunkTargets = new Map<string, Set<string>>();
  const missingRsids = Array.from(missing);

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CLINVAR_BULK_INDEX_STORE, "readonly");
      const store = tx.objectStore(CLINVAR_BULK_INDEX_STORE);
      let completed = 0;

      for (const rsid of missingRsids) {
        const req = store.get(rsid);
        req.onsuccess = () => {
          const entry = req.result as ClinvarBulkIndexEntry | undefined;
          if (entry?.chunkKey) {
            const rsidsForChunk = chunkTargets.get(entry.chunkKey) ?? new Set<string>();
            rsidsForChunk.add(rsid);
            chunkTargets.set(entry.chunkKey, rsidsForChunk);
          }
          completed++;
          if (completed === missingRsids.length) resolve();
        };
        req.onerror = () => {
          completed++;
          if (completed === missingRsids.length) resolve();
        };
      }

      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }

  return chunkTargets;
}

async function readClinvarBulkChunksByIndex(
  db: IDBDatabase,
  chunkTargets: Map<string, Set<string>>,
  results: Map<string, VariantAnnotation>
): Promise<Set<string> | null> {
  const unresolved = new Set<string>();
  for (const rsids of chunkTargets.values()) {
    for (const rsid of rsids) {
      unresolved.add(rsid);
    }
  }

  const chunkKeys = Array.from(chunkTargets.keys());
  if (chunkKeys.length === 0) return unresolved;

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("clinvar_curated", "readonly");
      const store = tx.objectStore("clinvar_curated");
      let completed = 0;

      for (const chunkKey of chunkKeys) {
        const req = store.get(chunkKey);
        req.onsuccess = () => {
          const chunk = req.result as Partial<BulkVariantAnnotationChunk> | undefined;
          const targetRsids = chunkTargets.get(chunkKey) ?? new Set<string>();
          if (Array.isArray(chunk?.records)) {
            for (const record of chunk.records) {
              if (targetRsids.has(record.rsid)) {
                results.set(record.rsid, record);
                unresolved.delete(record.rsid);
                if (unresolved.size === 0) break;
              }
            }
          }
          completed++;
          if (completed === chunkKeys.length) resolve();
        };
        req.onerror = () => {
          completed++;
          if (completed === chunkKeys.length) resolve();
        };
      }

      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }

  return unresolved;
}

async function queryClinvarBulkMisses(
  db: IDBDatabase,
  missing: Set<string>,
  results: Map<string, VariantAnnotation>
): Promise<void> {
  const chunkTargets = await lookupClinvarBulkIndex(db, missing);
  if (chunkTargets) {
    const unresolvedFromIndex = await readClinvarBulkChunksByIndex(db, chunkTargets, results);
    if (unresolvedFromIndex === null) {
      await scanClinvarBulkChunks(db, missing, results);
      return;
    }

    const indexedRsids = new Set<string>();
    for (const rsids of chunkTargets.values()) {
      for (const rsid of rsids) {
        indexedRsids.add(rsid);
      }
    }

    const unresolved = new Set<string>();
    for (const rsid of missing) {
      if (!indexedRsids.has(rsid) || unresolvedFromIndex?.has(rsid)) {
        unresolved.add(rsid);
      }
    }

    await scanClinvarBulkChunks(db, unresolved, results);
    return;
  }

  await scanClinvarBulkChunks(db, missing, results);
}

/**
 * Query a reference database for annotations matching the given rsids.
 *
 * @returns Map of rsid -> annotation for found variants
 */
export async function queryVariants(
  dbName: ReferenceDatabaseName,
  rsids: string[]
): Promise<Map<string, VariantAnnotation>> {
  if (rsids.length === 0) {
    return new Map<string, VariantAnnotation>();
  }

  const db = await openDB();
  const results = new Map<string, VariantAnnotation>();

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(dbName, "readonly");
      const store = tx.objectStore(dbName);
      let completed = 0;

      for (const rsid of rsids) {
        const req = store.get(rsid);
        req.onsuccess = () => {
          if (req.result) {
            results.set(rsid, req.result as VariantAnnotation);
          }
          completed++;
          if (completed === rsids.length) resolve();
        };
        req.onerror = () => {
          completed++;
          if (completed === rsids.length) resolve();
        };
      }

      tx.onerror = () => reject(tx.error);
    });

    if (dbName === "clinvar_curated" && results.size < rsids.length) {
      const missing = new Set(rsids.filter((rsid) => !results.has(rsid)));
      await queryClinvarBulkMisses(db, missing, results);
    }
  } finally {
    db.close();
  }

  return results;
}

/**
 * Scan the clinvar_curated store and return annotations whose
 * "chrom:pos:ref:alt" key shares a "chrom:pos" prefix with one of the supplied
 * genome positions. ClinVar is keyed by position+allele (NOT by rsid), so
 * callers that only know genome positions use this instead of queryVariants
 * (which does exact-key gets and therefore never matches rsid inputs).
 *
 * Bulk chunks are unwrapped; chunk-marker records are skipped. Returns
 * Map<clinvarKey, VariantAnnotation>. Pair with matchClinVarDiseaseFindings
 * (clinvar-disease-matcher.ts) to apply the alt-allele-carry filter.
 *
 * DNA-4723.
 */
export async function scanClinvarByPosition(
  positionKeys: Set<string>,
): Promise<Map<string, VariantAnnotation>> {
  const db = await openDB();
  const results = new Map<string, VariantAnnotation>();

  if (positionKeys.size === 0) {
    db.close();
    return results;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("clinvar_curated", "readonly");
      const store = tx.objectStore("clinvar_curated");
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        const value = cursor.value as
          | VariantAnnotation
          | Partial<BulkVariantAnnotationChunk>;
        const records = Array.isArray((value as BulkVariantAnnotationChunk).records)
          ? (value as BulkVariantAnnotationChunk).records
          : [value as VariantAnnotation];

        for (const record of records) {
          const rsid = record.rsid || "";
          if (rsid.startsWith(BULK_CHUNK_PREFIX)) continue;

          // ClinVar rsid is "chrom:pos:ref:alt" — match on the "chrom:pos" prefix.
          const parts = rsid.split(":");
          if (parts.length >= 2) {
            const posKey = `${parts[0]}:${parts[1]}`;
            if (positionKeys.has(posKey)) {
              results.set(rsid, record);
            }
          }
        }

        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }

  return results;
}

/**
 * Delete all cached reference databases and metadata.
 * User-facing "Clear my analysis data" action.
 *
 * Closes all tracked connections before deleting the database.
 * Also clears DNA-related browser storage keys.
 */
export async function purgeAll(): Promise<void> {
  clearStoredDnaResults();
  await clearPendingFile();

  // Clear browser-resident DNA analysis data without touching unrelated app preferences.
  try {
    sessionStorage.removeItem("dna-results");
    sessionStorage.removeItem("narrativeData");
    // Remove any other DNA-prefixed session keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("dna-")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage may be unavailable in worker/SSR contexts — ignore
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("dna-")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable in worker/SSR contexts — ignore
  }

  // FIX 2: Close all tracked connections before deleting the database
  Array.from(openConnections).forEach((conn) => {
    try {
      conn.close();
    } catch {
      // Connection may already be closed — ignore
    }
  });
  openConnections.clear();

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(
      `Failed to delete database: ${request.error?.message ?? "unknown error"}`
    ));
    request.onblocked = () => {
      // Database is still in use by another tab despite closing our connections.
      // This is a real failure — the caller should know deletion is blocked.
      reject(new Error(
        "Database deletion blocked by open connections in another tab. " +
        "Please close other tabs using this application and try again."
      ));
    };
  });
}
